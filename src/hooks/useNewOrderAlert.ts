'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Audible alert + visual flash when a new paid order arrives, repeating
 * every `repeatMinutes` (default 2, configurable in Settings) while any
 * order remains unacknowledged.
 */
export function useNewOrderAlert(hasUnacknowledged: boolean, repeatMinutes = 2) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const play = useCallback(() => {
    try {
      if (!audioRef.current) audioRef.current = new Audio('/sounds/new-order.mp3');
      void audioRef.current.play().catch(() => {
        /* browsers block audio before first user interaction — flash still shows */
      });
      document.body.classList.remove('new-order-flash');
      // retrigger animation
      void document.body.offsetWidth;
      document.body.classList.add('new-order-flash');
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (hasUnacknowledged) {
      timerRef.current = setInterval(play, Math.max(1, repeatMinutes) * 60000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [hasUnacknowledged, repeatMinutes, play]);

  return { playAlert: play };
}
