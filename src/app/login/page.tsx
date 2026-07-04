'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';

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
      setError(error.message);
      return;
    }
    router.replace('/today');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={signIn} className="w-full max-w-sm rounded-2xl border border-cocoa-100 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-cocoa-900">Italian Bear Orders</h1>
        <p className="mt-1 text-sm text-stone-500">Staff sign in</p>
        <label className="mt-6 block text-sm font-medium">Email</label>
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 focus:border-cocoa-500 focus:outline-none"
        />
        <label className="mt-4 block text-sm font-medium">Password</label>
        <input
          type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 focus:border-cocoa-500 focus:outline-none"
        />
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit" disabled={busy}
          className="mt-6 min-h-12 w-full rounded-lg bg-cocoa-600 py-3 font-medium text-white hover:bg-cocoa-700 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="mt-4 text-center text-sm text-stone-500">
          Need access? <Link href="/signup" className="font-medium text-cocoa-600 underline">Request an account</Link>
        </p>
      </form>
    </main>
  );
}
