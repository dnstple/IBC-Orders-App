import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { recentStatuses } from '@/lib/visit-emails/engine';

export const runtime = 'nodejs';

/** Admin only: TableAgent status codes seen in the last 3 weeks, to pick which mean "arrived". */
export async function GET() {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  try {
    return NextResponse.json({ statuses: await recentStatuses() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
