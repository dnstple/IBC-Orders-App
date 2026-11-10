import type { Visit } from './eligibility';
import { addDays } from './eligibility';

/**
 * Reads bookings from the ibc-booking worker's read-only visits feed.
 * The TableAgent API keys stay in Cloudflare; this app only holds
 * VISITS_FEED_KEY (the worker's MAILER_KEY secret).
 */
export interface FeedResult {
  rows: Visit[];
  statuses: Array<{ code: string; name: string; id: number | null; count: number }>;
  errors: Array<{ shop: string; status: number }>;
}

const MAX_DAYS_PER_CALL = 60;

export function feedConfigured(): boolean {
  return Boolean(process.env.VISITS_FEED_KEY);
}

export async function fetchVisits(from: string, to: string): Promise<FeedResult> {
  const base = (process.env.VISITS_FEED_URL || 'https://ibc-booking.italianbearchocolate.workers.dev').replace(/\/+$/, '');
  const key = process.env.VISITS_FEED_KEY;
  if (!key) throw new Error('VISITS_FEED_KEY is not set, so bookings cannot be read from the booking server.');

  const out: FeedResult = { rows: [], statuses: [], errors: [] };
  const statusMap = new Map<string, FeedResult['statuses'][number]>();
  for (let start = from; start <= to; start = addDays(start, MAX_DAYS_PER_CALL)) {
    const end = addDays(start, MAX_DAYS_PER_CALL - 1) < to ? addDays(start, MAX_DAYS_PER_CALL - 1) : to;
    const res = await fetch(`${base}/admin/api/visits?from=${start}&to=${end}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      throw new Error(`Booking server replied ${res.status}${data?.error ? `: ${data.error}` : ''}`);
    }
    out.rows.push(...(data.rows as Visit[]));
    out.errors.push(...(data.errors ?? []));
    for (const s of data.statuses ?? []) {
      const cur = statusMap.get(s.code);
      if (cur) cur.count += s.count; else statusMap.set(s.code, { ...s });
    }
  }
  out.statuses = [...statusMap.values()].sort((a, b) => b.count - a.count);
  return out;
}
