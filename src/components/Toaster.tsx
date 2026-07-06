'use client';

import { useEffect, useState } from 'react';

export type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; message: string }

/** Fire a toast from anywhere: toast('Saved', 'success'). */
export function toast(message: string, kind: ToastKind = 'info') {
  window.dispatchEvent(new CustomEvent('ib-toast', { detail: { message, kind } }));
}

/**
 * Viewport-safe toast stack: bottom-right on desktop, above the tab bar on
 * mobile so it never covers primary actions. Announced politely to screen
 * readers; dismissible; auto-expires.
 */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    let nextId = 1;
    const onToast = (e: Event) => {
      const { message, kind } = (e as CustomEvent<{ message: string; kind: ToastKind }>).detail;
      const id = nextId++;
      setItems((prev) => [...prev.slice(-3), { id, kind, message }]); // max 4 stacked
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4000);
    };
    window.addEventListener('ib-toast', onToast);
    return () => window.removeEventListener('ib-toast', onToast);
  }, []);

  if (items.length === 0) return null;

  const kindCls: Record<ToastKind, string> = {
    success: 'bg-emerald-700 text-white',
    error: 'bg-red-700 text-white',
    info: 'bg-cocoa-900 text-white',
  };

  return (
    <div aria-live="polite" className="fixed bottom-20 right-3 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2 sm:bottom-4 sm:right-4">
      {items.map((t) => (
        <div key={t.id} className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg ${kindCls[t.kind]}`}>
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            className="!min-h-0 -mr-1 rounded p-1 text-white/70 hover:text-white"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
