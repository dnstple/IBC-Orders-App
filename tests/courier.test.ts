import { describe, it, expect } from 'vitest';
import { isSameDayCourier, courierInfo, isDeliveryChargeLine, trackingMessage } from '@/lib/courier';
import { parseFulfilmentAttrs } from '@/lib/pickup-attrs';
import type { OrderRow } from '@/types/db';

function row(overrides: Partial<OrderRow>): OrderRow {
  return {
    fulfillment_method: 'local_delivery', pickup_requested: false,
    delivery_option: 'sameday', delivery_date: '2026-09-17', delivery_label: 'By 5:00pm',
    operational_date: '2026-09-17', shopify_created_at: '2026-09-17T13:00:00+01:00',
    internal_status: 'new', cancelled_at: null,
    note_attributes: [],
    ...overrides,
  } as OrderRow;
}

describe('same-day courier recognition', () => {
  it('requires delivery method AND sameday option together', () => {
    expect(isSameDayCourier(row({}))).toBe(true);
    // Stale option on an order that switched back to collection: pickup wins.
    expect(isSameDayCourier(row({ fulfillment_method: 'pickup' }))).toBe(false);
    expect(isSameDayCourier(row({ pickup_requested: true }))).toBe(false);
    expect(isSameDayCourier(row({ delivery_option: 'standard' }))).toBe(false);
  });

  it('never keys off ibc_courier_* presence — a failed booking has none', () => {
    const o = row({ note_attributes: [] }); // no courier attrs at all
    expect(isSameDayCourier(o)).toBe(true);
    expect(courierInfo(o).status).toBe('unbooked'); // and it must be loud
  });

  it('parseFulfilmentAttrs accepts sameday with ready-time fallback to window_start', () => {
    const modern = parseFulfilmentAttrs([
      { key: 'delivery_method', value: 'delivery' },
      { key: 'delivery_option', value: 'sameday' },
      { key: 'delivery_ready_at', value: '2026-09-17T14:25:00+01:00' },
    ]);
    expect(modern.option).toBe('sameday');
    expect(modern.readyAt).toBe('2026-09-17T14:25:00+01:00');

    const older = parseFulfilmentAttrs([
      { key: 'delivery_method', value: 'delivery' },
      { key: 'delivery_option', value: 'sameday' },
      { key: 'delivery_window_start', value: '2026-09-17T14:25:00+01:00' },
    ]);
    expect(older.readyAt).toBe('2026-09-17T14:25:00+01:00');
  });
});

describe('courierInfo — booking states and times', () => {
  const attrs = (extra: Array<{ name: string; value: string }>) =>
    row({ note_attributes: [
      { name: 'delivery_ready_at', value: '2026-09-17T14:25:00+01:00' },
      { name: 'delivery_deadline', value: '2026-09-17T17:00:00+01:00' },
      { name: 'delivery_label', value: 'By 5:00pm' },
      ...extra,
    ] });

  it('booked state carries rider and links', () => {
    const c = courierInfo(attrs([
      { name: 'ibc_courier_status', value: 'booked' },
      { name: 'ibc_courier_courier_name', value: 'Botirjon H.' },
      { name: 'ibc_courier_last_status', value: 'collected' },
      { name: 'ibc_courier_tracking_url', value: 'https://gophr.example/t/abc' },
      { name: 'ibc_courier_job_url', value: 'https://gophr.example/j/abc' },
    ]));
    expect(c.status).toBe('booked');
    expect(c.riderName).toBe('Botirjon H.');
    expect(c.trackingUrl).toContain('/t/abc');
  });

  it('needs_review and failed keep their note; unknown/missing → unbooked', () => {
    expect(courierInfo(attrs([{ name: 'ibc_courier_status', value: 'needs_review' }, { name: 'ibc_courier_note', value: 'Quote £18.40 over cap' }])).note).toBe('Quote £18.40 over cap');
    expect(courierInfo(attrs([{ name: 'ibc_courier_status', value: 'failed' }])).status).toBe('failed');
    expect(courierInfo(attrs([])).status).toBe('unbooked'); // the #1097 case
    expect(courierInfo(attrs([{ name: 'ibc_courier_status', value: 'something-new' }])).status).toBe('unbooked');
  });

  it('estimated pickup prefers the courier ETA over the planned ready time', () => {
    const planned = courierInfo(attrs([]));
    expect(planned.estimatedPickupAt).toBe('2026-09-17T14:25:00+01:00');
    expect(planned.etaSource).toBe('planned');

    const live = courierInfo(attrs([{ name: 'ibc_courier_eta', value: '2026-09-17T14:40:00+01:00' }]));
    expect(live.estimatedPickupAt).toBe('2026-09-17T14:40:00+01:00');
    expect(live.etaSource).toBe('courier');
  });

  it('quote larger than price is by design, not an error — both just parse', () => {
    const c = courierInfo(attrs([
      { name: 'delivery_price_pence', value: '495' },
      { name: 'ibc_courier_quote_pence', value: '840' },
    ]));
    expect(c.pricePence).toBe(495);
    expect(c.quotePence).toBe(840);
  });
});

describe('delivery charge line (hidden product)', () => {
  it('IBC-DEL-* SKUs are excluded from packing/counts', () => {
    expect(isDeliveryChargeLine('IBC-DEL-0495')).toBe(true);
    expect(isDeliveryChargeLine('IBC-DEL-4995')).toBe(true);
    expect(isDeliveryChargeLine('ibc-del-0995')).toBe(true);
    expect(isDeliveryChargeLine('IB-PRA-16')).toBe(false);
    expect(isDeliveryChargeLine(null)).toBe(false);
  });
});

describe('customer tracking message', () => {
  it('is the exact hand-typed message, ready to paste', () => {
    expect(trackingMessage('https://x/t/1')).toBe(
      'Your Italian Bear order is on its way — track your rider here: https://x/t/1'
    );
  });
});
