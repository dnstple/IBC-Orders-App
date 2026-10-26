import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import {
  purchaseShippingLabel,
  getLabelPurchaseResult,
  logWriteError,
  LabelPurchaseError,
} from '@/lib/shopify/actions';
import { syncOrderFromShopify, isDemoOrder } from '@/lib/shopify/sync';
import {
  validatePackage,
  buildLabelPurchaseInput,
  labelServiceConfig,
  explainLabelError,
} from '@/lib/shipping-label';
import type { ShippingLabelRow } from '@/types/db';

/**
 * Shopify Shipping label for a shipping order — Royal Mail Tracked 24, with
 * the box size and weight staff measured for this parcel.
 *
 * POST { lengthCm, widthCm, heightCm, weightGrams } — buys the label.
 *   Shopify buys asynchronously, so this returns a `pending` label; the
 *   client then polls GET until it is `purchased` or `failed`.
 * GET — the order's current label, refreshed from Shopify while pending.
 *
 * At most one pending/purchased label per order (unique index), so a
 * double tap or a second iPad can never buy twice.
 */

async function loadOrder(id: string) {
  const { data } = await supabaseAdmin().from('orders')
    .select('id, shopify_order_id, shopify_order_gid, order_number, internal_status, fulfillment_method, tags')
    .eq('id', id).maybeSingle();
  return data;
}

async function latestLabel(orderId: string): Promise<ShippingLabelRow | null> {
  const { data } = await supabaseAdmin().from('shipping_labels')
    .select('*').eq('order_id', orderId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data as ShippingLabelRow | null) ?? null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;

  const order = await loadOrder(id);
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  let label = await latestLabel(id);
  if (label?.status === 'pending' && label.purchase_result_gid) {
    label = await refreshPending(label, order, gate.staff);
  }
  return NextResponse.json({ label });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const order = await loadOrder(id);
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.fulfillment_method !== 'shipping') {
    return NextResponse.json({ error: 'Only shipping orders get a Royal Mail label' }, { status: 400 });
  }
  if (['fulfilled', 'cancelled', 'refunded'].includes(order.internal_status)) {
    return NextResponse.json({ error: `Order is ${order.internal_status} — no label needed` }, { status: 409 });
  }

  const pkg = validatePackage(body);
  if (!pkg.ok || !pkg.value) {
    return NextResponse.json({ error: 'Check the box details', fields: pkg.errors }, { status: 400 });
  }

  const existing = await latestLabel(id);
  if (existing && existing.status !== 'failed') {
    return NextResponse.json(
      { error: 'This order already has a label — print it again instead of buying another', label: existing },
      { status: 409 }
    );
  }

  const db = supabaseAdmin();
  const demo = isDemoOrder(order);
  // Normally null: Shopify's preferred carrier (Royal Mail Tracked 24) decides.
  const service = labelServiceConfig();

  // The open shipping fulfillment order this label is for.
  const { data: groups } = await db.from('fulfillment_groups')
    .select('shopify_fulfillment_order_gid, status, delivery_method_type')
    .eq('order_id', id);
  const shippingGroups = (groups ?? []).filter(
    (g) => !['CLOSED', 'CANCELLED'].includes(g.status) && !['PICK_UP', 'LOCAL'].includes(g.delivery_method_type ?? '')
  );
  if (shippingGroups.length === 0) {
    return NextResponse.json({ error: 'Nothing left to ship on this order' }, { status: 400 });
  }
  if (shippingGroups.length > 1) {
    return NextResponse.json({
      error: 'This order ships from more than one place',
      detail: 'Buy these labels in Shopify instead.',
    }, { status: 400 });
  }

  // Claim the order's single live-label slot BEFORE calling Shopify.
  const { data: claimed, error: claimError } = await db.from('shipping_labels').insert({
    order_id: id,
    status: 'pending',
    package: pkg.value,
    carrier_code: service?.carrierCode ?? null,
    service_code: service?.serviceCode ?? null,
    purchased_by: gate.staff.id,
    purchased_by_name: gate.staff.fullName,
  }).select('*').single();
  if (claimError || !claimed) {
    const label = await latestLabel(id);
    return NextResponse.json(
      { error: 'A label is already being bought for this order', label },
      { status: 409 }
    );
  }

  if (demo) {
    const { data: done } = await db.from('shipping_labels').update({
      status: 'purchased',
      tracking_number: `DEMO${String(order.shopify_order_id).slice(-6)}GB`,
      tracking_company: 'Royal Mail',
      updated_at: new Date().toISOString(),
    }).eq('id', claimed.id).select('*').single();
    await audit({ orderId: id, actorId: gate.staff.id, actorName: gate.staff.fullName, eventType: 'label_purchased', details: { demo: true, package: pkg.value } });
    return NextResponse.json({ label: done });
  }

  const input = buildLabelPurchaseInput({
    fulfillmentOrderGid: shippingGroups[0].shopify_fulfillment_order_gid,
    pkg: pkg.value,
    service,
  });

  let resultGid: string;
  try {
    resultGid = await purchaseShippingLabel(input);
  } catch (err) {
    const code = err instanceof LabelPurchaseError ? err.code : null;
    const message = err instanceof Error ? err.message : String(err);
    await db.from('shipping_labels').update({
      status: 'failed', error: explainLabelError(code, message), updated_at: new Date().toISOString(),
    }).eq('id', claimed.id);
    await logWriteError({ orderId: id, action: 'shipping_label_purchase', request: input, error: err, actorId: gate.staff.id });
    return NextResponse.json(
      { error: 'Shopify didn\'t buy the label', detail: explainLabelError(code, message), label: await latestLabel(id) },
      { status: 502 }
    );
  }

  const { data: pending } = await db.from('shipping_labels').update({
    purchase_result_gid: resultGid, updated_at: new Date().toISOString(),
  }).eq('id', claimed.id).select('*').single();
  await audit({
    orderId: id, actorId: gate.staff.id, actorName: gate.staff.fullName,
    eventType: 'label_purchase_started', details: { resultGid, package: pkg.value, service: service ?? 'shop preferred carrier' },
  });

  // Most purchases finish within seconds — try once now to save a poll.
  const label = await refreshPending(pending as ShippingLabelRow, order, gate.staff);
  return NextResponse.json({ label });
}

/** Ask Shopify how a pending purchase is going and record the outcome. */
async function refreshPending(
  label: ShippingLabelRow,
  order: { id: string; shopify_order_gid: string },
  staff: { id: string; fullName: string }
): Promise<ShippingLabelRow> {
  if (!label.purchase_result_gid) return label;
  const db = supabaseAdmin();

  let result;
  try {
    result = await getLabelPurchaseResult(label.purchase_result_gid);
  } catch (err) {
    console.error('[label] poll failed — will retry on next poll', err);
    return label;
  }
  if (result.status === 'PENDING_PURCHASE') return label;

  const now = new Date().toISOString();
  if (result.status === 'PURCHASE_FAILED') {
    const message = explainLabelError(result.error?.code, result.error?.message ?? 'The label purchase failed');
    const { data } = await db.from('shipping_labels')
      .update({ status: 'failed', error: message, updated_at: now })
      .eq('id', label.id).eq('status', 'pending').select('*').maybeSingle();
    await audit({ orderId: order.id, actorId: staff.id, actorName: staff.fullName, eventType: 'label_purchase_failed', details: { error: result.error } });
    return (data as ShippingLabelRow | null) ?? { ...label, status: 'failed', error: message };
  }

  const { data } = await db.from('shipping_labels').update({
    status: 'purchased',
    shipping_label_gid: result.label?.gid ?? null,
    tracking_number: result.label?.tracking?.number ?? null,
    tracking_company: result.label?.tracking?.company ?? null,
    tracking_url: result.label?.tracking?.url ?? null,
    updated_at: now,
  }).eq('id', label.id).eq('status', 'pending').select('*').maybeSingle();

  if (data) {
    await audit({
      orderId: order.id, actorId: staff.id, actorName: staff.fullName,
      eventType: 'label_purchased', details: { tracking: result.label?.tracking ?? null },
    });
    // Buying a Shopify Shipping label normally fulfils the order — re-read
    // Shopify rather than assume it.
    try {
      await syncOrderFromShopify(order.shopify_order_gid);
    } catch (err) {
      console.error('[label] post-purchase sync failed (webhook will reconcile)', err);
    }
  }
  return (data as ShippingLabelRow | null) ?? (await latestLabel(order.id)) ?? label;
}
