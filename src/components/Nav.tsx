'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';
import { isPickupOrder } from '@/lib/operational';
import { isSameDayCourier } from '@/lib/courier';
import type { OrderRow } from '@/types/db';

type Board = 'pickups' | 'deliveries';

const TABS: Array<{ href: string; label: string; board?: Board }> = [
  { href: '/pickups', label: 'Pickups', board: 'pickups' },
  { href: '/deliveries', label: 'Deliveries', board: 'deliveries' },
  { href: '/settings', label: 'Settings' },
];

const TERMINAL = ['fulfilled', 'cancelled', 'refunded'];

type Counts = Record<Board, { open: number; unread: number }>;

/**
 * Open and new-order counts per board, live — so someone on Pickups can
 * see at a glance that Deliveries has orders waiting. Same split as the
 * boards: same-day courier orders count as Pickups.
 */
function useBoardCounts(): Counts | null {
  const [counts, setCounts] = useState<Counts | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from('orders')
      .select('internal_status, test, pickup_requested, fulfillment_method, delivery_option')
      .not('internal_status', 'in', `(${TERMINAL.join(',')})`)
      .limit(1000);
    if (error) return; // badges are a convenience — keep the last good counts
    const next: Counts = { pickups: { open: 0, unread: 0 }, deliveries: { open: 0, unread: 0 } };
    for (const o of (data ?? []) as OrderRow[]) {
      if (o.test) continue;
      const board: Board = isPickupOrder(o) || isSameDayCourier(o) ? 'pickups' : 'deliveries';
      next[board].open += 1;
      if (o.internal_status === 'new') next[board].unread += 1;
    }
    setCounts(next);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRealtimeOrders(() => void load(), 'orders-nav-counts');
  return counts;
}

export function Nav(_props: { role?: 'staff' | 'manager' | 'admin' }) {
  const pathname = usePathname();
  const counts = useBoardCounts();

  // No tab bar inside an order — the Back button handles navigation there,
  // and this sidesteps legacy iPads mispainting the fixed bar on scroll.
  if (pathname.startsWith('/orders/')) return null;

  return (
    <nav
      aria-label="Main"
      className="ib-tabbar z-10 w-full max-w-full border-t border-cocoa-100 bg-white pb-[env(safe-area-inset-bottom)] sm:rounded-xl sm:border sm:pb-0"
    >
      <div className="mx-auto grid w-full max-w-5xl grid-cols-3">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          const c = t.board && counts ? counts[t.board] : null;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              aria-label={c ? `${t.label}: ${c.open} open${c.unread ? `, ${c.unread} new` : ''}` : t.label}
              className={`flex min-h-11 items-center justify-center gap-1.5 px-2 py-3 text-center text-sm font-medium transition sm:py-2.5 ${
                active ? 'text-cocoa-700 sm:rounded-lg sm:bg-cocoa-50' : 'text-stone-500 hover:text-cocoa-600'
              } ${active ? 'max-sm:border-t-2 max-sm:border-cocoa-600 max-sm:bg-cocoa-50/60' : ''}`}
            >
              <span className="truncate">{t.label}</span>
              {c && c.unread > 0 && (
                <span className="shrink-0 animate-pulse rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold leading-tight text-white">
                  {c.unread} new
                </span>
              )}
              {c && c.unread === 0 && c.open > 0 && (
                <span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-semibold leading-tight text-stone-700">
                  {c.open}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
