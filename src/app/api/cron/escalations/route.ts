import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendStaffPush } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Unacknowledged-order escalation (runs every minute).
 * Timings come from app_settings.escalation and are configurable:
 *   push_repeat_minutes (default 5) — repeat push while status is 'new'
 *   manager_escalation_minutes — optional manager/admin escalation
 * The dashboard's own 2-minute audible repeat is client-side; this cron
 * covers devices where the dashboard isn't open.
 * Dedupe keys are bucketed by interval so each escalation fires once.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const db = supabaseAdmin();
  const { data: settings } = await db.from('app_settings').select('value').eq('key', 'escalation').single();
  const pushMins = Number(settings?.value?.push_repeat_minutes ?? 5);
  const mgrMins = Number(settings?.value?.manager_escalation_minutes ?? 15);
  const mgrEnabled = Boolean(settings?.value?.manager_escalation_enabled ?? false);

  const { data: unacked } = await db.from('orders')
    .select('id, order_number, shopify_created_at')
    .eq('internal_status', 'new')
    .eq('financial_status', 'PAID')
    .is('cancelled_at', null)
    .limit(50);

  let pushes = 0;
  const now = Date.now();
  for (const order of unacked ?? []) {
    const ageMin = (now - new Date(order.shopify_created_at).getTime()) / 60000;
    if (ageMin < pushMins) continue;

    // One push per pushMins bucket: bucket index in the dedupe key.
    const bucket = Math.floor(ageMin / pushMins);
    const res = await sendStaffPush({
      heading: 'Order needs action',
      message: `Order ${order.order_number} has waited ${Math.floor(ageMin)} min without being actioned.`,
      url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/orders/${order.id}`,
      dedupeKey: `escalation_push:${order.id}:${bucket}`,
      orderId: order.id,
      kind: 'escalation_push',
    });
    if (res.sent) pushes++;

    if (mgrEnabled && ageMin >= mgrMins) {
      await sendStaffPush({
        heading: 'Manager attention needed',
        message: `Order ${order.order_number} has had no action for ${Math.floor(ageMin)} min.`,
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/orders/${order.id}`,
        dedupeKey: `manager_escalation:${order.id}`,
        orderId: order.id,
        kind: 'manager_escalation',
        roles: ['manager', 'admin'],
      });
    }
  }
  return NextResponse.json({ ok: true, unacknowledged: unacked?.length ?? 0, pushes });
}
