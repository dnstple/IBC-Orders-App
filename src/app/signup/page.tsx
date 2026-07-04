'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AuthShell, AuthField, AuthButton, AuthError } from '@/components/AuthShell';

export default function SignupPage() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong — please try again.');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Network problem — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-2xl ring-1 ring-emerald-200">✓</div>
          <h2 className="mt-4 text-lg font-semibold text-cocoa-900">Your access request has been submitted.</h2>
          <p className="mt-2 text-sm leading-relaxed text-stone-500">
            An administrator must approve your account before you can access the order dashboard.
            You&apos;ll be able to sign in as soon as that happens.
          </p>
          <Link href="/login"
            className="mt-6 inline-block min-h-11 rounded-xl border border-cocoa-200 px-6 py-2.5 text-sm font-semibold text-cocoa-700 hover:bg-cocoa-50">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell footnote="Accounts are reviewed by a manager before activation">
      <h2 className="text-lg font-semibold text-cocoa-900">Request access</h2>
      <p className="mt-1 text-sm text-stone-500">For Italian Bear Chocolate staff only.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <AuthField label="Full name" required minLength={2} autoComplete="name"
          value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Sofia Marino" />
        <AuthField label="Email" type="email" required autoComplete="email"
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@gmail.com" />
        <AuthField label="Password" type="password" required minLength={8} autoComplete="new-password"
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
        {error && <AuthError>{error}</AuthError>}
        <AuthButton busy={busy}>{busy ? 'Submitting…' : 'Request access'}</AuthButton>
      </form>
      <div className="mt-6 border-t border-stone-100 pt-4 text-center text-sm text-stone-500">
        Already approved?{' '}
        <Link href="/login" className="font-semibold text-cocoa-700 hover:underline">Sign in</Link>
      </div>
    </AuthShell>
  );
}
