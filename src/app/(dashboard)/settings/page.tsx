import { supabaseServer } from '@/lib/supabase/server';
import { SettingsPanel } from '@/components/SettingsPanel';

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('staff_profiles').select('role').eq('id', user!.id).single();
  const role = (profile?.role ?? 'staff') as 'staff' | 'manager' | 'admin';

  if (role === 'staff') {
    return <p className="rounded-xl border border-cocoa-100 bg-white p-6 text-stone-500">Settings require a manager or admin account.</p>;
  }
  const { data: settings } = await supabase.from('app_settings').select('key, value');
  const { data: staff } = await supabase.from('staff_profiles').select('id, full_name, role, is_active').order('full_name');

  return <SettingsPanel role={role} settings={settings ?? []} staff={staff ?? []} />;
}
