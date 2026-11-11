import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadSettings, planVisits } from '@/lib/visit-emails/engine';
import { addDays, londonDay } from '@/lib/visit-emails/eligibility';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Admin only: backdate the thank-you email to earlier visits.
 *   { from, to, action: 'preview' } -> counts only, nothing saved
 *   { from, to, action: 'queue' }   -> records decisions; queued emails then go
 *                                      out in batches (batch size / daily cap)
 * Same rules as the automatic emails (arrival status, marketing switch,
 * opt-outs, one email per address), minus the "too late" rule.
 */
export async function POST(req: NextRequest) {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const s = await loadSettings();
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const today = londonDay();
  const from = String(body.from ?? ''), to = String(body.to ?? '');
  if (!ymd.test(from) || !ymd.test(to) || from > to) {
    return NextResponse.json({ error: 'Choose a start and end date (start first).' }, { status: 400 });
  }
  const earliest = addDays(today, -s.backfill_max_days);
  if (from < earliest) {
    return NextResponse.json({ error: `Backfill can only go back ${s.backfill_max_days} days (to ${earliest}). Change the limit in settings if needed.` }, { status: 400 });
  }
  if (to >= today) return NextResponse.json({ error: 'Backfill is for past days. Today onwards is handled automatically.' }, { status: 400 });
  if (s.arrived_statuses.length === 0) {
    return NextResponse.json({ error: 'Choose which TableAgent statuses mean the guest arrived first.' }, { status: 409 });
  }

  const write = body.action === 'queue';
  try {
    const plan = await planVisits(from, to, 'backfill', s, write);
    if (write) {
      await supabaseAdmin().from('visit_email_runs').insert({
        kind: 'backfill', mode: s.mode, fetched: plan.fetched, queued: plan.queue,
        skipped: Object.values(plan.skip).reduce((a, b) => a + b, 0),
        statuses: Object.fromEntries(plan.statuses.map((x) => [x.code, x.count])),
        error: `${from} to ${to}`, finished_at: new Date().toISOString(),
      });
    }
    const daysToSend = Math.ceil(plan.queue / Math.max(1, s.daily_cap));
    return NextResponse.json({ ok: true, saved: write, from, to, plan, daysToSend });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
