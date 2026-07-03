import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { Nav } from '@/components/Nav';
import { SyncHealth } from '@/components/SyncHealth';
import { OneSignalInit } from '@/components/OneSignalInit';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('staff_profiles')
    .select('full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.is_active) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-cocoa-100 bg-white p-8 text-center">
          <h1 className="text-lg font-semibold">Account not activated</h1>
          <p className="mt-2 text-sm text-stone-500">
            Your login exists but has no active staff profile yet. Ask a manager to activate you in Settings.
          </p>
        </div>
      </main>
    );
  }

  const role = profile.role as 'staff' | 'manager' | 'admin';
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-3 pb-24 sm:px-6 sm:pb-6">
      <OneSignalInit />
      <header className="flex flex-wrap items-center justify-between gap-2 py-4">
        <div>
          <h1 className="text-lg font-semibold text-cocoa-900">Italian Bear Orders</h1>
          <SyncHealth canManualSync={role !== 'staff'} />
        </div>
        <span className="text-sm text-stone-500">{profile.full_name} · {role}</span>
      </header>
      <Nav role={role} />
      <main className="mt-4">{children}</main>
    </div>
  );
}
