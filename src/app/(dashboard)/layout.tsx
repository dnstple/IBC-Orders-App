import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { Nav } from '@/components/Nav';
import { SyncHealth } from '@/components/SyncHealth';
import { OneSignalInit } from '@/components/OneSignalInit';
import { Toaster } from '@/components/Toaster';
import { InstallPrompt } from '@/components/InstallPrompt';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('staff_profiles')
    .select('full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  const role = profile?.role as 'staff' | 'manager' | 'admin' | 'pending' | 'suspended' | undefined;

  if (!profile || role === 'pending') {
    return (
      <GateScreen title="Your access request has been submitted.">
        An administrator must approve your account before you can access the order dashboard.
      </GateScreen>
    );
  }
  if (role === 'suspended' || !profile.is_active) {
    return (
      <GateScreen title="Account suspended">
        Your access has been suspended. Contact an administrator if you believe this is a mistake.
      </GateScreen>
    );
  }

  const opRole = role as 'staff' | 'manager' | 'admin';
  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl px-3 pb-32 sm:px-6 sm:pb-6">
      <OneSignalInit />
      <Toaster />
      <header className="flex flex-wrap items-center justify-between gap-2 py-4">
        <div>
          <h1 className="text-lg font-semibold text-cocoa-900">Italian Bear Orders</h1>
          <SyncHealth canManualSync={opRole !== 'staff'} />
        </div>
        <span className="text-sm text-stone-500">{profile.full_name} · {opRole}</span>
      </header>
      <Nav role={opRole} />
      <main className="mt-4">
        <InstallPrompt />
        {children}
      </main>
    </div>
  );
}

function GateScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-cocoa-100 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-stone-500">{children}</p>
      </div>
    </main>
  );
}
