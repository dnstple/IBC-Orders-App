import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processWebhookEvent } from '@/lib/webhook-processor';

export const runtime = 'nodejs';

/**
 * Retry net (every 5 min): webhook events stuck in 'received' (missed async
 * processing) or wedged in 'processing' (function died mid-flight) are
 * re-processed. Idempotent: processing re-fetches full truth from Shopify.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const db = supabaseAdmin();
  const staleCutoff = new Date(Date.now() - 3 * 60000).toISOString();

  // Unwedge events stuck in 'processing' for >3 minutes.
  await db.from('webhook_events')
    .update({ status: 'received' })
    .eq('status', 'processing')
    .lt('received_at', staleCutoff);

  const { data: pending } = await db.from('webhook_events')
    .select('id')
    .eq('status', 'received')
    .lt('received_at', new Date(Date.now() - 60000).toISOString())
    .order('received_at')
    .limit(20);

  let processed = 0, failed = 0;
  for (const evt of pending ?? []) {
    try {
      await processWebhookEvent(evt.id);
      processed++;
    } catch {
      failed++;
    }
  }
  return NextResponse.json({ ok: true, processed, failed });
}
