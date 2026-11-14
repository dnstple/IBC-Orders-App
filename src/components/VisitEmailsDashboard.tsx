'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/Toaster';
import { SKIP_LABELS } from '@/lib/visit-emails/eligibility';
import { cleanFirstName, findLink } from '@/lib/visit-emails/render';
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

  // Unsaved work is never silently lost: a draft is kept in this browser,
  // and leaving the page with unsaved changes asks first.
  const [draft, setDraft] = useState<{ at: string; s: VisitEmailSettings } | null>(null);
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
      if (d?.s && JSON.stringify(d.s) !== JSON.stringify(initialSettings)) setDraft(d);
    } catch { /* storage unavailable */ }
  }, [initialSettings]);
  useEffect(() => {
    if (!dirty) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: new Date().toISOString(), s })); } catch { /* ignore */ }
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, s]);

  const set = <K extends keyof VisitEmailSettings>(k: K, v: VisitEmailSettings[K]) => setS((p) => ({ ...p, [k]: v }));

  async function save(next = s) {
    setBusy('save');
    try {
      const r = await api('/api/visit-emails/settings', next);
      setSaved(r.settings); setS(r.settings);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setDraft(null);
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
      {draft && !dirty && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          You have changes from {when(draft.at)} that were never saved.
          <button className="ml-3 font-semibold underline" onClick={() => { setS(draft.s); setDraft(null); }}>Bring them back</button>
          <button className="ml-3 underline" onClick={() => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } setDraft(null); }}>Discard</button>
        </div>
      )}
      {dirty && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 shadow">
          <span><b>Unsaved changes.</b> They're kept in this browser, but only saved changes are used for emails.</span>
          <span className="flex gap-2">
            <button className={btn} onClick={() => save()} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save now'}</button>
            <button className={btnGhost} onClick={() => setS(saved)}>Undo changes</button>
          </span>
        </div>
      )}
      <StatusCard s={saved} stats={stats} busy={busy} onRun={runNow} />
      <Approvals s={saved} liveAllowed={!!stats?.server?.liveAllowed} onDone={load} />
      <Overview s={saved} stats={stats} />
      <SettingsCard s={s} set={set} dirty={dirty} busy={busy} onSave={() => save()} onReset={() => setS(saved)} liveAllowed={!!stats?.server?.liveAllowed} />
      <CopyCard s={s} set={set} dirty={dirty} busy={busy} onSave={() => save()} resendReady={!!stats?.server?.resendConfigured} />
      <DataCheck s={s} />
      <Backfill s={saved} dirty={dirty} onDone={load} />
      <Activity stats={stats} />
      <Versions onLoad={(v) => { setS(v); window.scrollTo({ top: 0, behavior: 'smooth' }); toast('Version loaded. Check it, then press Save now.', 'info'); }} />
      <Housekeeping onDone={load} />
    </div>
  );
}

const DRAFT_KEY = 'ibc-visit-emails-draft';

/* ── Status ─────────────────────────────────────────────────────────────── */
function StatusCard({ s, stats, busy, onRun }: { s: VisitEmailSettings; stats: Stats; busy: string; onRun: () => void }) {
  const mode = {
    off: { label: 'Off', cls: 'bg-stone-200 text-stone-700', note: 'Nothing is read, queued or sent.' },
    dry_run: { label: 'Dry run', cls: 'bg-amber-100 text-amber-800', note: 'Everything runs and is counted, but no email leaves the building.' },
    manual: { label: 'Approve each one', cls: 'bg-sky-100 text-sky-800', note: 'Guests are queued as normal; nothing sends until you press Send in the approval list.' },
    live: { label: 'Live', cls: 'bg-green-100 text-green-800', note: 'Emails are being sent automatically.' },
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

      <Funnel stats={stats} s={s} />

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Link clicks</h3>
          {stats.links.length === 0 ? <p className="mt-1 text-sm text-stone-500">No clicks yet.</p> : (
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-xs text-stone-500"><th className="py-1">Link</th><th className="text-right">Clicks</th><th className="text-right">People</th><th className="text-right" title="Email security scanners, not counted">Scanners</th></tr></thead>
              <tbody>{stats.links.map((l: any) => (
                <tr key={l.link} className="border-t border-stone-100">
                  <td className="py-1.5">{findLink(s, l.link)?.label ?? l.link}{l.link.startsWith('t-') ? <span className="text-xs text-stone-500"> (text link)</span> : null}</td>
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
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          {([
            ['off', 'Off', 'Nothing happens.'],
            ['dry_run', 'Dry run', 'Decides and counts everything, sends nothing. Use this to test.'],
            ['manual', 'Approve each one', liveAllowed ? 'Queues as normal; you send each email by hand from the approval list.' : 'Locked: needs VISIT_EMAILS_ALLOW_LIVE=true on the server first.'],
            ['live', 'Live', liveAllowed ? 'Sends real emails automatically.' : 'Locked: needs the email service set up on the server first.'],
          ] as const).map(([v, l, h]) => {
            const locked = (v === 'live' || v === 'manual') && !liveAllowed;
            return (
            <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${s.mode === v ? 'border-cocoa-600 bg-cocoa-50' : 'border-stone-200'} ${locked ? 'opacity-60' : ''}`}>
              <input type="radio" name="mode" checked={s.mode === v} disabled={locked} onChange={() => set('mode', v)} className="mt-1 accent-cocoa-600" />
              <span><span className="font-medium">{l}</span><span className="block text-xs text-stone-500">{h}</span></span>
            </label>
            );
          })}
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
/** Sends this exact preview to one address typed in. Never to guests; works in any mode once Resend is set up. */
function TestSend({ s, variant, shop, ready }: { s: VisitEmailSettings; variant: 'marketing' | 'plain'; shop: Shop; ready: boolean }) {
  const [to, setTo] = useState('');
  const [name, setName] = useState('Sofia');
  const [sending, setSending] = useState(false);
  async function send() {
    setSending(true);
    try {
      await api('/api/visit-emails/test', { to, settings: s, variant, shop, first_name: name });
      toast(`Test sent to ${to}. Check the inbox (and spam).`, 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
    setSending(false);
  }
  return (
    <div className="mt-4 rounded-lg border border-stone-200 p-3">
      <h3 className="text-sm font-semibold">Send a test to…</h3>
      <p className="mt-1 text-xs text-stone-500">
        Sends this preview (the version and café chosen above, with any unsaved changes) to one address only, subject starting [TEST].
        Never goes to a guest. Clicks on a test aren't counted.
      </p>
      {!ready ? (
        <p className="mt-2 text-sm text-amber-800">Needs Resend first: add RESEND_API_KEY in Vercel and redeploy.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="block text-sm">Email address<input type="email" value={to} onChange={(e) => setTo(e.target.value)} className={input} placeholder="you@example.com" /></label>
          <label className="block text-sm">First name to use<input value={name} onChange={(e) => setName(e.target.value)} className={input} /></label>
          <button className={btn} disabled={!to || sending} onClick={send}>{sending ? 'Sending…' : 'Send test'}</button>
        </div>
      )}
    </div>
  );
}

function CopyCard({ s, set, dirty, busy, onSave, resendReady }: { s: VisitEmailSettings; set: SetFn; dirty: boolean; busy: string; onSave: () => void; resendReady: boolean }) {
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
  const area = (label: string, k: 'body_marketing' | 'body_plain' | 'signoff', hint: string, rows = 6) => (
    <RichArea label={label} hint={hint} rows={rows} value={s[k]} onChange={(v) => set(k, v)} />
  );

  return (
    <section className={card}>
      <h2 className="font-semibold">Email copy</h2>
      <p className="mt-1 text-xs text-stone-500">
        Placeholders: <code>{'{first_name}'}</code> <code>{'{shop}'}</code> (Soho / Fitzrovia) <code>{'{visit_day}'}</code> (e.g. Wednesday)
        {' '}<code>{'{visit_date}'}</code> (e.g. Wednesday 11 November).
        If a guest has no first name, “, {'{first_name}'}” is left out. Leave a blank line between paragraphs.
        In the messages and sign-off, select words and press <b>Bold</b> or <b>Link</b>; it shows as <code>**bold**</code> and <code>[words](https://…)</code>.
      </p>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <fieldset className="text-sm">
            <legend>Style</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {([['letter', 'Letter', 'Plain and personal: small name at the top, simple button.'], ['branded', 'Branded', 'Brown header bar, big heading, bigger buttons.']] as const).map(([v, l, h]) => (
                <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${s.style === v ? 'border-cocoa-600 bg-cocoa-50' : 'border-stone-200'}`}>
                  <input type="radio" name="style" checked={s.style === v} onChange={() => set('style', v)} className="mt-1 accent-cocoa-600" />
                  <span><span className="font-medium">{l}</span><span className="block text-xs text-stone-500">{h}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm">Subject<input value={s.subject} onChange={(e) => set('subject', e.target.value)} className={input} /></label>
          <label className="block text-sm">Preview line (shown after the subject in the inbox)<input value={s.preheader} onChange={(e) => set('preheader', e.target.value)} className={input} /></label>
          <label className="block text-sm">Heading (the greeting line in the Letter style)<input value={s.heading} onChange={(e) => set('heading', e.target.value)} className={input} /></label>
          {area('Message: full version', 'body_marketing', 'Guests who ticked “news and offers”. Can mention the shop.')}
          {area('Message: plain version', 'body_plain', 'Guests who didn’t tick it (only used when sending to everyone). Thank-you and review only.')}
          {area('Sign-off', 'signoff', '', 2)}
          <label className="block text-sm">Closing line (script font, as on the website)
            <input value={s.tagline} onChange={(e) => set('tagline', e.target.value)} className={input} placeholder="Leave blank for none" />
          </label>

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
              <EmailFrame html={preview.html} />
            </>
          )}
          <TestSend s={s} variant={variant} shop={shop} ready={resendReady} />
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

/* ── Text box with Bold / Link buttons ─────────────────────────────────── */
function RichArea({ label, hint, rows, value, onChange }: { label: string; hint: string; rows: number; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function wrap(kind: 'bold' | 'link') {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const sel = value.slice(a, b) || (kind === 'bold' ? 'bold words' : 'link words');
    let piece: string;
    if (kind === 'bold') piece = `**${sel}**`;
    else {
      const url = (window.prompt('Link address (must start with https://)', 'https://italianbearchocolate.com/') || '').trim();
      if (!url) return;
      if (!/^https:\/\/\S+$/.test(url)) { toast('Links must start with https://', 'error'); return; }
      piece = `[${sel}](${url})`;
    }
    onChange(value.slice(0, a) + piece + value.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a, a + piece.length); });
  }
  return (
    <div className="text-sm">
      <div className="flex items-end justify-between gap-2">
        <span>{label}</span>
        <span className="flex gap-1">
          <button type="button" onClick={() => wrap('bold')} className="rounded border border-stone-300 px-2 py-0.5 text-xs font-bold hover:bg-stone-50">Bold</button>
          <button type="button" onClick={() => wrap('link')} className="rounded border border-stone-300 px-2 py-0.5 text-xs underline hover:bg-stone-50">Link</button>
        </span>
      </div>
      <textarea ref={ref} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={input} />
      {hint && <span className="mt-0.5 block text-xs text-stone-500">{hint}</span>}
    </div>
  );
}

/* ── Email preview: whole email by default; drag the corner to resize ──── */
function EmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const fit = useRef(true);
  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc || !box.current || !fit.current) return;
    box.current.style.height = `${doc.documentElement.scrollHeight + 4}px`;
  }, []);
  useEffect(() => { measure(); }, [html, measure]);
  return (
    <div className="mt-2">
      <div ref={box} style={{ height: 640 }} className="resize-y overflow-hidden rounded-lg border border-stone-200 bg-white"
        onMouseDown={() => { fit.current = false; }}>
        {/* allow-same-origin (no scripts) only so the frame's height can be measured */}
        <iframe ref={ref} title="Email preview" srcDoc={html} sandbox="allow-same-origin" className="h-full w-full"
          onLoad={() => { measure(); setTimeout(measure, 600); }} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-stone-500">
        <span>Drag the bottom-right corner to resize.</span>
        <button type="button" className="underline" onClick={() => { fit.current = true; measure(); }}>Show whole email</button>
        <button type="button" className="underline" onClick={() => { fit.current = false; if (box.current) box.current.style.height = '480px'; }}>Shorter</button>
      </div>
    </div>
  );
}

/* ── Check the data: real bookings and what the rules would do ─────────── */
type SampleRow = {
  shop: string; booking_id: string; date: string; time: string; party_size: number | null; status: string;
  first_name: string; email: string | null; marketing: 'yes' | 'no' | null;
  action: 'queue' | 'skip' | 'wait' | 'ignore' | 'handled'; reason?: string; variant?: 'marketing' | 'plain';
  due_at?: string; source: 'auto' | 'backfill'; handled_state?: string;
};
const ymdLocal = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);

/** Why a first name would look odd in "Thank you for visiting, …" (null = fine). */
/** What the cleaner can't fix (capitals and spacing are fixed automatically). null = fine. */
function nameProblem(n: string): string | null {
  const t = n.trim();
  if (!t) return 'no first name';
  if (/[\d@]/.test(t)) return 'looks wrong, left out';
  const clean = cleanFirstName(t);
  if (!clean) return 'left out';
  if (clean.replace(/[^\p{L}]/gu, '').length === 1) return 'initial only';
  if (t.split(/\s+/).length > 2) return 'more than two words, trimmed';
  return null;
}

/** The name as it will appear in the email, plus the original when cleaning changed it. */
function NameCell({ raw }: { raw: string | null }) {
  const clean = cleanFirstName(raw);
  const changed = (raw ?? '').trim() !== clean;
  return <>{clean || '–'}{changed && raw ? <span className="text-xs text-stone-400"> (was “{raw}”)</span> : null}</>;
}

function DataCheck({ s }: { s: VisitEmailSettings }) {
  const [from, setFrom] = useState(() => ymdLocal(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(() => ymdLocal(new Date()));
  const [rows, setRows] = useState<SampleRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'queue' | 'skip' | 'other'>('queue');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<SampleRow | null>(null);
  const [html, setHtml] = useState('');
  const [assume, setAssume] = useState(false);

  async function loadRows(range?: [string, string], assumeAttend = assume) {
    const [f, t] = range ?? [from, to];
    setBusy(true); setOpen(null);
    try { setRows((await api('/api/visit-emails/sample', { from: f, to: t, assume_attend: assumeAttend })).rows); } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  }
  /** This Saturday and Sunday (today and tomorrow if it's already Saturday; today if Sunday). */
  function thisWeekend() {
    const today = ymdLocal(new Date());
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
    const add = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const sat = dow === 0 ? add(-1) : add(6 - dow);
    const range: [string, string] = [dow === 0 ? today : sat, add(dow === 0 ? 0 : 7 - dow)];
    setFrom(range[0]); setTo(range[1]); setAssume(true); setFilter('all');
    void loadRows(range, true);
  }
  function downloadCsv() {
    if (!rows) return;
    const head = ['visit_date', 'weekday', 'time', 'cafe', 'party_size', 'tableagent_status', 'first_name_original', 'first_name_in_email', 'name_check', 'email', 'marketing', 'result', 'version', 'would_send'];
    const cell = (v: unknown) => { const t = String(v ?? ''); const safe = /^[=+\-@]/.test(t) ? `'${t}` : t; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
    const lines = [head.join(',')].concat(rows.map((r) => [
      r.date, new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }), r.time,
      SHOPS.find((x) => x.key === r.shop)?.name ?? r.shop, r.party_size, r.status, r.first_name, cleanFirstName(r.first_name), nameProblem(r.first_name) ?? 'ok',
      r.email ?? '', r.marketing ?? 'unanswered', result(r), r.variant ?? '', r.due_at ? when(r.due_at) : '',
    ].map(cell).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `visit-emails-${from}-to-${to}${assume ? '-if-all-attend' : ''}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }
  async function show(r: SampleRow) {
    setOpen(r); setHtml('');
    const variant = r.variant ?? (r.marketing === 'yes' ? 'marketing' : 'plain');
    try {
      const e = await api('/api/visit-emails/preview', { settings: s, variant, shop: r.shop, first_name: r.first_name, visit_date: r.date });
      setHtml(e.html);
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  const count = (a: SampleRow['action'][]) => rows?.filter((r) => a.includes(r.action)).length ?? 0;
  const shown = (rows ?? []).filter((r) =>
    filter === 'all' ? true : filter === 'queue' ? r.action === 'queue' : filter === 'skip' ? r.action === 'skip' : !['queue', 'skip'].includes(r.action));
  const issues = (rows ?? []).filter((r) => r.action === 'queue' && nameProblem(r.first_name)).length;
  const result = (r: SampleRow) =>
    r.action === 'queue' ? `Email (${r.variant === 'plain' ? 'plain' : 'full'})`
    : r.action === 'skip' ? `No – ${(SKIP_LABELS as Record<string, string>)[r.reason ?? ''] ?? r.reason}`
    : r.action === 'wait' ? 'Not decided yet'
    : r.action === 'ignore' ? 'Before go-live (backfill only)'
    : `Already handled (${STATE_LABEL[r.handled_state ?? ''] ?? r.handled_state})`;
  const tabs: Array<[typeof filter, string]> = [
    ['queue', `Would email (${count(['queue'])})`], ['skip', `Not emailed (${count(['skip'])})`],
    ['other', `Undecided / handled (${count(['wait', 'ignore', 'handled'])})`], ['all', `All (${rows?.length ?? 0})`],
  ];

  return (
    <section className={card}>
      <h2 className="font-semibold">Check the data</h2>
      <p className="mt-1 text-xs text-stone-500">
        Real bookings from TableAgent and what would happen to each, using the <b>saved</b> settings. Nothing is saved or sent.
        Click a guest to see their email. Names are tidied automatically (two words at most, capital letters fixed); the original shows in grey when it changed. Amber = something cleaning can’t fix.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block text-sm">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} /></label>
        <label className="block text-sm">to<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} /></label>
        <button className={btnGhost} disabled={busy || !from || !to} onClick={() => loadRows()}>{busy ? 'Loading…' : 'Show bookings'}</button>
        <button className={btnGhost} disabled={busy} onClick={thisWeekend}>This weekend</button>
        {rows && <button className={btnGhost} onClick={downloadCsv}>Download CSV</button>}
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={assume} onChange={(e) => setAssume(e.target.checked)} className="mt-1 h-4 w-4 accent-cocoa-600" />
        <span><b>Assume everyone attends</b> <span className="text-xs text-stone-500">– for future dates: every booking that isn't cancelled or a no-show counts as arrived. Press Show bookings again after changing.</span></span>
      </label>
      {rows && <QualitySummary rows={rows} />}
      {rows && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 ${filter === k ? 'border-cocoa-600 bg-cocoa-50 font-medium' : 'border-stone-300'}`}>{l}</button>
            ))}
            {issues > 0 && <span className="self-center text-amber-800">{issues} name{issues === 1 ? '' : 's'} to check</span>}
          </div>
          <div className="mt-2 max-h-[520px] overflow-auto rounded-lg border border-stone-100">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 bg-white"><tr className="text-left text-xs text-stone-500">
                <th className="px-2 py-1.5">Visit</th><th>Café</th><th>Party</th><th>TableAgent status</th><th>First name</th><th>Email</th><th>Marketing</th><th>Result</th><th>Would send</th>
              </tr></thead>
              <tbody>{shown.map((r) => {
                const np = nameProblem(r.first_name);
                return (
                  <tr key={r.shop + r.booking_id} onClick={() => show(r)}
                    className={`cursor-pointer border-t border-stone-100 hover:bg-cocoa-50 ${open?.booking_id === r.booking_id ? 'bg-cocoa-50' : ''}`}>
                    <td className="whitespace-nowrap px-2 py-1.5">{r.date.slice(8)}/{r.date.slice(5, 7)} {r.time}</td>
                    <td>{SHOPS.find((x) => x.key === r.shop)?.name ?? r.shop}</td>
                    <td>{r.party_size ?? '–'}</td>
                    <td>{r.status}</td>
                    <td className={np ? 'text-amber-800' : ''} title={np ?? ''}><NameCell raw={r.first_name} />{np ? <span className="text-xs"> ({np})</span> : null}</td>
                    <td className={r.email ? '' : 'text-amber-800'}>{r.email ?? 'none'}</td>
                    <td>{r.marketing === 'yes' ? 'Yes' : r.marketing === 'no' ? 'No' : '–'}</td>
                    <td>{result(r)}</td>
                    <td className="whitespace-nowrap">{r.due_at ? when(r.due_at) : ''}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {open && (
            <div className="mt-4">
              <p className="text-sm"><b>{cleanFirstName(open.first_name) || '(no name)'}</b> · {open.email ?? 'no email'} · {open.date} {open.time} ·
                {' '}{SHOPS.find((x) => x.key === open.shop)?.name} · {result(open)}
                <button className="ml-3 text-xs underline" onClick={() => setOpen(null)}>Close</button></p>
              {html ? <EmailFrame html={html} /> : <p className="mt-2 text-sm text-stone-500">Loading email…</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ── Funnel: sent → delivered → opened → clicked (real sends only) ─────── */
function Funnel({ stats, s }: { stats: Stats; s: VisitEmailSettings }) {
  const f = stats.funnel as null | Record<string, number>;
  const [sales, setSales] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [salesErr, setSalesErr] = useState('');
  useEffect(() => {
    if (!f?.sent) return;
    api('/api/visit-emails/sales').then(setSales).catch((e) => setSalesErr((e as Error).message));
  }, [f?.sent]);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const gbp = (n: number) => `£${(n ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (!f) {
    return <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Delivery and open tracking needs the database update <code>0007_visit_email_events.sql</code> running in Supabase.</p>;
  }
  const ordered = sales?.viaLink?.orders ?? 0;
  const steps: Array<[string, string, string]> = [
    ['Sent', String(f.sent), ''],
    ['Delivered', String(f.delivered), `${pct(f.delivered, f.sent)} of sent`],
    ['Opened', String(f.opened), `${pct(f.opened, f.delivered)} of delivered`],
    ['Clicked a link', String(f.clicked), `${pct(f.clicked, f.delivered)} of delivered · ${pct(f.clicked, f.opened)} of opened`],
    ['Ordered online', !f.sent ? '0' : sales ? String(ordered) : '…',
      sales ? `${gbp(sales.viaLink.revenue)} · ${pct(ordered, f.clicked)} of clickers` : salesErr ? 'couldn’t load' : ''],
  ];
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold">Funnel (real emails only)</h3>
      <ol className="mt-2 grid gap-2 sm:grid-cols-5">
        {steps.map(([label, n, sub], i) => (
          <li key={label} className={`rounded-lg border p-3 ${i === 4 ? 'border-cocoa-600 bg-cocoa-50' : 'border-stone-200'}`}>
            <div className="text-xs text-stone-500">{i + 1}. {label}</div>
            <div className="text-xl font-semibold text-cocoa-900">{n}</div>
            {sub && <div className="text-xs text-stone-500">{sub}</div>}
          </li>
        ))}
      </ol>
      {sales && (
        <p className="mt-2 text-xs text-stone-600">
          <b>Ordered online</b> = Shopify orders that arrived through the email’s links (tagged <code>{s.utm_campaign}</code>)
          {Object.keys(sales.viaLink.byLink).length ? `: ${Object.entries(sales.viaLink.byLink as Record<string, { orders: number; revenue: number }>).map(([k, v]) => `${findLink(s, k)?.label ?? k} ${v.orders} (${gbp(v.revenue)})`).join(' · ')}` : ''}.
          {' '}Wider view: <b>{sales.byGuests.orders}</b> online order{sales.byGuests.orders === 1 ? '' : 's'} ({gbp(sales.byGuests.revenue)}) from {sales.byGuests.guests} emailed guest{sales.byGuests.guests === 1 ? '' : 's'} within {sales.byGuests.windowDays} days of their email, however they reached the shop.
          {sales.viaLink.error ? ` Shopify: ${sales.viaLink.error}` : ''}
        </p>
      )}
      <p className="mt-2 text-xs text-stone-600">
        Problems: {f.bounced} bounced · {f.delayed} still delayed · {f.complained} marked as spam · {f.optedOut} opted out
        {f.sent ? ` (spam rate ${pct(f.complained, f.delivered)}; keep under 0.1%)` : ''}.
      </p>
      <p className="mt-1 text-xs text-stone-500">
        {stats.webhookConfigured ? '' : 'Delivered/opened/bounced need the Resend webhook set up (RESEND_WEBHOOK_SECRET). '}
        Opens are approximate: Apple Mail opens every email automatically and some people block images.
        Orders are only counted when Shopify can see the visit came from the email (people who block cookies are missed), so the wider view is a useful second number.
      </p>
    </div>
  );
}

/* ── Data quality at a glance, for the bookings loaded in Check the data ── */
function QualitySummary({ rows }: { rows: SampleRow[] }) {
  const live = rows.filter((r) => r.reason !== 'booking_cancelled');
  const n = live.length;
  const pct = (a: number) => (n ? `${Math.round((a / n) * 100)}%` : '–');
  const noEmail = live.filter((r) => !r.email).length;
  const byEmail = new Map<string, number>();
  for (const r of live) if (r.email) byEmail.set(r.email, (byEmail.get(r.email) ?? 0) + 1);
  const repeatGuests = [...byEmail.values()].filter((c) => c > 1).length;
  const nameIssues = new Map<string, number>();
  for (const r of live) { const p = nameProblem(r.first_name); if (p) nameIssues.set(p, (nameIssues.get(p) ?? 0) + 1); }
  const mk = { yes: live.filter((r) => r.marketing === 'yes').length, no: live.filter((r) => r.marketing === 'no').length };
  const unanswered = n - mk.yes - mk.no;
  const would = live.filter((r) => r.action === 'queue');
  const cancelled = rows.length - n;
  const cafes = SHOPS.map((x) => `${x.name} ${live.filter((r) => r.shop === x.key).length}`).join(' · ');
  const guests = live.reduce((a, r) => a + (r.party_size ?? 0), 0);
  return (
    <div className="mt-4 grid gap-3 rounded-lg bg-cocoa-50 p-3 text-sm sm:grid-cols-3">
      <div>
        <div className="text-xs text-stone-500">Bookings</div>
        <div><b>{n}</b> ({cafes}), {guests} guests{cancelled ? `; ${cancelled} cancelled left out` : ''}</div>
        <div className="mt-1"><b>{would.length}</b> would get an email ({would.filter((r) => r.variant === 'marketing').length} full, {would.filter((r) => r.variant === 'plain').length} plain)</div>
      </div>
      <div>
        <div className="text-xs text-stone-500">Marketing answer</div>
        <div>Yes <b>{mk.yes}</b> ({pct(mk.yes)}) · No <b>{mk.no}</b> ({pct(mk.no)}) · Not answered <b>{unanswered}</b> ({pct(unanswered)})</div>
        <div className="mt-1 text-xs text-stone-500">“Not answered” is usually bookings made by staff in TableAgent or before the tick box existed.</div>
      </div>
      <div>
        <div className="text-xs text-stone-500">Data quality</div>
        <div>No email: <b>{noEmail}</b> ({pct(noEmail)}) · Repeat guests: <b>{repeatGuests}</b></div>
        <div>Names to check: {nameIssues.size === 0 ? <b>none</b> : [...nameIssues].map(([k, c]) => `${k} ${c}`).join(' · ')}</div>
      </div>
    </div>
  );
}

/* ── Saved versions: every Save is kept and can be loaded back ──────────── */
function Versions({ onLoad }: { onLoad: (s: VisitEmailSettings) => void }) {
  const [list, setList] = useState<Array<{ id: number; saved_at: string; saved_by: string; mode: string; style: string; subject: string; opening: string }> | null>(null);
  const [missing, setMissing] = useState(false);
  async function open() {
    try { const r = await api('/api/visit-emails/history'); setList(r.versions); setMissing(!!r.missing); } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function loadOne(id: number) {
    try { onLoad((await api(`/api/visit-emails/history?id=${id}`)).settings); } catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <section className={card}>
      <h2 className="font-semibold">Saved versions</h2>
      <p className="mt-1 text-xs text-stone-500">Every time you press Save, that version of the settings and copy is kept. Load one to bring it back (then press Save).</p>
      {!list ? <button className={`${btnGhost} mt-3`} onClick={open}>Show saved versions</button> : missing ? (
        <p className="mt-2 text-sm text-amber-800">Needs the database update <code>0008_visit_email_settings_history.sql</code> running in Supabase.</p>
      ) : list.length === 0 ? <p className="mt-2 text-sm text-stone-500">No saved versions yet.</p> : (
        <ul className="mt-3 divide-y divide-stone-100 text-sm">
          {list.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <b>{when(v.saved_at)}</b>{v.saved_by ? ` · ${v.saved_by}` : ''} · {v.style} · {v.mode}
                <span className="block truncate text-xs text-stone-500">“{v.subject}” – {v.opening}…</span>
              </span>
              <button className={btnGhost} onClick={() => loadOne(v.id)}>Load</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Approval list: send queued emails one at a time, by hand ─────────── */
type ApprovalItem = {
  id: string; shop: string; booking_id: string; visit_date: string; visit_at: string | null; party_size: number | null;
  first_name: string | null; email: string | null; marketing: 'yes' | 'no' | null; variant: 'marketing' | 'plain' | null;
  state: string; due_at: string | null; source: string; error: string | null;
};

function Approvals({ s, liveAllowed, onDone }: { s: VisitEmailSettings; liveAllowed: boolean; onDone: () => void }) {
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [html, setHtml] = useState('');
  const reload = useCallback(async () => {
    try { setItems((await api('/api/visit-emails/approvals')).items); } catch (e) { toast((e as Error).message, 'error'); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function preview(it: ApprovalItem) {
    if (open === it.id) { setOpen(null); return; }
    setOpen(it.id); setHtml('');
    try {
      const e = await api('/api/visit-emails/preview', { settings: s, variant: it.variant ?? 'marketing', shop: it.shop, first_name: it.first_name ?? '', visit_date: it.visit_date });
      setHtml(e.html);
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function act(it: ApprovalItem, action: 'send' | 'skip') {
    if (action === 'send' && !confirm(`Send the real thank-you email to ${it.email} now?`)) return;
    if (action === 'skip' && !confirm(`Don't send to ${it.email}? It will be removed from the list.`)) return;
    setBusy(it.id + action);
    try {
      await api('/api/visit-emails/approvals', { id: it.id, action });
      toast(action === 'send' ? `Sent to ${it.email}.` : 'Removed from the list.', 'success');
      if (open === it.id) setOpen(null);
      await reload(); onDone();
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy('');
  }

  const cafe = (k: string) => SHOPS.find((x) => x.key === k)?.name ?? k;
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Approval list {items ? <span className="text-sm font-normal text-stone-500">({items.length} waiting)</span> : null}</h2>
        <button className={btnGhost} onClick={reload}>Refresh</button>
      </div>
      <p className="mt-1 text-xs text-stone-500">
        Guests the system has queued (or held in dry run). Check the email, then send them one at a time.
        {s.mode === 'manual' ? ' Mode is Approve each one, so nothing goes out unless you press Send.' : s.mode === 'live' ? ' Mode is Live: these also send automatically when due.' : ''}
        {' '}<b>Send now sends immediately</b>, whatever the time: it skips the send window, the hours-after-the-visit delay and the daily limit. Opt-outs, the marketing switch and cancelled bookings still apply.
      </p>
      {!liveAllowed && (
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Sending is locked on the server. To unlock: Vercel → Settings → Environment Variables → add <code>VISIT_EMAILS_ALLOW_LIVE</code> = <code>true</code>, then Redeploy.
          With the mode set to Dry run or Approve each one, nothing will send by itself after that.
        </p>
      )}
      {items && items.length === 0 && <p className="mt-3 text-sm text-stone-500">Nothing waiting. Guests appear here after their visit is marked as arrived (Run now to check straight away).</p>}
      {items && items.length > 0 && (
        <ul className="mt-3 divide-y divide-stone-100">
          {items.map((it) => {
            const np = nameProblem(it.first_name ?? '');
            return (
              <li key={it.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    <b className={np ? 'text-amber-800' : ''}>{cleanFirstName(it.first_name) ? <NameCell raw={it.first_name} /> : '(no name)'}</b>{np ? <span className="text-xs text-amber-800"> ({np})</span> : null}
                    {' · '}{it.email}
                    <span className="block text-xs text-stone-500">
                      {cafe(it.shop)} · visited {it.visit_date}{it.visit_at ? ` at ${new Date(it.visit_at).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })}` : ''}{it.party_size ? ` · party of ${it.party_size}` : ''} · TableAgent booking {it.booking_id} · {it.variant === 'plain' ? 'plain' : 'full'} version
                      {it.state === 'dry_run' ? ' · held in dry run' : s.mode === 'live' && it.due_at ? ` · sends automatically ${when(it.due_at)}` : ' · ready: Send now sends it immediately'}{it.source === 'backfill' ? ' · backfill' : ''}
                      {it.error ? <span className="text-red-700"> · last try: {it.error}</span> : null}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <button className={btnGhost} onClick={() => preview(it)}>{open === it.id ? 'Hide' : 'Preview'}</button>
                    <button className={btn} disabled={!liveAllowed || !!busy} onClick={() => act(it, 'send')}>{busy === it.id + 'send' ? 'Sending…' : 'Send now'}</button>
                    <button className={btnGhost} disabled={!!busy} onClick={() => act(it, 'skip')}>Don’t send</button>
                  </span>
                </div>
                {open === it.id && (html ? <EmailFrame html={html} /> : <p className="mt-2 text-sm text-stone-500">Loading email…</p>)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
