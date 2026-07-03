import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { verifyShopifyHmac } from '@/lib/shopify/hmac';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processWebhookEvent } from '@/lib/webhook-processor';

export const runtime = 'nodejs';

/**
 * Single Shopify webhook endpoint for all subscribed topics.
 *
 * Contract:
 *  1. Verify HMAC on the RAW body (401 if invalid — Shopify won't retry auth failures forever).
 *  2. Record the event; the unique X-Shopify-Webhook-Id makes redelivery a no-op.
 *  3. Return 200 fast; heavy work (full order re-fetch from Shopify) runs
 *     asynchronously via waitUntil, with a cron retry net for failures.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifyShopifyHmac(rawBody, req.headers.get('x-shopify-hmac-sha256'))) {
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  const webhookId = req.headers.get('x-shopify-webhook-id') ?? crypto.randomUUID();
  const topic = req.headers.get('x-shopify-topic') ?? 'unknown';
  const apiVersion = req.headers.get('x-shopify-api-version');
  const triggeredAt = req.headers.get('x-shopify-triggered-at');

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Refund payloads carry order_id; order payloads carry id.
  const shopifyOrderId = Number(
    topic.startsWith('refunds/') || topic.startsWith('fulfillments/')
      ? payload.order_id
      : payload.id
  ) || null;

  const db = supabaseAdmin();
  const { data: inserted, error } = await db
    .from('webhook_events')
    .insert({
      shopify_webhook_id: webhookId,
      topic,
      shopify_order_id: shopifyOrderId,
      api_version: apiVersion,
      triggered_at: triggeredAt,
      payload,
      status: 'received',
    })
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      // Duplicate delivery — already handled. Acknowledge so Shopify stops retrying.
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error('[webhook] failed to record event', error);
    // 500 → Shopify will retry; safe because insert is idempotent.
    return NextResponse.json({ error: 'Storage failure' }, { status: 500 });
  }

  if (inserted) {
    waitUntil(
      processWebhookEvent(inserted.id).catch((err) =>
        console.error('[webhook] async processing failed (cron will retry)', err)
      )
    );
  }

  return NextResponse.json({ ok: true });
}
