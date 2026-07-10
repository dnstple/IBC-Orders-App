import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { createFulfillment, logWriteError, type FulfillmentLineSelection } from '@/lib/shopify/actions';
import { syncOrderFromShopify, isDemoOrder } from '@/lib/shopify/sync';

/**
 * "Collected & fulfil" (pickup) / "Handed to courier & fulfil" (delivery).
 * Available to all active staff. Supports full or partial quantities per Fulfillment Order.
 * The order is NEVER marked fulfilled locally until Shopify's
 * fulfillmentCreate succeeds; final state is re-read from Shopify.
 *
 * Body: {
 *   selections?: [{ fulfillmentOrderGid, lines?: [{ ffoLineItemGid, quantity }] }],
 *   notifyCustomer?: boolean,
 *   tracking?: { number?, company?, url? }
 * }
 * Empty selections ⇒ fulfil all remaining items on all open groups.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const db = supabaseAdmin();
  const { data: order } = await db.from('orders')
    .select('id, shopify_order_id, shopify_order_gid, order_number, internal_status, fulfillment_method, tags')
    .eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (['cancelled', 'refunded'].includes(order.internal_status)) {
    return NextResponse.json({ error: `Order is ${order.internal_status} — cannot fulfil` }, { status: 409 });
  }

  const { data: groups } = await db.from('fulfillment_groups')
    .select('shopify_fulfillment_order_gid, status, line_items')
    .eq('order_id', id);
  const openGroups = (groups ?? []).filter((g) => !['CLOSED', 'CANCELLED'].includes(g.status));
  if (openGroups.length === 0) {
    return NextResponse.json({ error: 'No open fulfillment orders — nothing to fulfil' }, { status: 400 });
  }

  let selections: FulfillmentLineSelection[] = Array.isArray(body.selections) && body.selections.length
    ? body.selections
    : openGroups.map((g) => ({ fulfillmentOrderGid: g.shopify_fulfillment_order_gid }));

  // Validate: selected groups must exist, be open, and quantities within remaining.
  for (const sel of selections) {
    const group = openGroups.find((g) => g.shopify_fulfillment_order_gid === sel.fulfillmentOrderGid);
    if (!group) {
      return NextResponse.json({ error: `Fulfillment order not open on this order: ${sel.fulfillmentOrderGid}` }, { status: 400 });
    }
    for (const line of sel.lines ?? []) {
      const gl = (group.line_items as Array<{ ffoLineItemGid: string; remainingQuantity: number }>)
        .find((l) => l.ffoLineItemGid === line.ffoLineItemGid);
      if (!gl) return NextResponse.json({ error: `Unknown line item ${line.ffoLineItemGid}` }, { status: 400 });
      if (line.quantity < 1 || line.quantity > gl.remainingQuantity) {
        return NextResponse.json({ error: `Quantity ${line.quantity} exceeds remaining ${gl.remainingQuantity}` }, { status: 400 });
      }
    }
    // Drop zero-line selections that would fulfil nothing
    if (sel.lines && sel.lines.length === 0) {
      selections = selections.filter((s) => s !== sel);
    }
  }
  if (selections.length === 0) {
    return NextResponse.json({ error: 'Nothing selected to fulfil' }, { status: 400 });
  }

  const notifyCustomer = body.notifyCustomer !== false; // default: Shopify sends confirmation
  const tracking = body.tracking ?? undefined;

  if (isDemoOrder(order)) {
    await db.from('orders').update({ internal_status: 'fulfilled', shopify_fulfillment_status: 'FULFILLED' }).eq('id', id);
    await audit({ orderId: id, actorId: gate.staff.id, actorName: gate.staff.fullName, eventType: 'fulfilled', details: { demo: true } });
    return NextResponse.json({ ok: true, demo: true, shopifyStatus: 'FULFILLED (demo)' });
  }

  let result: { fulfillmentGid: string; status: string };
  try {
    result = await createFulfillment(selections, { notifyCustomer, tracking });
  } catch (err) {
    await logWriteError({
      orderId: id, action: 'fulfillment_create',
      request: { selections, notifyCustomer, tracking }, error: err, actorId: gate.staff.id,
    });
    return NextResponse.json(
      { error: 'Shopify rejected the fulfilment', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  await audit({
    orderId: id, actorId: gate.staff.id, actorName: gate.staff.fullName,
    eventType: order.fulfillment_method === 'pickup' ? 'collected_fulfilled' : 'handed_to_courier_fulfilled',
    details: { fulfillmentGid: result.fulfillmentGid, shopifyStatus: result.status, notifyCustomer, tracking: tracking ?? null, selections },
  });
  await db.from('scheduled_jobs').update({ status: 'cancelled' })
    .eq('order_id', id).eq('kind', 'reminder_1h').eq('status', 'pending');

  // Re-read truth from Shopify: sets FULFILLED or PARTIALLY_FULFILLED correctly.
  try {
    await syncOrderFromShopify(order.shopify_order_gid);
  } catch (err) {
    console.error('[fulfill] post-action sync failed (webhook will reconcile)', err);
  }

  const { data: fresh } = await db.from('orders')
    .select('internal_status, shopify_fulfillment_status').eq('id', id).single();
  return NextResponse.json({
    ok: true,
    shopifyStatus: fresh?.shopify_fulfillment_status ?? result.status,
    internalStatus: fresh?.internal_status,
  });
}
