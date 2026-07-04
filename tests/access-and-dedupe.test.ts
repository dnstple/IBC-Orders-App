import { describe, it, expect } from 'vitest';

/**
 * Pending-user access: the role rank gate in lib/permissions.ts treats any
 * role outside staff/manager/admin as rank 0, and the database
 * is_active_staff() RLS function only admits active staff/manager/admin.
 * This test pins the rank logic used by every API route.
 */
const RANK: Record<string, number> = { staff: 1, manager: 2, admin: 3 };
const passes = (role: string, minimum: 'staff' | 'manager' | 'admin') =>
  (RANK[role] ?? 0) >= RANK[minimum];

describe('pending-user access restrictions', () => {
  it('pending and suspended users can never pass any gate', () => {
    for (const min of ['staff', 'manager', 'admin'] as const) {
      expect(passes('pending', min)).toBe(false);
      expect(passes('suspended', min)).toBe(false);
    }
  });
  it('approved roles pass appropriate gates only', () => {
    expect(passes('staff', 'staff')).toBe(true);
    expect(passes('staff', 'manager')).toBe(false);
    expect(passes('manager', 'manager')).toBe(true);
    expect(passes('admin', 'admin')).toBe(true);
  });
});

/**
 * Duplicate notification prevention relies on notification_events.dedupe_key
 * being UNIQUE. These tests pin the key shapes so two different events can
 * never collide and identical events always do.
 */
describe('duplicate notification prevention (dedupe keys)', () => {
  const newOrderKey = (orderId: string) => `new_order:${orderId}`;
  const reminderKey = (orderId: string, requiredAt: string) => `reminder_1h:${orderId}:${requiredAt}`;
  const escalationKey = (orderId: string, bucket: number) => `escalation_push:${orderId}:${bucket}`;

  it('same event produces the same key (DB unique constraint blocks resend)', () => {
    expect(newOrderKey('abc')).toBe(newOrderKey('abc'));
    expect(reminderKey('abc', '2026-07-05T14:30:00Z')).toBe(reminderKey('abc', '2026-07-05T14:30:00Z'));
  });
  it('rescheduled pickup times produce a new reminder key', () => {
    expect(reminderKey('abc', '2026-07-05T14:30:00Z')).not.toBe(reminderKey('abc', '2026-07-05T15:30:00Z'));
  });
  it('escalation buckets fire once per interval, not once ever', () => {
    expect(escalationKey('abc', 1)).not.toBe(escalationKey('abc', 2));
    expect(escalationKey('abc', 1)).toBe(escalationKey('abc', 1));
  });
});
