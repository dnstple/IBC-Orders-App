import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Manager+: update operational settings (escalation + reminder timings). */
export async function POST(req: NextRequest) {
  const gate = await requireRole('manager');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));

  const clamp = (v: unknown, def: number) => Math.min(Math.max(Number(v) || def, 1), 1440);
  const db = supabaseAdmin();
  const rows = [
    {
      key: 'escalation',
      value: {
        dashboard_repeat_minutes: clamp(body.dashboard_repeat_minutes, 2),
        push_repeat_minutes: clamp(body.push_repeat_minutes, 5),
        manager_escalation_minutes: clamp(body.manager_escalation_minutes, 15),
        manager_escalation_enabled: Boolean(body.manager_escalation_enabled),
      },
      updated_by: gate.staff.id,
    },
    {
      key: 'reminders',
      value: {
        pickup_lead_minutes: clamp(body.pickup_lead_minutes, 60),
        delivery_lead_minutes: clamp(body.delivery_lead_minutes, 60),
      },
      updated_by: gate.staff.id,
    },
  ];
  const { error } = await db.from('app_settings').upsert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
