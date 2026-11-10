import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { feedConfigured } from '@/lib/visit-emails/feed';
import { addDays, londonDateTime, londonDay } from '@/lib/visit-emails/eligibility';
import { liveSendingAllowed } from '@/lib/visit-emails/settings';

export const runtime = 'nodejs';

const mask = (e: string | null) => {
  if (!e) return '';
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(u.length - 1, 6)))}@${d}`;
};

/** Manager+: everything the Visit emails dashboard shows. */
export async function GET() {
  const gate = await requireRole('manager');
  if ('error' in gate) return gate.error;
  const db = supabaseAdmin();
  const today = londonDay();
  const since30 = addDays(today, -29);

  const [{ data: rows }, { data: clicks }, { data: sup }, { data: runs }, { data: recent }] = await Promise.all([
    db.from('visit_emails').select('id, state, skip_reason, variant, source, shop, sent_at, due_at').limit(50000),
    db.from('visit_email_clicks').select('visit_email_id, link_key, likely_bot').limit(100000),
    db.from('visit_email_suppressions').select('reason').limit(50000),
    db.from('visit_email_runs').select('*').order('started_at', { ascending: false }).limit(8),
    db.from('visit_emails')
      .select('id, shop, visit_date, first_name, email, state, skip_reason, variant, source, due_at, sent_at, marketing, error')
      .neq('state', 'skipped').order('updated_at', { ascending: false }).limit(40),
  ]);

  const byState: Record<string, number> = {};
  const skipReasons: Record<string, number> = {};
  const variants = { marketing: 0, plain: 0 };
  const sources = { auto: 0, backfill: 0 };
  const shops: Record<string, { sent: number; dry_run: number; queued: number }> = {};
  const daily: Record<string, { sent: number; dry_run: number }> = {};
  for (let d = since30; d <= today; d = addDays(d, 1)) daily[d] = { sent: 0, dry_run: 0 };
  const dayStart = londonDateTime(today, 0).getTime();
  let doneToday = 0;
  let nextDue: string | null = null;

  for (const r of rows ?? []) {
    byState[r.state] = (byState[r.state] ?? 0) + 1;
    if (r.state === 'skipped' || r.state === 'cancelled') {
      const k = r.skip_reason ?? 'cancelled';
      skipReasons[k] = (skipReasons[k] ?? 0) + 1;
    }
    const done = r.state === 'sent' || r.state === 'dry_run';
    if (done || r.state === 'queued') {
      if (r.variant === 'marketing' || r.variant === 'plain') variants[r.variant as 'marketing' | 'plain']++;
      sources[(r.source as 'auto' | 'backfill') ?? 'auto']++;
      const sh = (shops[r.shop] ??= { sent: 0, dry_run: 0, queued: 0 });
      sh[r.state as 'sent' | 'dry_run' | 'queued']++;
    }
    if (done && r.sent_at) {
      const day = londonDay(new Date(r.sent_at));
      if (daily[day]) daily[day][r.state as 'sent' | 'dry_run']++;
      if (new Date(r.sent_at).getTime() >= dayStart) doneToday++;
    }
    if (r.state === 'queued' && r.due_at && (!nextDue || r.due_at < nextDue)) nextDue = r.due_at;
  }

  const linkMap = new Map<string, { link: string; clicks: number; people: Set<string>; bots: number }>();
  const clickers = new Set<string>();
  for (const c of clicks ?? []) {
    const l = linkMap.get(c.link_key) ?? { link: c.link_key, clicks: 0, people: new Set<string>(), bots: 0 };
    if (c.likely_bot) l.bots++;
    else {
      l.clicks++;
      if (c.visit_email_id) { l.people.add(c.visit_email_id); clickers.add(c.visit_email_id); }
    }
    linkMap.set(c.link_key, l);
  }
  const sent = byState.sent ?? 0;
  const optOuts = (sup ?? []).filter((s) => s.reason === 'opt_out').length;

  return NextResponse.json({
    today,
    server: { feedConfigured: feedConfigured(), liveAllowed: liveSendingAllowed(), appUrl: process.env.NEXT_PUBLIC_APP_URL ?? '' },
    totals: {
      sent, dry_run: byState.dry_run ?? 0, queued: byState.queued ?? 0, failed: byState.failed ?? 0,
      skipped: (byState.skipped ?? 0) + (byState.cancelled ?? 0), doneToday, nextDue,
      uniqueClickers: clickers.size,
      clickRate: sent ? clickers.size / sent : null,
      optOuts, suppressed: sup?.length ?? 0,
    },
    variants, sources, shops, skipReasons,
    links: [...linkMap.values()].map((l) => ({ link: l.link, clicks: l.clicks, people: l.people.size, bots: l.bots }))
      .sort((a, b) => b.clicks - a.clicks),
    daily: Object.entries(daily).map(([day, v]) => ({ day, ...v })),
    runs: runs ?? [],
    recent: (recent ?? []).map((r) => ({ ...r, email: mask(r.email) })),
  });
}
