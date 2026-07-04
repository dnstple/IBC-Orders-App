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

  // Claim the event; only one worker may move received → processing.
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

    // Order deleted in Shopify → remove it here too (line items, fulfilment
    // groups, events and scheduled jobs cascade away with it).
    if (claimed.topic === 'orders/delete') {
      await db.from('orders').delete().eq('shopify_order_id', claimed.shopify_order_id);
      await db.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', eventId);
      console.log(`[webhook] order ${claimed.shopify_order_id} deleted in Shopify — removed locally`);
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
    if (result.becamePaid && !result.deleted) {
      await sendStaffPush({
        heading: result.isPickup ? 'New pickup order' : 'New delivery order',
        message: `Order ${result.orderNumber} — ${result.itemCount} item${result.itemCount === 1 ? '' : 's'}. Tap to view.`,
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/orders/${result.orderId}`,
        dedupeKey: `new_order:${result.orderId}`,
        orderId: result.orderId,
        kind: result.isPickup ? 'new_pickup_order' : 'new_delivery_order',
        prefKey: result.isPickup ? 'new_pickup' : 'new_delivery',
      });
    }
  } catch (err) {
    const attempts = (claimed.attempts ?? 0) + 1;
    await db.from('webhook_events').update({
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'received', // 'received' → cron retries
      attempts,
      error: err instanceof Error ? err.message : String(err),
    }).eq('id', eventId);

    if (attempts >= MAX_ATTEMPTS) {
      // Admin-only integration failure alert.
      await sendStaffPush({
        heading: 'Shopify sync problem',
        message: `Webhook ${claimed.topic} failed ${MAX_ATTEMPTS} times. Check Settings → sync health.`,
        dedupeKey: `webhook_failed:${eventId}`,
        kind: 'sync_error',
        roles: ['admin'],
        prefKey: 'sync_errors',
      }).catch(() => undefined);
    }
    throw err;
  }
}
