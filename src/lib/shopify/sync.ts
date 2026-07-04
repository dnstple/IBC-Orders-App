import { shopifyGraphql, orderAdminUrl } from '@/lib/shopify/client';
import { ORDER_FULL_QUERY } from '@/lib/shopify/queries';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { londonWallTimeToUtc, londonDateKey, parseFlexibleDate, parseFlexibleTime } from '@/lib/dates';
import { parsePickupAttrs, type PickupAttrs } from '@/lib/pickup-attrs';
import type { FulfillmentMethod, InternalStatus } from '@/types/db';
import { TERMINAL_STATUSES } from '@/types/db';

/* ── Shopify response shapes (subset) ─────────────────────────────────── */
interface ShopifyOrderFull {
  order: {
    id: string;
    legacyResourceId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    cancelledAt: string | null;
    closedAt: string | null;
    test: boolean;
    displayFinancialStatus: string | null;
    displayFulfillmentStatus: string | null;
    note: string | null;
    tags: string[];
    email: string | null;
    phone: string | null;
    customAttributes: Array<{ key: string; value: string | null }>;
    customer: { displayName: string; defaultEmailAddress: { emailAddress: string | null } | null; defaultPhoneNumber: { phoneNumber: string | null } | null } | null;
    shippingAddress: Record<string, string | null> | null;
    currencyCode: string;
    subtotalPriceSet: MoneyBag | null;
    totalShippingPriceSet: MoneyBag | null;
    totalTaxSet: MoneyBag | null;
    totalPriceSet: MoneyBag | null;
    totalDiscountsSet: MoneyBag | null;
    discountCodes: string[];
    refunds: Array<{ id: string; createdAt: string; note: string | null; totalRefundedSet: MoneyBag | null }>;
    lineItems: { nodes: ShopifyLineItem[] };
    fulfillmentOrders: { nodes: ShopifyFulfillmentOrder[] };
    fulfillments: Array<{ id: string; status: string; createdAt: string; trackingInfo: Array<{ number: string | null; company: string | null; url: string | null }> }>;
    events: { nodes: Array<{ id: string; createdAt: string; message: string }> };
  } | null;
}
interface MoneyBag { shopMoney: { amount: string; currencyCode?: string } }
interface ShopifyLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  currentQuantity: number;
  unfulfilledQuantity: number;
  requiresShipping: boolean;
  customAttributes: Array<{ key: string; value: string | null }>;
  originalUnitPriceSet: MoneyBag | null;
  image: { url: string } | null;
}
interface ShopifyFulfillmentOrder {
  id: string;
  status: string;
  requestStatus: string | null;
  fulfillAt: string | null;
  deliveryMethod: { methodType: string } | null;
  assignedLocation: { name: string | null; address1: string | null; city: string | null; zip: string | null; location: { id: string } | null } | null;
  supportedActions: Array<{ action: string }>;
  lineItems: { nodes: Array<{ id: string; remainingQuantity: number; totalQuantity: number; lineItem: { id: string } | null }> };
}

export interface SyncResult {
  orderId: string;          // Supabase uuid
  orderNumber: string;
  isNew: boolean;
  becamePaid: boolean;      // newly paid → trigger new-order alerts
  isPickup: boolean;
  skippedStale: boolean;
  itemCount: number;
}

const gidToLegacyId = (gid: string) => Number(gid.split('/').pop());

/* ── Fulfilment-method classification ─────────────────────────────────── */
function classifyMethod(ffos: ShopifyFulfillmentOrder[], pickupAttrs: PickupAttrs): FulfillmentMethod {
  // The pickup scheduler is authoritative when present.
  if (pickupAttrs.requested) return 'pickup';
  const types = new Set(
    ffos.map((f) => f.deliveryMethod?.methodType).filter((t): t is string => !!t)
  );
  if (types.has('PICK_UP') || types.has('PICKUP_POINT')) return 'pickup';
  if (types.has('LOCAL')) return 'local_delivery';
  if (types.has('SHIPPING')) return 'shipping';
  return 'unknown';
}

/* ── Required-action instant + operational date ───────────────────────── */
interface DateKeys {
  pickup_date: string[]; pickup_time: string[];
  delivery_date: string[]; delivery_time: string[];
}

interface Derived {
  at: string;              // required_fulfilment_at instant
  confirmed: boolean;      // false ⇒ "Time TBC"
  source: string;
  operationalDate: string; // London 'YYYY-MM-DD'
}

function findAttr(attrs: Array<{ key: string; value: string | null }>, keys: string[]): string | null {
  const lower = keys.map((k) => k.toLowerCase());
  for (const a of attrs) {
    if (lower.includes(a.key.toLowerCase()) && a.value) return a.value;
  }
  return null;
}

function deriveDates(
  method: FulfillmentMethod,
  pickup: PickupAttrs,
  attrs: Array<{ key: string; value: string | null }>,
  createdAt: string,
  keys: DateKeys
): Derived {
  // 1. Pickup scheduler slot — highest priority, fully confirmed.
  if (pickup.requested && pickup.slotStart) {
    return {
      at: new Date(pickup.slotStart).toISOString(),
      confirmed: true,
      source: 'ibc_slot',
      // The scheduler writes the London-local date; trust it over any UTC
      // re-derivation so days never shift across midnight/DST.
      operationalDate: pickup.date ?? londonDateKey(new Date(pickup.slotStart)),
    };
  }
  // 2. Pickup date without a slot time.
  if (pickup.requested && pickup.date) {
    return {
      at: londonWallTimeToUtc(pickup.date, '00:00').toISOString(),
      confirmed: false,
      source: 'ibc_date_only',
      operationalDate: pickup.date,
    };
  }

  // 3. Legacy note-attribute keys (kept for older orders).
  const dateKeys = method === 'pickup' ? keys.pickup_date : keys.delivery_date;
  const timeKeys = method === 'pickup' ? keys.pickup_time : keys.delivery_time;
  const rawDate = findAttr(attrs, dateKeys);
  const dateStr = rawDate ? parseFlexibleDate(rawDate) : null;
  if (dateStr) {
    const rawTime = findAttr(attrs, timeKeys);
    const timeStr = rawTime ? parseFlexibleTime(rawTime) : null;
    return {
      at: londonWallTimeToUtc(dateStr, timeStr ?? '00:00').toISOString(),
      confirmed: Boolean(timeStr),
      source: timeStr ? 'note_attribute' : 'note_attribute_date_only',
      operationalDate: dateStr,
    };
  }

  // 4. Fallback: order creation. For delivery this IS the operational date
  //    (spec: delivery uses order creation date); for pickup it surfaces
  //    as "Collection time TBC".
  return {
    at: createdAt,
    confirmed: false,
    source: 'shopify_created',
    operationalDate: londonDateKey(new Date(createdAt)),
  };
}

async function loadDateKeys(): Promise<DateKeys> {
  const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', 'date_attribute_keys').single();
  return (data?.value as DateKeys) ?? {
    pickup_date: ['Pickup Date'], pickup_time: ['Pickup Time'],
    delivery_date: ['Delivery Date'], delivery_time: ['Delivery Time'],
  };
}

/* ── Main sync: fetch full truth from Shopify, upsert locally ─────────── */
export async function syncOrderFromShopify(orderGid: string): Promise<SyncResult> {
  const db = supabaseAdmin();
  const data = await shopifyGraphql<ShopifyOrderFull>(ORDER_FULL_QUERY, { id: orderGid }, 'OrderFull');
  const o = data.order;
  if (!o) throw new Error(`Order not found in Shopify: ${orderGid}`);

  const { data: existing } = await db
    .from('orders')
    .select('id, shopify_updated_at, internal_status, financial_status, pickup_slot_id, needs_attention, needs_attention_reason')
    .eq('shopify_order_gid', o.id)
    .maybeSingle();

  // Stale-write guard: never overwrite newer Shopify state with older data.
  if (existing && new Date(o.updatedAt) < new Date(existing.shopify_updated_at)) {
    return {
      orderId: existing.id, orderNumber: o.name, isNew: false,
      becamePaid: false, isPickup: false, skippedStale: true, itemCount: 0,
    };
  }

  const attrs = o.customAttributes.map((a) => ({ key: a.key, value: a.value }));
  const pickupAttrs = parsePickupAttrs(attrs);
  const method = classifyMethod(o.fulfillmentOrders.nodes, pickupAttrs);
  const keys = await loadDateKeys();
  const derived = deriveDates(method, pickupAttrs, attrs, o.createdAt, keys);

  // Reconcile internal status with Shopify truth. Shopify-terminal states
  // always win; otherwise staff progress is preserved.
  let internalStatus: InternalStatus = (existing?.internal_status as InternalStatus) ?? 'new';
  const refunded = o.displayFinancialStatus === 'REFUNDED';
  // Shopify's ready-for-pickup state lives on the fulfilment order:
  // a PICK_UP fulfilment order in IN_PROGRESS means it was marked ready
  // (by this app or directly in Shopify admin).
  const pickupReadyInShopify = o.fulfillmentOrders.nodes.some(
    (f) => f.deliveryMethod?.methodType === 'PICK_UP' && f.status === 'IN_PROGRESS'
  );
  if (o.cancelledAt) internalStatus = refunded ? 'refunded' : 'cancelled';
  else if (refunded) internalStatus = 'refunded';
  else if (o.displayFulfillmentStatus === 'FULFILLED') internalStatus = 'fulfilled';
  else if (internalStatus === 'fulfilled' && o.displayFulfillmentStatus !== 'FULFILLED') {
    // Shopify-side change (e.g. fulfilment cancelled) — reopen for staff.
    internalStatus = 'acknowledged';
  } else if (pickupReadyInShopify) {
    // Ready in Shopify (from either side) → reflect it.
    internalStatus = 'ready_for_pickup';
  } else if (internalStatus === 'ready_for_pickup') {
    // App thought it was ready but Shopify disagrees — never pretend.
    internalStatus = 'acknowledged';
  }

  const attention =
    method === 'unknown' && !TERMINAL_STATUSES.includes(internalStatus)
      ? { flag: true, reason: 'Fulfilment method could not be determined' as string | null }
      : { flag: false, reason: null as string | null };

  const num = (m: MoneyBag | null) => (m ? Number(m.shopMoney.amount) : null);

  const row = {
    shopify_order_id: Number(o.legacyResourceId),
    shopify_order_gid: o.id,
    order_number: o.name,
    shopify_admin_url: orderAdminUrl(o.legacyResourceId),
    shopify_created_at: o.createdAt,
    shopify_updated_at: o.updatedAt,
    financial_status: o.displayFinancialStatus,
    shopify_fulfillment_status: o.displayFulfillmentStatus,
    cancelled_at: o.cancelledAt,
    closed_at: o.closedAt,
    test: o.test,
    fulfillment_method: method,
    pickup_location: (() => {
      if (pickupAttrs.location) return { name: pickupAttrs.location };
      const loc = o.fulfillmentOrders.nodes.find((f) => f.deliveryMethod?.methodType === 'PICK_UP')?.assignedLocation;
      return loc ? { name: loc.name, address: [loc.address1, loc.city, loc.zip].filter(Boolean).join(', ') } : null;
    })(),
    delivery_address: o.shippingAddress,
    customer_name: o.customer?.displayName ?? o.shippingAddress?.name ?? null,
    customer_email: o.customer?.defaultEmailAddress?.emailAddress ?? o.email,
    customer_phone: o.customer?.defaultPhoneNumber?.phoneNumber ?? o.phone ?? o.shippingAddress?.phone ?? null,
    note: o.note,
    note_attributes: attrs.map((a) => ({ name: a.key, value: a.value ?? '' })),
    tags: o.tags,
    discounts: o.discountCodes.map((code) => ({ code, amount: o.totalDiscountsSet?.shopMoney.amount })),
    currency: o.currencyCode,
    subtotal: num(o.subtotalPriceSet),
    shipping_total: num(o.totalShippingPriceSet),
    tax_total: num(o.totalTaxSet),
    total: num(o.totalPriceSet),
    refund_summary: o.refunds.map((r) => ({ id: r.id, createdAt: r.createdAt, note: r.note, amount: r.totalRefundedSet?.shopMoney.amount })),
    required_fulfilment_at: derived.at,
    time_confirmed: derived.confirmed,
    date_source: derived.source,
    operational_date: derived.operationalDate,
    /* Pickup scheduler fields */
    pickup_requested: pickupAttrs.requested,
    pickup_date: pickupAttrs.date,
    pickup_slot_start: pickupAttrs.slotStart ? new Date(pickupAttrs.slotStart).toISOString() : null,
    pickup_slot_end: pickupAttrs.slotEnd ? new Date(pickupAttrs.slotEnd).toISOString() : null,
    pickup_slot_label: pickupAttrs.slotLabel,
    pickup_delay_minutes: pickupAttrs.delayMinutes,
    internal_status: internalStatus,
    needs_attention: attention.flag,
    needs_attention_reason: attention.reason,
    raw_payload: o as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };

  const { data: upserted, error } = await db
    .from('orders')
    .upsert(row, { onConflict: 'shopify_order_gid' })
    .select('id')
    .single();
  if (error) throw new Error(`orders upsert failed: ${error.message}`);
  const orderId = upserted.id as string;

  /* line items */
  const liRows = o.lineItems.nodes.map((li) => ({
    order_id: orderId,
    shopify_line_item_id: gidToLegacyId(li.id),
    shopify_line_item_gid: li.id,
    title: li.title,
    variant_title: li.variantTitle,
    sku: li.sku,
    quantity: li.quantity,
    fulfilled_quantity: Math.max(0, li.currentQuantity - li.unfulfilledQuantity),
    refunded_quantity: Math.max(0, li.quantity - li.currentQuantity),
    unit_price: li.originalUnitPriceSet ? Number(li.originalUnitPriceSet.shopMoney.amount) : null,
    image_url: li.image?.url ?? null,
    properties: li.customAttributes.map((a) => ({ name: a.key, value: a.value ?? '' })),
    requires_shipping: li.requiresShipping,
  }));
  if (liRows.length) {
    const { error: liErr } = await db.from('order_line_items').upsert(liRows, { onConflict: 'order_id,shopify_line_item_id' });
    if (liErr) throw new Error(`line items upsert failed: ${liErr.message}`);
  }

  /* fulfillment orders → fulfillment_groups */
  const fgRows = o.fulfillmentOrders.nodes.map((f) => ({
    order_id: orderId,
    shopify_fulfillment_order_gid: f.id,
    status: f.status,
    request_status: f.requestStatus,
    delivery_method_type: f.deliveryMethod?.methodType ?? null,
    assigned_location: f.assignedLocation ? { name: f.assignedLocation.name } : null,
    fulfill_at: f.fulfillAt,
    line_items: f.lineItems.nodes.map((n) => ({
      ffoLineItemGid: n.id,
      orderLineItemGid: n.lineItem?.id ?? '',
      remainingQuantity: n.remainingQuantity,
      totalQuantity: n.totalQuantity,
    })),
    supported_actions: f.supportedActions.map((a) => a.action),
  }));
  if (fgRows.length) {
    const { error: fgErr } = await db.from('fulfillment_groups').upsert(fgRows, { onConflict: 'shopify_fulfillment_order_gid' });
    if (fgErr) throw new Error(`fulfillment groups upsert failed: ${fgErr.message}`);
  }

  const isNew = !existing;
  const becamePaid =
    o.displayFinancialStatus === 'PAID' &&
    (isNew || existing?.financial_status !== 'PAID');

  if (!isNew) {
    await audit({ orderId, eventType: 'shopify_synced', details: { updatedAt: o.updatedAt, fulfillmentStatus: o.displayFulfillmentStatus } });
  } else {
    await audit({ orderId, eventType: 'order_received', details: { orderNumber: o.name, method, pickupSlot: pickupAttrs.slotLabel } });
  }

  await reconcileReminderJob(orderId, derived.at, derived.confirmed, internalStatus, method);

  return {
    orderId, orderNumber: o.name, isNew, becamePaid,
    isPickup: method === 'pickup',
    skippedStale: false, itemCount: liRows.length,
  };
}

/* ── Incremental reconciliation (auto-resync) ─────────────────────────── */
export const ORDERS_UPDATED_QUERY = /* GraphQL */ `
  query OrdersUpdated($first: Int!, $query: String, $after: String) {
    orders(first: $first, query: $query, after: $after, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { id updatedAt }
    }
  }
`;

/**
 * Sync only orders whose Shopify updatedAt is newer than the last successful
 * reconcile (with overlap), instead of re-fetching history. Idempotent —
 * the per-order stale guard makes repeats harmless.
 */
export async function reconcileUpdatedOrders(sinceIso: string): Promise<{ synced: number; failed: number; errors: string[] }> {
  const overlap = new Date(new Date(sinceIso).getTime() - 10 * 60000).toISOString();
  const search = `updated_at:>='${overlap}'`;
  let synced = 0, failed = 0, cursor: string | null = null;
  const errors: string[] = [];

  for (let page = 0; page < 4; page++) {
    const data: {
      orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string }> };
    } = await shopifyGraphql(ORDERS_UPDATED_QUERY, { first: 50, query: search, after: cursor }, 'OrdersUpdated');

    for (const node of data.orders.nodes) {
      try {
        await syncOrderFromShopify(node.id);
        synced++;
      } catch (err) {
        failed++;
        if (errors.length < 5) errors.push(`${node.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return { synced, failed, errors };
}

/* ── One-hour reminder scheduling (idempotent) ────────────────────────── */
async function reconcileReminderJob(
  orderId: string,
  requiredAt: string,
  confirmed: boolean,
  status: InternalStatus,
  method: FulfillmentMethod
): Promise<void> {
  const db = supabaseAdmin();
  const settle = TERMINAL_STATUSES.includes(status) || status === 'ready_for_pickup';

  // Cancel any pending reminder that no longer matches (time changed, order done)
  await db.from('scheduled_jobs')
    .update({ status: 'cancelled' })
    .eq('order_id', orderId)
    .eq('kind', 'reminder_1h')
    .eq('status', 'pending')
    .neq('dedupe_key', `reminder_1h:${orderId}:${requiredAt}`);

  if (!confirmed || settle || method === 'unknown') return;

  const { data: lead } = await db.from('app_settings').select('value').eq('key', 'reminders').single();
  const minutes = method === 'pickup'
    ? (lead?.value?.pickup_lead_minutes ?? 60)
    : (lead?.value?.delivery_lead_minutes ?? 60);
  const runAt = new Date(new Date(requiredAt).getTime() - minutes * 60000);
  if (runAt <= new Date()) return; // never schedule in the past

  await db.from('scheduled_jobs').upsert(
    {
      order_id: orderId,
      kind: 'reminder_1h',
      run_at: runAt.toISOString(),
      status: 'pending',
      dedupe_key: `reminder_1h:${orderId}:${requiredAt}`,
    },
    { onConflict: 'dedupe_key', ignoreDuplicates: true }
  );
}

/**
 * Guard: demo/seed orders must never reach Shopify.
 * Seeded orders use IDs in the reserved 900000000000–900000000999 range
 * plus a 'demo' tag. Real Shopify order IDs are ~8e12, far outside this
 * range — an open-ended >= check would (and once did) swallow real orders.
 */
export function isDemoOrder(order: { shopify_order_id: number; tags: string[] }): boolean {
  const inSeedRange = order.shopify_order_id >= 900000000000 && order.shopify_order_id < 900000001000;
  return inSeedRange || order.tags.includes('demo');
}
