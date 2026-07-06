'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    await supabaseBrowser().auth.signOut().catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="min-h-9 rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:border-cocoa-500 hover:text-cocoa-700 disabled:opacity-60"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
