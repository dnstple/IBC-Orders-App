'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OrderRow, ShippingLabelRow } from '@/types/db';
import { PrintSlipButton } from '@/components/PrintSlipButton';
import { validatePackage, buildDemoLabelPdf, type PackageErrors } from '@/lib/shipping-label';
import { isDemoOrder } from '@/lib/demo';
import {
  detectPlatform,
  printPdf,
  printerMarkedReady,
  setPrinterReady,
  MUNBYN_DRIVER_URL,
  type Platform,
} from '@/lib/print-pdf';

/**
 * Royal Mail Tracked 24 label, start to finish, without leaving the app:
 *   1. Slip     — print the "YOUR ORDER" slip; it goes INSIDE the box
 *                 before the box is closed, weighed and measured
 *   2. Measure  — staff type the box's size and weight for THIS parcel
 *   3. Buy      — the app buys the Shopify Shipping label (any device)
 *   4. Print    — on a Windows or Mac computer, the browser's print window
 *                 sends it to the USB Munbyn (the Munbyn iOS app can't take
 *                 files from other apps, so the iPad hands printing over)
 * Written for someone doing it for the first time: every screen says
 * exactly what to do next. Buying is guarded server-side — one live label
 * per order — so re-opening this screen only ever re-prints.
 */
type Step = 'slip' | 'measure' | 'confirm' | 'buying' | 'failed' | 'print';

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
      : initialLabel ? 'measure'
      : 'slip'
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

  const stepNumber = step === 'slip' ? 1 : step === 'measure' ? 2 : step === 'print' ? 4 : 3;
  const practice = isDemoOrder(order);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-cream" role="dialog" aria-modal="true" aria-label={`Shipping label for ${order.order_number}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cocoa-100 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-cocoa-900">Shipping label · {order.order_number}</div>
          <div className="text-xs text-stone-500">Step {stepNumber} of 4 · Royal Mail Tracked 24</div>
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
        <div className="h-1.5 bg-cocoa-600 transition-all" style={{ width: `${Math.round((stepNumber / 4) * 100)}%` }} />
      </div>
      {practice && (
        <div role="status" className="bg-sky-600 px-4 py-2 text-center text-sm font-semibold text-white">
          PRACTICE ORDER — nothing will be bought. The label will say &ldquo;DEMO&rdquo;.
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-xl">
          {step === 'slip' && <SlipScreen order={order} />}
          {step === 'measure' && <MeasureScreen form={form} setForm={setForm} errors={errors} />}
          {step === 'confirm' && <ConfirmScreen order={order} form={form} practice={practice} />}
          {step === 'buying' && <BuyingScreen slow={slow} />}
          {step === 'failed' && <FailedScreen message={failure} />}
          {step === 'print' && label && <PrintScreen order={order} label={label} />}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-cocoa-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-xl gap-2">
          {step === 'slip' && (
            <button onClick={() => setStep('measure')} className={primaryBtn}>Next — slip is in the box →</button>
          )}
          {step === 'measure' && (
            <button onClick={next} className={primaryBtn}>Next — check details →</button>
          )}
          {step === 'confirm' && (
            <>
              <button onClick={() => setStep('measure')} disabled={submitting} className={backBtn}>← Change</button>
              <button onClick={buy} disabled={submitting} className={primaryBtn}>
                {submitting ? 'Buying…' : practice ? 'Buy label (practice — free)' : 'Buy label'}
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

/* ── Step 1: the order slip goes in the box before it is closed ───────── */
function SlipScreen({ order }: { order: OrderRow }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => setPlatform(detectPlatform()), []);

  return (
    <div className="rounded-2xl border-2 border-cocoa-300 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold text-cocoa-900">Print the order slip</h2>
      <p className="mt-1 text-base text-stone-700">
        The slip lists what&apos;s in the box and the allergens. It goes <strong>inside the box</strong>,
        on top of the items — not on the outside.
      </p>
      {platform === 'tablet' ? (
        <p className="mt-4 rounded-xl bg-sky-50 p-4 text-base text-sky-900 ring-1 ring-sky-200">
          Printing only works from the <strong>computer next to the Munbyn</strong>. Open this order
          ({order.order_number}) there and click <strong>Print order slip</strong>, put the slip in the box,
          then tap <strong>Next</strong> here.
        </p>
      ) : (
        <div className="mt-4">
          <PrintSlipButton
            orderId={order.id}
            className="block min-h-16 w-full rounded-xl bg-cocoa-700 px-5 py-3 text-xl font-semibold text-white hover:bg-cocoa-600 disabled:opacity-60"
          />
        </div>
      )}
      <ol className="mt-4 space-y-3 text-base text-stone-700">
        <Instruction n={1}>In the print window, choose the <strong>Munbyn</strong> and click <strong>Print</strong>.</Instruction>
        <Instruction n={2}>Put the slip <strong>inside the box</strong>, on top of the items.</Instruction>
        <Instruction n={3}>Close and tape the box, then click <strong>Next</strong> to weigh and measure it.</Instruction>
      </ol>
    </div>
  );
}

/* ── Step 2: measure and weigh ─────────────────────────────────────────── */
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

/* ── Step 3: check, then buy ───────────────────────────────────────────── */
function ConfirmScreen({ order, form, practice }: { order: OrderRow; form: Form; practice: boolean }) {
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
      {practice ? (
        <div className="mt-5 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-sky-200">
          Practice order: tapping <strong>Buy label</strong> makes a free placeholder label. Nothing is paid for and
          the customer isn&apos;t emailed.
        </div>
      ) : (
        <div className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Tapping <strong>Buy label</strong> pays for postage on the shop&apos;s Shopify account and emails the customer
          their tracking number. Only tap it <strong>once</strong>.
        </div>
      )}
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

/* ── Step 4: print from the computer to the USB Munbyn ─────────────────── */
function PrintScreen({ order, label }: { order: OrderRow; label: ShippingLabelRow }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [file, setFile] = useState<Blob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [printClicked, setPrintClicked] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [firstTime, setFirstTime] = useState(false);

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);
    setFirstTime(p !== 'tablet' && !printerMarkedReady());
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/label/pdf`, { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Couldn't load the label (${res.status})`);
      }
      setFile(await res.blob());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Couldn\'t load the label');
    }
  }, [order.id]);

  useEffect(() => {
    load();
  }, [load]);

  function print() {
    if (!file) return;
    setPrintClicked(true);
    printPdf(file);
  }

  const bought = (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
      <p className="text-base font-semibold">✓ Label bought</p>
      {label.tracking_number && (
        <p className="mt-0.5 text-sm">Tracking number: <span className="font-mono">{label.tracking_number}</span></p>
      )}
    </div>
  );

  if (platform === 'tablet') {
    return (
      <div className="space-y-4">
        {bought}
        <div className="rounded-2xl border border-cocoa-100 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-cocoa-900">Print it on the computer</h2>
          <ol className="mt-4 space-y-4 text-base text-stone-700">
            <Instruction n={1}>Tap <strong>Done</strong> below. The label is saved — you won&apos;t be charged again.</Instruction>
            <Instruction n={2}>On the <strong>computer next to the Munbyn printer</strong>, open the orders app and this order ({order.order_number}).</Instruction>
            <Instruction n={3}>Click <strong>Print label again</strong> and follow the steps there.</Instruction>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* The one thing to do, first — no scrolling to find it */}
      <div className="rounded-2xl border-2 border-cocoa-300 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-base font-semibold text-emerald-700">✓ Label bought</p>
          {label.tracking_number && (
            <p className="text-sm text-stone-500">Tracking <span className="font-mono">{label.tracking_number}</span></p>
          )}
        </div>
        <button
          onClick={print}
          disabled={!file}
          className="mt-3 block min-h-16 w-full rounded-xl bg-cocoa-700 px-5 py-3 text-xl font-semibold text-white hover:bg-cocoa-600 disabled:opacity-60"
        >
          {file ? '🖨  Print label' : loadError ? 'Label not loaded' : 'Getting the label…'}
        </button>
        {loadError && (
          <p className="mt-2 text-sm text-red-700">
            {loadError}{' '}
            <button onClick={load} className="font-semibold underline">Try again</button>
          </p>
        )}
        <p className="mt-3 text-sm text-stone-600">
          In the print window, check the printer is the <strong>Munbyn</strong> (e.g. &ldquo;IBC Label Printer 2&rdquo;),
          click <strong>Print</strong>, stick the label flat on top of the box, then click <strong>Done</strong>.
        </p>
        <button
          onClick={() => setSetupOpen(true)}
          className={`mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold ${
            firstTime
              ? 'bg-sky-100 text-sky-900 ring-2 ring-sky-300 hover:bg-sky-200'
              : 'text-sky-800 underline hover:bg-sky-50'
          }`}
        >
          First time printing on this computer? Set it up →
        </button>
      </div>

      {setupOpen && platform && (
        <SetupPopout onClose={() => setSetupOpen(false)}>
          <PrinterSetup platform={platform} onReady={() => { setSetupOpen(false); setFirstTime(false); }} />
        </SetupPopout>
      )}

      {printClicked && (
        <details className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-700">
          <summary className="cursor-pointer font-semibold text-cocoa-900">It didn&apos;t print properly — what do I do?</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li><strong>Label tiny, cut off or on two labels?</strong> In the print window open <strong>More settings</strong>, set <strong>Paper size</strong> to <strong>4 x 6</strong> (or 100 x 150 mm), <strong>Margins</strong> to <strong>None</strong>, then Print.</li>
            <li><strong>No Munbyn in the printer list?</strong> <button onClick={() => setSetupOpen(true)} className="font-semibold underline">Set up this computer</button>.</li>
            <li><strong>No print window appeared?</strong> Use Google Chrome, then click Print label again.</li>
            <li>Clicking <strong>Print label</strong> again is safe — it prints the same label and <strong>never buys a new one</strong>.</li>
            <li>Still stuck? Click <strong>Done</strong> and ask a manager — the label can be printed later from this order.</li>
          </ul>
        </details>
      )}
    </div>
  );
}

/** Popout over the print screen, closable, starting at the top. */
function SetupPopout({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Set up printing on this computer"
        className="relative w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close setup"
          className="absolute right-3 top-3 z-10 min-h-10 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-sm text-sky-900 hover:bg-sky-50">
          ✕ Close
        </button>
        {children}
      </div>
    </div>
  );
}

/* ── First time on this computer: driver + test print ──────────────────── */
function PrinterSetup({ platform, onReady }: { platform: Platform; onReady: () => void }) {
  const [tested, setTested] = useState(false);
  const os = platform === 'mac' ? 'Mac' : 'Windows';

  function testPrint() {
    setTested(true);
    printPdf(new Blob([buildDemoLabelPdf([
      'TEST LABEL - NOT POSTAGE',
      'Italian Bear Chocolate',
      'If this fills the label and',
      'reads the right way up,',
      'this computer is ready.',
    ]).buffer as ArrayBuffer], { type: 'application/pdf' }));
  }

  return (
    <div className="rounded-2xl border-2 border-sky-300 bg-sky-50 p-6 text-sky-950">
      <h2 className="pr-24 text-lg font-semibold">First time printing on this computer?</h2>
      <p className="mt-1 text-sm">Do this once. If labels already print from this computer, skip to step 3.</p>
      <ol className="mt-4 space-y-4 text-base">
        <Instruction n={1}>Plug the Munbyn into this computer with its <strong>USB cable</strong> and switch it on.</Instruction>
        <Instruction n={2}>
          Install the Munbyn printer driver for {os}:
          <a
            href={MUNBYN_DRIVER_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block min-h-12 w-full rounded-xl border border-sky-400 bg-white px-5 py-3 text-center font-semibold text-sky-900 hover:bg-sky-100"
          >
            Download the Munbyn driver ↗
          </a>
          <span className="mt-2 block text-sm">
            On Munbyn&apos;s page pick the <strong>{os}</strong> driver for the <strong>130B</strong>, open the downloaded
            file and follow its steps.{platform === 'mac'
              ? ' Then open System Settings → Printers & Scanners → Add Printer and choose the Munbyn.'
              : ' Leave the printer plugged in while it installs.'}
          </span>
        </Instruction>
        <Instruction n={3}>
          Print a test label:
          <button
            onClick={testPrint}
            className="mt-2 block min-h-12 w-full rounded-xl bg-sky-700 px-5 py-3 font-semibold text-white hover:bg-sky-800"
          >
            🖨  Print a test label
          </button>
          <span className="mt-2 block text-sm">
            In the print window choose the <strong>Munbyn</strong> as the printer, then Print. If it&apos;s tiny or cut off,
            open <strong>More settings</strong> and set Paper size <strong>4 x 6</strong> and Margins <strong>None</strong>.
          </span>
        </Instruction>
      </ol>
      {tested && (
        <button
          onClick={() => { setPrinterReady(true); onReady(); }}
          className="mt-5 block min-h-12 w-full rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-700"
        >
          ✓ The test label printed properly
        </button>
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
