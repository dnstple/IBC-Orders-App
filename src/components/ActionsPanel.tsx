'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderRow, FulfillmentGroupRow, LineItemRow } from '@/types/db';

/**
 * Order actions. Buttons are role/state aware, but every rule is ALSO
 * enforced server-side — this component is convenience, not security.
 * Fulfilment success is only shown after the API confirms Shopify succeeded.
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

  const isPickup = order.fulfillment_method === 'pickup';
  const isDelivery = ['local_delivery', 'shipping'].includes(order.fulfillment_method);
  const terminal = ['fulfilled', 'cancelled', 'refunded'].includes(order.internal_status);
  const hasOpenPickupGroup = useMemo(
    () => groups.some((g) => g.delivery_method_type === 'PICK_UP' && !['CLOSED', 'CANCELLED'].includes(g.status)),
    [groups]
  );

  async function call(label: string, url: string, body?: unknown) {
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
        setError(json.detail ? `${json.error}: ${json.detail}` : json.error ?? `Failed (${res.status})`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('Network error — check your connection and try again.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const btn = 'w-full rounded-lg px-4 py-3 text-sm font-medium transition disabled:opacity-50';
  const primary = `${btn} bg-cocoa-600 text-white hover:bg-cocoa-700`;
  const secondary = `${btn} border border-stone-200 text-stone-700 hover:border-cocoa-500`;
  const success = `${btn} bg-emerald-600 text-white hover:bg-emerald-700`;

  if (terminal) {
    return (
      <aside className="rounded-xl border border-cocoa-100 bg-white p-5">
        <h2 className="font-semibold">Actions</h2>
        <p className="mt-2 text-sm text-stone-500">
          This order is {order.internal_status}. No further actions available.
        </p>
      </aside>
    );
  }

  return (
    <aside className="space-y-2 rounded-xl border border-cocoa-100 bg-white p-5 lg:sticky lg:top-4">
      <h2 className="font-semibold">Actions</h2>

      {order.internal_status === 'new' && (
        <button className={primary} disabled={busy !== null}
          onClick={() => call('ack', `/api/orders/${order.id}/acknowledge`)}>
          {busy === 'ack' ? 'Acknowledging…' : 'Acknowledge'}
        </button>
      )}

      {['new', 'acknowledged'].includes(order.internal_status) && order.fulfillment_method !== 'unknown' && (
        <button className={secondary} disabled={busy !== null}
          onClick={() => call('prep', `/api/orders/${order.id}/status`, { status: 'preparing' })}>
          {busy === 'prep' ? 'Saving…' : 'Start preparing'}
        </button>
      )}

      {/* Pickup path */}
      {isPickup && ['acknowledged', 'preparing'].includes(order.internal_status) && hasOpenPickupGroup && (
        <button className={success} disabled={busy !== null}
          onClick={() => call('ready', `/api/orders/${order.id}/ready-for-pickup`)}>
          {busy === 'ready' ? 'Notifying via Shopify…' : 'Ready for pickup (notifies customer)'}
        </button>
      )}
      {isPickup && role !== 'staff' && ['preparing', 'ready_for_pickup', 'acknowledged'].includes(order.internal_status) && (
        <button className={primary} disabled={busy !== null} onClick={() => setModal('fulfill')}>
          Collected & fulfil…
        </button>
      )}

      {/* Delivery path */}
      {isDelivery && order.internal_status === 'preparing' && (
        <button className={secondary} disabled={busy !== null}
          onClick={() => call('packed', `/api/orders/${order.id}/status`, { status: 'packed' })}>
          {busy === 'packed' ? 'Saving…' : 'Mark packed'}
        </button>
      )}
      {isDelivery && ['preparing', 'packed'].includes(order.internal_status) && (
        <button className={secondary} disabled={busy !== null} onClick={() => setModal('courier')}>
          Courier booked…
        </button>
      )}
      {isDelivery && role !== 'staff' && ['packed', 'courier_booked', 'preparing'].includes(order.internal_status) && (
        <button className={primary} disabled={busy !== null} onClick={() => setModal('fulfill')}>
          Handed to courier & fulfil…
        </button>
      )}

      {role === 'staff' && (isPickup || isDelivery) && (
        <p className="pt-1 text-xs text-stone-400">Fulfilling orders requires a manager.</p>
      )}
      {isPickup && !hasOpenPickupGroup && !terminal && (
        <p className="pt-1 text-xs text-stone-400">
          Ready-for-pickup unavailable: Shopify has no open local-pickup fulfilment order.
        </p>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Action failed</p>
          <p className="mt-0.5">{error}</p>
          <p className="mt-1 text-xs text-red-600">Details were saved to the admin error log.</p>
        </div>
      )}

      {modal === 'fulfill' && (
        <FulfillModal
          order={order} groups={groups} lineItems={lineItems}
          onClose={() => setModal(null)}
          onConfirm={async (payload) => {
            const ok = await call('fulfill', `/api/orders/${order.id}/fulfill`, payload);
            if (ok) setModal(null);
          }}
          busy={busy === 'fulfill'}
        />
      )}
      {modal === 'courier' && (
        <CourierModal
          onClose={() => setModal(null)}
          onConfirm={async (payload) => {
            const ok = await call('courier', `/api/orders/${order.id}/courier`, payload);
            if (ok) setModal(null);
          }}
          busy={busy === 'courier'}
        />
      )}
    </aside>
  );
}

/* ── Fulfil modal: full/partial quantities, tracking, notify toggle ────── */
function FulfillModal({ order, groups, lineItems, onClose, onConfirm, busy }: {
  order: OrderRow;
  groups: FulfillmentGroupRow[];
  lineItems: LineItemRow[];
  onClose: () => void;
  onConfirm: (payload: unknown) => void;
  busy: boolean;
}) {
  const openGroups = groups.filter((g) => !['CLOSED', 'CANCELLED'].includes(g.status));
  const isPickup = order.fulfillment_method === 'pickup';
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
    <Modal onClose={onClose} title={isPickup ? 'Confirm collection' : 'Confirm handover to courier'}>
      <p className="text-sm text-stone-600">
        This will mark the selected items <strong>fulfilled in Shopify</strong>.{' '}
        {isPickup ? 'Confirm collection?' : 'Confirm the parcel has been handed to the courier?'}
      </p>
      <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
        {openGroups.map((g) =>
          g.line_items.map((l) => (
            <div key={l.ffoLineItemGid} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{titleFor(l.orderLineItemGid)}</span>
              <input
                type="number" min={0} max={l.remainingQuantity}
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
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm" />
          <input placeholder="Tracking company (optional)" value={tracking.company}
            onChange={(e) => setTracking({ ...tracking, company: e.target.value })}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm" />
          <input placeholder="Tracking URL (optional, https://…)" value={tracking.url}
            onChange={(e) => setTracking({ ...tracking, url: e.target.value })}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        </div>
      )}
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        Send Shopify {isPickup ? 'confirmation' : 'shipping confirmation'} email to customer
      </label>
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-lg border border-stone-200 py-2.5 text-sm">Cancel</button>
        <button onClick={submit} disabled={busy || !anySelected}
          className="flex-1 rounded-lg bg-cocoa-600 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Fulfilling in Shopify…' : 'Confirm & fulfil'}
        </button>
      </div>
    </Modal>
  );
}

/* ── Courier booking modal ─────────────────────────────────────────────── */
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
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        <input placeholder="Booking reference" value={form.bookingRef}
          onChange={(e) => setForm({ ...form, bookingRef: e.target.value })}
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        <input placeholder="Tracking URL (https://…)" value={form.trackingUrl}
          onChange={(e) => setForm({ ...form, trackingUrl: e.target.value })}
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm" />
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-lg border border-stone-200 py-2.5 text-sm">Cancel</button>
        <button onClick={() => onConfirm(form)} disabled={busy || !form.courierName.trim()}
          className="flex-1 rounded-lg bg-cocoa-600 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Save courier details'}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}
