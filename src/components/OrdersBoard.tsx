'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { OrderRow, LineItemRow } from '@/types/db';
import { tabFor, groupByOperationalDay, type DashboardTab, type DaySections } from '@/lib/operational';
import { dayGroupLabel, formatLondonFull } from '@/lib/dates';
import { OrderCard } from '@/components/OrderCard';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';
import { useNewOrderAlert } from '@/hooks/useNewOrderAlert';

const GRID = 'grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]';
const RETRY_DELAYS = [2000, 8000]; // limited exponential backoff — never infinite

/**
 * Today / Future / Past boards. Resilient: keeps the last good data with a
 * warning banner when a refresh fails, retries with bounded backoff, and
 * one malformed order can never take down the list.
 */
export function OrdersBoard({ tab }: { tab: DashboardTab }) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastGoodAt, setLastGoodAt] = useState<Date | null>(null);
  const retryCount = useRef(0);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return; // no overlapping fetches
    loading.current = true;
    try {
      const supabase = supabaseBrowser();
      let query = supabase.from('orders').select('*').limit(500);
      const todayIso = new Date().toISOString().slice(0, 10);
      if (tab === 'past') {
        query = query.lte('operational_date', todayIso).order('operational_date', { ascending: false });
      } else {
        query = query.gte('operational_date', todayIso).order('operational_date', { ascending: true });
      }
      const { data, error } = await query;
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
      // Bounded auto-retry with backoff.
      const delay = RETRY_DELAYS[retryCount.current];
      if (delay != null) {
        retryCount.current += 1;
        setTimeout(() => { loading.current = false; void load(); }, delay);
      }
    } finally {
      loading.current = false;
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onOnline = () => { retryCount.current = 0; void load(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [load]);
  useRealtimeOrders(() => void load());

  const visible = useMemo(
    () => (orders ?? []).filter((o) => !o.test && tabFor(o) === tab),
    [orders, tab]
  );

  const hasUnread = useMemo(
    () => tab === 'today' && visible.some((o) => o.internal_status === 'new'),
    [visible, tab]
  );
  useNewOrderAlert(hasUnread);

  const days = useMemo(() => {
    const grouped = groupByOperationalDay(visible);
    return tab === 'past' ? grouped.reverse() : grouped;
  }, [visible, tab]);

  /* Initial load failed with nothing to show */
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

  /* Initial loading: structured skeletons matching real cards */
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

  const emptyCopy = {
    today: 'No orders due today.',
    future: 'No upcoming orders yet.',
    past: 'No past orders.',
  }[tab];

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
      {days.length === 0 && (
        <div className="rounded-xl border border-cocoa-100 bg-white p-10 text-center text-stone-500">{emptyCopy}</div>
      )}
      {days.map((day) => (
        <DayGroup key={day.dateKey} day={day} itemCounts={itemCounts} showDayHeading={tab !== 'today'} onActioned={() => void load()} />
      ))}
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

function DayGroup({ day, itemCounts, showDayHeading, onActioned }: {
  day: DaySections;
  itemCounts: Record<string, number>;
  showDayHeading: boolean;
  onActioned: () => void;
}) {
  const heading = dayGroupLabel(new Date(`${day.dateKey}T12:00:00Z`));
  return (
    <section className="min-w-0">
      {showDayHeading && (
        <h2 className="mb-3 border-b border-cocoa-100 pb-1.5 text-base font-semibold text-cocoa-900">{heading}</h2>
      )}
      {day.pickup.length > 0 && (
        <Subsection label="Pickup Orders" count={day.pickup.length}>
          {day.pickup.map((o) => (
            <OrderCard key={o.id} order={o} itemCount={itemCounts[o.id]} showDate={showDayHeading} onActioned={onActioned} />
          ))}
        </Subsection>
      )}
      {day.delivery.length > 0 && (
        <Subsection label="Delivery Orders" count={day.delivery.length}>
          {day.delivery.map((o) => (
            <OrderCard key={o.id} order={o} itemCount={itemCounts[o.id]} showDate={showDayHeading} onActioned={onActioned} />
          ))}
        </Subsection>
      )}
      {day.pickup.length === 0 && day.delivery.length === 0 && (
        <p className="text-sm text-stone-400">No orders.</p>
      )}
    </section>
  );
}

function Subsection({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-5 min-w-0">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
        {label} · {count}
      </h3>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">{children}</div>
    </div>
  );
}
