import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { loadSettings } from '@/lib/visit-emails/engine';
import { salesFromVisitEmails } from '@/lib/visit-emails/sales';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Admin only: online orders and revenue that came from the visit emails. Read-only. */
export async function GET() {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  try {
    return NextResponse.json(await salesFromVisitEmails(await loadSettings()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
