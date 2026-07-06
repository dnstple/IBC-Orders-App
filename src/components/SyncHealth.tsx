'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { toast } from '@/components/Toaster';

interface SyncState {
  running?: boolean;
  last_success?: string | null;
  last_error?: string | null;
  interval_minutes?: number;
}

/**
 * Unobtrusive sync health: last successful sync, running state, last error,
 * failed-webhook count (admins) and a manual refresh. The dashboard keeps
 * working from cached data if Shopify is temporarily down.
 */
export function SyncHealth({ canManualSync }: { canManualSync: boolean }) {
  const [state, setState] = useState<SyncState>({});
  const [failing, setFailing] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  async function load() {
    const supabase = supabaseBrowser();
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'sync_state').maybeSingle();
    if (data?.value) setState(data.value as SyncState);
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
    if (busy) return; // no duplicate requests
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        const message = `Sync failed: ${json?.error ?? `HTTP ${res.status}`}`;
        setResult(message);
        toast(message, 'error');
      } else if (json.failed > 0) {
        setResult(`Synced ${json.synced}, ${json.failed} failed`);
        toast(`Refresh finished with ${json.failed} failure${json.failed === 1 ? '' : 's'}.`, 'error');
      } else {
        setResult(`✓ Synced ${json.synced}`);
        toast(`Refreshed ${json.synced} order${json.synced === 1 ? '' : 's'} from Shopify.`, 'success');
        setTimeout(() => setResult(null), 5000);
      }
    } catch {
      setResult('Sync failed: network problem');
      toast('Refresh failed — network problem.', 'error');
    }
    setBusy(false);
    void load();
  }

  const last = state.last_success ? new Date(state.last_success) : null;
  const ago = last ? Math.max(0, Math.round((Date.now() - last.getTime()) / 1000)) : null;
  const agoLabel = ago == null ? 'never' : ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)} min ago`;
  const stale = ago != null && ago > Math.max(10, (state.interval_minutes ?? 3) * 3) * 60;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
      <span className={stale ? 'font-medium text-amber-700' : ''}>
        {state.running ? 'Syncing with Shopify…' : `Shopify synced ${agoLabel}`}
      </span>
      {state.last_error && (
        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-amber-200" title={state.last_error}>
          last sync error
        </span>
      )}
      {failing > 0 && (
        <span className="rounded-md bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-red-200">
          {failing} webhook{failing === 1 ? '' : 's'} failing
        </span>
      )}
      {canManualSync && (
        <button
          onClick={manualSync}
          disabled={busy}
          className="min-h-8 rounded-md border border-stone-200 px-2.5 py-1 text-stone-600 hover:border-cocoa-500 disabled:opacity-50"
        >
          {busy ? 'Refreshing…' : 'Refresh now'}
        </button>
      )}
      {result && (
        <span role="status" className={result.startsWith('✓') || result.startsWith('Synced') ? 'text-emerald-700' : 'font-medium text-red-700'}>{result}</span>
      )}
    </div>
  );
}
