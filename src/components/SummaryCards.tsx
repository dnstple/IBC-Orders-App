import type { SummaryCounts } from '@/lib/orders-view';

const CARDS: Array<{ key: keyof SummaryCounts; label: string; accent?: string }> = [
  { key: 'todayTotal', label: 'Today' },
  { key: 'newCount', label: 'New', accent: 'text-amber-700' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready / awaiting' },
  { key: 'timeTbc', label: 'Time TBC' },
  { key: 'overdue', label: 'Overdue', accent: 'text-red-700' },
];

export function SummaryCards({ counts }: { counts: SummaryCounts }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {CARDS.map((c) => (
        <div key={c.key} className="rounded-xl border border-cocoa-100 bg-white px-3 py-2.5">
          <div className={`text-xl font-semibold ${counts[c.key] > 0 ? c.accent ?? '' : 'text-stone-400'}`}>
            {counts[c.key]}
          </div>
          <div className="text-xs text-stone-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
