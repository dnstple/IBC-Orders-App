'use client';

import { useState } from 'react';
import { printHtml } from '@/lib/print-pdf';

/**
 * Prints the "YOUR ORDER" slip that goes in the box, on the same Munbyn as
 * the shipping label. Allergen problems found on the website show here for
 * staff — they are never printed on the customer's slip.
 */
export function PrintSlipButton({ orderId, className }: { orderId: string; className: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function print() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/slip`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.html) throw new Error(json.error ?? `Couldn't make the slip (${res.status})`);
      setWarnings(json.warnings ?? []);
      printHtml(json.html);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn\'t make the slip');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className={className} disabled={busy} onClick={print}>
        {busy ? 'Getting the slip…' : '🧾  Print order slip'}
      </button>
      <p className="mt-1 text-xs text-stone-500">The slip goes <strong>inside</strong> the box, on top of the items.</p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error} <button onClick={print} className="font-semibold underline">Try again</button>
        </p>
      )}
      {warnings.length > 0 && (
        <div role="status" className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">Check the allergens before this goes in the box (not printed on the slip):</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
