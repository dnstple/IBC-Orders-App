/**
 * Registers all Shopify webhook subscriptions for this app, pointing at
 * your deployed webhook endpoint.
 *
 * Usage:  node scripts/register-webhooks.mjs https://your-app.vercel.app
 *
 * Reads SHOPIFY_SHOP_DOMAIN + SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET
 * from .env.local. Webhooks belong to the app that registers them and are
 * signed with its client secret — which is why this must run with YOUR
 * app's credentials, not any other tool's.
 */
import { readFileSync } from 'fs';

const base = process.argv[2];
if (!base || !base.startsWith('https://')) {
  console.error('Usage: node scripts/register-webhooks.mjs https://your-app.vercel.app');
  process.exit(1);
}
const callbackUrl = `${base.replace(/\/$/, '')}/api/webhooks/shopify`;

// Minimal .env.local parser
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const { SHOPIFY_SHOP_DOMAIN: shop, SHOPIFY_CLIENT_ID: id, SHOPIFY_CLIENT_SECRET: secret } = env;
const apiVersion = env.SHOPIFY_API_VERSION || '2026-07';
if (!shop || !id || !secret) {
  console.error('Missing SHOPIFY_SHOP_DOMAIN / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET in .env.local');
  process.exit(1);
}

// Client credentials grant → access token
const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
});
if (!tokenRes.ok) {
  console.error('Token exchange failed:', tokenRes.status, await tokenRes.text());
  process.exit(1);
}
const { access_token } = await tokenRes.json();

async function gql(query, variables) {
  const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': access_token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const TOPICS = [
  'ORDERS_CREATE', 'ORDERS_PAID', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'ORDERS_DELETE',
  'ORDERS_FULFILLED', 'ORDERS_PARTIALLY_FULFILLED', 'REFUNDS_CREATE',
  'FULFILLMENTS_CREATE', 'FULFILLMENTS_UPDATE',
];

// Show existing subscriptions first
const existing = await gql(`{
  webhookSubscriptions(first: 50) {
    nodes { id topic uri }
  }
}`);
const have = new Map(existing.webhookSubscriptions.nodes.map((n) => [n.topic, n]));

const CREATE = `
  mutation Create($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }`;
const UPDATE = `
  mutation Update($id: ID!, $sub: WebhookSubscriptionInput!) {
    webhookSubscriptionUpdate(id: $id, webhookSubscription: $sub) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }`;

for (const topic of TOPICS) {
  const sub = { callbackUrl, format: 'JSON' };
  const current = have.get(topic);
  if (current) {
    if (current.uri === callbackUrl) {
      console.log(`= ${topic} already registered`);
      continue;
    }
    const data = await gql(UPDATE, { id: current.id, sub });
    const errs = data.webhookSubscriptionUpdate.userErrors;
    console.log(errs.length ? `✗ ${topic}: ${errs.map((e) => e.message).join('; ')}` : `~ ${topic} updated → ${callbackUrl}`);
  } else {
    const data = await gql(CREATE, { topic, sub });
    const errs = data.webhookSubscriptionCreate.userErrors;
    console.log(errs.length ? `✗ ${topic}: ${errs.map((e) => e.message).join('; ')}` : `✓ ${topic} registered → ${callbackUrl}`);
  }
}
console.log('\nDone. Place a test order to verify the pipeline.');
