import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { sendStaffPush } from '@/lib/push';

/**
 * Called once after sign-up: notifies admins that a request is waiting.
 * The caller must be authenticated (their pending profile was created by
 * the auth trigger); deduped per user so it can never spam.
 */
export async function POST() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: profile } = await supabase.from('staff_profiles')
    .select('full_name, role').eq('id', user.id).maybeSingle();
  if (!profile || profile.role !== 'pending') return NextResponse.json({ ok: true });

  await sendStaffPush({
    heading: 'Staff access request',
    message: `${profile.full_name} has requested dashboard access. Approve in Settings.`,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/settings`,
    dedupeKey: `signup_request:${user.id}`,
    kind: 'signup_request',
    roles: ['admin'],
  });
  return NextResponse.json({ ok: true });
}
