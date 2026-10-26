import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { shopifyGraphql } from '@/lib/shopify/client';
import { ORDER_SLIP_QUERY, SLIP_VARIANTS_QUERY } from '@/lib/shopify/queries';
import { buildOrderSlip, type AllergenSource, type SlipLineInput } from '@/lib/order-slip';
import { renderSlipHtml } from '@/lib/order-slip-html';

type Mf = { value: string } | null;

const parseList = (mf: Mf | undefined): string[] | null => {
  if (!mf?.value) return null;
  try {
    const v = JSON.parse(mf.value);
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
};

const allergensOf = (product: { pa: Mf; pt: Mf } | null, variant: { va: Mf; vt: Mf } | null): AllergenSource => ({
  productAllergens: parseList(product?.pa),
  productTraces: parseList(product?.pt),
  variantAllergens: parseList(variant?.va),
  variantTraces: parseList(variant?.vt),
});

interface SlipQuery {
  order: {
    name: string;
    lineItems: {
      nodes: Array<{
        title: string;
        variantTitle: string | null;
        sku: string | null;
        currentQuantity: number;
        customAttributes: Array<{ key: string; value: string | null }>;
        product: { pa: Mf; pt: Mf } | null;
        variant: { va: Mf; vt: Mf } | null;
      }>;
    };
  } | null;
}

interface VariantsQuery {
  nodes: Array<{ legacyResourceId: string; product: { title: string; pa: Mf; pt: Mf }; va: Mf; vt: Mf } | null>;
}

/**
 * The order's "YOUR ORDER" packing slip: print-ready 4×6 HTML plus any
 * allergen warnings for staff. Read-only — allergens are read live from the
 * website's metafields every time, so the slip always matches the site.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;
  const db = supabaseAdmin();

  const { data: order } = await db.from('orders')
    .select('id, shopify_order_id, shopify_order_gid, order_number')
    .eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  let lines: SlipLineInput[];
  const giftBoxPieces: Record<string, { title: string; allergens: AllergenSource }> = {};
  const seeded = order.shopify_order_id >= 900000000000 && order.shopify_order_id < 900000001000;

  try {
    if (seeded) {
      // App-only seed order: nothing to read in Shopify.
      const { data: items } = await db.from('order_line_items')
        .select('title, variant_title, sku, quantity, refunded_quantity, properties').eq('order_id', id);
      lines = (items ?? []).map((li) => ({
        title: li.title,
        variantTitle: li.variant_title,
        sku: li.sku,
        quantity: li.quantity - (li.refunded_quantity ?? 0),
        properties: li.properties ?? [],
        allergens: {},
      }));
    } else {
      const data = await shopifyGraphql<SlipQuery>(ORDER_SLIP_QUERY, { id: order.shopify_order_gid }, 'orderSlip');
      if (!data.order) return NextResponse.json({ error: 'Shopify couldn\'t find this order' }, { status: 404 });
      lines = data.order.lineItems.nodes.map((li) => ({
        title: li.title,
        variantTitle: li.variantTitle,
        sku: li.sku,
        quantity: li.currentQuantity,
        properties: li.customAttributes.map((a) => ({ name: a.key, value: a.value ?? '' })),
        allergens: allergensOf(li.product, li.variant),
      }));

      // Gift box pieces are saved as variant ids on the box line.
      const ids = new Set<string>();
      for (const l of lines) {
        const raw = l.properties.find((p) => p.name === '_Gift Box Selection JSON')?.value;
        if (!raw) continue;
        try {
          for (const p of JSON.parse(raw) as Array<{ variant_id: number | string }>) ids.add(String(p.variant_id));
        } catch { /* builder falls back to the checkout snapshot */ }
      }
      if (ids.size) {
        const v = await shopifyGraphql<VariantsQuery>(
          SLIP_VARIANTS_QUERY,
          { ids: [...ids].map((n) => `gid://shopify/ProductVariant/${n}`) },
          'slipVariants'
        );
        for (const n of v.nodes) {
          if (n) giftBoxPieces[n.legacyResourceId] = { title: n.product.title, allergens: allergensOf(n.product, n) };
        }
      }
    }
  } catch (err) {
    console.error('[order slip] failed', err);
    return NextResponse.json({ error: 'Couldn\'t read the order from Shopify — try again' }, { status: 502 });
  }

  const slip = buildOrderSlip({ orderNumber: order.order_number, lines, giftBoxPieces });
  if (seeded) slip.staffWarnings.unshift('Practice order made in the app — it has no allergen information.');
  const html = renderSlipHtml(slip, { fontBase: `${req.nextUrl.origin}/fonts` });

  return NextResponse.json(
    { html, warnings: slip.staffWarnings },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
