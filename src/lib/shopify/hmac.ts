import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify the X-Shopify-Hmac-Sha256 header against the RAW request body.
 * Must be computed on the exact bytes Shopify sent — read the body as text
 * before any JSON parsing.
 */
export function verifyShopifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}
