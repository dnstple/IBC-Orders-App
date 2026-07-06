'use client';

import { useEffect } from 'react';

/**
 * Staff-friendly fallback for any component failure — never a blank page,
 * never a stack trace. Technical detail goes to the console/logs only.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app error boundary]', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream p-6">
      <div className="w-full max-w-sm rounded-2xl border border-cocoa-100 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-2xl ring-1 ring-amber-200" aria-hidden>!</div>
        <h1 className="mt-4 text-lg font-semibold text-cocoa-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-stone-500">The screen hit a problem. Your orders are safe in Shopify.</p>
        <div className="mt-6 grid gap-2">
          <button onClick={reset}
            className="min-h-11 rounded-xl bg-cocoa-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cocoa-600">
            Try again
          </button>
          <button onClick={() => window.location.reload()}
            className="min-h-11 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 hover:border-cocoa-500">
            Refresh page
          </button>
        </div>
      </div>
    </main>
  );
}
