import { describe, it, expect } from 'vitest';
import { isDemoOrder } from '@/lib/shopify/sync';

describe('demo-order guard (Shopify write firewall)', () => {
  it('blocks seeded demo IDs and demo-tagged orders', () => {
    expect(isDemoOrder({ shopify_order_id: 900000000001, tags: [] })).toBe(true);
    expect(isDemoOrder({ shopify_order_id: 900000000105, tags: [] })).toBe(true);
    expect(isDemoOrder({ shopify_order_id: 123, tags: ['demo'] })).toBe(true);
  });
  it('NEVER classifies real Shopify orders as demo (regression: real IDs are ~8e12)', () => {
    expect(isDemoOrder({ shopify_order_id: 8293195546890, tags: [] })).toBe(false);
    expect(isDemoOrder({ shopify_order_id: 8290835955978, tags: [] })).toBe(false);
    expect(isDemoOrder({ shopify_order_id: 900000001000, tags: [] })).toBe(false);
  });
});
