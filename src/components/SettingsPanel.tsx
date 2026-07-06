'use client';

import { useEffect, useState } from 'react';
import type { NotificationPrefs } from '@/types/db';
import { SignOutButton } from '@/components/SignOutButton';

interface Setting { key: string; value: Record<string, unknown> }

/**
 * Settings: sync status/interval, per-user notification preferences,
 * staff access approval (admin), alert timings (manager+), and the
 * Shopify write-error log (admin). All actions are re-checked server-side.
 */
export function SettingsPanel({ role, settings, myPrefs }: {
  role: 'staff' | 'manager' | 'admin';
  settings: Setting[];
  myPrefs: Partial<NotificationPrefs>;
}) {
  return (
    <div className="space-y-6">
      <SyncSection role={role} settings={settings} />
      <NotificationPrefsSection myPrefs={myPrefs} />
      {role === 'admin' && <StaffAccessSection />}
      {role !== 'staff' && <AlertTimingsSection settings={settings} />}
      {role === 'admin' && <WriteErrorsSection />}
      <section className="rounded-xl border border-cocoa-100 bg-white p-5">
        <h2 className="font-semibold">Account</h2>
        <p className="mt-1 text-xs text-stone-500">Sign out of IBC Orders on this device.</p>
        <div className="mt-3">
          <SignOutButton />
        </div>
      </section>
    </div>
  );
}

/* ── Sync ──────────────────────────────────────────────────────────────── */
function SyncSection({ role, settings }: { role: string; settings: Setting[] }) {
  const sync = (settings.find((s) => s.key === 'sync_state')?.value ?? {}) as {
    running?: boolean; last_success?: string | null; last_error?: string | null; interval_minutes?: number;
  };
  const [interval, setIntervalMin] = useState(Number(sync.interval_minutes ?? 3));
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    const res = await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_interval_minutes: interval }),
    });
    setMsg(res.ok ? 'Saved.' : 'Save failed.');
  }

  return (
    <section className="rounded-xl border border-cocoa-100 bg-white p-5">
      <h2 className="font-semibold">Shopify sync</h2>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-stone-500">Last successful sync</dt>
          <dd className="font-medium">{sync.last_success ? new Date(sync.last_success).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'never'}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Currently running</dt>
          <dd className="font-medium">{sync.running ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Last error</dt>
          <dd className={`font-medium ${sync.last_error ? 'text-red-700' : ''}`}>{sync.last_error ?? 'none'}</dd>
        </div>
      </dl>
      {role !== 'staff' && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            Auto-resync interval (minutes)
            <input type="number" min={1} max={60} value={interval}
              onChange={(e) => setIntervalMin(Number(e.target.value))}
              className="mt-1 block w-32 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <button onClick={save} className="min-h-11 rounded-lg bg-cocoa-600 px-4 py-2 text-sm font-medium text-white hover:bg-cocoa-700">
            Save
          </button>
          {msg && <span className="pb-2.5 text-sm text-stone-500">{msg}</span>}
        </div>
      )}
    </section>
  );
}

/* ── Per-user notification preferences ────────────────────────────────── */
const PREF_LABELS: Array<{ key: keyof NotificationPrefs; label: string; adminOnly?: boolean }> = [
  { key: 'new_pickup', label: 'New pickup orders' },
  { key: 'new_delivery', label: 'New delivery orders' },
  { key: 'pickup_reminders', label: 'Pickup approaching collection time' },
  { key: 'status_changes', label: 'Important Shopify status changes' },
  { key: 'sync_errors', label: 'Sync/integration failures (admins)', adminOnly: true },
];

function NotificationPrefsSection({ myPrefs }: { myPrefs: Partial<NotificationPrefs> }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    const p: Record<string, boolean> = {};
    for (const { key } of PREF_LABELS) p[key] = myPrefs[key] !== false;
    return p;
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    const res = await fetch('/api/me/prefs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    setMsg(res.ok ? 'Preferences saved.' : 'Save failed.');
  }

  return (
    <section className="rounded-xl border border-cocoa-100 bg-white p-5">
      <h2 className="font-semibold">My notifications</h2>
      <p className="mt-1 text-xs text-stone-500">
        Applies to this account on every device where you&apos;ve enabled notifications (🔔 button).
      </p>
      <div className="mt-3 space-y-2">
        {PREF_LABELS.map(({ key, label }) => (
          <label key={key} className="flex min-h-10 items-center gap-3 text-sm">
            <input type="checkbox" checked={prefs[key]}
              onChange={(e) => setPrefs({ ...prefs, [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>
      <button onClick={save} className="mt-3 min-h-11 rounded-lg bg-cocoa-600 px-4 py-2 text-sm font-medium text-white hover:bg-cocoa-700">
        Save preferences
      </button>
      {msg && <span className="ml-3 text-sm text-stone-500">{msg}</span>}
    </section>
  );
}

/* ── Staff access (admin) ─────────────────────────────────────────────── */
interface StaffRow {
  id: string; full_name: string; email: string; role: string;
  is_active: boolean; requested_at: string;
}

function StaffAccessSection() {
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/admin/staff');
    if (res.ok) setStaff((await res.json()).staff);
    else setError('Could not load staff list.');
  }
  useEffect(() => { void load(); }, []);

  async function act(userId: string, action: string) {
    setBusyId(userId);
    setError(null);
    const res = await fetch('/api/admin/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Action failed');
    setBusyId(null);
    void load();
  }

  const pending = (staff ?? []).filter((s) => s.role === 'pending');
  const others = (staff ?? []).filter((s) => s.role !== 'pending');
  const btn = 'min-h-9 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50';

  return (
    <section className="rounded-xl border border-cocoa-100 bg-white p-5">
      <h2 className="font-semibold">Staff access (admin)</h2>

      {pending.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-amber-800">Pending requests · {pending.length}</h3>
          <ul className="mt-2 space-y-2">
            {pending.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                <div className="text-sm">
                  <div className="font-medium">{s.full_name}</div>
                  <div className="text-stone-500">{s.email} · requested {new Date(s.requested_at).toLocaleDateString('en-GB')}</div>
                </div>
                <div className="flex gap-2">
                  <button disabled={busyId === s.id} onClick={() => act(s.id, 'approve')}
                    className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Approve</button>
                  <button disabled={busyId === s.id} onClick={() => act(s.id, 'reject')}
                    className={`${btn} border border-red-200 text-red-700 hover:bg-red-50`}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {staff && pending.length === 0 && <p className="mt-2 text-sm text-stone-500">No pending requests.</p>}

      <h3 className="mt-4 text-sm font-semibold text-stone-600">All users</h3>
      <ul className="mt-2 divide-y divide-stone-100">
        {others.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <div>
              <span className="font-medium">{s.full_name}</span>{' '}
              <span className="text-stone-500">· {s.email} · {s.role}{s.is_active ? '' : ' · inactive'}</span>
            </div>
            <div className="flex gap-2">
              {s.role === 'suspended' ? (
                <button disabled={busyId === s.id} onClick={() => act(s.id, 'restore')}
                  className={`${btn} border border-emerald-300 text-emerald-700 hover:bg-emerald-50`}>Restore access</button>
              ) : (
                <button disabled={busyId === s.id} onClick={() => act(s.id, 'suspend')}
                  className={`${btn} border border-stone-200 text-stone-600 hover:border-red-300 hover:text-red-700`}>Suspend</button>
              )}
            </div>
          </li>
        ))}
        {staff === null && <li className="py-3 text-sm text-stone-400">Loading…</li>}
      </ul>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}

/* ── Alert timings (manager+) ─────────────────────────────────────────── */
function AlertTimingsSection({ settings }: { settings: Setting[] }) {
  const escalation = (settings.find((s) => s.key === 'escalation')?.value ?? {}) as Record<string, unknown>;
  const reminders = (settings.find((s) => s.key === 'reminders')?.value ?? {}) as Record<string, unknown>;
  const [form, setForm] = useState({
    dashboard_repeat_minutes: Number(escalation.dashboard_repeat_minutes ?? 2),
    push_repeat_minutes: Number(escalation.push_repeat_minutes ?? 5),
    manager_escalation_minutes: Number(escalation.manager_escalation_minutes ?? 15),
    manager_escalation_enabled: Boolean(escalation.manager_escalation_enabled ?? false),
    pickup_lead_minutes: Number(reminders.pickup_lead_minutes ?? 60),
    delivery_lead_minutes: Number(reminders.delivery_lead_minutes ?? 60),
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    const res = await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setMsg(res.ok ? 'Saved.' : 'Save failed.');
  }

  const num = (key: keyof typeof form, label: string) => (
    <label className="block text-sm">
      {label}
      <input type="number" min={1} value={Number(form[key])}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
        className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" />
    </label>
  );

  return (
    <section className="rounded-xl border border-cocoa-100 bg-white p-5">
      <h2 className="font-semibold">Alerts & reminders</h2>
      <p className="mt-1 text-xs text-stone-500">Pickup reminder default is 60 minutes before the collection slot.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {num('pickup_lead_minutes', 'Pickup reminder lead (min before slot)')}
        {num('delivery_lead_minutes', 'Delivery reminder lead (min)')}
        {num('dashboard_repeat_minutes', 'Dashboard alarm repeat (min)')}
        {num('push_repeat_minutes', 'Push escalation repeat (min)')}
        {num('manager_escalation_minutes', 'Manager escalation after (min)')}
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={form.manager_escalation_enabled}
            onChange={(e) => setForm({ ...form, manager_escalation_enabled: e.target.checked })} />
          Manager/admin escalation enabled
        </label>
      </div>
      <button onClick={save} className="mt-4 min-h-11 rounded-lg bg-cocoa-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cocoa-700">
        Save settings
      </button>
      {msg && <span className="ml-3 text-sm text-stone-500">{msg}</span>}
    </section>
  );
}

/* ── Shopify write errors (admin) ─────────────────────────────────────── */
function WriteErrorsSection() {
  const [writeErrors, setWriteErrors] = useState<Array<{ id: string; action: string; created_at: string; user_errors: unknown }> | null>(null);

  async function loadErrors() {
    const res = await fetch('/api/admin/write-errors');
    if (res.ok) setWriteErrors((await res.json()).errors);
  }
  async function retry(errorId: string) {
    await fetch('/api/admin/write-errors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errorId, resolution: 'retry_sync' }),
    });
    void loadErrors();
  }

  return (
    <section className="rounded-xl border border-cocoa-100 bg-white p-5">
      <h2 className="font-semibold">Shopify write errors (admin)</h2>
      <button onClick={loadErrors} className="mt-2 min-h-10 rounded-lg border border-stone-200 px-4 py-2 text-sm hover:border-cocoa-500">
        Load open errors
      </button>
      {writeErrors && writeErrors.length === 0 && <p className="mt-3 text-sm text-stone-500">No open write errors. ✓</p>}
      {writeErrors?.map((e) => (
        <div key={e.id} className="mt-3 rounded-lg border border-red-100 bg-red-50 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">{e.action}</span>
            <span className="text-xs text-stone-500">{new Date(e.created_at).toLocaleString('en-GB')}</span>
          </div>
          <pre className="mt-1 overflow-x-auto text-xs text-red-800">{JSON.stringify(e.user_errors, null, 2)}</pre>
          <button onClick={() => retry(e.id)} className="mt-2 min-h-9 rounded-md bg-red-700 px-3 py-1.5 text-xs text-white">
            Re-sync order & mark resolved
          </button>
        </div>
      ))}
    </section>
  );
}
