import { describe, it, expect } from 'vitest';
import {
  tabFor, groupByOperationalDay, sortPickup, toOperationalOrder,
  isPickupOrder, nativeStatus, slotTimeRange,
} from '@/lib/operational';
import type { OrderRow } from '@/types/db';

/** Minimal OrderRow factory for pure-logic tests. */
function order(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: crypto.randomUUID(),
    shopify_order_id: 1, shopify_order_gid: 'gid://shopify/Order/1',
    order_number: '#1042', shopify_admin_url: 'https://admin.shopify.com/store/x/orders/1',
    shopify_created_at: '2026-07-04T10:18:00+01:00',
    shopify_updated_at: '2026-07-04T10:18:00+01:00',
    financial_status: 'PAID', shopify_fulfillment_status: 'UNFULFILLED',
    cancelled_at: null, closed_at: null, test: false,
    fulfillment_method: 'pickup', pickup_location: null, delivery_address: null,
    customer_name: 'Test', customer_email: null, customer_phone: null,
    note: null, note_attributes: [], tags: [], discounts: [],
    currency: 'GBP', subtotal: 40, shipping_total: 0, tax_total: 0, total: 42.5,
    refund_summary: [], required_fulfilment_at: null, time_confirmed: false,
    date_source: 'shopify_created',
    pickup_requested: false, pickup_date: null,
    pickup_slot_start: null, pickup_slot_end: null, pickup_slot_label: null,
    pickup_delay_minutes: null,
    operational_date: '2026-07-04',
    pickup_slot_id: null, internal_status: 'new',
    acknowledged_at: null, acknowledged_by: null, assigned_staff_id: null,
    needs_attention: false, needs_attention_reason: null,
    courier_name: null, courier_booking_ref: null, courier_tracking_url: null,
    synced_at: '', updated_at: '',
    ...overrides,
  } as OrderRow;
}

const NOW = new Date('2026-07-04T12:00:00+01:00'); // "today" = 2026-07-04

describe('pickup detection via normalisation', () => {
  it('ibc_pickup_requested marks the order as pickup regardless of method', () => {
    const o = order({ pickup_requested: true, fulfillment_method: 'unknown' });
    expect(isPickupOrder(o)).toBe(true);
    expect(toOperationalOrder(o).orderType).toBe('pickup');
  });
  it('delivery orders are labelled delivery with the order time', () => {
    const o = order({ fulfillment_method: 'shipping' });
    const op = toOperationalOrder(o);
    expect(op.orderType).toBe('delivery');
    expect(op.operationalTime).toMatch(/^Ordered /);
  });
});

describe('Today / Future / Past grouping', () => {
  it('classifies by operational date in London', () => {
    expect(tabFor(order({ operational_date: '2026-07-04' }), NOW)).toBe('today');
    expect(tabFor(order({ operational_date: '2026-07-05' }), NOW)).toBe('future');
    expect(tabFor(order({ operational_date: '2026-07-03' }), NOW)).toBe('past');
  });
  it('pickup uses ibc_pickup_date; delivery uses creation date', () => {
    const pickupTomorrow = order({
      pickup_requested: true, pickup_date: '2026-07-05', operational_date: '2026-07-05',
    });
    const deliveryToday = order({
      fulfillment_method: 'local_delivery', operational_date: '2026-07-04',
    });
    expect(tabFor(pickupTomorrow, NOW)).toBe('future');
    expect(tabFor(deliveryToday, NOW)).toBe('today');
  });
  it('cancelled and fulfilled historical orders stay visible in past', () => {
    const cancelled = order({ operational_date: '2026-07-01', cancelled_at: '2026-07-01T12:00:00Z', internal_status: 'cancelled' });
    const fulfilled = order({ operational_date: '2026-07-02', internal_status: 'fulfilled', shopify_fulfillment_status: 'FULFILLED', fulfillment_method: 'shipping' });
    expect(tabFor(cancelled, NOW)).toBe('past');
    expect(tabFor(fulfilled, NOW)).toBe('past');
  });
});

describe('pickup slot sorting', () => {
  it('sorts by slot start, slotless orders last', () => {
    const a = order({ pickup_requested: true, pickup_slot_start: '2026-07-04T15:30:00+01:00' });
    const b = order({ pickup_requested: true, pickup_slot_start: '2026-07-04T10:00:00+01:00' });
    const c = order({ pickup_requested: true, pickup_slot_start: null });
    const sorted = sortPickup([a, c, b]);
    expect(sorted[0]).toBe(b);
    expect(sorted[1]).toBe(a);
    expect(sorted[2]).toBe(c);
  });
  it('groups days with pickup before delivery, both sorted', () => {
    const rows = [
      order({ fulfillment_method: 'shipping', operational_date: '2026-07-05', shopify_created_at: '2026-07-04T09:00:00+01:00' }),
      order({ pickup_requested: true, operational_date: '2026-07-05', pickup_slot_start: '2026-07-05T16:00:00+01:00' }),
      order({ pickup_requested: true, operational_date: '2026-07-05', pickup_slot_start: '2026-07-05T11:00:00+01:00' }),
    ];
    const [day] = groupByOperationalDay(rows);
    expect(day.dateKey).toBe('2026-07-05');
    expect(day.pickup).toHaveLength(2);
    expect(day.delivery).toHaveLength(1);
    expect(day.pickup[0].pickup_slot_start).toBe('2026-07-05T11:00:00+01:00');
  });
});

describe('slot display', () => {
  it('renders 3:30–4:00pm style ranges', () => {
    expect(slotTimeRange('2026-07-05T15:30:00+01:00', '2026-07-05T16:00:00+01:00')).toBe('3:30–4:00pm');
  });
  it('keeps both suffixes across noon', () => {
    expect(slotTimeRange('2026-07-05T11:30:00+01:00', '2026-07-05T12:00:00+01:00')).toBe('11:30am–12:00pm');
  });
});

describe('ready-for-pickup state', () => {
  it('shows Shopify-native Ready for pickup, never "Acknowledged"', () => {
    expect(nativeStatus(order({ internal_status: 'ready_for_pickup', pickup_requested: true }))).toBe('Ready for pickup');
    expect(nativeStatus(order({ internal_status: 'acknowledged' }))).toBe('Unfulfilled');
  });
  it('Shopify terminal states win over internal state', () => {
    expect(nativeStatus(order({ internal_status: 'ready_for_pickup', cancelled_at: '2026-07-04T12:00:00Z' }))).toBe('Cancelled');
    expect(nativeStatus(order({ internal_status: 'preparing', shopify_fulfillment_status: 'FULFILLED' }))).toBe('Fulfilled');
  });
});

describe('due-soon / urgency states', async () => {
  const { dueState } = await import('@/lib/operational');
  const NOW2 = new Date('2026-07-04T15:10:00+01:00');
  it('flags due_soon within 30 minutes of the slot start', () => {
    const o = order({ pickup_requested: true, pickup_slot_start: '2026-07-04T15:30:00+01:00' });
    expect(dueState(o, NOW2)).toBe('due_soon');
  });
  it('flags due_now once the slot has started', () => {
    const o = order({ pickup_requested: true, pickup_slot_start: '2026-07-04T15:00:00+01:00' });
    expect(dueState(o, NOW2)).toBe('due_now');
  });
  it('no urgency far ahead, for delivery, or once fulfilled/cancelled', () => {
    expect(dueState(order({ pickup_requested: true, pickup_slot_start: '2026-07-04T17:00:00+01:00' }), NOW2)).toBeNull();
    expect(dueState(order({ fulfillment_method: 'shipping' }), NOW2)).toBeNull();
    expect(dueState(order({ pickup_requested: true, pickup_slot_start: '2026-07-04T15:00:00+01:00', internal_status: 'fulfilled' }), NOW2)).toBeNull();
    expect(dueState(order({ pickup_requested: true, pickup_slot_start: '2026-07-04T15:00:00+01:00', cancelled_at: '2026-07-04T14:00:00Z', internal_status: 'cancelled' }), NOW2)).toBeNull();
  });
});
