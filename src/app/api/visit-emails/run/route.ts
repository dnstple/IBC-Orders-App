import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { runVisitEmails } from '@/lib/visit-emails/engine';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Manager+: "Run now" on the Visit emails tab (same as one cron run). */
export async function POST() {
  const gate = await requireRole('manager');
  if ('error' in gate) return gate.error;
  return NextResponse.json(await runVisitEmails('manual'));
}
