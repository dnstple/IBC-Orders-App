'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/pickup', label: 'Pickup' },
  { href: '/delivery', label: 'Delivery' },
  { href: '/attention', label: 'Needs attention' },
  { href: '/past', label: 'Past orders' },
  { href: '/settings', label: 'Settings' },
];

export function Nav({ role }: { role: 'staff' | 'manager' | 'admin' }) {
  const pathname = usePathname();
  const tabs = TABS.filter((t) => t.href !== '/settings' || role !== 'staff');
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-cocoa-100 bg-white/95 backdrop-blur sm:static sm:rounded-xl sm:border sm:bg-white">
      <div className="mx-auto flex max-w-5xl">
        {tabs.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex-1 px-2 py-3 text-center text-sm font-medium transition sm:py-2.5 ${
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
