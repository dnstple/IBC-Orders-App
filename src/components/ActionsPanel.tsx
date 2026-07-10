'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderRow, FulfillmentGroupRow, LineItemRow } from '@/types/db';
import { toast } from '@/components/Toaster';

/**
 * Order workflow (server-enforced; buttons are convenience):
 *   New            → Acknowledge Order            (internal)
 *   Acknowledged   → Mark ready for pickup        (Shopify mutation, pickup only)
 *   Ready          → Mark fulfilled               (confirmation, Shopify fulfilmentCreate)
 *   Fulfilled      → completed / disabled
 * Delivery orders: Acknowledge → Preparing → Packed → Courier booked →
 * Mark fulfilled. No fake "ready" state is invented for delivery.
 * Every action disables while running, blocks double-clicks, reports
 * failures, and re-syncs state from Shopify rather than assuming success.
 */
export function ActionsPanel({ order, groups, lineItems, role }: {
  order: OrderRow;
  groups: FulfillmentGroupRow[];
  lineItems: LineItemRow[];
  role: 'staff' | 'manager' | 'admin';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'fulfill' | 'courier' | null>(null);

  const isPickup = order.pickup_requested || order.fulfillment_method === 'pickup';
  const isDelivery = !isPickup && ['local_delivery', 'shipping'].includes(order.fulfillment_method);
  const status = order.internal_status;
  const terminal = ['fulfilled', 'cancelled', 'refunded'].includes(status);
  const hasOpenPickupGroup = useMemo(
    () => groups.some((g) => g.delivery_method_type === 'PICK_UP' && !['CLOSED', 'CANCELLED'].includes(g.status)),
    [groups]
  );

  async function call(label: string, url: string, body?: unknown, successMsg?: string) {
    if (busy) return false; // double-click guard
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = json.detail ? `${json.error}: ${json.detail}` : json.error ?? `Failed (${res.status})`;
        setError(message);
        toast(`${order.order_number}: ${message}`, 'error');
        return false;
      }
      if (successMsg) toast(successMsg, 'success');
      router.refresh(); // state comes back from the server, never assumed
      return true;
    } catch {
      setError('Network error — check your connection and try again.');
      toast('Network error — the order was not changed.', 'error');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const btn = 'w-full min-h-11 rounded-lg px-4 py-3 text-sm font-medium transition disabled:opacity-60';
  const primary = `${btn} bg-cocoa-700 text-white hover:bg-cocoa-600`;
  const secondary = `${btn} border border-stone-200 text-stone-700 hover:border-cocoa-500`;
  const success = `${btn} bg-emerald-600 text-white hover:bg-emerald-700`;

  if (terminal) {
    return (
      <aside className="rounded-xl border border-cocoa-100 bg-white p-5">
        <h2 className="font-semibold">Actions</h2>
        <div className="mt-3 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-500 ring-1 ring-stone-100">
          {status === 'fulfilled' ? '✓ Completed — this order is fulfilled.' : `This order is ${status}.`} No further actions.
        </div>
      </aside>
    );
  }

  return (
    <aside className="space-y-2 rounded-xl border border-cocoa-100 bg-white p-5 lg:sticky lg:top-4">
      <h2 className="font-semibold">Actions</h2>

      {/* Step 1: Acknowledge */}
      {status === 'new' && (
        <button className={primary} disabled={busy !== null}
          onClick={() => call('ack', `/api/orders/${order.id}/acknowledge`, undefined, `${order.order_number} acknowledged`)}>
          {busy === 'ack' ? 'Updating…' : 'Acknowledge Order'}
        </button>
      )}

      {/* Step 2 (pickup): Mark ready for pickup */}
      {isPickup && status !== 'new' && !['ready_for_pickup'].includes(status) && hasOpenPickupGroup && (
        <button className={success} disabled={busy !== null}
          onClick={() => call('ready', `/api/orders/${order.id}/ready-for-pickup`, undefined, `${order.order_number} marked ready — customer notified`)}>
          {busy === 'ready' ? 'Updating…' : 'Mark ready for pickup'}
        </button>
      )}
      {isPickup && status !== 'new' && status !== 'ready_for_pickup' && hasOpenPickupGroup && (
        <p className="text-xs text-stone-400">
          Updates Shopify and sends the customer Shopify&apos;s ready-for-pickup email.
        </p>
      )}

      {/* Step 3 (pickup): Mark fulfilled — confirmation required */}
      {isPickup && status === 'ready_for_pickup' && (
        <button className={primary} disabled={busy !== null} onClick={() => setModal('fulfill')}>
          Mark fulfilled…
        </button>
      )}

      {/* Delivery path */}
      {isDelivery && status === 'acknowledged' && (
        <button className={secondary} disabled={busy !== null}
          onClick={() => call('prep', `/api/orders/${order.id}/status`, { status: 'preparing' }, `${order.order_number} → preparing`)}>
          {busy === 'prep' ? 'Updating…' : 'Start preparing'}
        </button>
      )}
      {isDelivery && status === 'preparing' && (
        <button className={secondary} disabled={busy !== null}
          onClick={() => call('packed', `/api/orders/${order.id}/status`, { status: 'packed' }, `${order.order_number} → packed`)}>
          {busy === 'packed' ? 'Updating…' : 'Mark packed'}
        </button>
      )}
      {isDelivery && ['preparing', 'packed'].includes(status) && (
        <button className={secondary} disabled={busy !== null} onClick={() => setModal('courier')}>
          Courier booked…
        </button>
      )}
      {isDelivery && ['preparing', 'packed', 'courier_booked'].includes(status) && (
        <button className={primary} disabled={busy !== null} onClick={() => setModal('fulfill')}>
          Mark fulfilled…
        </button>
      )}

      {isPickup && !hasOpenPickupGroup && (
        <p className="pt-1 text-xs text-stone-400">
          Ready-for-pickup unavailable: Shopify has no open local-pickup fulfilment order.
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Action failed — the order was not changed</p>
          <p className="mt-0.5 break-words">{error}</p>
          <p className="mt-1 text-xs text-red-600">Details were saved to the admin error log. You can retry above.</p>
        </div>
      )}

      {modal === 'fulfill' && (
        <FulfillModal
          order={order} groups={groups} lineItems={lineItems}
          onClose={() => setModal(null)}
          onConfirm={async (payload) => {
            const ok = await call('fulfill', `/api/orders/${order.id}/fulfill`, payload, `${order.order_number} fulfilled in Shopify`);
            if (ok) setModal(null);
          }}
          busy={busy === 'fulfill'}
        />
      )}
      {modal === 'courier' && (
        <CourierModal
          onClose={() => setModal(null)}
          onConfirm={async (payload) => {
            const ok = await call('courier', `/api/orders/${order.id}/courier`, payload, 'Courier details saved');
            if (ok) setModal(null);
          }}
          busy={busy === 'courier'}
        />
      )}
    </aside>
  );
}

/* ── Fulfil confirmation: full/partial quantities, tracking, notify ────── */
function FulfillModal({ order, groups, lineItems, onClose, onConfirm, busy }: {
  order: OrderRow;
  groups: FulfillmentGroupRow[];
  lineItems: LineItemRow[];
  onClose: () => void;
  onConfirm: (payload: unknown) => void;
  busy: boolean;
}) {
  const openGroups = groups.filter((g) => !['CLOSED', 'CANCELLED'].includes(g.status));
  const isPickup = order.pickup_requested || order.fulfillment_method === 'pickup';
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const q: Record<string, number> = {};
    for (const g of openGroups) for (const l of g.line_items) q[l.ffoLineItemGid] = l.remainingQuantity;
    return q;
  });
  const [notify, setNotify] = useState(true);
  const [tracking, setTracking] = useState({ number: '', company: '', url: '' });

  const titleFor = (orderLineItemGid: string) =>
    lineItems.find((li) => li.shopify_line_item_gid === orderLineItemGid)?.title ?? 'Item';

  function submit() {
    const selections = openGroups
      .map((g) => ({
        fulfillmentOrderGid: g.shopify_fulfillment_order_gid,
        lines: g.line_items
          .filter((l) => (quantities[l.ffoLineItemGid] ?? 0) > 0)
          .map((l) => ({ ffoLineItemGid: l.ffoLineItemGid, quantity: quantities[l.ffoLineItemGid] })),
      }))
      .filter((s) => s.lines.length > 0);
    onConfirm({
      selections,
      notifyCustomer: notify,
      tracking: isPickup ? undefined : {
        number: tracking.number || undefined,
        company: tracking.company || undefined,
        url: tracking.url || undefined,
      },
    });
  }

  const anySelected = Object.values(quantities).some((v) => v > 0);

  return (
    <Modal onClose={onClose} title="Mark fulfilled?">
      <p className="text-sm text-stone-600">
        This marks the selected items <strong>fulfilled in Shopify</strong> and can&apos;t easily be undone.{' '}
        {isPickup ? 'Confirm the customer has collected the order?' : 'Confirm the parcel has been handed to the courier?'}
      </p>
      <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
        {openGroups.map((g) =>
          g.line_items.map((l) => (
            <div key={l.ffoLineItemGid} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{titleFor(l.orderLineItemGid)}</span>
              <input
                type="number" min={0} max={l.remainingQuantity}
                aria-label={`Quantity to fulfil for ${titleFor(l.orderLineItemGid)}`}
                value={quantities[l.ffoLineItemGid] ?? 0}
                onChange={(e) => setQuantities({
                  ...quantities,
                  [l.ffoLineItemGid]: Math.min(Math.max(0, Number(e.target.value)), l.remainingQuantity),
                })}
                className="w-16 rounded-lg border border-stone-300 px-2 py-1.5 text-right"
              />
              <span className="w-14 text-xs text-stone-400">of {l.remainingQuantity}</span>
            </div>
          ))
        )}
      </div>
      {!isPickup && (
        <div className="mt-3 grid gap-2">
          <input placeholder="Tracking number (optional)" value={tracking.number}
            onChange={(e) => setTracking({ ...tracking, number: e.target.value })}
            className="min-h-11 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
          <input placeholder="Tracking company (optional)" value={tracking.company}
            onChange={(e) => setTracking({ ...tracking, company: e.target.value })}
            className="min-h-11 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
          <input placeholder="Tracking URL (optional, https://…)" value={tracking.url}
            onChange={(e) => setTracking({ ...tracking, url: e.target.value })}
            className="min-h-11 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        </div>
      )}
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        Send Shopify {isPickup ? 'confirmation' : 'shipping confirmation'} email to customer
      </label>
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="min-h-11 flex-1 rounded-lg border border-stone-200 py-2.5 text-sm">Cancel</button>
        <button onClick={submit} disabled={busy || !anySelected}
          className="min-h-11 flex-1 rounded-lg bg-cocoa-700 py-2.5 text-sm font-medium text-white disabled:opacity-60">
          {busy ? 'Updating…' : 'Confirm & mark fulfilled'}
        </button>
      </div>
    </Modal>
  );
}

/* ── Courier booking ───────────────────────────────────────────────────── */
function CourierModal({ onClose, onConfirm, busy }: {
  onClose: () => void;
  onConfirm: (payload: unknown) => void;
  busy: boolean;
}) {
  const [form, setForm] = useState({ courierName: '', bookingRef: '', trackingUrl: '' });
  return (
    <Modal onClose={onClose} title="Courier booked">
      <div className="grid gap-2">
        <input placeholder="Courier name *" value={form.courierName}
          onChange={(e) => setForm({ ...form, courierName: e.target.value })}
          className="min-h-11 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        <input placeholder="Booking reference" value={form.bookingRef}
          onChange={(e) => setForm({ ...form, bookingRef: e.target.value })}
          className="min-h-11 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        <input placeholder="Tracking URL (https://…)" value={form.trackingUrl}
          onChange={(e) => setForm({ ...form, trackingUrl: e.target.value })}
          className="min-h-11 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="min-h-11 flex-1 rounded-lg border border-stone-200 py-2.5 text-sm">Cancel</button>
        <button onClick={() => onConfirm(form)} disabled={busy || !form.courierName.trim()}
          className="min-h-11 flex-1 rounded-lg bg-cocoa-700 py-2.5 text-sm font-medium text-white disabled:opacity-60">
          {busy ? 'Updating…' : 'Save courier details'}
        </button>
      </div>
    </Modal>
  );
}

/* ── Accessible modal: focus trap, Escape, focus return, viewport-safe ── */
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialog) {
        const focusables = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
          .filter((el) => !el.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
      >
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}
