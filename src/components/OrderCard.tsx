'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderRow } from '@/types/db';
import { toOperationalOrder, statusBadgeClass, dueState } from '@/lib/operational';
import { formatLondonDate } from '@/lib/dates';
import { toast } from '@/components/Toaster';

interface Props {
  order: OrderRow;
  itemCount?: number;
  /** Hide the date line when the surrounding group already shows the day. */
  showDate?: boolean;
  onActioned?: () => void;
}

/**
 * Order tile. Resilient by design: malformed orders render with fallbacks
 * ("Guest customer", "Pickup time unavailable", "Order total unavailable")
 * instead of breaking the list. No fixed widths — safe in any grid column.
 */
export function OrderCard({ order, itemCount, showDate = true, onActioned }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Keep urgency badges live without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  let op: ReturnType<typeof toOperationalOrder>;
  try {
    op = toOperationalOrder(order);
  } catch (err) {
    console.error('[order card] failed to normalise order', order.id, err);
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Order {order.order_number ?? ''} couldn&apos;t be displayed.{' '}
        <a href={order.shopify_admin_url} target="_blank" rel="noreferrer" className="font-medium underline">
          Open in Shopify ↗
        </a>
      </div>
    );
  }

  const isPickup = op.orderType === 'pickup';
  const unread = order.internal_status === 'new' && !op.isCancelled;
  const due = dueState(order, now);

  const money = order.total != null ? `£${order.total.toFixed(2)}` : 'Order total unavailable';
  const dateLabel = op.operationalDate ? formatLondonDate(new Date(`${op.operationalDate}T12:00:00Z`)) : 'Date unavailable';

  async function acknowledge(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return; // no duplicate requests
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/acknowledge`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast(`Couldn't acknowledge ${op.orderNumber}: ${json.error ?? res.status}. Tap to retry.`, 'error');
        return;
      }
      toast(`${op.orderNumber} acknowledged`, 'success');
      onActioned?.();
    } catch {
      toast(`Network problem acknowledging ${op.orderNumber} — try again.`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const open = () => router.push(`/orders/${order.id}`);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open order ${op.orderNumber}`}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
      className={`relative block w-full min-w-0 max-w-full cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition hover:border-cocoa-500 ${
        op.isCancelled
          ? 'border-red-200 opacity-75'
          : unread
            ? 'border-amber-300 ring-1 ring-amber-200'
            : 'border-cocoa-100'
      }`}
    >
      {unread && (
        <span className="absolute -left-1 -top-1 h-3 w-3 rounded-full bg-amber-500 ring-2 ring-white" role="status" aria-label="New order" />
      )}

      {/* Row 1: number · type · urgency · status */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-cocoa-900">{op.orderNumber}</span>
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${
            isPickup ? 'bg-cocoa-50 text-cocoa-700 ring-cocoa-100' : 'bg-sky-50 text-sky-800 ring-sky-200'
          }`}
        >
          {isPickup ? 'Pickup' : 'Delivery'}
        </span>
        {due === 'due_soon' && (
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-300">
            Due soon
          </span>
        )}
        {due === 'due_now' && (
          <span className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
            Pickup due now
          </span>
        )}
        <span className={`ml-auto max-w-full truncate rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${statusBadgeClass(op.nativeOrderStatus)}`}>
          {op.nativeOrderStatus}
        </span>
      </div>

      {/* Row 2: date · time */}
      <div className="mt-2 min-w-0 break-words text-sm">
        {showDate && <span className="text-stone-600">{dateLabel} · </span>}
        {isPickup ? (
          op.operationalTime ? (
            <span className="font-semibold text-cocoa-900">{op.operationalTime}</span>
          ) : (
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600 ring-1 ring-stone-200">
              Pickup time unavailable
            </span>
          )
        ) : (
          <span className="text-stone-600">{op.operationalTime ?? 'Order time unavailable'}</span>
        )}
      </div>

      {/* Row 3: customer · items · total */}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="min-w-0 truncate font-medium">{order.customer_name?.trim() || 'Guest customer'}</span>
        <span className="text-stone-500">
          {itemCount != null && `${itemCount} item${itemCount === 1 ? '' : 's'} · `}
          {money}
          {order.financial_status && order.financial_status !== 'PAID' && (
            <span className="ml-1.5 text-red-600">{order.financial_status.replaceAll('_', ' ').toLowerCase()}</span>
          )}
        </span>
      </div>

      {/* Workflow: acknowledge directly from the tile */}
      {unread && (
        <button
          onClick={acknowledge}
          disabled={busy}
          className="mt-3 min-h-11 w-full rounded-lg bg-cocoa-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cocoa-600 disabled:opacity-60"
        >
          {busy ? 'Updating…' : 'Acknowledge Order'}
        </button>
      )}

      {op.isCancelled && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
          Cancelled — manage refunds in Shopify
        </div>
      )}
    </div>
  );
}
