'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Sign in failed — please try again.');
        return;
      }
      // Full navigation so the fresh session cookie is used immediately.
      window.location.assign('/today');
    } catch {
      setError('Network problem — check your connection and try again.');
    } finally {
      setBusy(false);
    }
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
