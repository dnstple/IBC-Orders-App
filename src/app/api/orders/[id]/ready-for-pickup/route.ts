import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { markReadyForPickup, logWriteError } from '@/lib/shopify/actions';
import { syncOrderFromShopify, isDemoOrder } from '@/lib/shopify/sync';

/**
 * Ready for pickup — ONLY for fulfillment orders Shopify confirms are
 * local pickup (deliveryMethod PICK_UP). Calls the official mutation, which
 * sends Shopify's "Ready for pickup" customer notification. Internal state
 * advances only after Shopify succeeds.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;

  const db = supabaseAdmin();
  const { data: order } = await db.from('orders')
    .select('id, shopify_order_id, shopify_order_gid, internal_status, fulfillment_method, tags')
    .eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  if (['fulfilled', 'cancelled', 'refunded'].includes(order.internal_status)) {
    return NextResponse.json({ error: `Order is already ${order.internal_status}` }, { status: 409 });
  }

  // Server-side guard: verify against Shopify fulfillment orders, not the UI.
  const { data: groups } = await db.from('fulfillment_groups')
    .select('shopify_fulfillment_order_gid, delivery_method_type, status')
    .eq('order_id', id);
  const pickupGroups = (groups ?? []).filter(
    (g) => g.delivery_method_type === 'PICK_UP' && !['CLOSED', 'CANCELLED'].includes(g.status)
  );
  if (pickupGroups.length === 0) {
    return NextResponse.json(
      { error: 'No open local-pickup fulfillment orders on this order — Ready for pickup is not available' },
      { status: 400 }
    );
  }

  if (isDemoOrder(order)) {
    await db.from('orders').update({ internal_status: 'ready_for_pickup' }).eq('id', id);
    await audit({ orderId: id, actorId: gate.staff.id, actorName: gate.staff.fullName, eventType: 'ready_for_pickup', details: { demo: true } });
    return NextResponse.json({ ok: true, demo: true });
  }

  const gids = pickupGroups.map((g) => g.shopify_fulfillment_order_gid);
  try {
    await markReadyForPickup(gids);
  } catch (err) {
    await logWriteError({ orderId: id, action: 'ready_for_pickup', request: { fulfillmentOrders: gids }, error: err, actorId: gate.staff.id });
    return NextResponse.json(
      { error: 'Shopify rejected the ready-for-pickup action', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  // Shopify confirmed — update immediately, then reconcile with a full sync.
  await db.from('orders').update({ internal_status: 'ready_for_pickup' }).eq('id', id);
  await audit({
    orderId: id, actorId: gate.staff.id, actorName: gate.staff.fullName,
    eventType: 'ready_for_pickup', details: { fulfillmentOrders: gids, customerNotified: true },
  });
  // Cancel the 1-hour reminder — order is ready.
  await db.from('scheduled_jobs').update({ status: 'cancelled' })
    .eq('order_id', id).eq('kind', 'reminder_1h').eq('status', 'pending');

  try {
    await syncOrderFromShopify(order.shopify_order_gid);
  } catch (err) {
    console.error('[ready-for-pickup] post-action sync failed (webhook will reconcile)', err);
  }
  return NextResponse.json({ ok: true });
}
