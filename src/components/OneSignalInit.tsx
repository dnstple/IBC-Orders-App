'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    OneSignalDeferred?: Array<(os: OneSignalSdk) => void>;
  }
}

interface OneSignalSdk {
  init: (opts: Record<string, unknown>) => Promise<void>;
  Notifications: {
    permission: boolean;
    requestPermission: () => Promise<void>;
    addEventListener: (ev: string, cb: () => void) => void;
  };
  User: {
    PushSubscription: {
      id: string | null | undefined;
      optIn: () => Promise<void>;
      addEventListener: (ev: string, cb: () => void) => void;
    };
  };
}

/**
 * Loads the OneSignal Web SDK, links this device's subscription to the
 * signed-in staff profile, and shows an "Enable notifications" button until
 * permission is granted (explicit user gesture — more reliable than
 * dashboard auto-prompts). Notifications carry only order number + item
 * count, never customer personal data.
 */
export function OneSignalInit() {
  const sdkRef = useRef<OneSignalSdk | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null); // null = SDK not ready
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId) return;

    if (!document.getElementById('onesignal-sdk')) {
      const script = document.createElement('script');
      script.id = 'onesignal-sdk';
      script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
      script.defer = true;
      document.head.appendChild(script);
    }

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: OneSignalSdk) => {
      try {
        await OneSignal.init({ appId, allowLocalhostAsSecureOrigin: true });
      } catch {
        /* already initialised (e.g. React strict-mode double effect) */
      }
      const register = async () => {
        const playerId = OneSignal.User.PushSubscription.id;
        if (playerId) {
          await fetch('/api/devices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId }),
          }).catch(() => undefined);
        }
      };
      OneSignal.User.PushSubscription.addEventListener('change', register);
      OneSignal.Notifications.addEventListener('permissionChange', () => {
        setEnabled(OneSignal.Notifications.permission);
        void register();
      });
      await register();
      sdkRef.current = OneSignal;
      setEnabled(OneSignal.Notifications.permission);
    });
  }, []);

  async function enable() {
    const sdk = sdkRef.current;
    if (!sdk) return;
    setBusy(true);
    try {
      await sdk.Notifications.requestPermission();
      await sdk.User.PushSubscription.optIn();
      setEnabled(sdk.Notifications.permission);
    } finally {
      setBusy(false);
    }
  }

  if (!process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || enabled !== false) return null;

  return (
    <button
      onClick={enable}
      disabled={busy}
      className="fixed bottom-16 right-4 z-20 rounded-full bg-cocoa-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-cocoa-700 disabled:opacity-50 sm:bottom-4"
    >
      {busy ? 'Requesting…' : '🔔 Enable notifications'}
    </button>
  );
}
