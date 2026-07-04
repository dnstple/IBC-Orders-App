'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';

/**
 * Staff access request. Signing up creates the auth user; a database
 * trigger creates a PENDING profile with no data access until an admin
 * approves it in Settings.
 */
export default function SignupPage() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.fullName.trim() } },
    });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // Notify admins (session may exist if email confirmation is disabled).
    await fetch('/api/signup-notify', { method: 'POST' }).catch(() => undefined);
    setBusy(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-cocoa-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-cocoa-900">Your access request has been submitted.</h1>
          <p className="mt-3 text-sm text-stone-500">
            An administrator must approve your account before you can access the order dashboard.
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm font-medium text-cocoa-600 underline">
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-cocoa-100 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-cocoa-900">Request staff access</h1>
        <p className="mt-1 text-sm text-stone-500">Italian Bear Orders</p>
        <label className="mt-6 block text-sm font-medium">Full name</label>
        <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 focus:border-cocoa-500 focus:outline-none" />
        <label className="mt-4 block text-sm font-medium">Email</label>
        <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 focus:border-cocoa-500 focus:outline-none" />
        <label className="mt-4 block text-sm font-medium">Password</label>
        <input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 focus:border-cocoa-500 focus:outline-none" />
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy}
          className="mt-6 min-h-12 w-full rounded-lg bg-cocoa-600 py-3 font-medium text-white hover:bg-cocoa-700 disabled:opacity-50">
          {busy ? 'Submitting…' : 'Request access'}
        </button>
        <p className="mt-4 text-center text-sm text-stone-500">
          Already approved? <Link href="/login" className="font-medium text-cocoa-600 underline">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
