'use client';

import { useState } from 'react';

interface Setting { key: string; value: Record<string, unknown> }
interface Staff { id: string; full_name: string; role: string; is_active: boolean }

/**
 * Manager: escalation/reminder timings. Admin additionally sees webhook
 * health + Shopify write-error log with retry.
 */
export function SettingsPanel({ role, settings, staff }: { role: 'manager' | 'admin'; settings: Setting[]; staff: Staff[] }) {
  const escalation = settings.find((s) => s.key === 'escalation')?.value ?? {};
  const reminders = settings.find((s) => s.key === 'reminders')?.value ?? {};
  const [form, setForm] = useState({
    dashboard_repeat_minutes: Number(escalation.dashboard_repeat_minutes ?? 2),
    push_repeat_minutes: Number(escalation.push_repeat_minutes ?? 5),
    manager_escalation_minutes: Number(escalation.manager_escalation_minutes ?? 15),
    manager_escalation_enabled: Boolean(escalation.manager_escalation_enabled ?? false),
    pickup_lead_minutes: Number(reminders.pickup_lead_minutes ?? 60),
    delivery_lead_minutes: Number(reminders.delivery_lead_minutes ?? 60),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [writeErrors, setWriteErrors] = useState<Array<{ id: string; action: string; created_at: string; user_errors: unknown }> | null>(null);

  async function save() {
    setMsg(null);
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setMsg(res.ok ? 'Saved.' : `Save failed: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
  }

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

  const num = (key: keyof typeof form, label: string) => (
    <label className="block text-sm">
      {label}
      <input
        type="number" min={1} value={Number(form[key])}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
        className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
      />
    </label>
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-cocoa-100 bg-white p-5">
        <h2 className="font-semibold">Alerts & reminders</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {num('dashboard_repeat_minutes', 'Dashboard alarm repeat (min)')}
          {num('push_repeat_minutes', 'Push escalation repeat (min)')}
          {num('pickup_lead_minutes', 'Pickup reminder lead (min)')}
          {num('delivery_lead_minutes', 'Delivery reminder lead (min)')}
          {num('manager_escalation_minutes', 'Manager escalation after (min)')}
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox" checked={form.manager_escalation_enabled}
              onChange={(e) => setForm({ ...form, manager_escalation_enabled: e.target.checked })}
            />
            Manager/admin escalation enabled
          </label>
        </div>
        <button onClick={save} className="mt-4 rounded-lg bg-cocoa-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cocoa-700">
          Save settings
        </button>
        {msg && <span className="ml-3 text-sm text-stone-500">{msg}</span>}
      </section>

      <section className="rounded-xl border border-cocoa-100 bg-white p-5">
        <h2 className="font-semibold">Staff</h2>
        <p className="mt-1 text-xs text-stone-500">Create logins in Supabase Auth; profiles and roles are managed here (managers+).</p>
        <ul className="mt-3 divide-y divide-stone-100">
          {staff.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span>{s.full_name}</span>
              <span className="text-stone-500">{s.role}{s.is_active ? '' : ' · inactive'}</span>
            </li>
          ))}
        </ul>
      </section>

      {role === 'admin' && (
        <section className="rounded-xl border border-cocoa-100 bg-white p-5">
          <h2 className="font-semibold">Shopify write errors (admin)</h2>
          <button onClick={loadErrors} className="mt-2 rounded-lg border border-stone-200 px-4 py-2 text-sm hover:border-cocoa-500">
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
              <button onClick={() => retry(e.id)} className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-xs text-white">
                Re-sync order & mark resolved
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
