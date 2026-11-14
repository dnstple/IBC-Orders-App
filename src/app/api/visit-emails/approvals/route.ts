import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendOneApproved } from '@/lib/visit-emails/engine';

export const runtime = 'nodejs';

/**
 * Admin only: the approval list.
 *   GET                              -> emails waiting (queued, or held in dry run), oldest visit first
 *   POST { id, action: 'send' }      -> send that one email now
 *   POST { id, action: 'skip' }      -> don't send it (cancelled, contact details removed)
 */
export async function GET() {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const { data, error } = await supabaseAdmin().from('visit_emails')
    .select('id, shop, visit_date, visit_at, party_size, first_name, email, marketing, variant, state, due_at, source, error')
    .in('state', ['queued', 'dry_run']).order('visit_at', { ascending: true }).order('due_at', { ascending: true }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Unknown email.' }, { status: 400 });

  if (body.action === 'skip') {
    const { data } = await supabaseAdmin().from('visit_emails')
      .update({ state: 'cancelled', skip_reason: 'cancelled', email: null, first_name: null })
      .eq('id', id).in('state', ['queued', 'dry_run']).select('id');
    return data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Already sent or removed.' }, { status: 409 });
  }
  if (body.action === 'send') {
    const r = await sendOneApproved(id, gate.staff.fullName);
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 409 });
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
