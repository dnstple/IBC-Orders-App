import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { normaliseSettings } from '@/lib/visit-emails/settings';
import { VisitEmailsDashboard } from '@/components/VisitEmailsDashboard';

export const dynamic = 'force-dynamic';

/** Post-visit thank-you emails: stats, settings, copy and backfill. Admin only. */
export default async function VisitEmailsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('staff_profiles').select('role').eq('id', user!.id).single();
  if (me?.role !== 'admin') redirect('/pickups');

  const { data } = await supabase.from('app_settings').select('value').eq('key', 'visit_emails').maybeSingle();
  return <VisitEmailsDashboard initialSettings={normaliseSettings(data?.value)} />;
}
