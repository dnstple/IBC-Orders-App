'use client';

import { useRouter } from 'next/navigation';

/**
 * In-app back navigation — essential in the installed (home-screen) app,
 * which has no browser chrome. Falls back to Today if there's no history
 * (e.g. the order was opened directly from a notification).
 */
export function BackButton() {
  const router = useRouter();

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push('/pickups');
  }

  return (
    <button
      onClick={goBack}
      aria-label="Go back"
      className="mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-600 transition hover:border-cocoa-500 hover:text-cocoa-700"
    >
      <span aria-hidden>←</span> Back
    </button>
  );
}
