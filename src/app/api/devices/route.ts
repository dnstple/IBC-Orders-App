import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Register this device's OneSignal subscription id for the signed-in staff member. */
export async function POST(req: NextRequest) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const playerId = String(body.playerId ?? '').trim();
  if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: profile } = await db.from('staff_profiles')
    .select('onesignal_player_ids').eq('id', gate.staff.id).single();
  const ids = new Set<string>(profile?.onesignal_player_ids ?? []);
  ids.add(playerId);
  await db.from('staff_profiles').update({ onesignal_player_ids: [...ids] }).eq('id', gate.staff.id);
  return NextResponse.json({ ok: true });
}
