import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { appUrl } from '@/lib/visit-emails/engine';
import { addDays, londonDay } from '@/lib/visit-emails/eligibility';
import { renderEmail } from '@/lib/visit-emails/render';
import { sendTestEmail } from '@/lib/visit-emails/sender';
import { normaliseSettings } from '@/lib/visit-emails/settings';

export const runtime = 'nodejs';

const recent: number[] = [];

/**
 * Admin only: send ONE test email to the address typed on the tab, using
 * the settings on screen. Never goes to a guest; subject starts "[TEST]".
 * At most 10 a minute (per server instance) to stop accidental repeats.
 */
export async function POST(req: NextRequest) {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const to = String(body.to ?? '').trim().toLowerCase();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(to)) {
    return NextResponse.json({ error: 'Enter one email address.' }, { status: 400 });
  }
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= 10) return NextResponse.json({ error: 'Too many test emails. Wait a minute.' }, { status: 429 });
  recent.push(now);

  const s = normaliseSettings(body.settings);
  const email = renderEmail(s, {
    token: 'preview',
    appUrl: appUrl(),
    shop: body.shop === 'fitzrovia' ? 'fitzrovia' : 'soho',
    firstName: typeof body.first_name === 'string' ? body.first_name.slice(0, 60) : 'Sofia',
    visitDate: addDays(londonDay(), -1),
    variant: body.variant === 'plain' ? 'plain' : 'marketing',
  });
  try {
    const res = await sendTestEmail(s, to, email);
    console.log('VISIT_EMAIL_TEST', JSON.stringify({ by: gate.staff.id, id: res.id }));
    return NextResponse.json({ ok: true, id: res.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
