import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncOrderFromShopify } from '@/lib/shopify/sync';

/** Admin-only: list + retry failed Shopify write operations. */
export async function GET(_req: NextRequest) {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const { data } = await supabaseAdmin().from('shopify_write_errors')
    .select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(100);
  return NextResponse.json({ errors: data ?? [] });
}

/** Body: { errorId, resolution: 'retry_sync' | 'dismiss' }
 *  retry_sync re-reads the order from Shopify so state is correct before staff retry the action from the order page. */
export async function POST(req: NextRequest) {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  const { data: row } = await db.from('shopify_write_errors')
    .select('id, order_id, action').eq('id', body.errorId).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.resolution === 'dismiss') {
    await db.from('shopify_write_errors').update({ status: 'dismissed', resolved_at: new Date().toISOString() }).eq('id', row.id);
    return NextResponse.json({ ok: true });
  }

  if (row.order_id) {
    const { data: order } = await db.from('orders').select('shopify_order_gid').eq('id', row.order_id).maybeSingle();
    if (order) {
      try {
        await syncOrderFromShopify(order.shopify_order_gid);
      } catch (err) {
        return NextResponse.json({ error: `Re-sync failed: ${err instanceof Error ? err.message : err}` }, { status: 502 });
      }
    }
  }
  await db.from('shopify_write_errors').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', row.id);
  return NextResponse.json({ ok: true, note: 'Order re-synced from Shopify. Retry the action from the order page.' });
}
