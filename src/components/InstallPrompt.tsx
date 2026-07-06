'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'ibc-install-dismissed-at';
const REMIND_AFTER_DAYS = 7;

/**
 * Home-screen install helper, shown only inside the logged-in app:
 * - Android/Chrome: captures beforeinstallprompt so one tap on "Install"
 *   opens the native add-to-home-screen dialog.
 * - iPhone/iPad: Apple provides no install API, so we show the two-step
 *   instructions instead.
 * Hidden once installed (standalone mode) and snoozed for a week when
 * dismissed. Installing from the icon is also what enables iOS push.
 */
export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (Date.now() - dismissedAt < REMIND_AFTER_DAYS * 86400000) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      setPlatform('ios');
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
      setPlatform('android');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!platform) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setPlatform(null);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === 'accepted') setPlatform(null);
    else dismiss();
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-cocoa-100 bg-cocoa-50/70 px-4 py-3">
      <span className="min-w-0 flex-1 text-sm text-cocoa-900">
        {platform === 'android' ? (
          <>Add <strong>IBC Orders</strong> to your home screen for one-tap access and notifications.</>
        ) : (
          <>Install <strong>IBC Orders</strong>: tap the <strong>Share</strong> button <span aria-hidden>⎋</span> below, then <strong>&ldquo;Add to Home Screen&rdquo;</strong>. Notifications on iPhone only work from the installed app.</>
        )}
      </span>
      <div className="flex gap-2">
        {platform === 'android' && (
          <button onClick={install}
            className="min-h-10 rounded-lg bg-cocoa-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cocoa-600">
            Install
          </button>
        )}
        <button onClick={dismiss} aria-label="Dismiss install suggestion"
          className="min-h-10 rounded-lg border border-cocoa-200 px-3 py-2 text-sm text-cocoa-700 hover:bg-white">
          Later
        </button>
      </div>
    </div>
  );
}
