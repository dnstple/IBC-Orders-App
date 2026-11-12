/**
 * Settings for the post-visit thank-you emails. Stored as JSON in
 * app_settings (key 'visit_emails') and edited on the Visit emails tab.
 * normaliseSettings() fills defaults and clamps anything out of range, so
 * the engine can trust what it reads.
 */

export type VisitEmailMode = 'off' | 'dry_run' | 'live';
export type Shop = 'soho' | 'fitzrovia';
export const SHOPS: Array<{ key: Shop; name: string; address: string }> = [
  { key: 'soho', name: 'Soho', address: '41 Broadwick Street, London W1F 9QL' },
  { key: 'fitzrovia', name: 'Fitzrovia', address: '29 Rathbone Place, London W1T 1JQ' },
];

export interface VisitEmailLink {
  /** Short id used in tracked URLs and reports, e.g. "review". */
  key: string;
  label: string;
  /** Default destination. */
  url: string;
  /** Optional per-shop destination (e.g. each café's Google review page). */
  shop_urls?: Partial<Record<Shop, string>>;
  /** 'all' = every email; 'marketing' = only guests who said Yes to marketing. */
  show_in: 'all' | 'marketing';
}

export interface VisitEmailSettings {
  /** off = nothing queued or sent · dry_run = everything runs, nothing is sent · live = sends. */
  mode: VisitEmailMode;
  shops: Shop[];
  /** TableAgent status codes that mean the guest turned up (picked from what the feed reports). */
  arrived_statuses: string[];

  /** Hours after the booking start time before the email goes. */
  delay_hours: number;
  /** Only send between these hours, London time (start inclusive, end exclusive). */
  send_window_start_hour: number;
  send_window_end_hour: number;
  /** Automatic emails only for visits on or after this date (YYYY-MM-DD). Older visits = backfill. */
  auto_from_date: string;
  /** Don't send an automatic email if it's more than this many days late (e.g. the poller was down). */
  max_late_days: number;

  /** The legal switch. true = only guests who ticked "news and offers" (Marketing = Yes). */
  respect_marketing: boolean;
  /** When sending to everyone: guests without a Yes get the plain email (no shop/booking links). */
  plain_for_non_opted_in: boolean;
  /** Never email the same address twice within this many days (across both cafés). */
  dedupe_days: number;

  /** Emails per run (the poller runs every 15 minutes) and per London day. */
  batch_size: number;
  daily_cap: number;
  /** How far back a backfill can reach. */
  backfill_max_days: number;

  from_name: string;
  from_email: string;
  reply_to: string;

  subject: string;
  preheader: string;
  heading: string;
  /**
   * Paragraphs separated by a blank line. Placeholders: {first_name} {shop}
   * {visit_day} (Wednesday) {visit_date} (Wednesday 11 November).
   * Markup: **bold** and [link words](https://...).
   */
  body_marketing: string;
  body_plain: string;
  signoff: string;
  /** Script line at the very end, as on the website. Blank = none. */
  tagline: string;
  links: VisitEmailLink[];
  /** Footer link that stops further emails. Recommended even for a one-off email. */
  include_opt_out: boolean;

  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
}

export const DEFAULT_SETTINGS: VisitEmailSettings = {
  mode: 'off',
  shops: ['soho', 'fitzrovia'],
  arrived_statuses: [],
  delay_hours: 20,
  send_window_start_hour: 10,
  send_window_end_hour: 19,
  auto_from_date: '',
  max_late_days: 3,
  respect_marketing: true,
  plain_for_non_opted_in: true,
  dedupe_days: 180,
  batch_size: 25,
  daily_cap: 100,
  backfill_max_days: 90,
  from_name: 'Italian Bear Chocolate',
  from_email: 'hello@italianbearchocolate.com',
  reply_to: 'info@italianbearchocolate.com',
  subject: 'Thank you for visiting us in {shop}',
  preheader: 'It was lovely to have you with us.',
  heading: 'Thank you for visiting, {first_name}',
  body_marketing:
    "It was lovely to welcome you to our {shop} café on {visit_day}. We hope you enjoyed your time with us.\n\n" +
    "If you have a moment, we'd be very grateful for a quick review. It helps other chocolate lovers find us.\n\n" +
    'And if you would like to take a little Italian Bear home, our chocolates, spreads and gifts are all online.',
  body_plain:
    "It was lovely to welcome you to our {shop} café on {visit_day}. We hope you enjoyed your time with us.\n\n" +
    "If you have a moment, we'd be very grateful for a quick review.",
  signoff: 'See you again soon,\nThe Italian Bear Chocolate team',
  tagline: 'All you need is chocolate',
  links: [
    { key: 'review', label: 'Leave us a review', url: '', shop_urls: { soho: '', fitzrovia: '' }, show_in: 'all' },
    { key: 'shop', label: 'Shop online', url: 'https://italianbearchocolate.com/collections/all', show_in: 'marketing' },
    { key: 'book', label: 'Book your next visit', url: 'https://italianbearchocolate.com/pages/book-a-table', show_in: 'marketing' },
  ],
  include_opt_out: true,
  utm_source: 'visit-email',
  utm_medium: 'email',
  utm_campaign: 'thank-you-for-visiting',
};

const RESERVED_LINK_KEYS = new Set(['unsubscribe', 'stop', 'preview']);

const int = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};
const str = (v: unknown, def: string, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const isHttpUrl = (u: string) => /^https:\/\/[^\s]+$/i.test(u);

export function normaliseSettings(raw: unknown): VisitEmailSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const mode = ['off', 'dry_run', 'live'].includes(r.mode as string) ? (r.mode as VisitEmailMode) : d.mode;
  const shops = Array.isArray(r.shops)
    ? (r.shops.filter((s) => SHOPS.some((x) => x.key === s)) as Shop[])
    : d.shops;
  const arrived = Array.isArray(r.arrived_statuses)
    ? [...new Set(r.arrived_statuses.map((s) => String(s).trim().toLowerCase()).filter(Boolean))].slice(0, 20)
    : d.arrived_statuses;

  const links: VisitEmailLink[] = [];
  const seen = new Set<string>();
  for (const l of Array.isArray(r.links) ? r.links : d.links) {
    const o = (l ?? {}) as Record<string, unknown>;
    const key = String(o.key ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
    if (!key || seen.has(key) || RESERVED_LINK_KEYS.has(key) || key.startsWith('t-')) continue; // t-… = inline links
    seen.add(key);
    const shopUrls: Partial<Record<Shop, string>> = {};
    const su = (o.shop_urls ?? {}) as Record<string, unknown>;
    for (const s of SHOPS) {
      const u = str(su[s.key], '', 1000).trim();
      shopUrls[s.key] = isHttpUrl(u) ? u : '';
    }
    const url = str(o.url, '', 1000).trim();
    links.push({
      key,
      label: str(o.label, key, 80).trim() || key,
      url: isHttpUrl(url) ? url : '',
      shop_urls: shopUrls,
      show_in: o.show_in === 'marketing' ? 'marketing' : 'all',
    });
    if (links.length >= 6) break;
  }

  const start = int(r.send_window_start_hour, d.send_window_start_hour, 0, 23);
  const end = int(r.send_window_end_hour, d.send_window_end_hour, 1, 24);

  return {
    mode,
    shops,
    arrived_statuses: arrived,
    delay_hours: int(r.delay_hours, d.delay_hours, 0, 24 * 14),
    send_window_start_hour: start,
    send_window_end_hour: end > start ? end : Math.min(start + 1, 24),
    auto_from_date: ymd(r.auto_from_date),
    max_late_days: int(r.max_late_days, d.max_late_days, 1, 30),
    respect_marketing: bool(r.respect_marketing, d.respect_marketing),
    plain_for_non_opted_in: bool(r.plain_for_non_opted_in, d.plain_for_non_opted_in),
    dedupe_days: int(r.dedupe_days, d.dedupe_days, 0, 3650),
    batch_size: int(r.batch_size, d.batch_size, 1, 200),
    daily_cap: int(r.daily_cap, d.daily_cap, 1, 5000),
    backfill_max_days: int(r.backfill_max_days, d.backfill_max_days, 1, 730),
    from_name: str(r.from_name, d.from_name, 80).trim() || d.from_name,
    from_email: str(r.from_email, d.from_email, 120).trim() || d.from_email,
    reply_to: str(r.reply_to, d.reply_to, 120).trim(),
    subject: str(r.subject, d.subject, 150),
    preheader: str(r.preheader, d.preheader, 200),
    heading: str(r.heading, d.heading, 150),
    body_marketing: str(r.body_marketing, d.body_marketing, 4000),
    body_plain: str(r.body_plain, d.body_plain, 4000),
    signoff: str(r.signoff, d.signoff, 300),
    tagline: str(r.tagline, d.tagline, 80),
    links,
    include_opt_out: bool(r.include_opt_out, d.include_opt_out),
    utm_source: str(r.utm_source, d.utm_source, 60).trim() || d.utm_source,
    utm_medium: str(r.utm_medium, d.utm_medium, 60).trim() || d.utm_medium,
    utm_campaign: str(r.utm_campaign, d.utm_campaign, 80).trim() || d.utm_campaign,
  };
}

/** Live sending needs BOTH the dashboard switch and this server-side lock. */
export function liveSendingAllowed(): boolean {
  return process.env.VISIT_EMAILS_ALLOW_LIVE === 'true' && Boolean(process.env.RESEND_API_KEY);
}

export function shopName(key: string): string {
  return SHOPS.find((s) => s.key === key)?.name ?? key;
}
