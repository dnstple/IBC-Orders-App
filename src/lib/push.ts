import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Web-push to opted-in staff devices via OneSignal.
 * Notifications deliberately minimise personal data: order number + item
 * count only. Never include addresses, phone numbers or customer notes.
 */
interface PushOptions {
  heading: string;
  message: string;
  url?: string;
  /** Unique key — a row in notification_events guards against double-sends. */
  dedupeKey: string;
  orderId?: string;
  kind: string;
  roles?: Array<'staff' | 'manager' | 'admin'>;
}

export async function sendStaffPush(opts: PushOptions): Promise<{ sent: boolean; reason?: string }> {
  const db = supabaseAdmin();

  // Idempotency: claim the dedupe key first; unique constraint stops repeats.
  const { error: dupeError } = await db.from('notification_events').insert({
    order_id: opts.orderId ?? null,
    kind: opts.kind,
    channel: 'push',
    dedupe_key: opts.dedupeKey,
    payload: { heading: opts.heading, message: opts.message },
  });
  if (dupeError) {
    if (dupeError.code === '23505') return { sent: false, reason: 'duplicate' };
    console.error('[push] dedupe insert failed', dupeError);
    return { sent: false, reason: 'dedupe_error' };
  }

  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    console.warn('[push] OneSignal not configured — skipping push send');
    return { sent: false, reason: 'not_configured' };
  }

  let query = db.from('staff_profiles').select('onesignal_player_ids, role').eq('is_active', true);
  if (opts.roles?.length) query = query.in('role', opts.roles);
  const { data: profiles } = await query;
  const playerIds = [...new Set((profiles ?? []).flatMap((p) => p.onesignal_player_ids ?? []))];
  if (playerIds.length === 0) return { sent: false, reason: 'no_devices' };

  const res = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      include_subscription_ids: playerIds,
      headings: { en: opts.heading },
      contents: { en: opts.message },
      url: opts.url ?? process.env.NEXT_PUBLIC_APP_URL,
    }),
  });
  if (!res.ok) {
    console.error('[push] OneSignal error', res.status, await res.text().catch(() => ''));
    return { sent: false, reason: `onesignal_${res.status}` };
  }
  return { sent: true };
}
