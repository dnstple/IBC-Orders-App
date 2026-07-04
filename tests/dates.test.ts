import { describe, it, expect } from 'vitest';
import { londonWallTimeToUtc, londonDateKey, dayGroupLabel } from '@/lib/dates';

describe('Europe/London timezone handling', () => {
  it('converts BST wall time to the correct UTC instant', () => {
    // 5 July 2026 is BST (UTC+1): 15:30 London == 14:30Z
    expect(londonWallTimeToUtc('2026-07-05', '15:30').toISOString()).toBe('2026-07-05T14:30:00.000Z');
  });
  it('converts GMT wall time to the correct UTC instant', () => {
    // 5 January is GMT (UTC+0)
    expect(londonWallTimeToUtc('2026-01-05', '15:30').toISOString()).toBe('2026-01-05T15:30:00.000Z');
  });
  it('handles the October BST→GMT transition day', () => {
    // Clocks go back 25 Oct 2026; 14:00 London that day is GMT already? No —
    // the change happens at 02:00, so 14:00 is GMT (UTC+0).
    expect(londonWallTimeToUtc('2026-10-25', '14:00').toISOString()).toBe('2026-10-25T14:00:00.000Z');
    // The day before is still BST (UTC+1).
    expect(londonWallTimeToUtc('2026-10-24', '14:00').toISOString()).toBe('2026-10-24T13:00:00.000Z');
  });
  it('slot instants with explicit offsets do not shift the London day', () => {
    // 00:15 BST on the 5th is 23:15Z on the 4th — the London day must stay the 5th.
    const d = new Date('2026-07-05T00:15:00+01:00');
    expect(londonDateKey(d)).toBe('2026-07-05');
  });
  it('labels today/tomorrow relative to a fixed now', () => {
    const now = new Date('2026-07-04T10:00:00+01:00');
    expect(dayGroupLabel(new Date('2026-07-04T18:00:00+01:00'), now)).toBe('Today');
    expect(dayGroupLabel(new Date('2026-07-05T09:00:00+01:00'), now)).toBe('Tomorrow');
    expect(dayGroupLabel(new Date('2026-07-06T09:00:00+01:00'), now)).toBe('Monday 6 July');
  });
});
