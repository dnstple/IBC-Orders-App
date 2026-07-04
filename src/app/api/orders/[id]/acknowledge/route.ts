import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';

/**
 * Marks a NEW order as seen (clears the unread indicator + stops the
 * escalation alarms). Internal only — never touches Shopify. Fired
 * automatically when staff open an order; there is no user-facing
 * "Acknowledge" action or status anywhere in the UI.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRole('staff');
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;

  const db = supabaseAdmin();
  const { data: order } = await db.from('orders').select('id, internal_status').eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.internal_status !== 'new') {
    return NextResponse.json({ ok: true, alreadySeen: true });
  }

  const { error } = await db.from('orders').update({
    internal_status: 'acknowledged', // DB value retained for compatibility; never displayed
    acknowledged_at: new Date().toISOString(),
    acknowledged_by: gate.staff.id,
  }).eq('id', id).eq('internal_status', 'new'); // optimistic guard against races
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit({
    orderId: id, actorId: gate.staff.id, actorName: gate.staff.fullName,
    eventType: 'opened', details: {},
  });
  return NextResponse.json({ ok: true });
}
