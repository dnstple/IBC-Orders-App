'use client';

import { useEffect, useState } from 'react';
import { countdown } from '@/lib/dates';

const STATE_CLS = {
  future: 'text-stone-500',
  soon: 'text-amber-700',
  due: 'text-orange-700 font-semibold',
  overdue: 'text-red-700 font-semibold',
};

/** Live countdown — shown only when the time is confirmed. */
export function Countdown({ targetIso }: { targetIso: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const { label, state } = countdown(new Date(targetIso), now);
  return <span className={`text-sm ${STATE_CLS[state]}`}>{label}</span>;
}
