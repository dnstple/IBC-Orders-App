# Shopify custom app setup

This app is a **private custom app for one store** (no OAuth, no App Store).

## 1. Create the app

1. Shopify admin → **Settings → Apps and sales channels → Develop apps** (enable custom app development if prompted).
2. **Create an app** → name it `Italian Bear Orders`.
3. Configuration → **Admin API integration** → grant scopes:

| Scope | Why |
|---|---|
| `read_orders` | Read orders, line items, refunds, events |
| `write_orders` | Tags + metafields (`ib_status`, courier details) |
| `read_fulfillments` / `write_fulfillments` | Read + create fulfilments |
| `read_merchant_managed_fulfillment_orders` / `write_merchant_managed_fulfillment_orders` | Fulfillment Orders at your own locations, incl. ready-for-pickup |
| `read_assigned_fulfillment_orders` / `write_assigned_fulfillment_orders` | Fulfillment orders assigned to locations |
| `read_customers` | Customer name/email/phone on orders |
| `read_products` | Line-item images |
| `read_locations` | Pickup location details |

4. Set the **webhook API version** to `2026-07` (same as `SHOPIFY_API_VERSION`).
5. **Install app** → copy the **Admin API access token** (`shpat_…`) → `SHOPIFY_ADMIN_ACCESS_TOKEN`.
6. API credentials → copy the **API secret key** → `SHOPIFY_WEBHOOK_SECRET` (this signs webhooks).

## 2. Webhook subscriptions

All topics point to the same endpoint: `https://<your-app-domain>/api/webhooks/shopify`

Subscribe to:

- `orders/create`
- `orders/paid`
- `orders/updated`
- `orders/cancelled`
- `orders/fulfilled`
- `orders/partially_fulfilled`
- `refunds/create`
- `fulfillments/create`
- `fulfillments/update`

Custom apps register webhooks via the API. One-off registration with GraphiQL or curl:

```graphql
mutation {
  webhookSubscriptionCreate(
    topic: ORDERS_PAID
    webhookSubscription: { callbackUrl: "https://<your-app>/api/webhooks/shopify", format: JSON }
  ) {
    webhookSubscription { id }
    userErrors { field message }
  }
}
```

Repeat for each topic (`ORDERS_CREATE`, `ORDERS_UPDATED`, `ORDERS_CANCELLED`, `ORDERS_FULFILLED`, `ORDERS_PARTIALLY_FULFILLED`, `REFUNDS_CREATE`, `FULFILLMENTS_CREATE`, `FULFILLMENTS_UPDATE`). Verify with:

```graphql
{ webhookSubscriptions(first: 20) { nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }
```

Notes:
- Every payload is verified against `SHOPIFY_WEBHOOK_SECRET` (HMAC-SHA256 of the raw body).
- Handlers are idempotent — Shopify redelivery is detected via `X-Shopify-Webhook-Id` and acknowledged without reprocessing.
- The handler never trusts payload contents for state: it re-fetches the full order + fulfillment orders from the Admin API.

## 3. Pickup date/time attributes

Until the future slot picker exists, the app reads pickup/delivery dates from **cart/note attributes**. Default recognised keys (editable in `app_settings.date_attribute_keys`): `Pickup Date`, `Pickup Time`, `Delivery Date`, `Delivery Time`, `Dispatch Date`. Dates accepted as `YYYY-MM-DD`, `DD/MM/YYYY` or natural text; times as `14:00` / `2:30 pm`. Orders without a parseable date+time appear under **Time TBC** and get no 1-hour reminder.
