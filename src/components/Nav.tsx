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
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-cocoa-100 bg-white/95 backdrop-blur sm:static sm:rounded-xl sm:border sm:bg-white">
      <div className="mx-auto flex max-w-5xl">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`min-h-12 flex flex-1 items-center justify-center px-2 py-3 text-center text-sm font-medium transition sm:py-2.5 ${
                active ? 'text-cocoa-700 sm:rounded-lg sm:bg-cocoa-50' : 'text-stone-500 hover:text-cocoa-600'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
