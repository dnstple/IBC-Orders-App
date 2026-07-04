'use client';

import { useRouter } from 'next/navigation';
import type { OrderRow } from '@/types/db';
import { toOperationalOrder, statusBadgeClass } from '@/lib/operational';
import { formatLondonDate } from '@/lib/dates';

interface Props {
  order: OrderRow;
  itemCount?: number;
  /** Hide the date line when the surrounding group already shows the day. */
  showDate?: boolean;
}

/**
 * Order tile — everything staff need without opening the order:
 * number, type, slot/order time, native Shopify status, items, total.
 */
export function OrderCard({ order, itemCount, showDate = true }: Props) {
  const router = useRouter();
  const op = toOperationalOrder(order);
  const isPickup = op.orderType === 'pickup';
  const unread = order.internal_status === 'new' && !op.isCancelled;

  const money = order.total != null ? `£${order.total.toFixed(2)}` : '';
  const dateLabel = formatLondonDate(new Date(`${op.operationalDate}T12:00:00Z`));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/orders/${order.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && router.push(`/orders/${order.id}`)}
      className={`relative block cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition hover:border-cocoa-500 ${
        op.isCancelled
          ? 'border-red-200 opacity-75'
          : unread
            ? 'border-amber-300 ring-1 ring-amber-200'
            : 'border-cocoa-100'
      }`}
    >
      {unread && (
        <span className="absolute -left-1 -top-1 h-3 w-3 rounded-full bg-amber-500 ring-2 ring-white" aria-label="New order" />
      )}

      {/* Row 1: number · type badge · status */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-cocoa-900">{op.orderNumber}</span>
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${
            isPickup
              ? 'bg-cocoa-50 text-cocoa-700 ring-cocoa-100'
              : 'bg-sky-50 text-sky-800 ring-sky-200'
          }`}
        >
          {isPickup ? 'Pickup' : 'Delivery'}
        </span>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${statusBadgeClass(op.nativeOrderStatus)}`}>
          {op.nativeOrderStatus}
        </span>
      </div>

      {/* Row 2: date · time (slot for pickup, order time for delivery) */}
      <div className="mt-2 text-sm">
        {showDate && <span className="text-stone-600">{dateLabel} · </span>}
        {isPickup ? (
          op.operationalTime ? (
            <span className="font-semibold text-cocoa-900">{op.operationalTime}</span>
          ) : (
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600 ring-1 ring-stone-200">
              Collection time TBC
            </span>
          )
        ) : (
          <span className="text-stone-600">{op.operationalTime}</span>
        )}
      </div>

      {/* Row 3: customer · items · total · financial status */}
      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">{order.customer_name ?? 'Unknown customer'}</span>
        <span className="text-stone-500">
          {itemCount != null && `${itemCount} item${itemCount === 1 ? '' : 's'}`}
          {itemCount != null && money && ' · '}
          {money}
          {order.financial_status && order.financial_status !== 'PAID' && (
            <span className="ml-1.5 text-red-600">{order.financial_status.replaceAll('_', ' ').toLowerCase()}</span>
          )}
        </span>
      </div>

      {op.isCancelled && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
          Cancelled — manage refunds in Shopify
        </div>
      )}
    </div>
  );
}
