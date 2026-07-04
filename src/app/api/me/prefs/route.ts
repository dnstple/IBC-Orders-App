import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';

const KEYS = ['new_pickup', 'new_delivery', 'pickup_reminders', 'status_changes', 'sync_errors'] as const;

/** Per-user notification preferences. */
export async function POST(req: NextRequest) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));

  const prefs: Record<string, boolean> = {};
  for (const k of KEYS) prefs[k] = body[k] !== false && body[k] !== 'false';

  const { error } = await supabaseAdmin().from('staff_profiles')
    .update({ notification_prefs: prefs }).eq('id', gate.staff.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, prefs });
}
