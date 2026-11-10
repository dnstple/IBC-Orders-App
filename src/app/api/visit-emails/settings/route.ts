import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { londonDay } from '@/lib/visit-emails/eligibility';
import { liveSendingAllowed, normaliseSettings } from '@/lib/visit-emails/settings';

/** Manager+: save the Visit emails settings and copy. */
export async function POST(req: NextRequest) {
  const gate = await requireRole('manager');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const next = normaliseSettings(body);

  if (next.mode === 'live' && !liveSendingAllowed()) {
    return NextResponse.json({
      error: 'Live sending is locked on the server. It needs RESEND_API_KEY and VISIT_EMAILS_ALLOW_LIVE=true in Vercel first.',
    }, { status: 409 });
  }
  // First time it's switched on: automatic emails start from today; older visits are for the backfill.
  if (next.mode !== 'off' && !next.auto_from_date) next.auto_from_date = londonDay();

  const { error } = await supabaseAdmin().from('app_settings').upsert({
    key: 'visit_emails', value: next, updated_by: gate.staff.id, updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, settings: next });
}
