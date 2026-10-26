import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getLabelPurchaseResult } from '@/lib/shopify/actions';
import { isDemoOrder } from '@/lib/shopify/sync';
import { buildDemoLabelPdf } from '@/lib/shipping-label';

/**
 * The order's purchased label as a PDF, served from this app's own origin
 * so the iPad can hand it straight to the share sheet (and the Munbyn app).
 * The Shopify document URL is re-read on every request in case it expires.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;
  const db = supabaseAdmin();

  const { data: order } = await db.from('orders')
    .select('id, shopify_order_id, order_number, customer_name, delivery_address, tags')
    .eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  const { data: label } = await db.from('shipping_labels')
    .select('status, purchase_result_gid, tracking_number')
    .eq('order_id', id).eq('status', 'purchased')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!label) return NextResponse.json({ error: 'No label has been bought for this order' }, { status: 404 });

  const filename = `label-${order.order_number.replace(/[^\w-]/g, '')}.pdf`;
  const headers = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  };

  if (isDemoOrder(order)) {
    const a = (order.delivery_address ?? {}) as Record<string, string | null>;
    const pdf = buildDemoLabelPdf([
      'DEMO LABEL - NOT POSTAGE',
      `Royal Mail Tracked 24  ${order.order_number}`,
      order.customer_name ?? '',
      a.address1 ?? '',
      a.city ?? '',
      a.zip ?? '',
      `Tracking ${label.tracking_number ?? ''}`,
    ]);
    return new NextResponse(pdf.buffer as ArrayBuffer, { headers });
  }

  if (!label.purchase_result_gid) {
    return NextResponse.json({ error: 'Label record is missing its Shopify reference' }, { status: 500 });
  }
  try {
    const result = await getLabelPurchaseResult(label.purchase_result_gid);
    const url = result.label?.pdfUrl;
    if (!url) return NextResponse.json({ error: 'Shopify has no printable label for this order' }, { status: 502 });
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ error: `Couldn't download the label (${res.status})` }, { status: 502 });
    return new NextResponse(await res.arrayBuffer(), { headers });
  } catch (err) {
    console.error('[label pdf] failed', err);
    return NextResponse.json({ error: 'Couldn\'t get the label from Shopify — try again' }, { status: 502 });
  }
}
