import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { shopifyGraphql } from '@/lib/shopify/client';
import { ORDERS_RECENT_QUERY } from '@/lib/shopify/queries';
import { syncOrderFromShopify } from '@/lib/shopify/sync';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Manual "Sync from Shopify" (manager+). Re-syncs recent + open orders in
 * case any webhook was missed. Bounded to protect rate limits.
 */
export async function POST(req: NextRequest) {
  const gate = await requireRole('manager');
  if ('error' in gate) return gate.error;
  try {
    return await runSync(req, gate.staff);
  } catch (err) {
    // Surface config/auth problems (bad domain, token exchange failure, missing
    // scopes) as readable JSON instead of an opaque 500.
    console.error('[sync] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

async function runSync(req: NextRequest, staff: { id: string; fullName: string }) {
  const body = await req.json().catch(() => ({}));
  const days = Math.min(Number(body.days) || 14, 60);

  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const search = `created_at:>=${since} OR fulfillment_status:unfulfilled`;

  let synced = 0, failed = 0, cursor: string | null = null;
  const errors: string[] = [];

  for (let page = 0; page < 5; page++) {
    const data: {
      orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string }> };
    } = await shopifyGraphql(ORDERS_RECENT_QUERY, { first: 50, query: search, after: cursor }, 'OrdersRecent');

    for (const node of data.orders.nodes) {
      try {
        await syncOrderFromShopify(node.id);
        synced++;
      } catch (err) {
        failed++;
        if (errors.length < 5) errors.push(`${node.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  await supabaseAdmin().from('app_settings').upsert({
    key: 'last_manual_sync',
    value: { at: new Date().toISOString(), by: staff.fullName, synced, failed },
    updated_by: staff.id,
  });
  return NextResponse.json({ ok: failed === 0, synced, failed, errors });
}
