'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrderRow, ShippingLabelRow } from '@/types/db';
import { validatePackage, type PackageErrors } from '@/lib/shipping-label';

/**
 * Royal Mail Tracked 24 label, start to finish, without leaving the app:
 *   1. Measure  — staff type the box's size and weight for THIS parcel
 *   2. Buy      — the app buys the Shopify Shipping label
 *   3. Print    — the label goes to the iPad share sheet → Munbyn app
 * Written for someone doing it for the first time: every screen says
 * exactly what to do next. Buying is guarded server-side — one live label
 * per order — so re-opening this screen only ever re-prints.
 */
type Step = 'measure' | 'confirm' | 'buying' | 'failed' | 'print';

export function LabelFlow({ order, initialLabel, onClose, onDone }: {
  order: OrderRow;
  initialLabel: ShippingLabelRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [label, setLabel] = useState<ShippingLabelRow | null>(initialLabel);
  const [step, setStep] = useState<Step>(() =>
    initialLabel?.status === 'purchased' ? 'print'
      : initialLabel?.status === 'pending' ? 'buying'
      : 'measure'
  );
  const [form, setForm] = useState({
    lengthCm: initialLabel ? String(initialLabel.package.lengthCm) : '',
    widthCm: initialLabel ? String(initialLabel.package.widthCm) : '',
    heightCm: initialLabel ? String(initialLabel.package.heightCm) : '',
    weightGrams: initialLabel ? String(initialLabel.package.weightGrams) : '',
  });
  const [errors, setErrors] = useState<PackageErrors>({});
  const [failure, setFailure] = useState<string | null>(initialLabel?.status === 'failed' ? initialLabel.error : null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'buying') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, step]);

  const applyLabel = useCallback((next: ShippingLabelRow | null) => {
    setLabel(next);
    if (next?.status === 'purchased') setStep('print');
    else if (next?.status === 'failed') {
      setFailure(next.error ?? 'The label wasn\'t bought.');
      setStep('failed');
    }
  }, []);

  // While Shopify is buying, check every 2 seconds.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (step !== 'buying') return;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/orders/${order.id}/label`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (res.ok) applyLabel(json.label ?? null);
      } catch {
        /* offline blip — keep trying */
      }
      if (Date.now() - started > 45000) setSlow(true);
      if (!stopped) timer = setTimeout(tick, 2000);
    };
    let timer = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [step, order.id, applyLabel]);

  function next() {
    const check = validatePackage(form);
    setErrors(check.errors);
    if (check.ok) setStep('confirm');
  }

  async function buy() {
    if (submitting) return; // double-tap guard (the server guards too)
    setSubmitting(true);
    setFailure(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (json.label?.status === 'purchased' || json.label?.status === 'pending') {
        setLabel(json.label);
        setStep(json.label.status === 'purchased' ? 'print' : 'buying');
        return;
      }
      if (res.status === 400 && json.fields) {
        setErrors(json.fields);
        setStep('measure');
        return;
      }
      setFailure([json.error, json.detail].filter(Boolean).join(' — ') || `Something went wrong (${res.status}).`);
      setStep('failed');
    } catch {
      setFailure('No internet connection. Nothing was bought — check the Wi‑Fi and try again.');
      setStep('failed');
    } finally {
      setSubmitting(false);
    }
  }

  const stepNumber = step === 'measure' ? 1 : step === 'print' ? 3 : 2;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-cream" role="dialog" aria-modal="true" aria-label={`Shipping label for ${order.order_number}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cocoa-100 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-cocoa-900">Shipping label · {order.order_number}</div>
          <div className="text-xs text-stone-500">Step {stepNumber} of 3 · Royal Mail Tracked 24</div>
        </div>
        {step !== 'buying' && (
          <button
            onClick={onClose}
            aria-label="Close label screen"
            className="min-h-10 rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:border-cocoa-500"
          >
            ✕ Close
          </button>
        )}
      </div>

      <div className="h-1.5 w-full bg-cocoa-100" aria-hidden>
        <div className="h-1.5 bg-cocoa-600 transition-all" style={{ width: `${Math.round((stepNumber / 3) * 100)}%` }} />
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-xl">
          {step === 'measure' && <MeasureScreen form={form} setForm={setForm} errors={errors} />}
          {step === 'confirm' && <ConfirmScreen order={order} form={form} />}
          {step === 'buying' && <BuyingScreen slow={slow} />}
          {step === 'failed' && <FailedScreen message={failure} />}
          {step === 'print' && label && <PrintScreen order={order} label={label} />}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-cocoa-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-xl gap-2">
          {step === 'measure' && (
            <button onClick={next} className={primaryBtn}>Next — check details →</button>
          )}
          {step === 'confirm' && (
            <>
              <button onClick={() => setStep('measure')} disabled={submitting} className={backBtn}>← Change</button>
              <button onClick={buy} disabled={submitting} className={primaryBtn}>
                {submitting ? 'Buying…' : 'Buy label'}
              </button>
            </>
          )}
          {step === 'failed' && (
            <>
              <button onClick={() => setStep('measure')} className={backBtn}>← Change box details</button>
              <button onClick={() => setStep('confirm')} className={primaryBtn}>Try again</button>
            </>
          )}
          {step === 'print' && (
            <button onClick={onDone} className={doneBtn}>✓ Done — label is on the box</button>
          )}
        </div>
      </div>
    </div>
  );
}

const primaryBtn = 'min-h-12 flex-1 rounded-xl bg-cocoa-700 px-5 py-3 text-base font-semibold text-white hover:bg-cocoa-600 disabled:opacity-60';
const doneBtn = 'min-h-12 flex-1 rounded-xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white hover:bg-emerald-700';
const backBtn = 'min-h-12 rounded-xl border border-stone-200 px-5 py-3 text-sm font-medium text-stone-600 hover:border-cocoa-500 disabled:opacity-50';

type Form = { lengthCm: string; widthCm: string; heightCm: string; weightGrams: string };

/* ── Step 1: measure and weigh ─────────────────────────────────────────── */
function MeasureScreen({ form, setForm, errors }: {
  form: Form;
  setForm: (f: Form) => void;
  errors: PackageErrors;
}) {
  return (
    <div className="rounded-2xl border border-cocoa-100 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-cocoa-900">Measure and weigh the box</h2>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-base text-stone-700">
        <li>Close and tape the box first.</li>
        <li>Measure the <strong>outside</strong> of the box with the tape measure, in <strong>centimetres</strong>.</li>
        <li>Put the closed box on the scales and type the weight in <strong>grams</strong>.</li>
      </ol>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <NumberField label="Length" unit="cm" value={form.lengthCm} error={errors.lengthCm}
          onChange={(v) => setForm({ ...form, lengthCm: v })} />
        <NumberField label="Width" unit="cm" value={form.widthCm} error={errors.widthCm}
          onChange={(v) => setForm({ ...form, widthCm: v })} />
        <NumberField label="Height" unit="cm" value={form.heightCm} error={errors.heightCm}
          onChange={(v) => setForm({ ...form, heightCm: v })} />
      </div>
      <div className="mt-3">
        <NumberField label="Weight" unit="g" value={form.weightGrams} error={errors.weightGrams} integer
          onChange={(v) => setForm({ ...form, weightGrams: v })} />
        <p className="mt-1 text-xs text-stone-500">Example: 1.25 kg on the scales = 1250 g</p>
      </div>

      {(errors.lengthCm || errors.widthCm || errors.heightCm || errors.weightGrams || errors.size) && (
        <div role="alert" className="mt-4 space-y-1 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {[errors.lengthCm, errors.widthCm, errors.heightCm, errors.weightGrams, errors.size]
            .filter(Boolean).map((e) => <p key={e}>{e}</p>)}
        </div>
      )}
    </div>
  );
}

function NumberField({ label, unit, value, error, onChange, integer }: {
  label: string;
  unit: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  integer?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      <div className={`mt-1 flex items-center rounded-xl border bg-white px-3 ${error ? 'border-red-400 ring-1 ring-red-200' : 'border-stone-300'}`}>
        <input
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          pattern={integer ? '[0-9]*' : undefined}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(integer ? /[^0-9]/g : /[^0-9.]/g, ''))}
          className="min-h-12 w-full min-w-0 bg-transparent text-xl font-semibold text-cocoa-900 outline-none"
          aria-invalid={Boolean(error)}
        />
        <span className="pl-1 text-base text-stone-500">{unit}</span>
      </div>
    </label>
  );
}

/* ── Step 2: check, then buy ───────────────────────────────────────────── */
function ConfirmScreen({ order, form }: { order: OrderRow; form: Form }) {
  const a = order.delivery_address ?? {};
  return (
    <div className="rounded-2xl border border-cocoa-100 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-cocoa-900">Check, then buy the label</h2>
      <dl className="mt-4 space-y-3 text-base">
        <div>
          <dt className="text-sm text-stone-500">Sending to</dt>
          <dd className="font-medium text-cocoa-900 [overflow-wrap:anywhere]">
            {[a.name ?? order.customer_name, a.address1, a.address2, a.city, a.zip].filter(Boolean).join(', ')}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-stone-500">Service</dt>
          <dd className="font-medium text-cocoa-900">Royal Mail Tracked 24</dd>
        </div>
        <div>
          <dt className="text-sm text-stone-500">Box</dt>
          <dd className="font-medium text-cocoa-900">
            {form.lengthCm} × {form.widthCm} × {form.heightCm} cm · {form.weightGrams} g
          </dd>
        </div>
      </dl>
      <div className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
        Tapping <strong>Buy label</strong> pays for postage on the shop&apos;s Shopify account and emails the customer
        their tracking number. Only tap it <strong>once</strong>.
      </div>
    </div>
  );
}

function BuyingScreen({ slow }: { slow: boolean }) {
  return (
    <div className="rounded-2xl border border-cocoa-100 bg-white p-8 text-center shadow-sm" role="status" aria-live="polite">
      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-cocoa-100 border-t-cocoa-600" aria-hidden />
      <h2 className="mt-5 text-xl font-semibold text-cocoa-900">Buying the label…</h2>
      <p className="mt-2 text-base text-stone-600">This usually takes a few seconds. Please don&apos;t close this screen.</p>
      {slow && (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          This is taking longer than usual. Keep waiting — <strong>don&apos;t</strong> buy a label in Shopify, or you&apos;ll
          pay twice. If nothing happens after a few minutes, ask a manager.
        </p>
      )}
    </div>
  );
}

function FailedScreen({ message }: { message: string | null }) {
  return (
    <div role="alert" className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-red-800">The label wasn&apos;t bought</h2>
      <p className="mt-2 text-base text-stone-700">{message ?? 'Something went wrong.'}</p>
      <p className="mt-3 text-sm text-stone-500">Nothing was charged. Check the box details and try again.</p>
    </div>
  );
}

/* ── Step 3: print via the share sheet → Munbyn app ────────────────────── */
function PrintScreen({ order, label }: { order: OrderRow; label: ShippingLabelRow }) {
  // Download the PDF up front: the share sheet has to open straight from
  // the tap, and Safari won't allow it after waiting on a download.
  const [file, setFile] = useState<File | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [printTapped, setPrintTapped] = useState(false);
  const objectUrl = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/label/pdf`, { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Couldn't load the label (${res.status})`);
      }
      const blob = await res.blob();
      setFile(new File([blob], `label-${order.order_number.replace(/[^\w-]/g, '')}.pdf`, { type: 'application/pdf' }));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Couldn\'t load the label');
    }
  }, [order.id, order.order_number]);

  useEffect(() => {
    load();
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, [load]);

  async function print() {
    if (!file) return;
    setPrintTapped(true);
    const shareData = { files: [file], title: `Label ${order.order_number}` };
    if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
      } catch {
        /* closed the share menu — they can tap again */
      }
      return;
    }
    // No share sheet (e.g. a desktop browser): open the PDF to print it.
    if (!objectUrl.current) objectUrl.current = URL.createObjectURL(file);
    window.open(objectUrl.current, '_blank');
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
        <p className="text-base font-semibold">✓ Label bought</p>
        {label.tracking_number && (
          <p className="mt-0.5 text-sm">Tracking number: <span className="font-mono">{label.tracking_number}</span></p>
        )}
      </div>

      <div className="rounded-2xl border border-cocoa-100 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-cocoa-900">Print the label</h2>
        <ol className="mt-4 space-y-4 text-base text-stone-700">
          <Instruction n={1}>Check the <strong>Munbyn printer</strong> is switched on and has labels in it.</Instruction>
          <Instruction n={2}>
            Tap <strong>Print label</strong> below.
            <button
              onClick={print}
              disabled={!file}
              className="mt-3 block min-h-14 w-full rounded-xl bg-cocoa-700 px-5 py-3 text-lg font-semibold text-white hover:bg-cocoa-600 disabled:opacity-60"
            >
              {file ? '🖨  Print label' : loadError ? 'Label not loaded' : 'Getting the label…'}
            </button>
            {loadError && (
              <span className="mt-2 block text-sm text-red-700">
                {loadError}{' '}
                <button onClick={load} className="font-semibold underline">Try again</button>
              </span>
            )}
          </Instruction>
          <Instruction n={3}>A menu slides up. Tap the <strong>Munbyn</strong> app icon — it&apos;s the <strong>first app</strong> in the row.</Instruction>
          <Instruction n={4}>The Munbyn app opens with the label. Tap <strong>Print</strong>.</Instruction>
          <Instruction n={5}>Peel the label off and stick it <strong>flat on the top</strong> of the box.</Instruction>
          <Instruction n={6}>Come back to this app and tap <strong>Done</strong>.</Instruction>
        </ol>
      </div>

      {printTapped && (
        <details className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-700">
          <summary className="cursor-pointer font-semibold text-cocoa-900">It didn&apos;t print — what do I do?</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>Can&apos;t see Munbyn in the menu? Scroll the row of apps to the right, tap <strong>More</strong>, and pick Munbyn.</li>
            <li>Turn the printer off and on again, wait 10 seconds, then tap <strong>Print label</strong> again.</li>
            <li>Tapping <strong>Print label</strong> again is safe — it prints the same label and <strong>never buys a new one</strong>.</li>
            <li>Still stuck? Tap <strong>Done</strong> and ask a manager — you can print it later from this order.</li>
          </ul>
        </details>
      )}
    </div>
  );
}

function Instruction({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cocoa-700 text-sm font-bold text-white">{n}</span>
      <div className="min-w-0 flex-1 pt-1">{children}</div>
    </li>
  );
}
