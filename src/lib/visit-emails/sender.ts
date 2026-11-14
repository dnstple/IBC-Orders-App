import { liveSendingAllowed, type VisitEmailSettings } from './settings';
import type { RenderedEmail } from './render';

/**
 * Sends one email through Resend. Locked twice: the dashboard must be in
 * 'live' mode AND the server must have VISIT_EMAILS_ALLOW_LIVE=true plus
 * RESEND_API_KEY. Until both are true this never touches the network.
 */
export class LiveSendingLocked extends Error {
  constructor() { super('Live sending is locked on the server (VISIT_EMAILS_ALLOW_LIVE / RESEND_API_KEY).'); }
}

export async function sendEmail(
  s: VisitEmailSettings,
  to: string,
  email: RenderedEmail,
  idempotencyKey: string
): Promise<{ id: string }> {
  if (s.mode !== 'live' || !liveSendingAllowed()) throw new LiveSendingLocked();
  return deliver(s, to, email, idempotencyKey);
}

/** One email an admin approved by hand (Approve-each-one mode, or a dry-run email). Needs the server lock open. */
export async function sendApprovedEmail(s: VisitEmailSettings, to: string, email: RenderedEmail, idempotencyKey: string): Promise<{ id: string }> {
  if (!liveSendingAllowed()) throw new LiveSendingLocked();
  return deliver(s, to, email, idempotencyKey);
}

/** Resend is set up (key present). Test sends only need this; guest sends need liveSendingAllowed(). */
export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * A test email to an address an admin typed in. Works in any mode once
 * RESEND_API_KEY exists, so the email can be checked in a real inbox before
 * any guest gets one. Links use the 'preview' token: no clicks counted, and
 * the opt-out link does nothing.
 */
export async function sendTestEmail(s: VisitEmailSettings, to: string, email: RenderedEmail): Promise<{ id: string }> {
  if (!resendConfigured()) throw new Error('Resend is not set up yet (RESEND_API_KEY is missing in Vercel).');
  return deliver(s, to, { ...email, subject: `[TEST] ${email.subject}` }, `visit-email-test-${Date.now()}`);
}

async function deliver(s: VisitEmailSettings, to: string, email: RenderedEmail, idempotencyKey: string): Promise<{ id: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  const payload: Record<string, unknown> = {
    from: `${s.from_name} <${s.from_email}>`,
    to: [to],
    subject: email.subject,
    html: email.html,
    text: email.text,
    tags: [{ name: 'campaign', value: s.utm_campaign.replace(/[^A-Za-z0-9_-]/g, '_') }],
  };
  if (s.reply_to) payload.reply_to = s.reply_to;
  if (email.optOutUrl) {
    payload.headers = {
      'List-Unsubscribe': `<${email.optOutUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${String(data?.message ?? data?.name ?? '').slice(0, 200)}`);
  return { id: String(data.id ?? '') };
}
