'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { OrderRow, LineItemRow } from '@/types/db';
import { tabFor, groupByOperationalDay, type DashboardTab, type DaySections } from '@/lib/operational';
import { dayGroupLabel } from '@/lib/dates';
import { OrderCard } from '@/components/OrderCard';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';
import { useNewOrderAlert } from '@/hooks/useNewOrderAlert';

/**
 * Today / Future / Past boards. Each day is split into Pickup Orders
 * (sorted by slot start) then Delivery Orders (sorted by order time).
 * Reads through RLS; realtime keeps every open device current.
 */
export function OrdersBoard({ tab }: { tab: DashboardTab }) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const supabase = supabaseBrowser();
      let query = supabase.from('orders').select('*').limit(500);
      const todayIso = new Date().toISOString().slice(0, 10);
      // Server-side narrowing (operational_date is indexed); exact London-day
      // classification happens client-side via tabFor().
      if (tab === 'past') {
        query = query.lte('operational_date', todayIso).order('operational_date', { ascending: false });
      } else {
        query = query.gte('operational_date', todayIso).order('operational_date', { ascending: true });
      }
      const { data, error } = await query;
      if (error) {
        setError(error.message);
        return;
      }
      setError(null);
      setOffline(false);
      const rows = (data ?? []) as OrderRow[];
      setOrders(rows);

      const ids = rows.map((o) => o.id);
      if (ids.length) {
        const { data: li } = await supabase.from('order_line_items').select('order_id, quantity').in('order_id', ids);
        const counts: Record<string, number> = {};
        for (const item of (li ?? []) as Pick<LineItemRow, 'order_id' | 'quantity'>[]) {
          counts[item.order_id] = (counts[item.order_id] ?? 0) + item.quantity;
        }
        setItemCounts(counts);
      }
    } catch {
      setOffline(true);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onOnline = () => void load();
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

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="font-medium">Couldn&apos;t load orders</p>
        <p className="mt-1 text-sm">{error}</p>
        <button onClick={() => void load()} className="mt-3 min-h-11 rounded-lg bg-red-700 px-4 py-2 text-sm text-white">Retry</button>
      </div>
    );
  }
  if (orders === null) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-cocoa-50" />
        ))}
      </div>
    );
  }

  const emptyCopy = {
    today: 'No orders due today.',
    future: 'No upcoming orders yet.',
    past: 'No past orders.',
  }[tab];

  return (
    <div className="space-y-8">
      {offline && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
          You appear to be offline — showing the last loaded orders.
        </div>
      )}
      {days.length === 0 && (
        <div className="rounded-xl border border-cocoa-100 bg-white p-10 text-center text-stone-500">{emptyCopy}</div>
      )}
      {days.map((day) => (
        <DayGroup
          key={day.dateKey}
          day={day}
          itemCounts={itemCounts}
          showDayHeading={tab !== 'today'}
        />
      ))}
    </div>
  );
}

function DayGroup({ day, itemCounts, showDayHeading }: {
  day: DaySections;
  itemCounts: Record<string, number>;
  showDayHeading: boolean;
}) {
  const heading = dayGroupLabel(new Date(`${day.dateKey}T12:00:00Z`));
  return (
    <section>
      {showDayHeading && (
        <h2 className="mb-3 border-b border-cocoa-100 pb-1.5 text-base font-semibold text-cocoa-900">{heading}</h2>
      )}
      {day.pickup.length > 0 && (
        <Subsection label="Pickup Orders" count={day.pickup.length}>
          {day.pickup.map((o) => (
            <OrderCard key={o.id} order={o} itemCount={itemCounts[o.id]} showDate={showDayHeading} />
          ))}
        </Subsection>
      )}
      {day.delivery.length > 0 && (
        <Subsection label="Delivery Orders" count={day.delivery.length}>
          {day.delivery.map((o) => (
            <OrderCard key={o.id} order={o} itemCount={itemCounts[o.id]} showDate={showDayHeading} />
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
    <div className="mb-5">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
        {label} · {count}
      </h3>
      <div className="grid gap-3 lg:grid-cols-2">{children}</div>
    </div>
  );
}
