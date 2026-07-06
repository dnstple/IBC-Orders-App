import { londonDateKey, formatLondonTime, TZ } from '@/lib/dates';
import type { OrderRow } from '@/types/db';

/**
 * OperationalOrder: the normalised, UI-facing view of an order.
 * Shopify remains the source of truth; this maps its state (plus the
 * ibc_* pickup-scheduler attributes already parsed at sync time) into the
 * operational shape the dashboard renders. Centralised so no component
 * reads raw attributes or invents statuses.
 */
export interface OperationalOrder {
  id: string;
  orderNumber: string;
  orderType: 'pickup' | 'delivery';
  /** London-local 'YYYY-MM-DD' driving Today / Future / Past grouping. */
  operationalDate: string;
  /** Display time: slot range for pickup, order time for delivery. */
  operationalTime?: string;
  pickupDate?: string;
  pickupSlotStart?: string;
  pickupSlotEnd?: string;
  pickupSlotLabel?: string;
  pickupLocation?: string;
  /** Shopify-native display status (never internal jargon). */
  nativeOrderStatus: string;
  financialStatus: string;
  fulfilmentStatus: string;
  isCancelled: boolean;
  shopifyAdminUrl: string;
}

export function isPickupOrder(o: OrderRow): boolean {
  return o.pickup_requested || o.fulfillment_method === 'pickup';
}

export function operationalDateKey(o: OrderRow): string {
  if (o.operational_date) return o.operational_date;
  if (isPickupOrder(o) && o.pickup_date) return o.pickup_date;
  return londonDateKey(new Date(o.shopify_created_at));
}

/** Compact slot display: "3:30–4:00pm" (falls back to start time only). */
export function slotTimeRange(startIso: string | null, endIso: string | null): string | null {
  if (!startIso) return null;
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
      .format(d).replace(' ', '').toLowerCase();
  const start = fmt(new Date(startIso));
  if (!endIso) return start;
  const end = fmt(new Date(endIso));
  // "3:30pm–4:00pm" → "3:30–4:00pm" when both share a suffix
  const suffix = end.slice(-2);
  const startTrimmed = start.endsWith(suffix) ? start.slice(0, -2) : start;
  return `${startTrimmed}–${end}`;
}

/**
 * Shopify-native status label. Internal operational stages (Preparing,
 * Packed, Courier booked) are surfaced only while an order is live; the
 * word "Acknowledged" is never shown anywhere.
 */
export function nativeStatus(o: OrderRow): string {
  if (o.cancelled_at) return 'Cancelled';
  if (o.financial_status === 'REFUNDED') return 'Refunded';
  if (o.shopify_fulfillment_status === 'FULFILLED') return 'Fulfilled';
  if (o.internal_status === 'ready_for_pickup') return 'Ready for pickup';
  if (o.shopify_fulfillment_status === 'PARTIALLY_FULFILLED') return 'Partially fulfilled';
  if (o.internal_status === 'courier_booked') return 'Courier booked';
  if (o.internal_status === 'packed') return 'Packed';
  if (o.internal_status === 'preparing') return 'Preparing';
  return 'Unfulfilled';
}

export function statusBadgeClass(label: string): string {
  switch (label) {
    case 'Cancelled':
    case 'Refunded':
      return 'bg-red-50 text-red-700 ring-red-200';
    case 'Fulfilled':
      return 'bg-stone-100 text-stone-600 ring-stone-200';
    case 'Ready for pickup':
      return 'bg-emerald-50 text-emerald-800 ring-emerald-300';
    case 'Partially fulfilled':
      return 'bg-violet-50 text-violet-800 ring-violet-200';
    case 'Preparing':
    case 'Packed':
    case 'Courier booked':
      return 'bg-indigo-50 text-indigo-800 ring-indigo-200';
    default:
      return 'bg-amber-50 text-amber-900 ring-amber-300'; // Unfulfilled
  }
}

export function toOperationalOrder(o: OrderRow): OperationalOrder {
  const pickup = isPickupOrder(o);
  const dateKey = operationalDateKey(o);
  const slotRange = slotTimeRange(o.pickup_slot_start, o.pickup_slot_end);

  return {
    id: o.id,
    orderNumber: o.order_number,
    orderType: pickup ? 'pickup' : 'delivery',
    operationalDate: dateKey,
    operationalTime: pickup
      ? slotRange ?? undefined
      : `Ordered ${formatLondonTime(new Date(o.shopify_created_at))}`,
    pickupDate: o.pickup_date ?? undefined,
    pickupSlotStart: o.pickup_slot_start ?? undefined,
    pickupSlotEnd: o.pickup_slot_end ?? undefined,
    pickupSlotLabel: o.pickup_slot_label ?? undefined,
    pickupLocation: o.pickup_location?.name ?? undefined,
    nativeOrderStatus: nativeStatus(o),
    financialStatus: o.financial_status ?? 'UNKNOWN',
    fulfilmentStatus: o.shopify_fulfillment_status ?? 'UNFULFILLED',
    isCancelled: Boolean(o.cancelled_at),
    shopifyAdminUrl: o.shopify_admin_url,
  };
}

/* ── Grouping & sorting ─────────────────────────────────────────────────── */

export type DashboardTab = 'today' | 'future' | 'past';

export function tabFor(o: OrderRow, now = new Date()): DashboardTab {
  const key = operationalDateKey(o);
  const today = londonDateKey(now);
  if (key === today) return 'today';
  return key > today ? 'future' : 'past';
}

/** Pickup first by slot start (no-slot last), delivery by order time asc. */
export function sortPickup(orders: OrderRow[]): OrderRow[] {
  return [...orders].sort((a, b) => {
    if (a.pickup_slot_start && b.pickup_slot_start) {
      return new Date(a.pickup_slot_start).getTime() - new Date(b.pickup_slot_start).getTime();
    }
    if (a.pickup_slot_start) return -1;
    if (b.pickup_slot_start) return 1;
    return new Date(a.shopify_created_at).getTime() - new Date(b.shopify_created_at).getTime();
  });
}

export function sortDelivery(orders: OrderRow[]): OrderRow[] {
  return [...orders].sort(
    (a, b) => new Date(a.shopify_created_at).getTime() - new Date(b.shopify_created_at).getTime()
  );
}

export interface DaySections {
  dateKey: string;
  pickup: OrderRow[];
  delivery: OrderRow[];
}

/** Group a set of orders into per-day pickup/delivery sections, sorted. */
export function groupByOperationalDay(orders: OrderRow[]): DaySections[] {
  const byDay = new Map<string, { pickup: OrderRow[]; delivery: OrderRow[] }>();
  for (const o of orders) {
    const key = operationalDateKey(o);
    const bucket = byDay.get(key) ?? { pickup: [], delivery: [] };
    (isPickupOrder(o) ? bucket.pickup : bucket.delivery).push(o);
    byDay.set(key, bucket);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([dateKey, b]) => ({
      dateKey,
      pickup: sortPickup(b.pickup),
      delivery: sortDelivery(b.delivery),
    }));
}

/* ── Urgency for pickup orders ─────────────────────────────────────────── */

export type DueState = 'due_soon' | 'due_now' | null;

/**
 * 'due_soon': pickup slot starts within 30 minutes.
 * 'due_now':  pickup slot has started and the order isn't collected yet.
 * Never set for cancelled/refunded/fulfilled orders.
 */
export function dueState(o: OrderRow, now = new Date()): DueState {
  if (!isPickupOrder(o) || !o.pickup_slot_start) return null;
  if (['fulfilled', 'cancelled', 'refunded'].includes(o.internal_status) || o.cancelled_at) return null;
  const start = new Date(o.pickup_slot_start).getTime();
  const diffMin = (start - now.getTime()) / 60000;
  if (diffMin <= 0) return 'due_now';
  if (diffMin <= 30) return 'due_soon';
  return null;
}
