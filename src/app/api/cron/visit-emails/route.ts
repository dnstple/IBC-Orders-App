import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron-auth';
import { runVisitEmails } from '@/lib/visit-emails/engine';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Post-visit thank-you emails. Call every 15 minutes from cron-job.org with
 * Authorization: Bearer <CRON_SECRET>. Does nothing while the mode is 'off';
 * in 'dry_run' it decides and records everything but sends nothing.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;
  const result = await runVisitEmails('cron');
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
