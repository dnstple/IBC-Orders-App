import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Server-side sign-in. The session cookie is set via Set-Cookie response
 * headers rather than client-side JavaScript — reliable on Safari/iPad
 * configurations that restrict document.cookie (which caused silent
 * login loops with no error).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) {
    return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const friendly = error.message === 'Invalid login credentials'
      ? 'Email or password is incorrect.'
      : error.message;
    return NextResponse.json({ error: friendly }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
