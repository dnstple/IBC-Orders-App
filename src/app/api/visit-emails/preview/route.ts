import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { appUrl } from '@/lib/visit-emails/engine';
import { londonDay, addDays } from '@/lib/visit-emails/eligibility';
import { renderEmail } from '@/lib/visit-emails/render';
import { normaliseSettings } from '@/lib/visit-emails/settings';

/**
 * Admin only: renders the email from the settings on screen (saved or not),
 * so copy can be checked before saving. Links point at /r/preview/..., which
 * redirects without counting a click. Sends nothing.
 */
export async function POST(req: NextRequest) {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const s = normaliseSettings(body.settings);
  const email = renderEmail(s, {
    token: 'preview',
    appUrl: appUrl(),
    shop: body.shop === 'fitzrovia' ? 'fitzrovia' : 'soho',
    firstName: typeof body.first_name === 'string' ? body.first_name.slice(0, 60) : 'Sofia',
    visitDate: /^\d{4}-\d{2}-\d{2}$/.test(body.visit_date ?? '') ? body.visit_date : addDays(londonDay(), -1),
    variant: body.variant === 'plain' ? 'plain' : 'marketing',
  });
  return NextResponse.json(email);
}
