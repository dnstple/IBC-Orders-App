import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { loadSettings, sampleVisits } from '@/lib/visit-emails/engine';
import { addDays, londonDay } from '@/lib/visit-emails/eligibility';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Admin only: bookings in a date range (max 31 days) and what the rules would do with each. Saves nothing. */
export async function POST(req: NextRequest) {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const today = londonDay();
  const from = ymd.test(body.from ?? '') ? body.from : addDays(today, -6);
  const to = ymd.test(body.to ?? '') ? body.to : today;
  if (from > to) return NextResponse.json({ error: 'Start date must be before the end date.' }, { status: 400 });
  if (addDays(from, 31) < to) return NextResponse.json({ error: 'Choose 31 days or fewer.' }, { status: 400 });
  try {
    const s = await loadSettings();
    return NextResponse.json({ from, to, ...(await sampleVisits(from, to, s)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
