'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/today', label: 'Today' },
  { href: '/future', label: 'Future Orders' },
  { href: '/past', label: 'Past Orders' },
  { href: '/settings', label: 'Settings' },
];

export function Nav(_props: { role?: 'staff' | 'manager' | 'admin' }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 w-full max-w-full border-t border-cocoa-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:static sm:rounded-xl sm:border sm:bg-white sm:pb-0"
    >
      <div className="mx-auto grid w-full max-w-5xl grid-cols-4 max-[420px]:grid-cols-2">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center justify-center truncate px-2 py-3 text-center text-sm font-medium transition sm:py-2.5 ${
                active ? 'text-cocoa-700 sm:rounded-lg sm:bg-cocoa-50' : 'text-stone-500 hover:text-cocoa-600'
              } ${active ? 'max-sm:border-t-2 max-sm:border-cocoa-600 max-sm:bg-cocoa-50/60' : ''}`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
