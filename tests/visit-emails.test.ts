import { describe, expect, it } from 'vitest';
import { decide, intoSendWindow, londonDateTime, type Visit, type DecideContext } from '@/lib/visit-emails/eligibility';
import { destinationUrl, fill, findLink, inlineKey, renderEmail } from '@/lib/visit-emails/render';
import { DEFAULT_SETTINGS, normaliseSettings, type VisitEmailSettings } from '@/lib/visit-emails/settings';

const S = (o: Partial<VisitEmailSettings> = {}): VisitEmailSettings =>
  normaliseSettings({ ...DEFAULT_SETTINGS, arrived_statuses: ['seated', 'completed'], mode: 'dry_run', ...o });

const visit = (o: Partial<Visit> = {}): Visit => ({
  shop: 'soho', id: 'A1', date: '2026-11-08', time: '14:00', starts_at: '2026-11-08T14:00:00+00:00', party_size: 2,
  status: { id: 4, code: 'completed', name: 'Completed' }, first_name: 'Ada', email: 'ada@example.com', marketing: 'yes', ...o,
});

const ctx = (o: Partial<DecideContext> = {}): DecideContext => ({
  now: new Date('2026-11-09T12:00:00Z'), source: 'auto', suppressed: new Set(), recent: new Set(), ...o,
});

describe('decide', () => {
  it('queues an opted-in guest who arrived, delay hours after the booking, inside the window', () => {
    const d = decide(visit(), S({ delay_hours: 20 }), ctx({ now: new Date('2026-11-08T18:00:00Z') }));
    expect(d).toEqual({ action: 'queue', variant: 'marketing', dueAt: new Date('2026-11-09T10:00:00Z') });
  });

  it('moves an evening due time to the next morning', () => {
    const d = decide(visit({ starts_at: '2026-11-08T19:00:00+00:00' }), S({ delay_hours: 1 }), ctx({ now: new Date('2026-11-08T20:30:00Z') }));
    expect(d.action === 'queue' && d.dueAt.toISOString()).toBe('2026-11-09T10:00:00.000Z');
  });

  it('respects the marketing switch', () => {
    expect(decide(visit({ marketing: 'no' }), S(), ctx())).toEqual({ action: 'skip', reason: 'marketing_no' });
    expect(decide(visit({ marketing: null }), S(), ctx())).toEqual({ action: 'skip', reason: 'marketing_unanswered' });
  });

  it('with the switch off, non-opted-in guests get the plain version (or full, if chosen)', () => {
    const off = S({ respect_marketing: false });
    expect(decide(visit({ marketing: 'no' }), off, ctx())).toMatchObject({ action: 'queue', variant: 'plain' });
    expect(decide(visit({ marketing: null }), off, ctx())).toMatchObject({ action: 'queue', variant: 'plain' });
    expect(decide(visit({ marketing: 'yes' }), off, ctx())).toMatchObject({ action: 'queue', variant: 'marketing' });
    expect(decide(visit({ marketing: 'no' }), S({ respect_marketing: false, plain_for_non_opted_in: false }), ctx()))
      .toMatchObject({ action: 'queue', variant: 'marketing' });
  });

  it('waits for the status to settle, then skips no-shows', () => {
    const ns = visit({ status: { id: 5, code: 'no_show', name: 'No Show' } });
    expect(decide(ns, S(), ctx())).toEqual({ action: 'wait' });
    expect(decide(ns, S(), ctx({ now: new Date('2026-11-10T15:00:00Z') }))).toEqual({ action: 'skip', reason: 'not_arrived' });
  });

  it('records nothing until arrival statuses are chosen', () => {
    expect(decide(visit(), S({ arrived_statuses: [] }), ctx({ now: new Date('2026-11-20T12:00:00Z') }))).toEqual({ action: 'wait' });
  });

  it('skips opted-out, duplicate and email-less guests', () => {
    expect(decide(visit(), S(), ctx({ suppressed: new Set(['ada@example.com']) }))).toEqual({ action: 'skip', reason: 'opted_out' });
    expect(decide(visit(), S(), ctx({ recent: new Set(['ada@example.com']) }))).toEqual({ action: 'skip', reason: 'duplicate' });
    expect(decide(visit({ email: null }), S(), ctx())).toEqual({ action: 'skip', reason: 'no_email' });
  });

  it('skips cafés that are switched off', () => {
    expect(decide(visit(), S({ shops: ['fitzrovia'] }), ctx())).toEqual({ action: 'skip', reason: 'shop_off' });
  });

  it('automatic emails ignore visits before the go-live date and skip very late ones', () => {
    expect(decide(visit(), S({ auto_from_date: '2026-11-09' }), ctx())).toEqual({ action: 'ignore' });
    expect(decide(visit(), S({ max_late_days: 1 }), ctx({ now: new Date('2026-11-12T12:00:00Z') }))).toEqual({ action: 'skip', reason: 'too_late' });
  });

  it('backfill sends old visits now (inside the window), ignoring go-live date and lateness', () => {
    const d = decide(visit({ date: '2026-09-01', starts_at: '2026-09-01T13:00:00+01:00' }), S({ auto_from_date: '2026-11-01' }),
      ctx({ source: 'backfill', now: new Date('2026-11-09T12:00:00Z') }));
    expect(d).toEqual({ action: 'queue', variant: 'marketing', dueAt: new Date('2026-11-09T12:00:00Z') });
  });

  it('never decides a booking that has not happened yet', () => {
    expect(decide(visit({ starts_at: '2026-11-10T14:00:00+00:00' }), S(), ctx())).toEqual({ action: 'wait' });
  });
});

describe('London time', () => {
  it('handles BST and GMT', () => {
    expect(londonDateTime('2026-07-01', 10).toISOString()).toBe('2026-07-01T09:00:00.000Z');
    expect(londonDateTime('2026-12-01', 10).toISOString()).toBe('2026-12-01T10:00:00.000Z');
  });
  it('keeps times already inside the window', () => {
    const d = new Date('2026-07-01T12:00:00Z');
    expect(intoSendWindow(d, { send_window_start_hour: 10, send_window_end_hour: 19 })).toBe(d);
  });
});

describe('render', () => {
  it('fills placeholders and drops a missing first name cleanly', () => {
    expect(fill('Thank you for visiting, {first_name}', { firstName: '', shop: 'soho', visitDate: '2026-11-08' })).toBe('Thank you for visiting');
    expect(fill('Hi {first_name}, {shop} on {visit_day}', { firstName: 'Ada', shop: 'fitzrovia', visitDate: '2026-11-08' }))
      .toBe('Hi Ada, Fitzrovia on Sunday');
    expect(fill('{visit_date}', { firstName: '', shop: 'soho', visitDate: '2026-11-08' })).toBe('Sunday 8 November');
  });

  it('tags our own links with UTMs but leaves review sites alone, and prefers the per-café address', () => {
    const s = S();
    const shopLink = s.links.find((l) => l.key === 'shop')!;
    const u = new URL(destinationUrl(shopLink, 'soho', s));
    expect(u.searchParams.get('utm_campaign')).toBe('thank-you-for-visiting');
    expect(u.searchParams.get('utm_content')).toBe('shop-soho');
    const review = { key: 'review', label: 'Review', url: 'https://g.page/r/default', shop_urls: { fitzrovia: 'https://g.page/r/fitz' }, show_in: 'all' as const };
    expect(destinationUrl(review, 'fitzrovia', s)).toBe('https://g.page/r/fitz');
    expect(destinationUrl(review, 'soho', s)).toBe('https://g.page/r/default');
  });

  it('plain version leaves out marketing-only buttons; every button is a tracked link', () => {
    const s = S({ links: [
      { key: 'review', label: 'Review', url: 'https://g.page/r/x', show_in: 'all' },
      { key: 'shop', label: 'Shop', url: 'https://italianbearchocolate.com/collections/all', show_in: 'marketing' },
    ] });
    const plain = renderEmail(s, { token: 'abc123', appUrl: 'https://app.test/', shop: 'soho', firstName: 'Ada', visitDate: '2026-11-08', variant: 'plain' });
    expect(plain.links.map((l) => l.key)).toEqual(['review']);
    expect(plain.html).toContain('https://app.test/r/abc123/review');
    expect(plain.html).not.toContain('collections/all');
    expect(plain.optOutUrl).toBe('https://app.test/r/abc123/unsubscribe');
    const full = renderEmail(s, { token: 'abc123', appUrl: 'https://app.test', shop: 'soho', firstName: 'Ada', visitDate: '2026-11-08', variant: 'marketing' });
    expect(full.links.map((l) => l.key)).toEqual(['review', 'shop']);
  });

  it('escapes guest names and reports links with no address', () => {
    const e = renderEmail(S(), { token: 't', appUrl: 'https://app.test', shop: 'soho', firstName: '<script>x</script>', visitDate: '2026-11-08', variant: 'marketing' });
    expect(e.html).not.toContain('<script>');
    expect(e.missingLinks).toEqual(['Leave us a review']);
  });
});

describe('normaliseSettings', () => {
  it('fills defaults, drops bad links and reserved keys, and clamps numbers', () => {
    const s = normaliseSettings({
      mode: 'nonsense', batch_size: 9999, send_window_start_hour: 20, send_window_end_hour: 8,
      links: [{ key: 'unsubscribe', label: 'x', url: 'https://a.b' }, { key: 'Shop!', label: 'Shop', url: 'javascript:alert(1)' }],
    });
    expect(s.mode).toBe('off');
    expect(s.batch_size).toBe(200);
    expect(s.send_window_end_hour).toBe(21);
    expect(s.links).toEqual([{ key: 'shop', label: 'Shop', url: '', shop_urls: { soho: '', fitzrovia: '' }, show_in: 'all' }]);
    expect(s.respect_marketing).toBe(true);
  });
});

import { vi, afterEach } from 'vitest';
import { sendEmail, sendTestEmail, LiveSendingLocked } from '@/lib/visit-emails/sender';

describe('sender locks', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const email = () => renderEmail(S(), { token: 'preview', appUrl: 'https://app.test', shop: 'soho', firstName: 'Ada', visitDate: '2026-11-08', variant: 'plain' });

  it('test send refuses without a Resend key and never calls the network', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    vi.stubEnv('RESEND_API_KEY', '');
    await expect(sendTestEmail(S(), 'me@example.com', email())).rejects.toThrow(/Resend is not set up/);
    expect(f).not.toHaveBeenCalled();
  });

  it('test send goes to the one address with a [TEST] subject', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r1' }) }); vi.stubGlobal('fetch', f);
    vi.stubEnv('RESEND_API_KEY', 'k');
    await sendTestEmail(S(), 'me@example.com', email());
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.to).toEqual(['me@example.com']);
    expect(body.subject).toMatch(/^\[TEST\] /);
  });

  it('guest sending stays locked with a key but without live mode + VISIT_EMAILS_ALLOW_LIVE', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    vi.stubEnv('RESEND_API_KEY', 'k');
    await expect(sendEmail(S({ mode: 'dry_run' }), 'g@example.com', email(), 'x')).rejects.toBeInstanceOf(LiveSendingLocked);
    vi.stubEnv('VISIT_EMAILS_ALLOW_LIVE', 'false');
    await expect(sendEmail(S({ mode: 'live' }), 'g@example.com', email(), 'x')).rejects.toBeInstanceOf(LiveSendingLocked);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('copy markup, fonts and tagline', () => {
  const base = { token: 'tok123', appUrl: 'https://app.test', shop: 'soho', firstName: 'Ada', visitDate: '2026-11-11', variant: 'marketing' as const };

  it('turns **bold** and [text](url) into HTML, tracked, and plain text alternatives', () => {
    const s = S({ body_marketing: 'We **loved** having you. See [our hampers](https://italianbearchocolate.com/collections/hampers).' });
    const e = renderEmail(s, base);
    const key = inlineKey('https://italianbearchocolate.com/collections/hampers');
    expect(e.html).toContain('<strong>loved</strong>');
    expect(e.html).toContain(`href="https://app.test/r/tok123/${key}"`);
    expect(e.html).not.toContain('**');
    expect(e.text).toContain(`our hampers (https://app.test/r/tok123/${key})`);
    expect(e.text).toContain('We loved having you.');
    // the redirect can find it, and it gets UTM tags like the buttons
    const l = findLink(s, key)!;
    expect(l.label).toBe('our hampers');
    expect(new URL(destinationUrl(l, 'soho', s)).searchParams.get('utm_content')).toBe(`${key}-soho`);
  });

  it('escapes HTML inside bold and links, and ignores non-https links', () => {
    const s = S({ body_marketing: '**<b>x</b>** and [click](javascript:alert(1))' });
    const e = renderEmail(s, base);
    expect(e.html).toContain('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
    expect(e.html).not.toContain('href="javascript');
  });

  it('ends with the tagline in the website script font, and uses the site fonts', () => {
    const e = renderEmail(S(), base);
    expect(e.html).toContain('All you need is chocolate');
    expect(e.html).toMatch(/Cookie/);
    expect(e.html).toMatch(/Oswald/);
    expect(e.html).toMatch(/Cabin/);
    expect(e.text.trimEnd().endsWith('All you need is chocolate') || e.text.includes('team' + String.fromCharCode(10, 10) + 'All you need is chocolate')).toBe(true);
    expect(renderEmail(S({ tagline: '' }), base).html).not.toContain('All you need is chocolate');
  });

  it('button keys cannot pretend to be inline links', () => {
    expect(normaliseSettings({ links: [{ key: 't-abc', label: 'x', url: 'https://a.b' }] }).links).toEqual([]);
  });
});

import { createHmac } from 'crypto';
import { verifySvix } from '@/lib/visit-emails/webhook';

describe('Resend webhook signature', () => {
  const secret = 'whsec_' + Buffer.from('test-secret-key-123').toString('base64');
  const sign = (id: string, ts: string, body: string) =>
    'v1,' + createHmac('sha256', Buffer.from('test-secret-key-123')).update(`${id}.${ts}.${body}`).digest('base64');
  const now = 1_800_000_000;

  it('accepts a correct signature and rejects tampering, wrong secret and old timestamps', () => {
    const body = '{"type":"email.delivered","data":{"email_id":"abc"}}';
    const sig = sign('msg_1', String(now), body);
    expect(verifySvix(secret, 'msg_1', String(now), body, `v1,bogus ${sig}`, now)).toBe(true);
    expect(verifySvix(secret, 'msg_1', String(now), body.replace('abc', 'xyz'), sig, now)).toBe(false);
    expect(verifySvix('whsec_' + Buffer.from('other').toString('base64'), 'msg_1', String(now), body, sig, now)).toBe(false);
    expect(verifySvix(secret, 'msg_1', String(now - 600), body, sign('msg_1', String(now - 600), body), now)).toBe(false);
    expect(verifySvix('', 'msg_1', String(now), body, sig, now)).toBe(false);
  });
});

describe('brand-font images', () => {
  it('header and closing line are images with readable alt text', () => {
    const e = renderEmail(S(), { token: 't', appUrl: 'https://links.test', shop: 'soho', firstName: 'Ada', visitDate: '2026-11-11', variant: 'plain' });
    expect(e.html).toContain('src="https://links.test/r/img/wordmark?on=light&amp;v=');
    expect(e.html).toContain('alt="Italian Bear Chocolate"');
    expect(e.html).toContain('src="https://links.test/r/img/tagline?t=All%20you%20need%20is%20chocolate');
    expect(e.html).toContain('alt="All you need is chocolate"');
  });
});

import { decideAssumingAttendance } from '@/lib/visit-emails/eligibility';

describe('assume everyone attends (preview only)', () => {
  const future = visit({ date: '2026-11-15', starts_at: '2026-11-15T13:00:00+00:00', status: { id: 2, code: 'confirmed', name: 'Confirmed' } });
  it('treats a future confirmed booking as arrived and gives its real send time', () => {
    const d = decideAssumingAttendance(future, S({ delay_hours: 20, auto_from_date: '2026-12-01' }), ctx({ now: new Date('2026-11-14T09:00:00Z') }));
    expect(d).toEqual({ action: 'queue', variant: 'marketing', dueAt: new Date('2026-11-16T10:00:00Z') });
  });
  it('still leaves out cancelled bookings and no-shows, and still respects the marketing switch', () => {
    expect(decideAssumingAttendance({ ...future, status: { id: 6, code: 'canceled', name: 'Canceled' } }, S(), ctx()))
      .toEqual({ action: 'skip', reason: 'booking_cancelled' });
    expect(decideAssumingAttendance({ ...future, status: { id: 5, code: 'no_show', name: 'No Show' } }, S(), ctx()))
      .toEqual({ action: 'skip', reason: 'not_arrived' });
    expect(decideAssumingAttendance({ ...future, marketing: 'no' }, S(), ctx())).toEqual({ action: 'skip', reason: 'marketing_no' });
  });
});

describe('styles', () => {
  const input = { token: 't', appUrl: 'https://links.test', shop: 'soho', firstName: 'Ada', visitDate: '2026-11-11', variant: 'marketing' as const };
  it('letter is the default: no brown header bar, light wordmark, same copy', () => {
    const s = S();
    expect(s.style).toBe('letter');
    const e = renderEmail(s, input);
    expect(e.html).toContain('wordmark?on=light');
    expect(e.html).not.toContain('<h1');
    expect(e.html).toContain('Thank you for visiting, Ada');
  });
  it('branded keeps the header bar and heading', () => {
    const e = renderEmail(S({ style: 'branded' }), input);
    expect(e.html).toContain('wordmark?on=dark');
    expect(e.html).toContain('<h1');
  });
  it('saved copy is never replaced by defaults when settings are re-read', () => {
    const mine = { body_marketing: 'My own words on {visit_day}.', subject: 'My subject', signoff: 'Cheers', tagline: 'Mine' };
    const s = normaliseSettings({ ...mine, style: 'branded' });
    expect(normaliseSettings(s)).toMatchObject(mine);
  });
});

import { sendApprovedEmail } from '@/lib/visit-emails/sender';

describe('approve each one', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const email = () => renderEmail(S(), { token: 't', appUrl: 'https://app.test', shop: 'soho', firstName: 'Ada', visitDate: '2026-11-08', variant: 'marketing' });

  it('is a valid mode that survives saving', () => {
    expect(normaliseSettings({ mode: 'manual' }).mode).toBe('manual');
  });
  it('a hand-approved email still needs the server lock open', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    vi.stubEnv('RESEND_API_KEY', 'k'); vi.stubEnv('VISIT_EMAILS_ALLOW_LIVE', 'false');
    await expect(sendApprovedEmail(S({ mode: 'manual' }), 'g@example.com', email(), 'x')).rejects.toBeInstanceOf(LiveSendingLocked);
    expect(f).not.toHaveBeenCalled();
  });
  it('with the lock open it sends exactly one email to that guest, even in manual mode', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r9' }) }); vi.stubGlobal('fetch', f);
    vi.stubEnv('RESEND_API_KEY', 'k'); vi.stubEnv('VISIT_EMAILS_ALLOW_LIVE', 'true');
    await expect(sendApprovedEmail(S({ mode: 'manual' }), 'g@example.com', email(), 'visit-email-1')).resolves.toEqual({ id: 'r9' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0][1].body).to).toEqual(['g@example.com']);
    // but automatic sending is still refused in manual mode
    await expect(sendEmail(S({ mode: 'manual' }), 'g@example.com', email(), 'x')).rejects.toBeInstanceOf(LiveSendingLocked);
  });
});
