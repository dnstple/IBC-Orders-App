'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { AuthShell, AuthField, AuthButton, AuthError } from '@/components/AuthShell';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
      return;
    }
    router.replace('/today');
    router.refresh();
  }

  return (
    <AuthShell footnote="Internal staff dashboard · Shopify remains the source of truth">
      <h2 className="text-lg font-semibold text-cocoa-900">Sign in</h2>
      <p className="mt-1 text-sm text-stone-500">Welcome back — orders are waiting.</p>
      <form onSubmit={signIn} className="mt-6 space-y-4">
        <AuthField label="Email" type="email" required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@italianbearchocolate.com" />
        <AuthField label="Password" type="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        {error && <AuthError>{error}</AuthError>}
        <AuthButton busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</AuthButton>
      </form>
      <div className="mt-6 border-t border-stone-100 pt-4 text-center text-sm text-stone-500">
        New here?{' '}
        <Link href="/signup" className="font-semibold text-cocoa-700 hover:underline">Request access</Link>
      </div>
    </AuthShell>
  );
}
