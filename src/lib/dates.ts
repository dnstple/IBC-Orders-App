/**
 * Europe/London date utilities.
 * All storage is UTC (timestamptz); everything shown or scheduled is
 * computed against the Europe/London wall clock, so BST/GMT transitions
 * are handled by Intl rather than fixed offsets.
 */

export const TZ = 'Europe/London';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

function londonParts(d: Date) {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFmt.formatToParts(d)) {
    if (type !== 'literal') p[type] = parseInt(value, 10);
  }
  // Intl can emit hour 24 at midnight
  if (p.hour === 24) p.hour = 0;
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** 'YYYY-MM-DD' for the instant, in London. */
export function londonDateKey(d: Date): string {
  const p = londonParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Convert a London wall-clock date/time to a UTC instant, DST-safe.
 * Two-pass: guess the instant as if UTC, measure the London offset at that
 * instant, correct, and re-verify (handles the wall clock near transitions).
 */
export function londonWallTimeToUtc(dateStr: string, timeStr = '00:00'): Date {
  const [y, m, day] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  let guess = Date.UTC(y, m - 1, day, hh, mm ?? 0, 0);
  for (let i = 0; i < 2; i++) {
    const p = londonParts(new Date(guess));
    const asIf = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const want = Date.UTC(y, m - 1, day, hh, mm ?? 0, 0);
    guess += want - asIf;
  }
  return new Date(guess);
}

export function formatLondonTime(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export function formatLondonDate(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

export function formatLondonFull(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

/** Day-group label: 'Today', 'Tomorrow', 'Sunday 5 July', or 'Past'. */
export function dayGroupLabel(d: Date, now = new Date()): string {
  const key = londonDateKey(d);
  const todayKey = londonDateKey(now);
  const tomorrowKey = londonDateKey(new Date(now.getTime() + 86400000));
  if (key === todayKey) return 'Today';
  if (key === tomorrowKey) return 'Tomorrow';
  if (key < todayKey) return 'Past';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

export type CountdownState = 'future' | 'soon' | 'due' | 'overdue';

export function countdown(target: Date, now = new Date()): { label: string; state: CountdownState } {
  const diffMin = Math.round((target.getTime() - now.getTime()) / 60000);
  if (diffMin <= -1) {
    const m = Math.abs(diffMin);
    return { label: `Overdue by ${m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`}`, state: 'overdue' };
  }
  if (diffMin <= 15) return { label: diffMin <= 0 ? 'Due now' : `Due in ${diffMin} min`, state: 'due' };
  if (diffMin <= 90) return { label: `Start preparing in ${diffMin - 15} min`, state: 'soon' };
  const h = Math.floor(diffMin / 60);
  return { label: h >= 24 ? `In ${Math.floor(h / 24)}d ${h % 24}h` : `In ${h}h ${diffMin % 60}m`, state: 'future' };
}

/** Try to parse a merchant-entered date value ('2026-07-05', '05/07/2026', '5 July 2026'). */
export function parseFlexibleDate(value: string): string | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return londonDateKey(new Date(t));
  return null;
}

/** Parse '14:00', '2:30 pm', '14.00' → 'HH:mm' or null. */
export function parseFlexibleTime(value: string): string | null {
  const m = value.trim().toLowerCase().match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || parseInt(m[2], 10) > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
