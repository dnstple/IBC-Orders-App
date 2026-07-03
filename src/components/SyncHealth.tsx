'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

/**
 * Visible sync health: time since the most recent order sync, plus a
 * warning when webhook processing is failing (managers/admins see counts).
 */
export function SyncHealth({ canManualSync }: { canManualSync: boolean }) {
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [failing, setFailing] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  async function load() {
    const supabase = supabaseBrowser();
    const { data: latest } = await supabase.from('orders')
      .select('synced_at').order('synced_at', { ascending: false }).limit(1);
    if (latest?.[0]) setLastSync(new Date(latest[0].synced_at));
    const { count } = await supabase.from('webhook_events')
      .select('id', { count: 'exact', head: true }).eq('status', 'failed');
    setFailing(count ?? 0); // 0 for non-admins (RLS returns no rows)
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      forceTick((n) => n + 1);
      void load();
    }, 30000);
    return () => clearInterval(t);
  }, []);

  async function manualSync() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setResult(`Sync failed (${res.status}): ${json?.error ?? 'see server logs'}`);
      } else {
        setResult(
          `Synced ${json.synced}, failed ${json.failed}` +
          (json.errors?.length ? ` — ${json.errors[0]}` : json.synced === 0 ? ' — no matching orders found in Shopify' : '')
        );
      }
    } catch (err) {
      setResult(`Sync error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(false);
    void load();
  }

  const ago = lastSync ? Math.max(0, Math.round((Date.now() - lastSync.getTime()) / 1000)) : null;
  const agoLabel = ago == null ? '—' : ago < 60 ? `${ago} seconds ago` : `${Math.round(ago / 60)} min ago`;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
      <span className={ago != null && ago > 900 ? 'text-amber-700' : ''}>Shopify synced {agoLabel}</span>
      {failing > 0 && (
        <span className="rounded-md bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-red-200">
          {failing} webhook{failing === 1 ? '' : 's'} failing
        </span>
      )}
      {canManualSync && (
        <button
          onClick={manualSync}
          disabled={busy}
          className="rounded-md border border-stone-200 px-2.5 py-1 text-stone-600 hover:border-cocoa-500 disabled:opacity-50"
        >
          {busy ? 'Syncing…' : 'Sync from Shopify'}
        </button>
      )}
      {result && (
        <span className={result.startsWith('Synced') ? 'text-emerald-700' : 'font-medium text-red-700'}>
          {result}
        </span>
      )}
    </div>
  );
}
