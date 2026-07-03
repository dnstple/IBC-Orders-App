import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { writeCourierMetafield, logWriteError } from '@/lib/shopify/actions';
import { isDemoOrder } from '@/lib/shopify/sync';

/** Save courier booking details (name, reference, tracking URL) and move to courier_booked. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const courierName = String(body.courierName ?? '').trim();
  const bookingRef = String(body.bookingRef ?? '').trim();
  const trackingUrl = String(body.trackingUrl ?? '').trim();
  if (!courierName) return NextResponse.json({ error: 'Courier name is required' }, { status: 400 });
  if (trackingUrl && !/^https:\/\//.test(trackingUrl)) {
    return NextResponse.json({ error: 'Tracking URL must be https://' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: order } = await db.from('orders')
    .select('id, shopify_order_id, shopify_order_gid, internal_status, fulfillment_method, tags')
    .eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (!['local_delivery', 'shipping'].includes(order.fulfillment_method)) {
    return NextResponse.json({ error: 'Courier booking applies to delivery orders only' }, { status: 400 });
  }
  if (['fulfilled', 'cancelled', 'refunded'].includes(order.internal_status)) {
    return NextResponse.json({ error: `Order is already ${order.internal_status}` }, { status: 409 });
  }

  const { error } = await db.from('orders').update({
    internal_status: 'courier_booked',
    courier_name: courierName,
    courier_booking_ref: bookingRef || null,
    courier_tracking_url: trackingUrl || null,
  }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit({
    orderId: id, actorId: gate.staff.id, actorName: gate.staff.fullName,
    eventType: 'courier_booked', details: { courierName, bookingRef, trackingUrl },
  });

  let mirrored = false;
  if (!isDemoOrder(order)) {
    try {
      await writeCourierMetafield(order.shopify_order_gid, { name: courierName, bookingRef, trackingUrl });
      mirrored = true;
    } catch (err) {
      await logWriteError({ orderId: id, action: 'courier_metafield', request: { courierName, bookingRef }, error: err, actorId: gate.staff.id });
    }
  }
  return NextResponse.json({ ok: true, mirrored });
}
