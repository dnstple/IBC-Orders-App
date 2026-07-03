import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncOrderFromShopify } from '@/lib/shopify/sync';
import { sendStaffPush } from '@/lib/push';

const MAX_ATTEMPTS = 5;

/**
 * Process one stored webhook event: re-fetch the FULL order + fulfillment
 * orders from Shopify (never trust the payload alone), upsert, and fire
 * new-paid-order notifications. Idempotent and safe under retries.
 */
export async function processWebhookEvent(eventId: string): Promise<void> {
  const db = supabaseAdmin();

  // Claim the event; only one worker may move received/failed → processing.
  const { data: claimed } = await db
    .from('webhook_events')
    .update({ status: 'processing' })
    .eq('id', eventId)
    .eq('status', 'received')
    .select('id, topic, shopify_order_id, attempts')
    .maybeSingle();
  if (!claimed) return; // already processed or being processed

  try {
    if (!claimed.shopify_order_id) {
      await db.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', eventId);
      return;
    }

    const gid = `gid://shopify/Order/${claimed.shopify_order_id}`;
    const result = await syncOrderFromShopify(gid);

    await db.from('webhook_events').update({
      status: result.skippedStale ? 'skipped_stale' : 'processed',
      processed_at: new Date().toISOString(),
      attempts: (claimed.attempts ?? 0) + 1,
    }).eq('id', eventId);

    // New paid order → alert staff (dedupe key means at most one push per order).
    if (result.becamePaid) {
      await sendStaffPush({
        heading: 'New Italian Bear order',
        message: `New order ${result.orderNumber} — ${result.itemCount} item${result.itemCount === 1 ? '' : 's'}. Tap to view.`,
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/orders`,
        dedupeKey: `new_order:${result.orderId}`,
        orderId: result.orderId,
        kind: 'new_order',
      });
    }
  } catch (err) {
    const attempts = (claimed.attempts ?? 0) + 1;
    await db.from('webhook_events').update({
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'received', // 'received' → cron retries
      attempts,
      error: err instanceof Error ? err.message : String(err),
    }).eq('id', eventId);
    throw err;
  }
}
