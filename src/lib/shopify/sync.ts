import { shopifyGraphql, orderAdminUrl } from '@/lib/shopify/client';
import { ORDER_FULL_QUERY } from '@/lib/shopify/queries';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { londonWallTimeToUtc, parseFlexibleDate, parseFlexibleTime } from '@/lib/dates';
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
  skippedStale: boolean;
  itemCount: number;
}

const gidToLegacyId = (gid: string) => Number(gid.split('/').pop());

/* ── Fulfilment-method classification from Fulfillment Orders ─────────── */
function classifyMethod(ffos: ShopifyFulfillmentOrder[]): FulfillmentMethod {
  const types = new Set(
    ffos.map((f) => f.deliveryMethod?.methodType).filter((t): t is string => !!t)
  );
  if (types.has('PICK_UP') || types.has('PICKUP_POINT')) return 'pickup';
  if (types.has('LOCAL')) return 'local_delivery';
  if (types.has('SHIPPING')) return 'shipping';
  return 'unknown';
}

/* ── Required-action date derivation ──────────────────────────────────── */
interface DateKeys {
  pickup_date: string[]; pickup_time: string[];
  delivery_date: string[]; delivery_time: string[];
}

function findAttr(attrs: Array<{ key?: string; name?: string; value: string | null }>, keys: string[]): string | null {
  const lower = keys.map((k) => k.toLowerCase());
  for (const a of attrs) {
    const name = (a.key ?? a.name ?? '').toLowerCase();
    if (lower.includes(name) && a.value) return a.value;
  }
  return null;
}

function deriveRequiredAt(
  method: FulfillmentMethod,
  attrs: Array<{ key: string; value: string | null }>,
  createdAt: string,
  keys: DateKeys
): { at: string; confirmed: boolean; source: string } {
  const dateKeys = method === 'pickup' ? keys.pickup_date : keys.delivery_date;
  const timeKeys = method === 'pickup' ? keys.pickup_time : keys.delivery_time;

  const rawDate = findAttr(attrs, dateKeys);
  const dateStr = rawDate ? parseFlexibleDate(rawDate) : null;
  if (dateStr) {
    const rawTime = findAttr(attrs, timeKeys);
    const timeStr = rawTime ? parseFlexibleTime(rawTime) : null;
    if (timeStr) {
      return { at: londonWallTimeToUtc(dateStr, timeStr).toISOString(), confirmed: true, source: 'note_attribute' };
    }
    // Date known, time unknown → grouped on the right day, flagged Time TBC
    return { at: londonWallTimeToUtc(dateStr, '00:00').toISOString(), confirmed: false, source: 'note_attribute_date_only' };
  }
  // Temporary fallback only — surfaces as "Collection/Delivery time TBC"
  return { at: createdAt, confirmed: false, source: 'shopify_created' };
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
    .select('id, shopify_updated_at, internal_status, financial_status, pickup_slot_id, needs_attention, needs_attention_reason, required_fulfilment_at, time_confirmed')
    .eq('shopify_order_gid', o.id)
    .maybeSingle();

  // Stale-write guard: never overwrite newer Shopify state with older data.
  if (existing && new Date(o.updatedAt) < new Date(existing.shopify_updated_at)) {
    return {
      orderId: existing.id, orderNumber: o.name, isNew: false,
      becamePaid: false, skippedStale: true, itemCount: 0,
    };
  }

  const method = classifyMethod(o.fulfillmentOrders.nodes);
  const keys = await loadDateKeys();

  // Slot (future feature) outranks note attributes.
  let required = deriveRequiredAt(method, o.customAttributes.map((a) => ({ key: a.key, value: a.value })), o.createdAt, keys);
  if (existing?.pickup_slot_id) {
    const { data: slot } = await db.from('pickup_slots').select('slot_date, start_time, is_confirmed').eq('id', existing.pickup_slot_id).maybeSingle();
    if (slot?.is_confirmed) {
      required = {
        at: londonWallTimeToUtc(slot.slot_date, String(slot.start_time).slice(0, 5)).toISOString(),
        confirmed: true,
        source: 'pickup_slot',
      };
    }
  }

  // Reconcile internal status with Shopify truth. Shopify-terminal states
  // always win; otherwise staff progress is preserved.
  let internalStatus: InternalStatus = (existing?.internal_status as InternalStatus) ?? 'new';
  const refunded = o.displayFinancialStatus === 'REFUNDED';
  if (o.cancelledAt) internalStatus = refunded ? 'refunded' : 'cancelled';
  else if (refunded) internalStatus = 'refunded';
  else if (o.displayFulfillmentStatus === 'FULFILLED') internalStatus = 'fulfilled';
  else if (internalStatus === 'fulfilled' && o.displayFulfillmentStatus !== 'FULFILLED') {
    // Shopify-side change (e.g. fulfilment cancelled) — reopen for staff.
    internalStatus = 'acknowledged';
  }

  const attention =
    method === 'unknown'
      ? { flag: true, reason: 'Fulfilment method could not be determined' }
      : { flag: existing?.needs_attention && existing.needs_attention_reason !== 'Fulfilment method could not be determined' ? existing.needs_attention : false, reason: existing?.needs_attention_reason ?? null };

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
      const loc = o.fulfillmentOrders.nodes.find((f) => f.deliveryMethod?.methodType === 'PICK_UP')?.assignedLocation;
      return loc ? { name: loc.name, address: [loc.address1, loc.city, loc.zip].filter(Boolean).join(', ') } : null;
    })(),
    delivery_address: o.shippingAddress,
    customer_name: o.customer?.displayName ?? o.shippingAddress?.name ?? null,
    customer_email: o.customer?.defaultEmailAddress?.emailAddress ?? o.email,
    customer_phone: o.customer?.defaultPhoneNumber?.phoneNumber ?? o.phone ?? o.shippingAddress?.phone ?? null,
    note: o.note,
    note_attributes: o.customAttributes.map((a) => ({ name: a.key, value: a.value ?? '' })),
    tags: o.tags,
    discounts: o.discountCodes.map((code) => ({ code, amount: o.totalDiscountsSet?.shopMoney.amount })),
    currency: o.currencyCode,
    subtotal: num(o.subtotalPriceSet),
    shipping_total: num(o.totalShippingPriceSet),
    tax_total: num(o.totalTaxSet),
    total: num(o.totalPriceSet),
    refund_summary: o.refunds.map((r) => ({ id: r.id, createdAt: r.createdAt, note: r.note, amount: r.totalRefundedSet?.shopMoney.amount })),
    required_fulfilment_at: required.at,
    time_confirmed: required.confirmed,
    date_source: required.source,
    internal_status: internalStatus,
    needs_attention: attention.flag,
    needs_attention_reason: attention.flag ? attention.reason : null,
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
    await audit({ orderId, eventType: 'order_received', details: { orderNumber: o.name, method } });
  }

  await reconcileReminderJob(orderId, required.at, required.confirmed, internalStatus, method);

  return { orderId, orderNumber: o.name, isNew, becamePaid, skippedStale: false, itemCount: liRows.length };
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

/** Guard: demo/seed orders (fake IDs ≥ 9e11 or 'demo' tag) must never reach Shopify. */
export function isDemoOrder(order: { shopify_order_id: number; tags: string[] }): boolean {
  return order.shopify_order_id >= 900000000000 || order.tags.includes('demo');
}
