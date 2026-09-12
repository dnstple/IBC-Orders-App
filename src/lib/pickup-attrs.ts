/**
 * Parsing for the pickup-scheduler custom attributes written onto Shopify
 * orders (additional details / cart attributes):
 *
 *   ibc_pickup_requested      "true"
 *   ibc_pickup_date           "2026-07-05"
 *   ibc_pickup_slot_start     "2026-07-05T15:30:00+01:00"
 *   ibc_pickup_slot_end       "2026-07-05T16:00:00+01:00"
 *   ibc_pickup_slot_label     "Sunday 5 July, 3:30–4:00pm"
 *   ibc_pickup_delay_minutes  "60"
 *   ibc_pickup_location       "Italian Bear Chocolate"
 *
 * All parsing is centralised here — the UI must never read raw attributes.
 * Slot start/end carry their own UTC offset (+01:00 BST / +00:00 GMT), so
 * parsing them as ISO instants is timezone-safe; the London day is taken
 * from ibc_pickup_date (already a London-local date), never from a UTC
 * conversion of the timestamp.
 */

export interface PickupAttrs {
  requested: boolean;
  /** 'YYYY-MM-DD' London-local date, validated. */
  date: string | null;
  /** ISO instant, validated parseable. */
  slotStart: string | null;
  slotEnd: string | null;
  slotLabel: string | null;
  location: string | null;
  delayMinutes: number | null;
}

export const EMPTY_PICKUP_ATTRS: PickupAttrs = {
  requested: false,
  date: null,
  slotStart: null,
  slotEnd: null,
  slotLabel: null,
  location: null,
  delayMinutes: null,
};

interface NamedAttr {
  name?: string | null;
  key?: string | null;
  value?: string | null;
}

function attrValue(attrs: NamedAttr[], key: string): string | null {
  for (const a of attrs) {
    const name = (a.name ?? a.key ?? '').trim().toLowerCase();
    if (name === key && a.value != null && String(a.value).trim() !== '') {
      return String(a.value).trim();
    }
  }
  return null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(DATE_RE);
  if (!m) return null;
  const month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return v;
}

function validInstant(v: string | null): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : v;
}

export function parsePickupAttrs(attrs: NamedAttr[]): PickupAttrs {
  const requested = (attrValue(attrs, 'ibc_pickup_requested') ?? '').toLowerCase() === 'true';
  const date = validDate(attrValue(attrs, 'ibc_pickup_date'));
  const slotStart = validInstant(attrValue(attrs, 'ibc_pickup_slot_start'));
  const slotEnd = validInstant(attrValue(attrs, 'ibc_pickup_slot_end'));
  const delayRaw = attrValue(attrs, 'ibc_pickup_delay_minutes');
  const delay = delayRaw != null && /^\d+$/.test(delayRaw) ? parseInt(delayRaw, 10) : null;

  return {
    requested,
    date,
    slotStart,
    slotEnd,
    slotLabel: attrValue(attrs, 'ibc_pickup_slot_label'),
    location: attrValue(attrs, 'ibc_pickup_location'),
    delayMinutes: delay,
  };
}

/* ── Full fulfilment-choice contract (storefront cart attributes) ────────
 * Three valid shapes:
 *   standard delivery  → delivery_method=delivery, delivery_option=standard.
 *                        NO date exists — never invent one, never fall back
 *                        to the order date.
 *   scheduled delivery → + delivery_date (YYYY-MM-DD wall-clock, a REQUEST
 *                        not a promise) and delivery_label (display only).
 *   collection         → ibc_pickup_* keys (parsed above).
 * delivery_method is absent on every order before the picker shipped, so
 * ibc_pickup_requested === "true" (strict — "false" exists on live orders)
 * remains a pickup signal on its own.
 */

export interface FulfilmentAttrs {
  /** 'delivery' | 'pickup' from the picker; null on historical orders. */
  deliveryMethod: 'delivery' | 'pickup' | null;
  option: 'standard' | 'scheduled' | null;
  /** Requested delivery day, YYYY-MM-DD wall-clock. Scheduled only. */
  deliveryDate: string | null;
  deliveryLabel: string | null;
  pickup: PickupAttrs;
}

export function parseFulfilmentAttrs(attrs: NamedAttr[]): FulfilmentAttrs {
  const pickup = parsePickupAttrs(attrs);
  const dm = attrValue(attrs, 'delivery_method');
  const rawOpt = attrValue(attrs, 'delivery_option');
  const option = rawOpt === 'standard' || rawOpt === 'scheduled' ? rawOpt : null;
  const deliveryDate = option === 'scheduled' ? validDate(attrValue(attrs, 'delivery_date')) : null;
  return {
    deliveryMethod: dm === 'pickup' ? 'pickup' : dm === 'delivery' ? 'delivery' : null,
    option,
    deliveryDate,
    deliveryLabel: deliveryDate ? attrValue(attrs, 'delivery_label') : null,
    pickup,
  };
}
