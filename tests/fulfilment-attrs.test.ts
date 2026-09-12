import { describe, it, expect } from 'vitest';
import { parseFulfilmentAttrs } from '@/lib/pickup-attrs';
import { deliveryInfo, isUndatedDelivery, operationalDateKey } from '@/lib/operational';
import type { OrderRow } from '@/types/db';

/**
 * The storefront fulfilment-picker contract: three valid shapes, plus the
 * live-data gotchas (absent attributes, the literal string "false",
 * missing delivery_method on historical orders).
 */

describe('parseFulfilmentAttrs — the three contract shapes', () => {
  it('standard shipping (#1087): delivery, standard, and NO date', () => {
    const f = parseFulfilmentAttrs([
      { key: 'delivery_method', value: 'delivery' },
      { key: 'delivery_option', value: 'standard' },
    ]);
    expect(f.deliveryMethod).toBe('delivery');
    expect(f.option).toBe('standard');
    expect(f.deliveryDate).toBeNull();   // never invent a date
    expect(f.deliveryLabel).toBeNull();
    expect(f.pickup.requested).toBe(false);
  });

  it('scheduled delivery: requested date + display label', () => {
    const f = parseFulfilmentAttrs([
      { key: 'delivery_method', value: 'delivery' },
      { key: 'delivery_option', value: 'scheduled' },
      { key: 'delivery_date', value: '2026-09-20' },
      { key: 'delivery_label', value: 'Sat 20th Sept' },
    ]);
    expect(f.option).toBe('scheduled');
    expect(f.deliveryDate).toBe('2026-09-20');
    expect(f.deliveryLabel).toBe('Sat 20th Sept');
  });

  it('collection (#1083): pickup keys, delivery_option deliberately empty', () => {
    const f = parseFulfilmentAttrs([
      { key: 'ibc_pickup_requested', value: 'true' },
      { key: 'ibc_pickup_date', value: '2026-09-04' },
      { key: 'ibc_pickup_slot_start', value: '2026-09-04T20:00:00+01:00' },
      { key: 'ibc_pickup_slot_end', value: '2026-09-04T20:30:00+01:00' },
      { key: 'ibc_pickup_slot_label', value: 'Friday 4 September, 8:00–8:30pm' },
      { key: 'ibc_pickup_delay_minutes', value: '60' },
      { key: 'ibc_pickup_location', value: 'Italian Bear Chocolate' },
      { key: 'delivery_option', value: '' },
    ]);
    expect(f.pickup.requested).toBe(true);
    expect(f.pickup.date).toBe('2026-09-04');
    expect(f.option).toBeNull();
    expect(f.deliveryDate).toBeNull();
  });
});

describe('parseFulfilmentAttrs — live-data gotchas', () => {
  it('no attributes at all (most historical orders) → all null, no error', () => {
    const f = parseFulfilmentAttrs([]);
    expect(f.deliveryMethod).toBeNull();
    expect(f.option).toBeNull();
    expect(f.deliveryDate).toBeNull();
    expect(f.pickup.requested).toBe(false);
  });

  it('#1055: ibc_pickup_requested="false" is NOT a collection', () => {
    const f = parseFulfilmentAttrs([{ key: 'ibc_pickup_requested', value: 'false' }]);
    expect(f.pickup.requested).toBe(false);
    expect(f.deliveryMethod).toBeNull();
  });

  it('delivery_method=pickup marks collection even without the ibc flag', () => {
    const f = parseFulfilmentAttrs([{ key: 'delivery_method', value: 'pickup' }]);
    expect(f.deliveryMethod).toBe('pickup');
  });

  it('a delivery_date without delivery_option=scheduled is ignored', () => {
    const f = parseFulfilmentAttrs([
      { key: 'delivery_method', value: 'delivery' },
      { key: 'delivery_date', value: '2026-09-20' },
    ]);
    expect(f.deliveryDate).toBeNull();
  });

  it('accepts webhook naming (name) as well as GraphQL naming (key)', () => {
    const f = parseFulfilmentAttrs([
      { name: 'delivery_method', value: 'delivery' },
      { name: 'delivery_option', value: 'standard' },
    ]);
    expect(f.option).toBe('standard');
  });
});

/* Row-level display/sorting behaviour */
function row(overrides: Partial<OrderRow>): OrderRow {
  return {
    fulfillment_method: 'shipping', pickup_requested: false, pickup_date: null,
    operational_date: '2026-09-12', shopify_created_at: '2026-09-12T09:00:00+01:00',
    delivery_option: null, delivery_date: null, delivery_label: null,
    date_source: 'shopify_created',
    ...overrides,
  } as OrderRow;
}

describe('deliveryInfo / grouping', () => {
  it('scheduled deliveries carry their requested day and sort into it', () => {
    const o = row({ delivery_option: 'scheduled', delivery_date: '2026-09-20', delivery_label: 'Sat 20th Sept', operational_date: '2026-09-20', date_source: 'delivery_scheduled' });
    expect(deliveryInfo(o)).toEqual({ kind: 'scheduled', label: 'Sat 20th Sept', date: '2026-09-20' });
    expect(isUndatedDelivery(o)).toBe(false);
    expect(operationalDateKey(o)).toBe('2026-09-20');
  });

  it('standard shipping has no date and groups as undated', () => {
    const o = row({ delivery_option: 'standard', date_source: 'delivery_standard' });
    expect(deliveryInfo(o).kind).toBe('standard');
    expect(isUndatedDelivery(o)).toBe(true);
  });

  it('pre-picker orders are "none", undated, and never invent a date', () => {
    const o = row({});
    expect(deliveryInfo(o).kind).toBe('none');
    expect(isUndatedDelivery(o)).toBe(true);
  });
});
