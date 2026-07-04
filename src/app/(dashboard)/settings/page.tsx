import { supabaseServer } from '@/lib/supabase/server';
import { SettingsPanel } from '@/components/SettingsPanel';
import type { NotificationPrefs } from '@/types/db';

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('staff_profiles')
    .select('role, notification_prefs').eq('id', user!.id).single();
  const role = (me?.role ?? 'staff') as 'staff' | 'manager' | 'admin';

  const { data: settings } = await supabase.from('app_settings').select('key, value');

  return (
    <SettingsPanel
      role={role}
      settings={settings ?? []}
      myPrefs={(me?.notification_prefs ?? {}) as Partial<NotificationPrefs>}
    />
  );
}
