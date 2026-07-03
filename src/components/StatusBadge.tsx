import type { InternalStatus } from '@/types/db';
import { STATUS_LABELS } from '@/lib/orders-view';

const STYLES: Record<InternalStatus, string> = {
  new: 'bg-amber-100 text-amber-900 ring-amber-300',
  acknowledged: 'bg-sky-50 text-sky-800 ring-sky-200',
  preparing: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  ready_for_pickup: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  packed: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  courier_booked: 'bg-teal-50 text-teal-800 ring-teal-200',
  fulfilled: 'bg-stone-100 text-stone-600 ring-stone-200',
  cancelled: 'bg-red-50 text-red-700 ring-red-200',
  refunded: 'bg-red-50 text-red-700 ring-red-200',
};

export function StatusBadge({ status, large = false }: { status: InternalStatus; large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ring-1 ${STYLES[status]} ${
        large ? 'px-4 py-1.5 text-base' : 'px-2.5 py-0.5 text-xs'
      }`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
