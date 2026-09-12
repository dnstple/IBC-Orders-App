import { notFound } from 'next/navigation';
import Image from 'next/image';
import { supabaseServer } from '@/lib/supabase/server';
import type { OrderRow, LineItemRow, FulfillmentGroupRow, OrderEventRow } from '@/types/db';
import { toOperationalOrder, statusBadgeClass, deliveryInfo } from '@/lib/operational';
import { Chips } from '@/components/Chips';
import { Countdown } from '@/components/Countdown';
import { orderChips } from '@/lib/orders-view';
import { formatLondonFull, formatLondonDate } from '@/lib/dates';
import { ActionsPanel } from '@/components/ActionsPanel';
import { BackButton } from '@/components/BackButton';
import { cleanLineItemProperties, asSelectionList } from '@/lib/line-item-props';

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
  const op = toOperationalOrder(o);
  const lineItems = (items ?? []) as LineItemRow[];
  const ffGroups = (groups ?? []) as FulfillmentGroupRow[];
  const timeline = (events ?? []) as OrderEventRow[];
  const money = (n: number | null) => (n == null ? '—' : `£${n.toFixed(2)}`);
  const isPickup = op.orderType === 'pickup';

  return (
    <div>
      <BackButton />
      <div className="grid w-full max-w-full gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        {/* Header */}
        <section className="rounded-xl border border-cocoa-100 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-cocoa-900">{op.orderNumber}</h1>
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${
                  isPickup ? 'bg-cocoa-50 text-cocoa-700 ring-cocoa-100' : 'bg-sky-50 text-sky-800 ring-sky-200'
                }`}
              >
                {isPickup ? 'Pickup' : 'Delivery'}
              </span>
            </div>
            <span className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ${statusBadgeClass(op.nativeOrderStatus)}`}>
              {op.nativeOrderStatus}
            </span>
          </div>
          <p className="mt-1 text-sm text-stone-500">
            Payment: {op.financialStatus} · Fulfilment: {op.fulfilmentStatus}
          </p>
          {o.time_confirmed && o.required_fulfilment_at && !op.isCancelled && (
            <div className="mt-2"><Countdown targetIso={o.required_fulfilment_at} /></div>
          )}
          <div className="mt-3"><Chips chips={orderChips(o)} /></div>
        </section>

        {/* Collection — prominent for pickup orders */}
        {isPickup && (
          <section className="rounded-xl border-2 border-cocoa-500 bg-cocoa-50/60 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-cocoa-700">Collection</h2>
            <p className="mt-1 text-lg font-semibold text-cocoa-900">
              {op.pickupLocation ?? 'Italian Bear Chocolate'}
            </p>
            <p className="text-lg text-cocoa-900">
              {op.pickupSlotLabel
                ?? (o.required_fulfilment_at
                  ? `${formatLondonDate(new Date(o.required_fulfilment_at))}${op.operationalTime ? `, ${op.operationalTime}` : ' — collection time TBC'}`
                  : 'Collection time TBC')}
            </p>
            {o.pickup_delay_minutes != null && (
              <p className="mt-1 text-sm text-cocoa-700">Preparation lead time: {o.pickup_delay_minutes} min</p>
            )}
            {(() => {
              // Legacy widget wrote an address + map link on early orders
              // (e.g. #1054) — show them when present, never require them.
              const addr = o.note_attributes.find((a) => a.name === 'ibc_pickup_address')?.value;
              const map = o.note_attributes.find((a) => a.name === 'ibc_pickup_map_url')?.value;
              if (!addr && !map) return null;
              return (
                <p className="mt-1 text-sm text-cocoa-700">
                  {addr}
                  {map && (
                    <> · <a href={map} target="_blank" rel="noreferrer" className="underline">map</a></>
                  )}
                </p>
              );
            })()}
          </section>
        )}

        {/* Delivery — the requested day is a request, not a promise */}
        {!isPickup && (() => {
          const d = deliveryInfo(o);
          return (
            <section className="rounded-xl border-2 border-sky-300 bg-sky-50/50 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-sky-800">Delivery</h2>
              {d.kind === 'scheduled' && (
                <>
                  <p className="mt-1 text-lg font-semibold text-sky-900">
                    {d.label ?? (d.date ? formatLondonDate(new Date(`${d.date}T12:00:00Z`)) : '')}
                  </p>
                  <p className="mt-1 text-sm text-sky-800">
                    Requested delivery date — this is the day the customer asked for, not a guaranteed arrival date.
                  </p>
                </>
              )}
              {d.kind === 'standard' && (
                <p className="mt-1 text-lg font-semibold text-sky-900">
                  Standard shipping — 2–3 business days <span className="text-sm font-normal">(no date requested)</span>
                </p>
              )}
              {d.kind === 'none' && (
                <p className="mt-1 text-lg text-sky-900">Not specified <span className="text-sm">(order predates the fulfilment picker)</span></p>
              )}
            </section>
          );
        })()}

        {/* Line items */}
        <section className="rounded-xl border border-cocoa-100 bg-white p-5">
          <h2 className="font-semibold">Items</h2>
          <ul className="mt-3 divide-y divide-stone-100">
            {lineItems.map((li) => {
              const lineTotal = li.unit_price != null ? li.unit_price * li.quantity : null;
              const partial = li.fulfilled_quantity > 0 && li.fulfilled_quantity < li.quantity;
              return (
                <li key={li.id} className="flex gap-3 py-3">
                  {li.image_url
                    ? <Image src={li.image_url} alt="" width={56} height={56} className="h-14 w-14 rounded-lg border border-stone-100 object-cover" />
                    : <div className="h-14 w-14 rounded-lg bg-cocoa-50" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="mt-0.5 shrink-0 rounded-md bg-cocoa-700 px-2 py-0.5 text-sm font-bold text-white">
                        ×{li.quantity}
                      </span>
                      <span className="min-w-0 break-words text-base font-semibold text-cocoa-900">{li.title}</span>
                    </div>
                    {li.variant_title && li.variant_title !== 'Default Title' && (
                      <div className="mt-0.5 text-sm text-stone-500">{li.variant_title}</div>
                    )}
                    <LineItemProperties properties={li.properties} />
                    {partial && (
                      <div className="mt-1 text-xs font-semibold text-violet-700">
                        Partially fulfilled — {li.fulfilled_quantity} of {li.quantity}
                      </div>
                    )}
                    {li.refunded_quantity > 0 && (
                      <div className="mt-1 text-xs font-semibold text-red-600">
                        {li.refunded_quantity} removed/refunded
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-semibold text-cocoa-900">
                      {lineTotal != null ? `£${lineTotal.toFixed(2)}` : ''}
                    </div>
                    {li.quantity > 1 && li.unit_price != null && (
                      <div className="text-xs text-stone-400">£{li.unit_price.toFixed(2)} each</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Customer & destination */}
        <section className="rounded-xl border border-cocoa-100 bg-white p-5">
          <h2 className="font-semibold">Customer</h2>
          <p className="mt-2 text-sm">{o.customer_name ?? '—'}</p>
          <p className="text-sm text-stone-500">{o.customer_email ?? ''}{o.customer_phone ? ` · ${o.customer_phone}` : ''}</p>
          {!isPickup && o.delivery_address && (
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
          {o.note_attributes.filter((a) => !a.name.startsWith('ibc_pickup') && !/^_|linked.*key|\bsku\b|variant\s*id/i.test(a.name) && a.value?.trim() && a.value.trim() !== 'Default Title').length > 0 && (
            <div className="mt-3 min-w-0 text-sm text-stone-600 [overflow-wrap:anywhere]">
              {o.note_attributes.filter((a) => !a.name.startsWith('ibc_pickup') && !/^_|linked.*key|\bsku\b|variant\s*id/i.test(a.name) && a.value?.trim() && a.value.trim() !== 'Default Title').map((a) => (
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

      {/* Actions + Shopify handoff */}
      <div className="min-w-0 space-y-4">
        <ActionsPanel order={o} groups={ffGroups} lineItems={lineItems} role={role} />
        <aside className="rounded-xl border border-cocoa-100 bg-white p-5">
          <a
            href={op.shopifyAdminUrl}
            target="_blank"
            rel="noreferrer"
            className="block min-h-12 w-full rounded-lg border-2 border-cocoa-600 px-4 py-3 text-center text-sm font-semibold text-cocoa-700 hover:bg-cocoa-50"
          >
            Open order in Shopify ↗
          </a>
          <p className="mt-3 text-xs leading-relaxed text-stone-500">
            <strong className="text-stone-700">To cancel or refund this order, open it in Shopify.</strong>{' '}
            Cancellations and refunds must be managed in Shopify so payment, stock and fulfilment records remain accurate.
          </p>
        </aside>
      </div>
      </div>
    </div>
  );
}

function LineItemProperties({ properties }: { properties: Array<{ name: string; value: string }> }) {
  const visible = cleanLineItemProperties(properties);
  if (visible.length === 0) return null;

  return (
    <div className="mt-1 min-w-0 space-y-1 text-xs text-amber-800 [overflow-wrap:anywhere]">
      {visible.map((p) => {
        const list = asSelectionList(p.value);
        if (list) {
          return (
            <div key={p.name}>
              <span className="font-semibold">{p.name}:</span>
              <ul className="mt-0.5 space-y-0.5 pl-3">
                {list.map((entry, i) => (
                  <li key={i} className="list-none">{entry}</li>
                ))}
              </ul>
            </div>
          );
        }
        return (
          <div key={p.name}>
            <span className="font-semibold">{p.name}:</span> {p.value}
          </div>
        );
      })}
    </div>
  );
}
