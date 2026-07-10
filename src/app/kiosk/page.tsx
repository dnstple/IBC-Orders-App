import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import type { OrderRow } from '@/types/db';
import { sortPickup, sortDelivery, isPickupOrder, nativeStatus, slotTimeRange, dueState } from '@/lib/operational';
import { formatLondonTime, formatLondonFull, londonDateKey } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/**
 * KIOSK VIEW — for legacy devices (e.g. iPadOS 12) that cannot run the
 * interactive app. 100% server-rendered HTML, no client JavaScript at all;
 * a meta-refresh reloads it every 30 seconds. View-only by design: order
 * actions require the full app on a modern device. Sign-in is still
 * required (middleware) and RLS applies.
 */
export default async function KioskPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const todayKey = londonDateKey(new Date());
  const { data } = await supabase
    .from('orders')
    .select('*')
    .eq('operational_date', todayKey)
    .limit(200);

  const rows = ((data ?? []) as OrderRow[]).filter((o) => !o.test);
  const pickup = sortPickup(rows.filter((o) => isPickupOrder(o)));
  const delivery = sortDelivery(rows.filter((o) => !isPickupOrder(o)));
  const now = new Date();

  return (
    <div style={{ minHeight: '100vh', background: '#faf8f5', color: '#1c1917', fontFamily: '-apple-system, Helvetica, Arial, sans-serif' }}>
      {/* ES5 auto-refresh — runs without hydration, works on Safari 12 */}
      <script dangerouslySetInnerHTML={{ __html: 'setTimeout(function(){window.location.reload();},30000);' }} />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
          <div style={{ display: 'table', width: '100%' }}>
            <h1 style={{ display: 'table-cell', fontSize: 22, color: '#2b1d12', margin: 0 }}>
              IBC Orders — Today
            </h1>
            <span style={{ display: 'table-cell', textAlign: 'right', fontSize: 13, color: '#78716c' }}>
              Updated {formatLondonTime(now)} · refreshes every 30s · view only
            </span>
          </div>

          <Section title={`Pickup Orders · ${pickup.length}`}>
            {pickup.map((o) => <Row key={o.id} o={o} now={now} />)}
            {pickup.length === 0 && <Empty text="No pickup orders today." />}
          </Section>

          <Section title={`Delivery Orders · ${delivery.length}`}>
            {delivery.map((o) => <Row key={o.id} o={o} now={now} />)}
            {delivery.length === 0 && <Empty text="No delivery orders today." />}
          </Section>

          <p style={{ fontSize: 12, color: '#a8a29e', marginTop: 24 }}>
            To acknowledge, mark ready or fulfil orders, use the full app on a phone or a newer device.
            Last full page refresh: {formatLondonFull(now)}.
          </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: '#78716c', borderBottom: '1px solid #ede3d8', paddingBottom: 6 }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p style={{ color: '#a8a29e', fontSize: 14 }}>{text}</p>;
}

function Row({ o, now }: { o: OrderRow; now: Date }) {
  const status = nativeStatus(o);
  const slot = slotTimeRange(o.pickup_slot_start, o.pickup_slot_end);
  const due = dueState(o, now);
  const isNew = o.internal_status === 'new' && !o.cancelled_at;
  const cancelled = Boolean(o.cancelled_at);

  const statusColor =
    status === 'Ready for pickup' ? '#047857'
    : status === 'Fulfilled' ? '#78716c'
    : cancelled || status === 'Refunded' ? '#b91c1c'
    : '#92400e';

  return (
    <div style={{
      background: '#ffffff',
      border: `1px solid ${due === 'due_now' ? '#dc2626' : isNew ? '#f59e0b' : '#ede3d8'}`,
      borderRadius: 10,
      padding: '10px 14px',
      marginTop: 8,
      opacity: cancelled ? 0.65 : 1,
    }}>
      <div style={{ display: 'table', width: '100%' }}>
        <div style={{ display: 'table-cell', verticalAlign: 'middle' }}>
          <strong style={{ fontSize: 16, color: '#2b1d12' }}>{o.order_number}</strong>
          {'  '}
          <span style={{ fontSize: 14 }}>{o.customer_name?.trim() || 'Guest customer'}</span>
          {isNew && <strong style={{ color: '#b45309', fontSize: 12 }}> · NEW</strong>}
          {due === 'due_soon' && <strong style={{ color: '#b45309', fontSize: 12 }}> · DUE SOON</strong>}
          {due === 'due_now' && <strong style={{ color: '#dc2626', fontSize: 12 }}> · PICKUP DUE NOW</strong>}
        </div>
        <div style={{ display: 'table-cell', textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
          {slot && <strong style={{ fontSize: 15, color: '#2b1d12' }}>{slot}</strong>}
          {!slot && isPickupOrder(o) && <span style={{ fontSize: 12, color: '#78716c' }}>time TBC</span>}
          {!isPickupOrder(o) && <span style={{ fontSize: 13, color: '#78716c' }}>ordered {formatLondonTime(new Date(o.shopify_created_at))}</span>}
          {'  '}
          <span style={{ fontSize: 12, fontWeight: 600, color: statusColor }}>{status}</span>
        </div>
      </div>
      {o.note && (
        <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>Note: {o.note}</div>
      )}
    </div>
  );
}
