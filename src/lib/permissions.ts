import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export type StaffRole = 'staff' | 'manager' | 'admin';

export interface StaffContext {
  id: string;
  fullName: string;
  role: StaffRole;
}

const RANK: Record<StaffRole, number> = { staff: 1, manager: 2, admin: 3 };

/**
 * Server-side gate for every API route. Never rely on the UI hiding buttons.
 * Returns the staff context, or a NextResponse error to return immediately.
 */
export async function requireRole(
  minimum: StaffRole
): Promise<{ staff: StaffContext } | { error: NextResponse }> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  }
  const { data: profile } = await supabase
    .from('staff_profiles')
    .select('id, full_name, role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active) {
    return { error: NextResponse.json({ error: 'No active staff profile' }, { status: 403 }) };
  }
  const rank = RANK[profile.role as StaffRole] ?? 0; // pending/suspended → 0
  if (rank < RANK[minimum]) {
    return { error: NextResponse.json({ error: `Requires ${minimum} role` }, { status: 403 }) };
  }
  return { staff: { id: profile.id, fullName: profile.full_name, role: profile.role as StaffRole } };
}
