import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normaliseSettings } from '@/lib/visit-emails/settings';

/**
 * Admin only: saved versions of the settings and copy.
 *   GET            -> the last 30 saves (when, who, subject, start of the message)
 *   GET ?id=<id>   -> that version in full, to load back into the tab (then Save)
 */
export async function GET(req: NextRequest) {
  const gate = await requireRole('admin');
  if ('error' in gate) return gate.error;
  const db = supabaseAdmin();
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const { data, error } = await db.from('visit_email_settings_history').select('value').eq('id', Number(id)).maybeSingle();
    if (error || !data) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    return NextResponse.json({ settings: normaliseSettings(data.value) });
  }
  const { data, error } = await db.from('visit_email_settings_history')
    .select('id, saved_at, saved_by, value').order('saved_at', { ascending: false }).limit(30);
  if (error) return NextResponse.json({ versions: [], missing: true });
  const ids = [...new Set((data ?? []).map((r) => r.saved_by).filter(Boolean))];
  const { data: people } = ids.length ? await db.from('staff_profiles').select('id, full_name').in('id', ids) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  return NextResponse.json({
    versions: (data ?? []).map((r) => {
      const v = normaliseSettings(r.value);
      return {
        id: r.id, saved_at: r.saved_at, saved_by: name.get(r.saved_by) ?? '',
        mode: v.mode, style: v.style, subject: v.subject, opening: v.body_marketing.slice(0, 90),
      };
    }),
  });
}
