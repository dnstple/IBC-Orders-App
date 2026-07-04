import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Admin-only staff access management.
 * GET  → all profiles incl. pending requests (with email from auth).
 * POST → { userId, action: 'approve' | 'reject' | 'suspend' | 'restore', role? }
 * RLS + requireRole enforce this server-side; UI hiding is cosmetic.
 */
export async function GET() {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const db = supabaseAdmin();

  const { data: profiles } = await db.from('staff_profiles')
    .select('id, full_name, role, is_active, requested_at, approved_at')
    .order('requested_at', { ascending: false });

  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const emails = new Map((users?.users ?? []).map((u) => [u.id, u.email ?? '']));
  return NextResponse.json({
    staff: (profiles ?? []).map((p) => ({ ...p, email: emails.get(p.id) ?? '' })),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? '');
  const action = String(body.action ?? '');
  const db = supabaseAdmin();

  const { data: target } = await db.from('staff_profiles').select('id, role, full_name').eq('id', userId).maybeSingle();
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (target.id === gate.staff.id && ['reject', 'suspend'].includes(action)) {
    return NextResponse.json({ error: 'You cannot suspend your own admin account' }, { status: 400 });
  }

  let update: Record<string, unknown>;
  switch (action) {
    case 'approve': {
      const role = ['staff', 'manager', 'admin'].includes(body.role) ? body.role : 'staff';
      update = { role, is_active: true, approved_by: gate.staff.id, approved_at: new Date().toISOString() };
      break;
    }
    case 'reject':
    case 'suspend':
      update = { role: 'suspended', is_active: false };
      break;
    case 'restore':
      update = { role: 'staff', is_active: true, approved_by: gate.staff.id, approved_at: new Date().toISOString() };
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const { error } = await db.from('staff_profiles').update(update).eq('id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
