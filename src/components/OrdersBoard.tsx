'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { OrderRow, LineItemRow } from '@/types/db';
import { groupByActionDate, summarise, isPast, needsAttention } from '@/lib/orders-view';
import { OrderCard } from '@/components/OrderCard';
import { SummaryCards } from '@/components/SummaryCards';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';
import { useNewOrderAlert } from '@/hooks/useNewOrderAlert';

type BoardMode = 'pickup' | 'delivery' | 'attention';

/**
 * Shared live board for Pickup / Delivery / Needs attention.
 * Reads via RLS-scoped anon client; every state change lands via realtime.
 */
export function OrdersBoard({ mode }: { mode: BoardMode }) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [items, setItems] = useState<Record<string, LineItemRow[]>>({});
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('required_fulfilment_at', { ascending: true })
      .limit(400);
    if (error) {
      setError(error.message);
      return;
    }
    const rows = (data ?? []) as OrderRow[];
    setOrders(rows);

    const ids = rows.map((o) => o.id);
    if (ids.length) {
      const { data: li } = await supabase.from('order_line_items').select('*').in('order_id', ids);
      const map: Record<string, LineItemRow[]> = {};
      for (const item of (li ?? []) as LineItemRow[]) {
        (map[item.order_id] ??= []).push(item);
      }
      setItems(map);
    }
    const { data: staff } = await supabase.from('staff_profiles').select('id, full_name');
    if (staff) setStaffNames(Object.fromEntries(staff.map((s) => [s.id, s.full_name])));
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRealtimeOrders(() => void load());

  const visible = useMemo(() => {
    if (!orders) return [];
    const active = orders.filter((o) => !o.test && !isPast(o));
    if (mode === 'pickup') return active.filter((o) => o.fulfillment_method === 'pickup');
    if (mode === 'delivery') return active.filter((o) => ['local_delivery', 'shipping'].includes(o.fulfillment_method));
    return active.filter((o) => needsAttention(o).flag);
  }, [orders, mode]);

  const hasUnacknowledged = useMemo(() => visible.some((o) => o.internal_status === 'new'), [visible]);
  useNewOrderAlert(hasUnacknowledged);

  const groups = useMemo(() => groupByActionDate(visible), [visible]);
  const counts = useMemo(() => summarise(visible), [visible]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="font-medium">Couldn&apos;t load orders</p>
        <p className="mt-1 text-sm">{error}</p>
        <button onClick={() => void load()} className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm text-white">Retry</button>
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

  return (
    <div className="space-y-6">
      {mode !== 'attention' && <SummaryCards counts={counts} />}
      {groups.length === 0 && (
        <div className="rounded-xl border border-cocoa-100 bg-white p-10 text-center text-stone-500">
          {mode === 'attention' ? 'Nothing needs attention. 🎉' : `No ${mode} orders right now.`}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.key}>
          <h2 className={`mb-2 text-sm font-semibold uppercase tracking-wide ${
            g.key === 'attention' || g.key === 'past-unresolved' ? 'text-red-700' : 'text-stone-500'
          }`}>
            {g.label} <span className="font-normal">({g.orders.length})</span>
          </h2>
          <div className="space-y-3">
            {g.orders.map((o) => {
              const li = items[o.id] ?? [];
              const summary = li.slice(0, 3).map((x) => `${x.quantity}× ${x.title}`).join(', ') + (li.length > 3 ? '…' : '');
              const count = li.reduce((s, x) => s + x.quantity, 0);
              return (
                <OrderCard
                  key={o.id}
                  order={o}
                  itemSummary={summary || undefined}
                  itemCount={count || undefined}
                  assigneeName={o.assigned_staff_id ? staffNames[o.assigned_staff_id] : null}
                  onActioned={() => void load()}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
