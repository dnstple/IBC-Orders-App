import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';

/** Assign/unassign a staff member to an order (internal only). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const staffId = body.staffId ? String(body.staffId) : null; // null ⇒ unassign

  const db = supabaseAdmin();
  const { data: order } = await db.from('orders').select('id, assigned_staff_id').eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  let assigneeName: string | null = null;
  if (staffId) {
    const { data: profile } = await db.from('staff_profiles').select('id, full_name, is_active').eq('id', staffId).maybeSingle();
    if (!profile?.is_active) return NextResponse.json({ error: 'Staff member not found or inactive' }, { status: 400 });
    assigneeName = profile.full_name;
  }

  await db.from('orders').update({ assigned_staff_id: staffId }).eq('id', id);
  if (order.assigned_staff_id) {
    await db.from('staff_assignments').update({ unassigned_at: new Date().toISOString() })
      .eq('order_id', id).is('unassigned_at', null);
  }
  if (staffId) {
    await db.from('staff_assignments').insert({ order_id: id, staff_id: staffId, assigned_by: gate.staff.id });
  }
  await audit({
    orderId: id, actorId: gate.staff.id, actorName: gate.staff.fullName,
    eventType: staffId ? 'assigned' : 'unassigned', details: { staffId, assigneeName },
  });
  return NextResponse.json({ ok: true });
}
