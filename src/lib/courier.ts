import type { OrderRow } from '@/types/db';

/**
 * Same-day courier orders — read-only view over the cart attributes owned
 * by the Pickup Scheduler app. This app must NEVER write any ibc_courier_*
 * or delivery_* attribute (orderUpdate replaces customAttributes wholesale,
 * which would wipe the booking, tracking link and pickup slot in one go).
 *
 * Recognition is delivery_method="delivery" AND delivery_option="sameday",
 * together — never the presence of ibc_courier_* keys (a failed booking has
 * none, and that's the order the shop most needs to see), and never
 * delivery_option alone (a basket that switched back to collection can
 * briefly carry a stale option; classification lets pickup win).
 */

export type CourierBookingStatus = 'booked' | 'needs_review' | 'failed' | 'unbooked';

export interface CourierInfo {
  /** Booking state. 'unbooked' = no ibc_courier_status at all — the booking
   *  never ran (webhook/app failure). The most dangerous state: make it loud. */
  status: CourierBookingStatus;
  note: string | null;
  bookedAt: string | null;
  riderName: string | null;
  lastStatus: string | null;
  statusUpdatedAt: string | null;
  /** What we asked for: basket packed + rider requested (prep time included). */
  plannedReadyAt: string | null;
  /** Courier's own live estimate, when the status webhook has reported one. */
  courierEta: string | null;
  /** For display: courier ETA when present, else planned ready time. */
  estimatedPickupAt: string | null;
  etaSource: 'courier' | 'planned' | null;
  /** The time the courier is contractually held to — what the customer bought. */
  deadlineAt: string | null;
  /** Customer's words for it ("By 5:00pm"). Display only — never parse. */
  deadlineLabel: string | null;
  trackingUrl: string | null;
  jobUrl: string | null;
  /** What the customer paid for delivery (pence). */
  pricePence: number | null;
  /** What Gophr charged the shop (pence). Normally LARGER than pricePence —
   *  delivery is priced just under cost by design. Never render as an error. */
  quotePence: number | null;
  /** Postcode the price was quoted for; compare quietly with the address. */
  quotedPostcode: string | null;
}

const instant = (v: string | null): string | null =>
  v && !Number.isNaN(Date.parse(v)) ? v : null;

const pence = (v: string | null): number | null =>
  v != null && /^\d+$/.test(v.trim()) ? parseInt(v.trim(), 10) : null;

function reader(o: OrderRow) {
  const map = new Map<string, string>();
  for (const a of o.note_attributes ?? []) {
    const v = (a.value ?? '').trim();
    if (v) map.set(a.name.trim().toLowerCase(), v);
  }
  return (name: string) => map.get(name) ?? null;
}

/** delivery_method=delivery + delivery_option=sameday, with pickup winning
 *  any conflict (classification already lets ibc_pickup_requested/pickup win). */
export function isSameDayCourier(o: OrderRow): boolean {
  return (
    o.fulfillment_method !== 'pickup' &&
    !o.pickup_requested &&
    o.delivery_option === 'sameday'
  );
}

export function courierInfo(o: OrderRow): CourierInfo {
  const attr = reader(o);

  // Older orders carry only delivery_window_start/_end — same instants,
  // older names. Prefer the newer keys, fall back rather than hiding.
  const plannedReadyAt = instant(attr('delivery_ready_at')) ?? instant(attr('delivery_window_start'));
  const deadlineAt = instant(attr('delivery_deadline')) ?? instant(attr('delivery_window_end'));
  const courierEta = instant(attr('ibc_courier_eta'));

  const rawStatus = attr('ibc_courier_status');
  const status: CourierBookingStatus =
    rawStatus === 'booked' || rawStatus === 'needs_review' || rawStatus === 'failed'
      ? rawStatus
      : 'unbooked';

  return {
    status,
    note: attr('ibc_courier_note'),
    bookedAt: instant(attr('ibc_courier_booked_at')),
    riderName: attr('ibc_courier_courier_name'),
    lastStatus: attr('ibc_courier_last_status'),
    statusUpdatedAt: instant(attr('ibc_courier_updated_at')),
    plannedReadyAt,
    courierEta,
    estimatedPickupAt: courierEta ?? plannedReadyAt,
    etaSource: courierEta ? 'courier' : plannedReadyAt ? 'planned' : null,
    deadlineAt,
    deadlineLabel: attr('delivery_label'),
    trackingUrl: attr('ibc_courier_tracking_url'),
    jobUrl: attr('ibc_courier_job_url'),
    pricePence: pence(attr('delivery_price_pence')),
    quotePence: pence(attr('ibc_courier_quote_pence')),
    quotedPostcode: attr('delivery_postcode'),
  };
}

/**
 * The courier charge rides in the basket as a hidden product (Shopify Basic
 * can't price shipping via an app at checkout). SKUs IBC-DEL-0495…IBC-DEL-4995.
 * It is not a thing: exclude from packing, item counts and packing slips;
 * show only as the delivery charge on the payment summary.
 */
export function isDeliveryChargeLine(sku: string | null | undefined): boolean {
  return Boolean(sku && sku.toUpperCase().startsWith('IBC-DEL-'));
}

/** The message the shop currently types by hand, ready for one-click copy. */
export function trackingMessage(trackingUrl: string): string {
  return `Your Italian Bear order is on its way — track your rider here: ${trackingUrl}`;
}
