import type { ChipKind } from '@/lib/orders-view';

const CHIP_META: Record<ChipKind, { label: string; cls: string }> = {
  note: { label: 'Customer note', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  allergy: { label: '⚠ Allergy note', cls: 'bg-red-100 text-red-800 ring-red-300 font-semibold' },
  gift: { label: 'Gift message', cls: 'bg-pink-50 text-pink-800 ring-pink-200' },
  time_tbc: { label: 'Time TBC', cls: 'bg-stone-100 text-stone-700 ring-stone-300' },
  cancel_refund: { label: 'Cancelled / refund', cls: 'bg-red-50 text-red-700 ring-red-200' },
  partial: { label: 'Partially fulfilled', cls: 'bg-violet-50 text-violet-800 ring-violet-200' },
};

export function Chips({ chips }: { chips: ChipKind[] }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c} className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs ring-1 ${CHIP_META[c].cls}`}>
          {CHIP_META[c].label}
        </span>
      ))}
    </div>
  );
}
