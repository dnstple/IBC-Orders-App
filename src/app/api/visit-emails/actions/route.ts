import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Manager+: housekeeping on the Visit emails tab.
 *   requeue_dry_run - put dry-run emails back in the queue (e.g. when going live)
 *   cancel_queued   - cancel everything still waiting to send
 *   suppress        - never email this address (also cancels its queued email)
 */
export async function POST(req: NextRequest) {
  const gate = await requireRole('manager');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  if (body.action === 'requeue_dry_run') {
    const { data, error } = await db.from('visit_emails')
      .update({ state: 'queued', sent_at: null, due_at: new Date().toISOString() })
      .eq('state', 'dry_run').select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: data?.length ?? 0 });
  }
  if (body.action === 'cancel_queued') {
    const { data, error } = await db.from('visit_emails')
      .update({ state: 'cancelled', skip_reason: 'cancelled', email: null, first_name: null })
      .eq('state', 'queued').select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: data?.length ?? 0 });
  }
  if (body.action === 'suppress') {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    await db.from('visit_email_suppressions').upsert({ email, reason: 'manual' }, { onConflict: 'email', ignoreDuplicates: true });
    await db.from('visit_emails').update({ state: 'cancelled', skip_reason: 'opted_out', email: null, first_name: null })
      .eq('email', email).eq('state', 'queued');
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
