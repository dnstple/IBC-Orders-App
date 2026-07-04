import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendStaffPush } from '@/lib/push';
import { formatLondonTime } from '@/lib/dates';
import { TERMINAL_STATUSES } from '@/types/db';

export const runtime = 'nodejs';

/**
 * One-hour pickup/delivery reminders (runs every minute via Vercel cron).
 * Jobs are created idempotently at sync time; run_at is stored in UTC and
 * derived from Europe/London wall time, so BST/GMT is already accounted for.
 * The notification_events dedupe key guarantees at most one send per event.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const db = supabaseAdmin();
  const { data: due } = await db.from('scheduled_jobs')
    .select('id, order_id, dedupe_key, attempts')
    .eq('kind', 'reminder_1h').eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .limit(25);

  let sent = 0, skipped = 0, failed = 0;
  for (const job of due ?? []) {
    try {
      const { data: order } = await db.from('orders')
        .select('id, order_number, internal_status, fulfillment_method, required_fulfilment_at, time_confirmed')
        .eq('id', job.order_id).maybeSingle();

      // Skip if the order no longer needs a reminder.
      const settled = !order
        || TERMINAL_STATUSES.includes(order.internal_status)
        || order.internal_status === 'ready_for_pickup'
        || order.internal_status === 'courier_booked'
        || !order.time_confirmed;
      if (settled) {
        await db.from('scheduled_jobs').update({ status: 'cancelled' }).eq('id', job.id);
        skipped++;
        continue;
      }

      const isPickup = order.fulfillment_method === 'pickup';
      const timeStr = formatLondonTime(new Date(order.required_fulfilment_at!));
      await sendStaffPush({
        heading: isPickup ? 'Pickup due soon' : 'Delivery due soon',
        message: isPickup
          ? `Order ${order.order_number} is due for collection at ${timeStr} today.`
          : `Order ${order.order_number} is due for dispatch at ${timeStr} today.`,
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/orders/${order.id}`,
        dedupeKey: job.dedupe_key,
        orderId: order.id,
        kind: 'reminder_1h',
        prefKey: 'pickup_reminders',
      });
      await db.from('scheduled_jobs').update({ status: 'sent' }).eq('id', job.id);
      await db.from('order_events').insert({
        order_id: order.id, actor_name: 'System', event_type: 'reminder_sent',
        details: { kind: 'reminder_1h', requiredAt: order.required_fulfilment_at },
      });
      sent++;
    } catch (err) {
      failed++;
      await db.from('scheduled_jobs').update({
        attempts: (job.attempts ?? 0) + 1,
        status: (job.attempts ?? 0) + 1 >= 5 ? 'failed' : 'pending',
        last_error: err instanceof Error ? err.message : String(err),
      }).eq('id', job.id);
    }
  }
  return NextResponse.json({ ok: true, sent, skipped, failed });
}
