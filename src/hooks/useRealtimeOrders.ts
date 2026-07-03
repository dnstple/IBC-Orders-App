'use client';

import { useEffect, useRef } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

/**
 * Subscribes to Postgres changes on `orders` so every open staff device
 * updates in real time — both for staff actions here and for Shopify-side
 * changes arriving via webhooks.
 */
export function useRealtimeOrders(onChange: (payload: { eventType: string; new: Record<string, unknown> | null }) => void) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel('orders-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        cbRef.current({
          eventType: payload.eventType,
          new: (payload.new as Record<string, unknown>) ?? null,
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
