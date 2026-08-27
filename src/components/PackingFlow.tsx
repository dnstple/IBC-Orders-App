'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import type { OrderRow, LineItemRow } from '@/types/db';
import { cleanLineItemProperties, asSelectionList } from '@/lib/line-item-props';

/**
 * Guided packing flow for DELIVERY orders — one product per screen, staff
 * physically confirm each item is in the box before moving on, then a
 * final review before the order is marked packed and Shopify is opened
 * for label printing. Exitable at any time (X or Escape) without losing
 * order state.
 */
export function PackingFlow({ order, lineItems, busy, onClose, onComplete }: {
  order: OrderRow;
  lineItems: LineItemRow[];
  busy: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const items = lineItems.filter((li) => li.quantity - li.refunded_quantity > 0);
  const [step, setStep] = useState(0); // 0..items.length-1 = items, items.length = review
  const atReview = step >= items.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-cream" role="dialog" aria-modal="true" aria-label={`Packing ${order.order_number}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cocoa-100 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-cocoa-900">Packing {order.order_number}</div>
          <div className="text-xs text-stone-500">
            {atReview ? 'Final check' : `Item ${step + 1} of ${items.length}`}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Exit packing flow"
          className="min-h-10 rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:border-cocoa-500"
        >
          ✕ Exit
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full bg-cocoa-100" aria-hidden>
        <div
          className="h-1.5 bg-cocoa-600 transition-all"
          style={{ width: `${Math.round(((step + 1) / (items.length + 1)) * 100)}%` }}
        />
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {!atReview ? (
          <ItemScreen item={items[step]} />
        ) : (
          <ReviewScreen order={order} items={items} />
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-cocoa-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-xl gap-2">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              disabled={busy}
              className="min-h-12 rounded-xl border border-stone-200 px-5 py-3 text-sm font-medium text-stone-600 hover:border-cocoa-500 disabled:opacity-50"
            >
              ← Back
            </button>
          )}
          {!atReview ? (
            <button
              onClick={() => setStep(step + 1)}
              className="min-h-12 flex-1 rounded-xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white hover:bg-emerald-700"
            >
              ✓ In the box — next
            </button>
          ) : (
            <button
              onClick={onComplete}
              disabled={busy}
              className="min-h-12 flex-1 rounded-xl bg-cocoa-700 px-5 py-3 text-base font-semibold text-white hover:bg-cocoa-600 disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Confirm packed & print label ↗'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── One product, unmissably clear ─────────────────────────────────────── */
function ItemScreen({ item }: { item: LineItemRow }) {
  const props = cleanLineItemProperties(item.properties);
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl border border-cocoa-100 bg-white p-6 text-center shadow-sm">
        {item.image_url ? (
          <Image
            src={item.image_url} alt={item.title} width={160} height={160}
            className="mx-auto h-40 w-40 rounded-xl border border-stone-100 object-cover"
          />
        ) : (
          <div className="mx-auto h-40 w-40 rounded-xl bg-cocoa-50" />
        )}

        <div className="mt-5 inline-flex items-center rounded-xl bg-cocoa-700 px-5 py-2 text-4xl font-bold text-white">
          ×{item.quantity}
        </div>
        <h2 className="mt-3 break-words text-2xl font-semibold text-cocoa-900">{item.title}</h2>
        {item.variant_title && item.variant_title !== 'Default Title' && (
          <p className="mt-1 text-lg text-stone-600">{item.variant_title}</p>
        )}

        {props.length > 0 && (
          <div className="mt-4 space-y-2 rounded-xl bg-amber-50 p-4 text-left text-sm text-amber-900 ring-1 ring-amber-100">
            {props.map((p) => {
              const list = asSelectionList(p.value);
              return (
                <div key={p.name} className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-semibold">{p.name}:</span>
                  {list ? (
                    <ul className="mt-1 space-y-1 pl-1">
                      {list.map((entry, i) => (
                        <li key={i} className="list-none text-base font-medium">{entry}</li>
                      ))}
                    </ul>
                  ) : (
                    <span> {p.value}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-sm text-stone-500">
        Put <strong>{item.quantity}</strong> in the box, then confirm.
      </p>
    </div>
  );
}

/* ── Final review before packing is confirmed ──────────────────────────── */
function ReviewScreen({ order, items }: { order: OrderRow; items: LineItemRow[] }) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl border border-cocoa-100 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-cocoa-900">Everything in the box?</h2>
        <ul className="mt-4 divide-y divide-stone-100">
          {items.map((li) => (
            <li key={li.id} className="flex items-center gap-3 py-2.5">
              <span className="text-emerald-600" aria-hidden>✓</span>
              <span className="shrink-0 rounded-md bg-cocoa-700 px-2 py-0.5 text-sm font-bold text-white">×{li.quantity}</span>
              <span className="min-w-0 flex-1 break-words text-sm font-medium">
                {li.title}
                {li.variant_title && li.variant_title !== 'Default Title' && (
                  <span className="font-normal text-stone-500"> — {li.variant_title}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {order.note?.trim() && (
          <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200 [overflow-wrap:anywhere]">
            <span className="font-semibold">Customer note:</span> {order.note}
          </div>
        )}
        <p className="mt-4 text-sm text-stone-500">
          Confirming marks the order <strong>Packed</strong> and opens it in Shopify to buy &amp; print the shipping label.
        </p>
      </div>
    </div>
  );
}
