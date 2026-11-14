/**
 * Who gets a thank-you email, which version, and when. Pure functions (no
 * database, no network) so every rule is covered by tests/visit-emails.test.ts.
 */
import type { Shop, VisitEmailSettings } from './settings';

/** One booking as the worker's /admin/api/visits feed returns it. */
export interface Visit {
  shop: string;
  shop_name?: string;
  id: string;
  date: string;              // YYYY-MM-DD (London)
  time: string;              // HH:MM
  starts_at: string | null;  // ISO with offset
  ends_at?: string | null;
  party_size: number | null;
  status: { id: number | null; code: string; name: string };
  first_name: string;
  email: string | null;
  marketing: 'yes' | 'no' | null;
}

export type SkipReason =
  | 'shop_off'
  | 'not_arrived'
  | 'no_email'
  | 'opted_out'
  | 'marketing_no'
  | 'marketing_unanswered'
  | 'duplicate'
  | 'too_late'
  | 'booking_cancelled';

export const SKIP_LABELS: Record<SkipReason | 'cancelled', string> = {
  shop_off: 'Café switched off',
  not_arrived: "Didn't arrive (no-show, cancelled or never marked)",
  no_email: 'No email on the booking',
  opted_out: 'Asked not to be emailed',
  marketing_no: 'Said no to marketing',
  marketing_unanswered: 'Never answered the marketing question',
  duplicate: 'Already emailed recently',
  too_late: 'Too long after the visit',
  booking_cancelled: 'Booking was cancelled',
  cancelled: 'Cancelled before sending',
};

export type Decision =
  /** Nothing to record yet: status may still change, or it's for the backfill tool. */
  | { action: 'wait' }
  | { action: 'ignore' }
  | { action: 'skip'; reason: SkipReason }
  | { action: 'queue'; variant: 'marketing' | 'plain'; dueAt: Date };

export interface DecideContext {
  now: Date;
  source: 'auto' | 'backfill';
  /** Addresses that opted out, bounced or complained. */
  suppressed: Set<string>;
  /** Addresses already emailed (or queued) within settings.dedupe_days. Updated as rows are queued. */
  recent: Set<string>;
}

/** How long after the booking a status can still change (staff marking arrivals late). */
export const STATUS_SETTLE_HOURS = 48;

export function visitStart(v: Visit): Date {
  if (v.starts_at && !Number.isNaN(Date.parse(v.starts_at))) return new Date(v.starts_at);
  return londonDateTime(v.date, Number(v.time.slice(0, 2)) || 12, Number(v.time.slice(3, 5)) || 0);
}

export function decide(v: Visit, s: VisitEmailSettings, ctx: DecideContext): Decision {
  const start = visitStart(v);
  const hoursSince = (ctx.now.getTime() - start.getTime()) / 3_600_000;

  // Automatic emails only cover visits from the go-live date; older ones are the backfill's job.
  if (ctx.source === 'auto' && s.auto_from_date && v.date < s.auto_from_date) return { action: 'ignore' };
  if (hoursSince < 0) return { action: 'wait' }; // booking hasn't happened yet

  if (!s.shops.includes(v.shop as Shop)) return { action: 'skip', reason: 'shop_off' };

  // No arrival statuses chosen yet = we can't tell who came. Record nothing.
  if (s.arrived_statuses.length === 0) return { action: 'wait' };
  if (!s.arrived_statuses.includes(v.status.code.toLowerCase())) {
    return hoursSince < STATUS_SETTLE_HOURS ? { action: 'wait' } : { action: 'skip', reason: 'not_arrived' };
  }

  const email = (v.email ?? '').trim().toLowerCase();
  if (!email) return { action: 'skip', reason: 'no_email' };
  if (ctx.suppressed.has(email)) return { action: 'skip', reason: 'opted_out' };

  if (s.respect_marketing && v.marketing !== 'yes') {
    return { action: 'skip', reason: v.marketing === 'no' ? 'marketing_no' : 'marketing_unanswered' };
  }
  const variant: 'marketing' | 'plain' =
    v.marketing === 'yes' || !s.plain_for_non_opted_in ? 'marketing' : 'plain';

  if (ctx.recent.has(email)) return { action: 'skip', reason: 'duplicate' };

  let due: Date;
  if (ctx.source === 'auto') {
    const ideal = new Date(start.getTime() + s.delay_hours * 3_600_000);
    if (ctx.now.getTime() - ideal.getTime() > s.max_late_days * 86_400_000) {
      return { action: 'skip', reason: 'too_late' };
    }
    due = ideal > ctx.now ? ideal : ctx.now;
  } else {
    due = ctx.now;
  }
  return { action: 'queue', variant, dueAt: intoSendWindow(due, s) };
}

/**
 * "What if everyone turns up?" preview for future dates (Check the data).
 * Every booking that isn't cancelled or a no-show is treated as arrived, and
 * judged as if just after its start time, so the result shows who would get
 * an email, which version, and when. Marketing switch, opt-outs and the
 * one-email-per-address rule still apply. Never used for real sending.
 */
export const ASSUMED_STATUS = '__assumed_arrived__';
export function decideAssumingAttendance(v: Visit, s: VisitEmailSettings, ctx: DecideContext): Decision {
  const code = v.status.code.toLowerCase();
  if (/cancel/.test(code)) return { action: 'skip', reason: 'booking_cancelled' };
  if (/no.?show/.test(code)) return { action: 'skip', reason: 'not_arrived' };
  const start = visitStart(v);
  const now = new Date(Math.max(ctx.now.getTime(), start.getTime() + 60_000));
  return decide(
    { ...v, status: { ...v.status, code: ASSUMED_STATUS } },
    { ...s, arrived_statuses: [ASSUMED_STATUS], auto_from_date: '' },
    { ...ctx, now, source: 'auto' },
  );
}

/* ---------------- London time helpers ---------------- */

const TZ = 'Europe/London';

function londonParts(d: Date) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute') };
}

/** The instant that is `hour:minute` London time on `ymd`. */
export function londonDateTime(ymd: string, hour: number, minute = 0): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const lp = londonParts(new Date(guess));
  const shownAsUtc = Date.UTC(lp.y, lp.m - 1, lp.d, lp.h, lp.min);
  return new Date(guess - (shownAsUtc - guess));
}

export function londonDay(d: Date = new Date()): string {
  const p = londonParts(d);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function inSendWindow(d: Date, s: Pick<VisitEmailSettings, 'send_window_start_hour' | 'send_window_end_hour'>): boolean {
  const h = londonParts(d).h;
  return h >= s.send_window_start_hour && h < s.send_window_end_hour;
}

/** Moves a time forward to the next moment inside the London send window. */
export function intoSendWindow(d: Date, s: Pick<VisitEmailSettings, 'send_window_start_hour' | 'send_window_end_hour'>): Date {
  if (inSendWindow(d, s)) return d;
  const day = londonDay(d);
  const h = londonParts(d).h;
  const target = h < s.send_window_start_hour ? day : addDays(day, 1);
  return londonDateTime(target, s.send_window_start_hour);
}
