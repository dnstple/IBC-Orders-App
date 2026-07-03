import { supabaseAdmin } from '@/lib/supabase/admin';

interface AuditEntry {
  orderId: string;
  actorId?: string | null;
  actorName?: string;
  eventType: string;
  details?: Record<string, unknown>;
}

/** Append-only audit record. Never throws — auditing must not break actions. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await supabaseAdmin().from('order_events').insert({
      order_id: entry.orderId,
      actor_id: entry.actorId ?? null,
      actor_name: entry.actorName ?? 'System',
      event_type: entry.eventType,
      details: entry.details ?? {},
    });
  } catch (err) {
    console.error('[audit] failed to record event', entry.eventType, err);
  }
}
