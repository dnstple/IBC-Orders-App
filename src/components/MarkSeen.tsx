'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Silently clears the unread state when staff open an order. */
export function MarkSeen({ orderId, isNew }: { orderId: string; isNew: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!isNew) return;
    void fetch(`/api/orders/${orderId}/acknowledge`, { method: 'POST' })
      .then(() => router.refresh())
      .catch(() => undefined);
  }, [orderId, isNew, router]);
  return null;
}
