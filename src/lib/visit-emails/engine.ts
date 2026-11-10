/**
 * The visit-email engine. One run (every 15 minutes from cron-job.org, or
 * "Run now" on the dashboard):
 *   1. read recent bookings from the booking server
 *   2. decide for each new one: wait, skip (with a reason) or queue
 *   3. send (or, in dry run, pretend to send) queued emails that are due,
 *      within the send window, batch size and daily cap
 * Backfill uses the same rules for an older date range, queueing emails
 * that then go out in batches through step 3.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { addDays, decide, inSendWindow, londonDateTime, londonDay, visitStart, type Visit } from './eligibility';
import { fetchVisits } from './feed';
import { renderEmail } from './render';
import { sendEmail, LiveSendingLocked } from './sender';
import { liveSendingAllowed, normaliseSettings, type VisitEmailSettings } from './settings';

export const AUTO_LOOKBACK_DAYS = 4;

export async function loadSettings(): Promise<VisitEmailSettings> {
  const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', 'visit_emails').maybeSingle();
  return normaliseSettings(data?.value);
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://ibc-orders.vercel.app').replace(/\/+$/, '');
}

async function suppressedSet(emails: string[]): Promise<Set<string>> {
  const list = [...new Set(emails.filter(Boolean))];
  const out = new Set<string>();
  for (let i = 0; i < list.length; i += 500) {
    const { data } = await supabaseAdmin().from('visit_email_suppressions').select('email').in('email', list.slice(i, i + 500));
    for (const r of data ?? []) out.add(r.email);
  }
  return out;
}

async function recentSet(emails: string[], s: VisitEmailSettings, now: Date): Promise<Set<string>> {
  const list = [...new Set(emails.filter(Boolean))];
  const out = new Set<string>();
  if (s.dedupe_days === 0) return out;
  const since = new Date(now.getTime() - s.dedupe_days * 86_400_000).toISOString();
  for (let i = 0; i < list.length; i += 500) {
    const { data } = await supabaseAdmin().from('visit_emails').select('email')
      .in('email', list.slice(i, i + 500))
      .in('state', ['queued', 'sent', 'dry_run'])
      .gte('created_at', since);
    for (const r of data ?? []) if (r.email) out.add(r.email);
  }
  return out;
}

async function existingKeys(keys: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const { data } = await supabaseAdmin().from('visit_emails').select('booking_key').in('booking_key', keys.slice(i, i + 500));
    for (const r of data ?? []) out.add(r.booking_key);
  }
  return out;
}

const keyOf = (v: Visit) => `${v.shop}:${v.id}`;

export interface PlanSummary {
  fetched: number;
  already: number;
  wait: number;
  ignore: number;
  queue: number;
  byVariant: { marketing: number; plain: number };
  skip: Record<string, number>;
  statuses: Array<{ code: string; name: string; count: number }>;
  feedErrors: Array<{ shop: string; status: number }>;
}

/** Decides every booking in [from, to]. With write=true, records the decisions. */
export async function planVisits(
  from: string, to: string, source: 'auto' | 'backfill', s: VisitEmailSettings, write: boolean, now = new Date()
): Promise<PlanSummary> {
  const feed = await fetchVisits(from, to);
  const rows = feed.rows.sort((a, b) => visitStart(a).getTime() - visitStart(b).getTime());
  const already = await existingKeys(rows.map(keyOf));
  const fresh = rows.filter((v) => !already.has(keyOf(v)));
  const emails = fresh.map((v) => (v.email ?? '').toLowerCase());
  const ctx = { now, source, suppressed: await suppressedSet(emails), recent: await recentSet(emails, s, now) };

  const sum: PlanSummary = {
    fetched: rows.length, already: rows.length - fresh.length, wait: 0, ignore: 0, queue: 0,
    byVariant: { marketing: 0, plain: 0 }, skip: {}, statuses: feed.statuses, feedErrors: feed.errors,
  };
  const inserts: Record<string, unknown>[] = [];
  for (const v of fresh) {
    const d = decide(v, s, ctx);
    const base = {
      booking_key: keyOf(v), shop: v.shop, booking_id: v.id, visit_date: v.date, visit_at: visitStart(v).toISOString(),
      party_size: v.party_size, status_code: v.status.code, marketing: v.marketing, source,
    };
    if (d.action === 'wait') { sum.wait++; continue; }
    if (d.action === 'ignore') { sum.ignore++; continue; }
    if (d.action === 'skip') {
      sum.skip[d.reason] = (sum.skip[d.reason] ?? 0) + 1;
      // No contact details kept on skipped rows.
      inserts.push({ ...base, state: 'skipped', skip_reason: d.reason });
      continue;
    }
    sum.queue++;
    sum.byVariant[d.variant]++;
    const email = (v.email ?? '').toLowerCase();
    ctx.recent.add(email); // a second booking by the same guest in this batch is a duplicate
    inserts.push({ ...base, state: 'queued', variant: d.variant, email, first_name: v.first_name || null, due_at: d.dueAt.toISOString() });
  }
  if (write && inserts.length) {
    for (let i = 0; i < inserts.length; i += 200) {
      const { error } = await supabaseAdmin().from('visit_emails')
        .upsert(inserts.slice(i, i + 200), { onConflict: 'booking_key', ignoreDuplicates: true });
      if (error) throw new Error(`Saving decisions failed: ${error.message}`);
    }
  }
  return sum;
}

/** Sends (or dry-runs) queued emails that are due. */
export async function sendDue(s: VisitEmailSettings, now = new Date()) {
  const out = { sent: 0, dry_run: 0, failed: 0, held: '' as string };
  if (s.mode === 'off') { out.held = 'Mode is off'; return out; }
  if (s.mode === 'live' && !liveSendingAllowed()) { out.held = 'Live sending is locked on the server'; return out; }
  if (!inSendWindow(now, s)) { out.held = 'Outside the send window'; return out; }

  const db = supabaseAdmin();
  const dayStart = londonDateTime(londonDay(now), 0).toISOString();
  const { count: doneToday } = await db.from('visit_emails').select('id', { count: 'exact', head: true })
    .in('state', ['sent', 'dry_run']).gte('sent_at', dayStart);
  const room = Math.min(s.batch_size, s.daily_cap - (doneToday ?? 0));
  if (room <= 0) { out.held = 'Daily cap reached'; return out; }

  const { data: due } = await db.from('visit_emails').select('*')
    .eq('state', 'queued').lte('due_at', now.toISOString())
    .order('due_at', { ascending: true }).limit(room);
  if (!due?.length) return out;

  const suppressed = await suppressedSet(due.map((r) => r.email));
  for (const row of due) {
    if (!row.email || suppressed.has(row.email) || (!s.shops.includes(row.shop))) {
      await db.from('visit_emails').update({ state: 'cancelled', skip_reason: !row.email || suppressed.has(row.email) ? 'opted_out' : 'shop_off', email: null, first_name: null }).eq('id', row.id);
      continue;
    }
    if (s.respect_marketing && row.marketing !== 'yes') {
      // The switch was turned back on after this was queued.
      await db.from('visit_emails').update({ state: 'cancelled', skip_reason: row.marketing === 'no' ? 'marketing_no' : 'marketing_unanswered', email: null, first_name: null }).eq('id', row.id);
      continue;
    }
    const email = renderEmail(s, {
      token: row.token, appUrl: appUrl(), shop: row.shop, firstName: row.first_name ?? '', visitDate: row.visit_date, variant: row.variant ?? 'plain',
    });
    if (s.mode === 'dry_run') {
      await db.from('visit_emails').update({ state: 'dry_run', sent_at: now.toISOString() }).eq('id', row.id).eq('state', 'queued');
      out.dry_run++;
      continue;
    }
    // Claim the row first so two overlapping runs can never send it twice.
    const { data: claimed } = await db.from('visit_emails').update({ attempts: (row.attempts ?? 0) + 1 })
      .eq('id', row.id).eq('state', 'queued').eq('attempts', row.attempts ?? 0).select('id');
    if (!claimed?.length) continue;
    try {
      const res = await sendEmail(s, row.email, email, `visit-email-${row.id}`);
      await db.from('visit_emails').update({ state: 'sent', sent_at: new Date().toISOString(), provider_message_id: res.id, error: null }).eq('id', row.id);
      out.sent++;
    } catch (e) {
      if (e instanceof LiveSendingLocked) { out.held = e.message; break; }
      const failedForGood = (row.attempts ?? 0) + 1 >= 3;
      await db.from('visit_emails').update({
        state: failedForGood ? 'failed' : 'queued', error: String((e as Error).message).slice(0, 300),
        due_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      }).eq('id', row.id);
      out.failed++;
    }
  }
  return out;
}

/** One full run: poll recent bookings, then send what's due. Logged in visit_email_runs. */
export async function runVisitEmails(kind: 'cron' | 'manual') {
  const s = await loadSettings();
  const db = supabaseAdmin();
  const now = new Date();
  const { data: run } = await db.from('visit_email_runs').insert({ kind, mode: s.mode }).select('id').single();
  const result: Record<string, unknown> = { mode: s.mode };
  try {
    if (s.mode !== 'off') {
      const today = londonDay(now);
      let from = addDays(today, -AUTO_LOOKBACK_DAYS);
      if (s.auto_from_date && s.auto_from_date > from) from = s.auto_from_date;
      const plan = from <= today ? await planVisits(from, today, 'auto', s, true, now) : null;
      result.plan = plan;
      const sent = await sendDue(s, now);
      result.send = sent;
      await db.from('visit_email_runs').update({
        fetched: plan?.fetched ?? 0, queued: plan?.queue ?? 0,
        skipped: plan ? Object.values(plan.skip).reduce((a, b) => a + b, 0) : 0,
        sent: sent.sent, dry_run: sent.dry_run, failed: sent.failed,
        statuses: plan ? Object.fromEntries(plan.statuses.map((x) => [x.code, x.count])) : null,
        error: [sent.held, ...(plan?.feedErrors ?? []).map((e) => `${e.shop}: TableAgent ${e.status}`)].filter(Boolean).join('; ') || null,
        finished_at: new Date().toISOString(),
      }).eq('id', run?.id);
    } else {
      await db.from('visit_email_runs').update({ error: 'Mode is off', finished_at: new Date().toISOString() }).eq('id', run?.id);
    }
    return { ok: true, ...result };
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 300);
    await db.from('visit_email_runs').update({ error: msg, finished_at: new Date().toISOString() }).eq('id', run?.id);
    return { ok: false, error: msg, ...result };
  }
}

/** Status codes seen over the last few weeks, for choosing which mean "arrived". */
export async function recentStatuses(days = 21) {
  const today = londonDay();
  const feed = await fetchVisits(addDays(today, -days), today);
  return feed.statuses;
}
