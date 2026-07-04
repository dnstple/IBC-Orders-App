import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { reconcileUpdatedOrders } from '@/lib/shopify/sync';
import { sendStaffPush } from '@/lib/push';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Automatic reconciliation sync (call every minute from the external cron;
 * it self-throttles to app_settings.sync_state.interval_minutes, default 3).
 * Webhooks remain the real-time path; this catches anything missed, using
 * Shopify updated_at so it never re-reads full history.
 * A claim-based lock prevents overlapping runs; locks older than 5 minutes
 * are treated as crashed and reclaimed.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const db = supabaseAdmin();
  const { data: stateRow } = await db.from('app_settings').select('value').eq('key', 'sync_state').single();
  const state = (stateRow?.value ?? {}) as {
    running?: boolean; started_at?: string | null; last_success?: string | null;
    last_error?: string | null; interval_minutes?: number;
  };

  const interval = Math.max(1, Number(state.interval_minutes ?? 3));
  const now = Date.now();

  if (state.last_success && now - new Date(state.last_success).getTime() < interval * 60000 - 15000) {
    return NextResponse.json({ ok: true, skipped: 'within_interval' });
  }
  const lockStale = !state.started_at || now - new Date(state.started_at).getTime() > 5 * 60000;
  if (state.running && !lockStale) {
    return NextResponse.json({ ok: true, skipped: 'already_running' });
  }

  // Claim the lock.
  await db.from('app_settings').update({
    value: { ...state, running: true, started_at: new Date().toISOString() },
  }).eq('key', 'sync_state');

  const since = state.last_success ?? new Date(now - 24 * 3600000).toISOString();
  try {
    const result = await reconcileUpdatedOrders(since);
    await db.from('app_settings').update({
      value: {
        ...state,
        running: false,
        started_at: null,
        last_success: new Date().toISOString(),
        last_error: result.failed > 0 ? result.errors[0] ?? 'partial failure' : null,
        interval_minutes: interval,
      },
    }).eq('key', 'sync_state');
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from('app_settings').update({
      value: { ...state, running: false, started_at: null, last_error: message, interval_minutes: interval },
    }).eq('key', 'sync_state');
    await sendStaffPush({
      heading: 'Shopify sync failed',
      message: `Automatic sync error: ${message.slice(0, 120)}`,
      dedupeKey: `reconcile_failed:${new Date().toISOString().slice(0, 13)}`, // ≤1 per hour
      kind: 'sync_error',
      roles: ['admin'],
      prefKey: 'sync_errors',
    }).catch(() => undefined);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
