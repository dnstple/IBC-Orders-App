'use client';

import { useState } from 'react';
import { toast } from '@/components/Toaster';
import { trackingMessage } from '@/lib/courier';

/**
 * One click instead of four: copies the ready-written customer message
 * ("Your Italian Bear order is on its way — track your rider here: {link}")
 * so the shop can paste it straight into a text/WhatsApp.
 */
export function CopyTrackingButton({ trackingUrl, compact = false }: { trackingUrl: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(trackingMessage(trackingUrl));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast('Customer tracking message copied — ready to paste.', 'success');
    } catch {
      toast('Couldn’t copy — long-press the tracking link instead.', 'error');
    }
  }

  return (
    <button
      onClick={copy}
      className={
        compact
          ? 'min-h-9 rounded-md border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 hover:border-cocoa-500'
          : 'min-h-11 w-full rounded-lg bg-cocoa-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cocoa-600'
      }
    >
      {copied ? '✓ Copied' : compact ? 'Copy msg' : 'Copy tracking message for customer'}
    </button>
  );
}
