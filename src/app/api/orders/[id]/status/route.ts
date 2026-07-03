import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { mirrorStatusToShopify, logWriteError } from '@/lib/shopify/actions';
import { isDemoOrder } from '@/lib/shopify/sync';
import type { InternalStatus } from '@/types/db';

/**
 * Internal operational status transitions (never fulfilment claims):
 *   pickup:   acknowledged → preparing
 *   delivery: acknowledged → preparing → packed → courier_booked
 * Optionally mirrors an ib_status tag/metafield to Shopify (best-effort).
 */
const ALLOWED: Record<string, { statuses: InternalStatus[]; methods: string[] }> = {
  preparing: { statuses: ['new', 'acknowledged'], methods: ['pickup', 'local_delivery', 'shipping'] },
  packed: { statuses: ['preparing'], methods: ['local_delivery', 'shipping'] },
  courier_booked: { statuses: ['preparing', 'packed'], methods: ['local_delivery', 'shipping'] },
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const target = body.status as string;
  const rule = ALLOWED[target];
  if (!rule) return NextResponse.json({ error: `Unsupported status: ${target}` }, { status: 400 });

  const db = supabaseAdmin();
  const { data: order } = await db.from('orders')
    .select('id, shopify_order_id, shopify_order_gid, internal_status, fulfillment_method, tags')
    .eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  if (!rule.methods.includes(order.fulfillment_method)) {
    return NextResponse.json({ error: `"${target}" is not valid for ${order.fulfillment_method} orders` }, { status: 400 });
  }
  if (!rule.statuses.includes(order.internal_status)) {
    return NextResponse.json({ error: `Cannot move from ${order.internal_status} to ${target}` }, { status: 409 });
  }

  const update: Record<string, unknown> = { internal_status: target };
  if (order.internal_status === 'new') {
    update.acknowledged_at = new Date().toISOString();
    update.acknowledged_by = gate.staff.id;
  }
  const { error } = await db.from('orders').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit({
    orderId: id, actorId: gate.staff.id, actorName: gate.staff.fullName,
    eventType: 'status_changed', details: { from: order.internal_status, to: target },
  });

  // Optional Shopify mirror (tag + metafield) — best-effort, logged on failure.
  let mirrored = false;
  if (body.mirrorToShopify !== false && !isDemoOrder(order)) {
    try {
      await mirrorStatusToShopify(order.shopify_order_gid, target);
      mirrored = true;
    } catch (err) {
      await logWriteError({ orderId: id, action: 'mirror_status', request: { status: target }, error: err, actorId: gate.staff.id });
    }
  }
  return NextResponse.json({ ok: true, mirrored });
}
