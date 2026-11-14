import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifySvix } from '@/lib/visit-emails/webhook';

export const runtime = 'nodejs';

/**
 * Resend webhook: delivery and engagement events for visit emails.
 * Set up in Resend -> Webhooks -> endpoint https://<app>/api/webhooks/resend
 * with events email.delivered, email.delivery_delayed, email.bounced,
 * email.complained, email.opened. Its signing secret (whsec_...) goes in
 * Vercel as RESEND_WEBHOOK_SECRET.
 *
 * Bounces (permanent) and spam complaints add the address to the
 * do-not-email list automatically. Test emails have no row and are ignored.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const ok = verifySvix(
    process.env.RESEND_WEBHOOK_SECRET ?? '',
    req.headers.get('svix-id') ?? '',
    req.headers.get('svix-timestamp') ?? '',
    body,
    req.headers.get('svix-signature') ?? '',
  );
  if (!ok) return NextResponse.json({ error: 'Bad signature' }, { status: 401 });

  let evt: { type?: string; created_at?: string; data?: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { evt = JSON.parse(body); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  const emailId = String(evt.data?.email_id ?? '');
  if (!emailId) return NextResponse.json({ ok: true, ignored: 'no email_id' });

  const db = supabaseAdmin();
  const { data: row } = await db.from('visit_emails')
    .select('id, email, opened_at, open_count, delivered_at').eq('provider_message_id', emailId).maybeSingle();
  if (!row) return NextResponse.json({ ok: true, ignored: 'not a visit email (e.g. a test)' });

  const at = evt.created_at && !Number.isNaN(Date.parse(evt.created_at)) ? evt.created_at : new Date().toISOString();
  switch (evt.type) {
    case 'email.delivered':
      if (!row.delivered_at) await db.from('visit_emails').update({ delivered_at: at }).eq('id', row.id);
      break;
    case 'email.delivery_delayed':
      await db.from('visit_emails').update({ delayed_at: at }).eq('id', row.id);
      break;
    case 'email.opened':
      await db.from('visit_emails').update({ opened_at: row.opened_at ?? at, open_count: (row.open_count ?? 0) + 1 }).eq('id', row.id);
      break;
    case 'email.bounced': {
      const type = String(evt.data?.bounce?.type ?? '');
      await db.from('visit_emails').update({ bounced_at: at, bounce_type: type || null }).eq('id', row.id);
      if (row.email && !/transient/i.test(type)) {
        await db.from('visit_email_suppressions').upsert({ email: row.email, reason: 'bounce' }, { onConflict: 'email', ignoreDuplicates: true });
      }
      break;
    }
    case 'email.complained':
      await db.from('visit_emails').update({ complained_at: at }).eq('id', row.id);
      if (row.email) {
        await db.from('visit_email_suppressions').upsert({ email: row.email, reason: 'complaint' }, { onConflict: 'email', ignoreDuplicates: true });
      }
      break;
    default:
      return NextResponse.json({ ok: true, ignored: evt.type });
  }
  return NextResponse.json({ ok: true });
}
