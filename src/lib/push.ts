import { supabaseAdmin } from '@/lib/supabase/admin';
import type { NotificationPrefs } from '@/types/db';

/**
 * Web-push to opted-in staff devices via OneSignal.
 * - Deduped via a unique key in notification_events (never double-sends).
 * - Respects each staff member's notification preferences.
 * - Prunes subscription ids OneSignal reports as invalid/expired.
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
  /** Only send to staff who have this preference enabled. */
  prefKey?: keyof NotificationPrefs;
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

  let query = db.from('staff_profiles')
    .select('id, onesignal_player_ids, role, notification_prefs')
    .eq('is_active', true)
    .in('role', opts.roles ?? ['staff', 'manager', 'admin']);
  const { data: profiles } = await query;

  const eligible = (profiles ?? []).filter((p) => {
    if (!opts.prefKey) return true;
    const prefs = (p.notification_prefs ?? {}) as Partial<NotificationPrefs>;
    return prefs[opts.prefKey] !== false; // default on
  });
  const playerIds = [...new Set(eligible.flatMap((p) => p.onesignal_player_ids ?? []))];
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

  // Prune invalid/expired subscriptions so lists stay healthy.
  try {
    const body = (await res.json()) as { errors?: { invalid_aliases?: { subscription_id?: string[] } } | string[] };
    const invalid = Array.isArray(body.errors)
      ? []
      : body.errors?.invalid_aliases?.subscription_id ?? [];
    if (invalid.length) {
      for (const p of eligible) {
        const remaining = (p.onesignal_player_ids ?? []).filter((id: string) => !invalid.includes(id));
        if (remaining.length !== (p.onesignal_player_ids ?? []).length) {
          await db.from('staff_profiles').update({ onesignal_player_ids: remaining }).eq('id', p.id);
        }
      }
    }
  } catch {
    /* response body parsing is best-effort */
  }
  return { sent: true };
}
