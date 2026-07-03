'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { OrderRow } from '@/types/db';
import { StatusBadge } from '@/components/StatusBadge';
import { formatLondonFull } from '@/lib/dates';

const PAGE_SIZE = 25;

/** Past orders: fulfilled, collected, cancelled or refunded orders from before today. */
export default function PastOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .in('internal_status', ['fulfilled', 'cancelled', 'refunded'])
      .order('required_fulfilment_at', { ascending: false })
      .range(p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1);
    setLoading(false);
    if (error) { setError(error.message); return; }
    const rows = (data ?? []) as OrderRow[];
    setOrders((prev) => (p === 0 ? rows : [...prev, ...rows]));
    setDone(rows.length < PAGE_SIZE);
  }, []);

  useEffect(() => { void load(0); }, [load]);

  if (error) return <p className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>;

  return (
    <div className="space-y-2">
      {orders.length === 0 && !loading && (
        <div className="rounded-xl border border-cocoa-100 bg-white p-10 text-center text-stone-500">No past orders yet.</div>
      )}
      {orders.map((o) => (
        <Link key={o.id} href={`/orders/${o.id}`}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cocoa-100 bg-white p-4 hover:border-cocoa-500">
          <div className="flex items-center gap-3">
            <StatusBadge status={o.internal_status} />
            <span className="font-medium">{o.order_number}</span>
            <span className="text-stone-500">{o.customer_name}</span>
          </div>
          <span className="text-sm text-stone-500">
            {o.required_fulfilment_at ? formatLondonFull(new Date(o.required_fulfilment_at)) : ''}
          </span>
        </Link>
      ))}
      {!done && orders.length > 0 && (
        <button
          onClick={() => { const p = page + 1; setPage(p); void load(p); }}
          disabled={loading}
          className="w-full rounded-xl border border-cocoa-100 bg-white py-3 text-sm text-stone-600 hover:border-cocoa-500 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
