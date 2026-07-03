import { notFound } from 'next/navigation';
import Image from 'next/image';
import { supabaseServer } from '@/lib/supabase/server';
import type { OrderRow, LineItemRow, FulfillmentGroupRow, OrderEventRow } from '@/types/db';
import { StatusBadge } from '@/components/StatusBadge';
import { Chips } from '@/components/Chips';
import { Countdown } from '@/components/Countdown';
import { orderChips } from '@/lib/orders-view';
import { formatLondonFull } from '@/lib/dates';
import { ActionsPanel } from '@/components/ActionsPanel';

export default async function OrderDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('staff_profiles').select('role').eq('id', user!.id).single();
  const role = (profile?.role ?? 'staff') as 'staff' | 'manager' | 'admin';

  const [{ data: order }, { data: items }, { data: groups }, { data: events }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', id).maybeSingle(),
    supabase.from('order_line_items').select('*').eq('order_id', id).order('title'),
    supabase.from('fulfillment_groups').select('*').eq('order_id', id),
    supabase.from('order_events').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(50),
  ]);
  if (!order) notFound();

  const o = order as OrderRow;
  const lineItems = (items ?? []) as LineItemRow[];
  const ffGroups = (groups ?? []) as FulfillmentGroupRow[];
  const timeline = (events ?? []) as OrderEventRow[];
  const money = (n: number | null) => (n == null ? '—' : `£${n.toFixed(2)}`);
  const methodLabel = { pickup: 'Pickup', local_delivery: 'Local delivery', shipping: 'Shipping', unknown: 'Method unknown' }[o.fulfillment_method];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {/* Header */}
        <section className="rounded-xl border border-cocoa-100 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-cocoa-900">{o.order_number}</h1>
              <p className="text-sm text-stone-500">
                {methodLabel} · {o.financial_status ?? '—'} · Shopify: {o.shopify_fulfillment_status ?? 'UNFULFILLED'}
              </p>
            </div>
            <StatusBadge status={o.internal_status} large />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-sm">
              {o.required_fulfilment_at
                ? o.time_confirmed
                  ? <>Required: <strong>{formatLondonFull(new Date(o.required_fulfilment_at))}</strong></>
                  : <>Required date: <strong>{formatLondonFull(new Date(o.required_fulfilment_at)).split(',')[0]}</strong> — {o.fulfillment_method === 'pickup' ? 'collection' : 'delivery'} time TBC</>
                : 'No required date'}
            </span>
            {o.time_confirmed && o.required_fulfilment_at && <Countdown targetIso={o.required_fulfilment_at} />}
          </div>
          <div className="mt-3"><Chips chips={orderChips(o)} /></div>
          <a href={o.shopify_admin_url} target="_blank" rel="noreferrer"
            className="mt-4 inline-block rounded-lg border border-cocoa-500 px-4 py-2 text-sm font-medium text-cocoa-700 hover:bg-cocoa-50">
            Open order in Shopify ↗
          </a>
        </section>

        {/* Line items */}
        <section className="rounded-xl border border-cocoa-100 bg-white p-5">
          <h2 className="font-semibold">Items</h2>
          <ul className="mt-3 divide-y divide-stone-100">
            {lineItems.map((li) => (
              <li key={li.id} className="flex gap-3 py-3">
                {li.image_url
                  ? <Image src={li.image_url} alt="" width={56} height={56} className="h-14 w-14 rounded-lg border border-stone-100 object-cover" />
                  : <div className="h-14 w-14 rounded-lg bg-cocoa-50" />}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{li.title}</div>
                  <div className="text-sm text-stone-500">
                    {li.variant_title && <span>{li.variant_title} · </span>}
                    {li.sku && <span>SKU {li.sku} · </span>}
                    Qty {li.quantity}
                    {li.fulfilled_quantity > 0 && <span> · fulfilled {li.fulfilled_quantity}/{li.quantity}</span>}
                    {li.refunded_quantity > 0 && <span className="text-red-600"> · {li.refunded_quantity} removed/refunded</span>}
                  </div>
                  {li.properties.length > 0 && (
                    <div className="mt-1 text-xs text-amber-800">
                      {li.properties.map((p) => `${p.name}: ${p.value}`).join(' · ')}
                    </div>
                  )}
                </div>
                <div className="text-sm text-stone-600">{li.unit_price != null ? `£${li.unit_price.toFixed(2)}` : ''}</div>
              </li>
            ))}
          </ul>
        </section>

        {/* Customer & destination */}
        <section className="rounded-xl border border-cocoa-100 bg-white p-5">
          <h2 className="font-semibold">Customer</h2>
          <p className="mt-2 text-sm">{o.customer_name ?? '—'}</p>
          <p className="text-sm text-stone-500">{o.customer_email ?? ''}{o.customer_phone ? ` · ${o.customer_phone}` : ''}</p>
          {o.fulfillment_method === 'pickup' && o.pickup_location && (
            <p className="mt-3 text-sm"><span className="font-medium">Pickup location:</span> {o.pickup_location.name}{o.pickup_location.address ? ` — ${o.pickup_location.address}` : ''}</p>
          )}
          {o.delivery_address && (
            <p className="mt-3 text-sm">
              <span className="font-medium">Delivery address:</span>{' '}
              {[o.delivery_address.name, o.delivery_address.address1, o.delivery_address.address2, o.delivery_address.city, o.delivery_address.zip].filter(Boolean).join(', ')}
            </p>
          )}
          {(o.courier_name || o.courier_booking_ref) && (
            <p className="mt-3 text-sm">
              <span className="font-medium">Courier:</span> {o.courier_name}
              {o.courier_booking_ref && ` · ref ${o.courier_booking_ref}`}
              {o.courier_tracking_url && <> · <a className="text-cocoa-600 underline" href={o.courier_tracking_url} target="_blank" rel="noreferrer">tracking</a></>}
            </p>
          )}
          {o.note && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <span className="font-medium">Customer note:</span> {o.note}
            </div>
          )}
          {o.note_attributes.length > 0 && (
            <div className="mt-3 text-sm text-stone-600">
              {o.note_attributes.map((a) => (
                <div key={a.name}><span className="text-stone-400">{a.name}:</span> {a.value}</div>
              ))}
            </div>
          )}
        </section>

        {/* Payment */}
        <section className="rounded-xl border border-cocoa-100 bg-white p-5 text-sm">
          <h2 className="font-semibold">Payment</h2>
          <dl className="mt-2 space-y-1">
            <div className="flex justify-between"><dt className="text-stone-500">Subtotal</dt><dd>{money(o.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Delivery</dt><dd>{money(o.shipping_total)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Tax</dt><dd>{money(o.tax_total)}</dd></div>
            {o.discounts.length > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Discounts ({o.discounts.map((d) => d.code).join(', ')})</dt>
                <dd>−£{Number(o.discounts[0]?.amount ?? 0).toFixed(2)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-stone-100 pt-1 font-semibold"><dt>Total</dt><dd>{money(o.total)}</dd></div>
          </dl>
          {o.refund_summary.length > 0 && (
            <div className="mt-3 rounded-lg bg-red-50 p-3 text-red-800">
              {o.refund_summary.map((r) => (
                <div key={r.id}>Refund £{Number(r.amount ?? 0).toFixed(2)} — {new Date(r.createdAt).toLocaleString('en-GB')}{r.note ? ` — ${r.note}` : ''}</div>
              ))}
            </div>
          )}
        </section>

        {/* Timeline */}
        <section className="rounded-xl border border-cocoa-100 bg-white p-5">
          <h2 className="font-semibold">Timeline</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {timeline.map((e) => (
              <li key={e.id} className="flex justify-between gap-3">
                <span>
                  <span className="font-medium">{e.actor_name}</span>{' '}
                  <span className="text-stone-600">{e.event_type.replaceAll('_', ' ')}</span>
                </span>
                <span className="whitespace-nowrap text-xs text-stone-400">{formatLondonFull(new Date(e.created_at))}</span>
              </li>
            ))}
            {timeline.length === 0 && <li className="text-stone-400">No activity yet.</li>}
          </ul>
        </section>
      </div>

      {/* Actions */}
      <div>
        <ActionsPanel order={o} groups={ffGroups} lineItems={lineItems} role={role} />
      </div>
    </div>
  );
}
