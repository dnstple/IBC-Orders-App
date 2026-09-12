'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { OrderRow, LineItemRow } from '@/types/db';
import { isPickupOrder, sortPickup, sortDelivery, operationalDateKey, isUndatedDelivery } from '@/lib/operational';
import { dayGroupLabel, formatLondonDate, formatLondonFull, londonDateKey } from '@/lib/dates';
import { OrderCard } from '@/components/OrderCard';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';
import { useNewOrderAlert } from '@/hooks/useNewOrderAlert';

const GRID = 'grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]';
const RETRY_DELAYS = [2000, 8000]; // limited backoff — never infinite
const TERMINAL = ['fulfilled', 'cancelled', 'refunded'];

/**
 * Pickups / Deliveries boards. Live (non-fulfilled, non-cancelled) orders
 * only, grouped by day and ordered strictly by time: pickups by collection
 * slot, deliveries by order time. Overdue days surface at the top in amber.
 */
export function OrdersBoard({ board }: { board: 'pickups' | 'deliveries' }) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastGoodAt, setLastGoodAt] = useState<Date | null>(null);
  const retryCount = useRef(0);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .not('internal_status', 'in', `(${TERMINAL.join(',')})`)
        .order('operational_date', { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as OrderRow[];
      setOrders(rows);
      setLoadError(null);
      setLastGoodAt(new Date());
      retryCount.current = 0;

      const ids = rows.map((o) => o.id);
      if (ids.length) {
        const { data: li } = await supabase.from('order_line_items').select('order_id, quantity').in('order_id', ids);
        const counts: Record<string, number> = {};
        for (const item of (li ?? []) as Pick<LineItemRow, 'order_id' | 'quantity'>[]) {
          counts[item.order_id] = (counts[item.order_id] ?? 0) + item.quantity;
        }
        setItemCounts(counts);
      }
    } catch (err) {
      const message = !navigator.onLine
        ? 'You appear to be offline.'
        : err instanceof Error ? err.message : 'Could not refresh orders.';
      setLoadError(message);
      const delay = RETRY_DELAYS[retryCount.current];
      if (delay != null) {
        retryCount.current += 1;
        setTimeout(() => { loading.current = false; void load(); }, delay);
      }
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onOnline = () => { retryCount.current = 0; void load(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [load]);
  useRealtimeOrders(() => void load());

  const visible = useMemo(
    () => (orders ?? []).filter((o) => !o.test && isPickupOrder(o) === (board === 'pickups')),
    [orders, board]
  );

  const hasUnread = useMemo(() => visible.some((o) => o.internal_status === 'new'), [visible]);
  useNewOrderAlert(hasUnread);

  /** Undated deliveries (standard shipping / pre-picker orders) have no day
   *  they're wanted on — they group separately, after every dated day. */
  const undated = useMemo(
    () => (board === 'deliveries' ? sortDelivery(visible.filter(isUndatedDelivery)) : []),
    [visible, board]
  );

  /** Day groups, ascending; within each day strictly by time. */
  const days = useMemo(() => {
    const dated = board === 'deliveries' ? visible.filter((o) => !isUndatedDelivery(o)) : visible;
    const byDay = new Map<string, OrderRow[]>();
    for (const o of dated) {
      const key = operationalDateKey(o);
      const list = byDay.get(key) ?? [];
      list.push(o);
      byDay.set(key, list);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([dateKey, list]) => ({
        dateKey,
        orders: board === 'pickups' ? sortPickup(list) : sortDelivery(list),
      }));
  }, [visible, board]);

  const todayKey = londonDateKey(new Date());

  if (orders === null && loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="font-medium">Couldn&apos;t load orders</p>
        <p className="mt-1 break-words text-sm">{loadError}</p>
        <button onClick={() => { retryCount.current = 0; void load(); }}
          className="mt-3 min-h-11 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white">
          Retry
        </button>
      </div>
    );
  }

  if (orders === null) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading orders">
        <div className="skeleton h-4 w-40" />
        <div className={GRID}>
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full space-y-8">
      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
          <span className="min-w-0 flex-1 break-words">
            Shopify sync failed. Showing data from {lastGoodAt ? formatLondonFull(lastGoodAt) : 'the last successful refresh'}.
          </span>
          <button onClick={() => { retryCount.current = 0; void load(); }}
            className="min-h-9 rounded-md border border-amber-300 px-3 py-1 text-xs font-semibold hover:bg-amber-100">
            Retry sync
          </button>
        </div>
      )}
      {days.length === 0 && undated.length === 0 && (
        <div className="rounded-xl border border-cocoa-100 bg-white p-10 text-center text-stone-500">
          No open {board === 'pickups' ? 'pickup' : 'delivery'} orders. 🎉
        </div>
      )}

      {/* Standard shipping first: no requested day, so it's due soonest by default */}
      {undated.length > 0 && (
        <section className="min-w-0">
          <h2 className="mb-3 border-b border-cocoa-100 pb-1.5 text-base font-semibold text-cocoa-900">
            Standard shipping <span className="font-normal text-stone-400">· {undated.length}</span>
          </h2>
          <div className={GRID}>
            {undated.map((o) => (
              <OrderCard key={o.id} order={o} itemCount={itemCounts[o.id]} onActioned={() => void load()} />
            ))}
          </div>
        </section>
      )}

      {days.map(({ dateKey, orders: dayOrders }) => {
        const overdue = dateKey < todayKey;
        const label = overdue
          ? `Overdue — ${formatLondonDate(new Date(`${dateKey}T12:00:00Z`))}`
          : dayGroupLabel(new Date(`${dateKey}T12:00:00Z`));
        return (
          <section key={dateKey} className="min-w-0">
            <h2 className={`mb-3 border-b pb-1.5 text-base font-semibold ${
              overdue ? 'border-red-200 text-red-700' : 'border-cocoa-100 text-cocoa-900'
            }`}>
              {label} <span className="font-normal text-stone-400">· {dayOrders.length}</span>
            </h2>
            <div className={GRID}>
              {dayOrders.map((o) => (
                <OrderCard key={o.id} order={o} itemCount={itemCounts[o.id]} onActioned={() => void load()} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="w-full min-w-0 rounded-xl border border-cocoa-100 bg-white p-4" aria-hidden>
      <div className="flex items-center gap-2">
        <div className="skeleton h-5 w-16" />
        <div className="skeleton h-5 w-14" />
        <div className="skeleton ml-auto h-5 w-24 rounded-full" />
      </div>
      <div className="skeleton mt-3 h-4 w-44" />
      <div className="mt-2 flex items-center justify-between">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-4 w-20" />
      </div>
    </div>
  );
}
