import { createHmac, timingSafeEqual } from 'crypto';

/** Checks a Resend (Svix) webhook signature: HMAC-SHA256 of "id.timestamp.body" with the whsec_ secret. */
export function verifySvix(secret: string, id: string, timestamp: string, body: string, signatures: string, nowSec = Date.now() / 1000): boolean {
  if (!secret || !id || !timestamp || !signatures) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false; // replay protection: 5 minutes
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signatures.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
