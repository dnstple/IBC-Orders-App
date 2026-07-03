import { londonDateKey, dayGroupLabel } from '@/lib/dates';
import type { OrderRow, InternalStatus } from '@/types/db';
import { TERMINAL_STATUSES } from '@/types/db';

/** Pure view logic shared by all board pages (client-safe, unit-testable). */

export type ChipKind = 'note' | 'allergy' | 'gift' | 'time_tbc' | 'cancel_refund' | 'partial';

export function orderChips(o: OrderRow, opts?: { allergyKeywords?: string[] }): ChipKind[] {
  const chips: ChipKind[] = [];
  const allergyWords = opts?.allergyKeywords ?? ['allergy', 'allergen', 'nut', 'gluten', 'dairy', 'intoleran'];
  const noteText = (o.note ?? '').toLowerCase();
  const attrText = o.note_attributes.map((a) => `${a.name} ${a.value}`.toLowerCase()).join(' ');

  if (o.note?.trim()) chips.push('note');
  if (allergyWords.some((w) => noteText.includes(w) || attrText.includes(w))) chips.push('allergy');
  if (attrText.includes('gift') || noteText.includes('gift message')) chips.push('gift');
  if (!o.time_confirmed && !TERMINAL_STATUSES.includes(o.internal_status)) chips.push('time_tbc');
  if (o.cancelled_at || o.refund_summary.length > 0) chips.push('cancel_refund');
  if (o.shopify_fulfillment_status === 'PARTIALLY_FULFILLED') chips.push('partial');
  return chips;
}

export function isOverdue(o: OrderRow, now = new Date()): boolean {
  if (TERMINAL_STATUSES.includes(o.internal_status)) return false;
  if (!o.required_fulfilment_at) return false;
  if (o.time_confirmed) return new Date(o.required_fulfilment_at) < now;
  // Time TBC: overdue once the required DAY has passed in London.
  return londonDateKey(new Date(o.required_fulfilment_at)) < londonDateKey(now);
}

/** Past orders = before today AND fully resolved (fulfilled/cancelled/refunded). */
export function isPast(o: OrderRow, now = new Date()): boolean {
  if (!TERMINAL_STATUSES.includes(o.internal_status)) return false;
  const ref = o.required_fulfilment_at ?? o.shopify_created_at;
  return londonDateKey(new Date(ref)) < londonDateKey(now);
}

/** Anything unresolved, ambiguous or stale belongs in Needs attention. */
export function needsAttention(o: OrderRow, now = new Date()): { flag: boolean; reason: string | null } {
  if (o.needs_attention) return { flag: true, reason: o.needs_attention_reason ?? 'Flagged' };
  if (o.fulfillment_method === 'unknown' && !TERMINAL_STATUSES.includes(o.internal_status)) {
    return { flag: true, reason: 'Fulfilment method could not be determined' };
  }
  if (isOverdue(o, now)) return { flag: true, reason: 'Overdue — not yet resolved' };
  if (!TERMINAL_STATUSES.includes(o.internal_status) && !o.required_fulfilment_at) {
    return { flag: true, reason: 'Missing required date' };
  }
  return { flag: false, reason: null };
}

export interface DateGroup {
  key: string;      // 'attention' | 'past-unresolved' | 'YYYY-MM-DD'
  label: string;    // 'Needs attention' | 'Today' | 'Tomorrow' | 'Sunday 5 July' | 'Past / unresolved'
  orders: OrderRow[];
}

const STATUS_SORT_RANK = (o: OrderRow, now: Date): number => {
  if (isOverdue(o, now)) return 0;
  if (o.internal_status === 'new') return 1;
  if (o.time_confirmed) return 2;
  return 3; // time TBC
};

/** Spec sort: overdue → unacknowledged → confirmed time asc → TBC → recent. */
export function sortWithinGroup(orders: OrderRow[], now = new Date()): OrderRow[] {
  return [...orders].sort((a, b) => {
    const ra = STATUS_SORT_RANK(a, now), rb = STATUS_SORT_RANK(b, now);
    if (ra !== rb) return ra - rb;
    if (ra === 2) {
      return new Date(a.required_fulfilment_at!).getTime() - new Date(b.required_fulfilment_at!).getTime();
    }
    return new Date(b.shopify_created_at).getTime() - new Date(a.shopify_created_at).getTime();
  });
}

/** Group a method-filtered list into Needs attention / Today / Tomorrow / future / past-unresolved. */
export function groupByActionDate(orders: OrderRow[], now = new Date()): DateGroup[] {
  const todayKey = londonDateKey(now);
  const attention: OrderRow[] = [];
  const pastUnresolved: OrderRow[] = [];
  const byDay = new Map<string, OrderRow[]>();

  for (const o of orders) {
    if (isPast(o, now)) continue; // Past Orders live in their own area
    const att = needsAttention(o, now);
    const dayKey = londonDateKey(new Date(o.required_fulfilment_at ?? o.shopify_created_at));
    if (att.flag && dayKey < todayKey) {
      pastUnresolved.push(o);
      continue;
    }
    if (att.flag && o.fulfillment_method === 'unknown') {
      attention.push(o);
      continue;
    }
    const list = byDay.get(dayKey) ?? [];
    list.push(o);
    byDay.set(dayKey, list);
  }

  const groups: DateGroup[] = [];
  if (attention.length) groups.push({ key: 'attention', label: 'Needs attention', orders: sortWithinGroup(attention, now) });
  for (const key of [...byDay.keys()].sort()) {
    const sample = byDay.get(key)![0];
    groups.push({
      key,
      label: dayGroupLabel(new Date(sample.required_fulfilment_at ?? sample.shopify_created_at), now),
      orders: sortWithinGroup(byDay.get(key)!, now),
    });
  }
  if (pastUnresolved.length) {
    groups.push({ key: 'past-unresolved', label: 'Past / unresolved', orders: sortWithinGroup(pastUnresolved, now) });
  }
  return groups;
}

export interface SummaryCounts {
  todayTotal: number;
  newCount: number;
  preparing: number;
  ready: number;
  timeTbc: number;
  overdue: number;
}

export function summarise(orders: OrderRow[], now = new Date()): SummaryCounts {
  const todayKey = londonDateKey(now);
  const active = orders.filter((o) => !TERMINAL_STATUSES.includes(o.internal_status));
  return {
    todayTotal: orders.filter((o) => londonDateKey(new Date(o.required_fulfilment_at ?? o.shopify_created_at)) === todayKey).length,
    newCount: active.filter((o) => o.internal_status === 'new').length,
    preparing: active.filter((o) => o.internal_status === 'preparing').length,
    ready: active.filter((o) => ['ready_for_pickup', 'packed', 'courier_booked'].includes(o.internal_status)).length,
    timeTbc: active.filter((o) => !o.time_confirmed).length,
    overdue: active.filter((o) => isOverdue(o, now)).length,
  };
}

export const STATUS_LABELS: Record<InternalStatus, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  preparing: 'Preparing',
  ready_for_pickup: 'Ready for pickup',
  packed: 'Packed',
  courier_booked: 'Courier booked',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};
