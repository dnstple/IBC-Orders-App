import { describe, it, expect } from 'vitest';
import { parsePickupAttrs } from '@/lib/pickup-attrs';

const FULL = [
  { name: 'ibc_pickup_requested', value: 'true' },
  { name: 'ibc_pickup_date', value: '2026-07-05' },
  { name: 'ibc_pickup_slot_start', value: '2026-07-05T15:30:00+01:00' },
  { name: 'ibc_pickup_slot_end', value: '2026-07-05T16:00:00+01:00' },
  { name: 'ibc_pickup_slot_label', value: 'Sunday 5 July, 3:30–4:00pm' },
  { name: 'ibc_pickup_delay_minutes', value: '60' },
  { name: 'ibc_pickup_location', value: 'Italian Bear Chocolate' },
];

describe('pickup order detection', () => {
  it('detects a pickup order when ibc_pickup_requested=true', () => {
    expect(parsePickupAttrs(FULL).requested).toBe(true);
  });
  it('is not pickup when the flag is absent or not "true"', () => {
    expect(parsePickupAttrs([]).requested).toBe(false);
    expect(parsePickupAttrs([{ name: 'ibc_pickup_requested', value: 'false' }]).requested).toBe(false);
    expect(parsePickupAttrs([{ name: 'ibc_pickup_requested', value: 'yes' }]).requested).toBe(false);
  });
  it('accepts Shopify "key" naming as well as "name"', () => {
    expect(parsePickupAttrs([{ key: 'ibc_pickup_requested', value: 'TRUE' }]).requested).toBe(true);
  });
});

describe('pickup date parsing', () => {
  it('parses all fields from a complete attribute set', () => {
    const p = parsePickupAttrs(FULL);
    expect(p.date).toBe('2026-07-05');
    expect(p.slotStart).toBe('2026-07-05T15:30:00+01:00');
    expect(p.slotEnd).toBe('2026-07-05T16:00:00+01:00');
    expect(p.slotLabel).toBe('Sunday 5 July, 3:30–4:00pm');
    expect(p.location).toBe('Italian Bear Chocolate');
    expect(p.delayMinutes).toBe(60);
  });
  it('rejects malformed dates, instants and delays', () => {
    const p = parsePickupAttrs([
      { name: 'ibc_pickup_requested', value: 'true' },
      { name: 'ibc_pickup_date', value: '05/07/2026' },
      { name: 'ibc_pickup_slot_start', value: 'not-a-date' },
      { name: 'ibc_pickup_delay_minutes', value: 'soon' },
    ]);
    expect(p.date).toBeNull();
    expect(p.slotStart).toBeNull();
    expect(p.delayMinutes).toBeNull();
  });
  it('treats empty values as missing', () => {
    const p = parsePickupAttrs([{ name: 'ibc_pickup_date', value: '  ' }]);
    expect(p.date).toBeNull();
  });
});
