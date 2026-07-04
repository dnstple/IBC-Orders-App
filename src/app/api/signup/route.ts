import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendStaffPush } from '@/lib/push';

/**
 * Staff access request (public endpoint).
 * Creates the auth user server-side with the service role, which bypasses
 * Supabase's confirmation-email flow entirely — sign-ups were silently
 * failing when confirmation emails didn't arrive. The profile is written
 * directly as PENDING (belt-and-braces alongside the DB trigger), so the
 * request always shows in Settings → Staff access. Pending users get no
 * data access until an admin approves them (enforced by RLS).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const fullName = String(body.fullName ?? '').trim().slice(0, 80);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  if (!fullName || fullName.length < 2) {
    return NextResponse.json({ error: 'Please enter your full name.' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email round-trip needed
    user_metadata: { full_name: fullName },
  });

  if (error) {
    const friendly = /already.*(registered|exists)/i.test(error.message)
      ? 'An account with this email already exists. If you are waiting for approval, an admin will activate it.'
      : error.message;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }

  // Ensure the pending profile exists even if the DB trigger is missing.
  await db.from('staff_profiles').upsert(
    { id: created.user.id, full_name: fullName, role: 'pending', is_active: false },
    { onConflict: 'id', ignoreDuplicates: true }
  );

  await sendStaffPush({
    heading: 'Staff access request',
    message: `${fullName} has requested dashboard access. Approve in Settings.`,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/settings`,
    dedupeKey: `signup_request:${created.user.id}`,
    kind: 'signup_request',
    roles: ['admin'],
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
