/**
 * Shopify Admin GraphQL client for one store.
 * Auth supports both app types:
 *  - Dev Dashboard app (current): SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET
 *    are exchanged for a short-lived access token via the OAuth client
 *    credentials grant (tokens expire after 24 h; cached and auto-renewed).
 *  - Legacy admin custom app: a permanent SHOPIFY_ADMIN_ACCESS_TOKEN.
 * Handles throttling (retry with backoff on THROTTLED / 429) and surfaces
 * userErrors so callers never treat a failed write as success.
 */

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2026-07';

export class ShopifyUserError extends Error {
  constructor(public userErrors: Array<{ field?: string[] | null; message: string }>, public operation: string) {
    super(`Shopify userErrors in ${operation}: ${userErrors.map((e) => e.message).join('; ')}`);
    this.name = 'ShopifyUserError';
  }
}

export class ShopifyHttpError extends Error {
  constructor(public status: number, body: string, operation: string) {
    super(`Shopify HTTP ${status} in ${operation}: ${body.slice(0, 500)}`);
    this.name = 'ShopifyHttpError';
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Legacy permanent token takes precedence if provided.
  const staticToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (staticToken) return staticToken;

  // Renew 5 minutes before expiry.
  if (cachedToken && cachedToken.expiresAt - Date.now() > 5 * 60000) {
    return cachedToken.token;
  }

  const shop = process.env.SHOPIFY_SHOP_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!shop || !clientId || !clientSecret) {
    throw new Error(
      'Shopify auth env vars missing: set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard app) or SHOPIFY_ADMIN_ACCESS_TOKEN (legacy custom app)'
    );
  }

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new ShopifyHttpError(res.status, await res.text().catch(() => ''), 'client_credentials_grant');
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 86400) * 1000,
  };
  return cachedToken.token;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

export async function shopifyGraphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  operation = 'graphql'
): Promise<T> {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN;
  if (!shop) throw new Error('Shopify env var missing: SHOPIFY_SHOP_DOMAIN');

  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });

    // Expired/revoked rotating token → drop cache and retry with a fresh one.
    if (res.status === 401 && !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN && attempt < maxAttempts) {
      cachedToken = null;
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxAttempts) throw new ShopifyHttpError(res.status, await res.text().catch(() => ''), operation);
      const retryAfter = parseFloat(res.headers.get('Retry-After') ?? '') || attempt;
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) throw new ShopifyHttpError(res.status, await res.text().catch(() => ''), operation);

    const json = (await res.json()) as GraphQLResponse<T>;
    if (json.errors?.length) {
      const throttled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < maxAttempts) {
        await sleep(1000 * attempt);
        continue;
      }
      throw new Error(`Shopify GraphQL errors in ${operation}: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    if (!json.data) throw new Error(`Shopify returned no data for ${operation}`);
    return json.data;
  }
  throw new Error(`Shopify request failed after retries: ${operation}`);
}

/** Throw ShopifyUserError if a mutation payload carries userErrors. */
export function assertNoUserErrors(
  payload: { userErrors?: Array<{ field?: string[] | null; message: string }> } | null | undefined,
  operation: string
): void {
  if (payload?.userErrors?.length) throw new ShopifyUserError(payload.userErrors, operation);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function orderAdminUrl(legacyOrderId: number | string): string {
  const shop = (process.env.SHOPIFY_SHOP_DOMAIN ?? '').replace('.myshopify.com', '');
  return `https://admin.shopify.com/store/${shop}/orders/${legacyOrderId}`;
}
