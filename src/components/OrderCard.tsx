'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { OrderRow } from '@/types/db';
import { StatusBadge } from '@/components/StatusBadge';
import { Chips } from '@/components/Chips';
import { Countdown } from '@/components/Countdown';
import { orderChips, isOverdue } from '@/lib/orders-view';
import { formatLondonFull } from '@/lib/dates';

interface Props {
  order: OrderRow;
  itemSummary?: string;   // "2× Praline Box, 1× Dark Bar"
  itemCount?: number;
  assigneeName?: string | null;
  onActioned?: () => void;
}

export function OrderCard({ order, itemSummary, itemCount, assigneeName, onActioned }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overdue = isOverdue(order);
  const chips = orderChips(order);

  async function acknowledge(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/orders/${order.id}/acknowledge`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? 'Failed to acknowledge');
      return;
    }
    onActioned?.();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/orders/${order.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && router.push(`/orders/${order.id}`)}
      className={`block cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition hover:border-cocoa-500 ${
        overdue ? 'border-red-300 ring-1 ring-red-200' : order.internal_status === 'new' ? 'border-amber-300 ring-1 ring-amber-200' : 'border-cocoa-100'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={order.internal_status} />
          {overdue && (
            <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white">OVERDUE</span>
          )}
        </div>
        <span className="font-semibold text-cocoa-900">{order.order_number}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium">{order.customer_name ?? 'Unknown customer'}</div>
          <div className="text-sm text-stone-500">
            {itemCount != null && <span>{itemCount} item{itemCount === 1 ? '' : 's'}</span>}
            {itemSummary && <span> — {itemSummary}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-stone-600">
            {order.required_fulfilment_at
              ? order.time_confirmed
                ? formatLondonFull(new Date(order.required_fulfilment_at))
                : `${formatLondonFull(new Date(order.required_fulfilment_at)).split(',')[0] ?? ''} — ${order.fulfillment_method === 'pickup' ? 'Collection' : 'Delivery'} time TBC`
              : 'No date'}
          </div>
          {order.time_confirmed && order.required_fulfilment_at && <Countdown targetIso={order.required_fulfilment_at} />}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Chips chips={chips} />
        {assigneeName && <span className="text-xs text-stone-500">Assigned: {assigneeName}</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {order.internal_status === 'new' && (
          <button
            onClick={acknowledge}
            disabled={busy}
            className="rounded-lg bg-cocoa-600 px-4 py-2 text-sm font-medium text-white hover:bg-cocoa-700 disabled:opacity-50"
          >
            {busy ? 'Acknowledging…' : 'Acknowledge'}
          </button>
        )}
        <span className="rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600">Open order</span>
        <a
          href={order.shopify_admin_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:border-cocoa-500"
        >
          Open in Shopify ↗
        </a>
      </div>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-700">{error}</p>}
    </div>
  );
}
