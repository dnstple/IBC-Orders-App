'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/Toaster';
import { SKIP_LABELS } from '@/lib/visit-emails/eligibility';
import { SHOPS, type Shop, type VisitEmailLink, type VisitEmailSettings } from '@/lib/visit-emails/settings';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Stats = any;

const card = 'rounded-xl border border-cocoa-100 bg-white p-5';
const input = 'mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm';
const btn = 'min-h-11 rounded-lg bg-cocoa-600 px-4 py-2 text-sm font-medium text-white hover:bg-cocoa-700 disabled:opacity-50';
const btnGhost = 'min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50';
const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';

async function api(path: string, body?: unknown) {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/**
 * Visit emails tab: one thank-you email after a guest's visit.
 * Top: what's happening (mode, numbers, clicks). Below: settings, copy,
 * backfill and logs. Every action is re-checked server-side (admin only).
 */
export function VisitEmailsDashboard({ initialSettings }: { initialSettings: VisitEmailSettings }) {
  const [saved, setSaved] = useState(initialSettings);
  const [s, setS] = useState(initialSettings);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState('');
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  const load = useCallback(async () => {
    try { setStats(await api('/api/visit-emails/stats')); } catch (e) { toast((e as Error).message, 'error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof VisitEmailSettings>(k: K, v: VisitEmailSettings[K]) => setS((p) => ({ ...p, [k]: v }));

  async function save(next = s) {
    setBusy('save');
    try {
      const r = await api('/api/visit-emails/settings', next);
      setSaved(r.settings); setS(r.settings);
      toast('Settings saved.', 'success');
      void load();
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy('');
  }

  async function runNow() {
    setBusy('run');
    try {
      const r = await api('/api/visit-emails/run', {});
      const p = r.plan, snd = r.send;
      toast(r.ok
        ? `Run done. ${p ? `${p.fetched} bookings read, ${p.queue} queued` : 'Nothing read (mode off)'}${snd ? `, ${snd.sent} sent, ${snd.dry_run} dry-run${snd.held ? ` (${snd.held})` : ''}` : ''}.`
        : `Run failed: ${r.error}`, r.ok ? 'success' : 'error');
      void load();
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy('');
  }

  return (
    <div className="space-y-6">
      <StatusCard s={saved} stats={stats} busy={busy} onRun={runNow} />
      <Overview s={saved} stats={stats} />
      <SettingsCard s={s} set={set} dirty={dirty} busy={busy} onSave={() => save()} onReset={() => setS(saved)} liveAllowed={!!stats?.server?.liveAllowed} />
      <CopyCard s={s} set={set} dirty={dirty} busy={busy} onSave={() => save()} />
      <Backfill s={saved} dirty={dirty} onDone={load} />
      <Activity stats={stats} />
      <Housekeeping onDone={load} />
    </div>
  );
}

/* ── Status ─────────────────────────────────────────────────────────────── */
function StatusCard({ s, stats, busy, onRun }: { s: VisitEmailSettings; stats: Stats; busy: string; onRun: () => void }) {
  const mode = {
    off: { label: 'Off', cls: 'bg-stone-200 text-stone-700', note: 'Nothing is read, queued or sent.' },
    dry_run: { label: 'Dry run', cls: 'bg-amber-100 text-amber-800', note: 'Everything runs and is counted, but no email leaves the building.' },
    live: { label: 'Live', cls: 'bg-green-100 text-green-800', note: 'Emails are being sent.' },
  }[s.mode];
  const lastRun = stats?.runs?.find((r: any) => r.kind !== 'backfill');
  const problems: string[] = [];
  if (stats && !stats.server.feedConfigured) problems.push('VISITS_FEED_KEY is not set in Vercel, so bookings cannot be read.');
  if (s.arrived_statuses.length === 0) problems.push('Choose which TableAgent statuses mean the guest arrived (Settings below). Until then nobody is queued.');
  const review = s.links.find((l) => l.key === 'review');
  if (review && !review.url && !SHOPS.every((x) => review.shop_urls?.[x.key])) problems.push('The review link has no address for every café yet.');

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            Visit emails
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${mode.cls}`}>{mode.label}</span>
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {mode.note} Sent to {s.respect_marketing ? 'guests who ticked “news and offers” only' : 'everyone who visited'}
            {', '}{s.delay_hours} h after their booking, {s.send_window_start_hour}:00–{s.send_window_end_hour}:00.
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Last run: {lastRun ? `${when(lastRun.started_at)}${lastRun.error ? ` · ${lastRun.error}` : ''}` : 'never'}
          </p>
        </div>
        <button className={btnGhost} onClick={onRun} disabled={!!busy || s.mode === 'off'}>{busy === 'run' ? 'Running…' : 'Run now'}</button>
      </div>
      {problems.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {problems.map((p) => <li key={p}>• {p}</li>)}
        </ul>
      )}
    </section>
  );
}

/* ── Overview ───────────────────────────────────────────────────────────── */
function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg bg-cocoa-50 p-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-2xl font-semibold text-cocoa-900">{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

function Overview({ s, stats }: { s: VisitEmailSettings; stats: Stats }) {
  if (!stats) return <section className={card}><p className="text-sm text-stone-500">Loading numbers…</p></section>;
  const t = stats.totals;
  const reasons = Object.entries(stats.skipReasons as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const last14 = (stats.daily as any[]).slice(-14).filter((d) => d.sent || d.dry_run);
  return (
    <section className={card}>
      <h2 className="font-semibold">At a glance</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Sent" value={t.sent} sub={t.dry_run ? `+ ${t.dry_run} in dry run` : undefined} />
        <Tile label="Waiting to send" value={t.queued} sub={t.nextDue ? `next ${when(t.nextDue)}` : undefined} />
        <Tile label="Not emailed" value={t.skipped} sub="see reasons below" />
        <Tile label="Clicked a link" value={t.uniqueClickers} sub={t.clickRate != null ? `${Math.round(t.clickRate * 100)}% of sent` : undefined} />
        <Tile label="Opted out" value={t.optOuts} sub={t.failed ? `${t.failed} failed to send` : undefined} />
      </div>
      <p className="mt-2 text-xs text-stone-500">
        Today: {t.doneToday} of {s.daily_cap} daily limit. Versions: {stats.variants.marketing} full, {stats.variants.plain} plain.
        From backfill: {stats.sources.backfill}.
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Link clicks</h3>
          {stats.links.length === 0 ? <p className="mt-1 text-sm text-stone-500">No clicks yet.</p> : (
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-xs text-stone-500"><th className="py-1">Link</th><th className="text-right">Clicks</th><th className="text-right">People</th><th className="text-right" title="Email security scanners, not counted">Scanners</th></tr></thead>
              <tbody>{stats.links.map((l: any) => (
                <tr key={l.link} className="border-t border-stone-100">
                  <td className="py-1.5">{s.links.find((x) => x.key === l.link)?.label ?? l.link}</td>
                  <td className="text-right font-medium">{l.clicks}</td><td className="text-right">{l.people}</td><td className="text-right text-stone-400">{l.bots}</td>
                </tr>))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-stone-500">
            Sales from these links: Shopify → Analytics → Reports → “Sessions by UTM campaign” (or “Sales by UTM campaign”), campaign <code>{s.utm_campaign}</code>.
            Links to Google reviews aren't tagged, so they're counted here only.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Why guests weren't emailed</h3>
          {reasons.length === 0 ? <p className="mt-1 text-sm text-stone-500">Nothing skipped yet.</p> : (
            <ul className="mt-2 space-y-1 text-sm">
              {reasons.map(([k, n]) => (
                <li key={k} className="flex justify-between border-t border-stone-100 pt-1"><span>{(SKIP_LABELS as any)[k] ?? k}</span><span className="font-medium">{n}</span></li>
              ))}
            </ul>
          )}
          {last14.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold">Last 14 days</h3>
              <ul className="mt-1 space-y-0.5 text-sm">
                {last14.map((d: any) => (
                  <li key={d.day} className="flex justify-between"><span>{new Date(d.day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <span>{d.sent} sent{d.dry_run ? ` · ${d.dry_run} dry run` : ''}</span></li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Settings ───────────────────────────────────────────────────────────── */
type SetFn = <K extends keyof VisitEmailSettings>(k: K, v: VisitEmailSettings[K]) => void;

function Num({ label, value, onChange, min, max, hint }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; hint?: string }) {
  return (
    <label className="block text-sm">
      {label}
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className={input} />
      {hint && <span className="mt-0.5 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (b: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 accent-cocoa-600" />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-stone-500">{hint}</span>}</span>
    </label>
  );
}

function SaveBar({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: string; onSave: () => void; onReset?: () => void }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <button className={btn} onClick={onSave} disabled={!dirty || !!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
      {onReset && dirty && <button className={btnGhost} onClick={onReset}>Undo changes</button>}
      {dirty && <span className="text-sm text-amber-700">Unsaved changes</span>}
    </div>
  );
}

function SettingsCard({ s, set, dirty, busy, onSave, onReset, liveAllowed }: {
  s: VisitEmailSettings; set: SetFn; dirty: boolean; busy: string; onSave: () => void; onReset: () => void; liveAllowed: boolean;
}) {
  const [statuses, setStatuses] = useState<Array<{ code: string; name: string; count: number }> | null>(null);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  async function loadStatuses() {
    setLoadingStatuses(true);
    try { setStatuses((await api('/api/visit-emails/statuses')).statuses); } catch (e) { toast((e as Error).message, 'error'); }
    setLoadingStatuses(false);
  }
  const allCodes = [...new Set([...(statuses ?? []).map((x) => x.code), ...s.arrived_statuses])];
  const toggleCode = (c: string) => set('arrived_statuses', s.arrived_statuses.includes(c) ? s.arrived_statuses.filter((x) => x !== c) : [...s.arrived_statuses, c]);

  return (
    <section className={card}>
      <h2 className="font-semibold">Settings</h2>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold">Mode</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {([
            ['off', 'Off', 'Nothing happens.'],
            ['dry_run', 'Dry run', 'Decides and counts everything, sends nothing. Use this to test.'],
            ['live', 'Live', liveAllowed ? 'Sends real emails.' : 'Locked: needs the email service set up on the server first.'],
          ] as const).map(([v, l, h]) => (
            <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${s.mode === v ? 'border-cocoa-600 bg-cocoa-50' : 'border-stone-200'} ${v === 'live' && !liveAllowed ? 'opacity-60' : ''}`}>
              <input type="radio" name="mode" checked={s.mode === v} disabled={v === 'live' && !liveAllowed} onChange={() => set('mode', v)} className="mt-1 accent-cocoa-600" />
              <span><span className="font-medium">{l}</span><span className="block text-xs text-stone-500">{h}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold">Who gets it</legend>
        <div className="mt-2 space-y-3">
          <Toggle checked={s.respect_marketing} onChange={(b) => set('respect_marketing', b)}
            label="Only email guests who ticked “news and offers” when booking"
            hint="Uses the TableAgent Marketing field. Untick to email everyone who visited (check with your legal advice first)." />
          {!s.respect_marketing && (
            <Toggle checked={s.plain_for_non_opted_in} onChange={(b) => set('plain_for_non_opted_in', b)}
              label="Guests who didn't tick it get the plain version"
              hint="Plain = thank-you and review link only, no shop or booking links. Safer for people who haven't agreed to marketing." />
          )}
          <div className="flex flex-wrap gap-4">
            {SHOPS.map((x) => (
              <Toggle key={x.key} checked={s.shops.includes(x.key)} label={x.name}
                onChange={(b) => set('shops', b ? [...s.shops, x.key] : s.shops.filter((k) => k !== x.key))} />
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold">What counts as “arrived”</legend>
        <p className="mt-1 text-xs text-stone-500">
          Tick the TableAgent statuses your team sets when a guest turns up (e.g. Seated, Completed). Bookings left as Confirmed,
          cancelled or no-show don't get the email. Load the statuses to see what's actually used.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {allCodes.map((c) => {
            const st = statuses?.find((x) => x.code === c);
            return (
              <label key={c} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${s.arrived_statuses.includes(c) ? 'border-cocoa-600 bg-cocoa-50' : 'border-stone-300'}`}>
                <input type="checkbox" checked={s.arrived_statuses.includes(c)} onChange={() => toggleCode(c)} className="accent-cocoa-600" />
                {st?.name ?? c}{st ? <span className="text-xs text-stone-500">({st.count})</span> : null}
              </label>
            );
          })}
          <button className={btnGhost} onClick={loadStatuses} disabled={loadingStatuses}>{loadingStatuses ? 'Loading…' : 'Load statuses from TableAgent'}</button>
        </div>
        {statuses && <p className="mt-1 text-xs text-stone-500">Counts are bookings from the last 3 weeks, both cafés.</p>}
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold">Timing and limits</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <Num label="Hours after the booking" value={s.delay_hours} min={0} max={336} onChange={(n) => set('delay_hours', n)} />
          <Num label="Send from (hour)" value={s.send_window_start_hour} min={0} max={23} onChange={(n) => set('send_window_start_hour', n)} />
          <Num label="Send until (hour)" value={s.send_window_end_hour} min={1} max={24} onChange={(n) => set('send_window_end_hour', n)} hint="London time" />
          <Num label="Skip if this many days late" value={s.max_late_days} min={1} max={30} onChange={(n) => set('max_late_days', n)} />
          <Num label="Emails per run" value={s.batch_size} min={1} max={200} onChange={(n) => set('batch_size', n)} hint="Runs every 15 min" />
          <Num label="Emails per day" value={s.daily_cap} min={1} max={5000} onChange={(n) => set('daily_cap', n)} hint="Resend free plan: 100" />
          <Num label="Don't repeat within (days)" value={s.dedupe_days} min={0} max={3650} onChange={(n) => set('dedupe_days', n)} hint="Same email address, either café" />
          <Num label="Backfill can reach back (days)" value={s.backfill_max_days} min={1} max={730} onChange={(n) => set('backfill_max_days', n)} />
          <label className="block text-sm">
            Automatic from
            <input type="date" value={s.auto_from_date} onChange={(e) => set('auto_from_date', e.target.value)} className={input} />
            <span className="mt-0.5 block text-xs text-stone-500">Earlier visits only via backfill</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold">Sender</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">From name<input value={s.from_name} onChange={(e) => set('from_name', e.target.value)} className={input} /></label>
          <label className="block text-sm">From address<input value={s.from_email} onChange={(e) => set('from_email', e.target.value)} className={input} /></label>
          <label className="block text-sm">Replies go to<input value={s.reply_to} onChange={(e) => set('reply_to', e.target.value)} className={input} /></label>
        </div>
      </fieldset>

      <SaveBar dirty={dirty} busy={busy} onSave={onSave} onReset={onReset} />
    </section>
  );
}

/* ── Copy + links + preview ─────────────────────────────────────────────── */
function CopyCard({ s, set, dirty, busy, onSave }: { s: VisitEmailSettings; set: SetFn; dirty: boolean; busy: string; onSave: () => void }) {
  const [variant, setVariant] = useState<'marketing' | 'plain'>('marketing');
  const [shop, setShop] = useState<Shop>('soho');
  const [preview, setPreview] = useState<{ subject: string; html: string; missingLinks: string[] } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api('/api/visit-emails/preview', { settings: s, variant, shop, first_name: 'Sofia' }).then(setPreview).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [s, variant, shop]);

  const setLink = (i: number, patch: Partial<VisitEmailLink>) => set('links', s.links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const area = (label: string, k: 'body_marketing' | 'body_plain', hint: string) => (
    <label className="block text-sm">{label}
      <textarea rows={6} value={s[k]} onChange={(e) => set(k, e.target.value)} className={input} />
      <span className="mt-0.5 block text-xs text-stone-500">{hint}</span>
    </label>
  );

  return (
    <section className={card}>
      <h2 className="font-semibold">Email copy</h2>
      <p className="mt-1 text-xs text-stone-500">
        Placeholders: <code>{'{first_name}'}</code> <code>{'{shop}'}</code> (Soho / Fitzrovia) <code>{'{visit_day}'}</code> (e.g. Saturday 8 November).
        If a guest has no first name, “, {'{first_name}'}” is left out. Leave a blank line between paragraphs.
      </p>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-sm">Subject<input value={s.subject} onChange={(e) => set('subject', e.target.value)} className={input} /></label>
          <label className="block text-sm">Preview line (shown after the subject in the inbox)<input value={s.preheader} onChange={(e) => set('preheader', e.target.value)} className={input} /></label>
          <label className="block text-sm">Heading<input value={s.heading} onChange={(e) => set('heading', e.target.value)} className={input} /></label>
          {area('Message: full version', 'body_marketing', 'Guests who ticked “news and offers”. Can mention the shop.')}
          {area('Message: plain version', 'body_plain', 'Guests who didn’t tick it (only used when sending to everyone). Thank-you and review only.')}
          <label className="block text-sm">Sign-off<textarea rows={2} value={s.signoff} onChange={(e) => set('signoff', e.target.value)} className={input} /></label>

          <div>
            <h3 className="text-sm font-semibold">Buttons</h3>
            <div className="mt-2 space-y-3">
              {s.links.map((l, i) => (
                <div key={i} className="rounded-lg border border-stone-200 p-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="block text-xs">Button text<input value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} className={input} /></label>
                    <label className="block text-xs">Report name<input value={l.key} onChange={(e) => setLink(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} className={input} /></label>
                    <label className="block text-xs">Shown to
                      <select value={l.show_in} onChange={(e) => setLink(i, { show_in: e.target.value as 'all' | 'marketing' })} className={input}>
                        <option value="all">Everyone</option><option value="marketing">Full version only</option>
                      </select>
                    </label>
                  </div>
                  <label className="mt-2 block text-xs">Address (https://…)<input value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} className={input} placeholder="Used for both cafés unless set below" /></label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {SHOPS.map((x) => (
                      <label key={x.key} className="block text-xs">{x.name} address (optional)
                        <input value={l.shop_urls?.[x.key] ?? ''} onChange={(e) => setLink(i, { shop_urls: { ...l.shop_urls, [x.key]: e.target.value } })} className={input} />
                      </label>
                    ))}
                  </div>
                  <button className="mt-2 text-xs text-red-700 underline" onClick={() => set('links', s.links.filter((_, j) => j !== i))}>Remove button</button>
                </div>
              ))}
              {s.links.length < 6 && (
                <button className={btnGhost} onClick={() => set('links', [...s.links, { key: `link${s.links.length + 1}`, label: 'New button', url: '', shop_urls: {}, show_in: 'all' }])}>Add a button</button>
              )}
            </div>
          </div>

          <Toggle checked={s.include_opt_out} onChange={(b) => set('include_opt_out', b)} label="“Don't email me again” link in the footer"
            hint="Recommended. UK rules (PECR) expect a simple opt-out in every marketing email, even a one-off, and Gmail/Yahoo now expect it from bulk senders." />
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block text-xs">utm_source<input value={s.utm_source} onChange={(e) => set('utm_source', e.target.value)} className={input} /></label>
            <label className="block text-xs">utm_medium<input value={s.utm_medium} onChange={(e) => set('utm_medium', e.target.value)} className={input} /></label>
            <label className="block text-xs">utm_campaign<input value={s.utm_campaign} onChange={(e) => set('utm_campaign', e.target.value)} className={input} /></label>
          </div>
          <SaveBar dirty={dirty} busy={busy} onSave={onSave} />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Preview</span>
            <select value={variant} onChange={(e) => setVariant(e.target.value as 'marketing' | 'plain')} className="rounded-lg border border-stone-300 px-2 py-1.5">
              <option value="marketing">Full version</option><option value="plain">Plain version</option>
            </select>
            <select value={shop} onChange={(e) => setShop(e.target.value as Shop)} className="rounded-lg border border-stone-300 px-2 py-1.5">
              {SHOPS.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
            </select>
          </div>
          {preview && (
            <>
              <p className="mt-2 text-sm"><span className="text-stone-500">Subject:</span> {preview.subject}</p>
              {preview.missingLinks.length > 0 && (
                <p className="mt-1 text-xs text-amber-800">Left out (no address yet): {preview.missingLinks.join(', ')}</p>
              )}
              <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="mt-2 h-[640px] w-full rounded-lg border border-stone-200 bg-white" />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Backfill ───────────────────────────────────────────────────────────── */
function Backfill({ s, dirty, onDone }: { s: VisitEmailSettings; dirty: boolean; onDone: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState('');

  async function go(action: 'preview' | 'queue') {
    if (action === 'queue' && !confirm(`Queue thank-you emails for visits ${from} to ${to}? They go out in batches of ${s.batch_size}, at most ${s.daily_cap} a day${s.mode === 'live' ? '. Mode is LIVE: these are real emails.' : ` (mode is ${s.mode === 'off' ? 'off, so nothing sends yet' : 'dry run, so nothing is really sent'}).`}`)) return;
    setBusy(action);
    try { setResult(await api('/api/visit-emails/backfill', { from, to, action })); if (action === 'queue') onDone(); }
    catch (e) { toast((e as Error).message, 'error'); }
    setBusy('');
  }
  const p = result?.plan;
  return (
    <section className={card}>
      <h2 className="font-semibold">Backdate to earlier visits</h2>
      <p className="mt-1 text-xs text-stone-500">
        Uses the saved settings and the same rules. Check the numbers first, then queue. Queued emails go out in batches
        ({s.batch_size} per run, {s.daily_cap} a day) within the send window. Each booking is only ever handled once.
      </p>
      {dirty && <p className="mt-2 text-sm text-amber-700">Save your settings first; backfill uses the saved version.</p>}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block text-sm">Visits from<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} /></label>
        <label className="block text-sm">to<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} /></label>
        <button className={btnGhost} disabled={!from || !to || !!busy} onClick={() => go('preview')}>{busy === 'preview' ? 'Checking…' : 'Check numbers'}</button>
        <button className={btn} disabled={!from || !to || !!busy || !p || result?.saved || dirty} onClick={() => go('queue')}>{busy === 'queue' ? 'Queueing…' : 'Queue these emails'}</button>
      </div>
      {p && (
        <div className="mt-4 rounded-lg bg-cocoa-50 p-3 text-sm">
          <p className="font-medium">{result.saved ? 'Queued' : 'Would queue'} {p.queue} email{p.queue === 1 ? '' : 's'} ({p.byVariant.marketing} full, {p.byVariant.plain} plain){p.queue ? `, about ${result.daysToSend} day${result.daysToSend === 1 ? '' : 's'} to send` : ''}.</p>
          <p className="mt-1 text-stone-600">{p.fetched} bookings found{p.already ? `, ${p.already} already handled before` : ''}{p.wait ? `, ${p.wait} too recent to decide` : ''}.</p>
          {Object.keys(p.skip).length > 0 && (
            <ul className="mt-1 text-stone-600">
              {Object.entries(p.skip as Record<string, number>).map(([k, n]) => <li key={k}>Not emailed – {(SKIP_LABELS as any)[k] ?? k}: {n}</li>)}
            </ul>
          )}
          {p.feedErrors?.length > 0 && <p className="mt-1 text-red-700">Couldn't read: {p.feedErrors.map((e: any) => `${e.shop} (${e.status})`).join(', ')}</p>}
        </div>
      )}
    </section>
  );
}

/* ── Activity ───────────────────────────────────────────────────────────── */
const STATE_LABEL: Record<string, string> = { queued: 'Waiting', sent: 'Sent', dry_run: 'Dry run', failed: 'Failed', cancelled: 'Cancelled' };

function Activity({ stats }: { stats: Stats }) {
  if (!stats) return null;
  return (
    <section className={card}>
      <h2 className="font-semibold">Recent emails</h2>
      {stats.recent.length === 0 ? <p className="mt-2 text-sm text-stone-500">None yet.</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-stone-500"><th className="py-1">Visit</th><th>Café</th><th>Guest</th><th>Version</th><th>Status</th><th>When</th></tr></thead>
            <tbody>{stats.recent.map((r: any) => (
              <tr key={r.id} className="border-t border-stone-100">
                <td className="py-1.5">{r.visit_date}</td>
                <td>{SHOPS.find((x) => x.key === r.shop)?.name ?? r.shop}</td>
                <td>{r.first_name || '–'} <span className="text-xs text-stone-500">{r.email}</span></td>
                <td>{r.variant === 'plain' ? 'Plain' : 'Full'}{r.source === 'backfill' ? ' · backfill' : ''}</td>
                <td title={r.error ?? ''}>{STATE_LABEL[r.state] ?? r.state}{r.skip_reason ? ` (${(SKIP_LABELS as any)[r.skip_reason] ?? r.skip_reason})` : ''}</td>
                <td>{when(r.sent_at ?? r.due_at)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="mt-5 text-sm font-semibold">Runs</h3>
      <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
        {stats.runs.map((r: any) => (
          <li key={r.id}>{when(r.started_at)} · {r.kind} · {r.mode} · read {r.fetched}, queued {r.queued}, skipped {r.skipped}, sent {r.sent}{r.dry_run ? `, dry run ${r.dry_run}` : ''}{r.failed ? `, failed ${r.failed}` : ''}{r.error ? ` · ${r.error}` : ''}</li>
        ))}
      </ul>
    </section>
  );
}

/* ── Housekeeping ───────────────────────────────────────────────────────── */
function Housekeeping({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  async function act(action: string, confirmText?: string, extra?: object) {
    if (confirmText && !confirm(confirmText)) return;
    try {
      const r = await api('/api/visit-emails/actions', { action, ...extra });
      toast(r.count != null ? `Done (${r.count}).` : 'Done.', 'success');
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <section className={card}>
      <h2 className="font-semibold">Housekeeping</h2>
      <div className="mt-3 flex flex-wrap gap-3">
        <button className={btnGhost} onClick={() => act('requeue_dry_run', 'Put every dry-run email back in the queue? Do this when going live if those guests should get the real email.')}>Re-queue dry-run emails</button>
        <button className={btnGhost} onClick={() => act('cancel_queued', 'Cancel every email still waiting to send?')}>Cancel everything waiting</button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm">Never email this address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} placeholder="guest@example.com" /></label>
        <button className={btnGhost} disabled={!email} onClick={() => act('suppress', undefined, { email }).then(() => setEmail(''))}>Add to do-not-email list</button>
      </div>
    </section>
  );
}
