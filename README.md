# Italian Bear Orders

Internal order-operations dashboard for **Italian Bear Chocolate**. It sits beside the Square POS on a tablet/laptop and is the main place staff see, prepare and action Shopify online orders.

**Shopify remains the source of truth.** This app reads orders via the Admin GraphQL API + webhooks, and writes fulfilment actions back so the real Shopify order page updates. It never creates Square orders, never duplicates Shopify orders, and never marks anything fulfilled until Shopify confirms.

## Stack

Next.js 15 (App Router, TypeScript, Tailwind) on Vercel · Supabase (Postgres, Auth, Realtime, RLS) · Shopify Admin GraphQL API `2026-07` · OneSignal web push · PWA (Add to Home Screen).

## Setup checklist

Work through these in order — each step is a prerequisite for the next.

**1. Supabase**
- [ ] Create a Supabase project (region: London/eu-west recommended).
- [ ] Run `supabase/migrations/0001_init.sql` in the SQL editor.
- [ ] (Optional) Run `supabase/seed_demo.sql` for demo orders — see "Demo mode" below.
- [ ] In Authentication → Providers, enable Email; disable public sign-ups (invite staff manually).
- [ ] Create staff users in Authentication → Users, then insert their `staff_profiles` rows:
      `insert into staff_profiles (id, full_name, role) values ('<auth user uuid>', 'Sarah', 'manager');`
      Roles: `staff` | `manager` | `admin`. Make yourself `admin`.
- [ ] Copy the project URL, anon key and service-role key into `.env`.

**2. Shopify custom app** — full walkthrough in `docs/shopify-setup.md`
- [ ] Create the custom app, grant the scopes listed there, install it.
- [ ] Copy the Admin API access token and API secret key (webhook secret) into `.env`.
- [ ] Register the webhook subscriptions (topics listed in the doc) pointing at `https://<your-app>/api/webhooks/shopify`.

**3. OneSignal**
- [ ] Create a OneSignal app (Web platform), site URL = your deployment URL.
- [ ] Copy App ID and REST API key into `.env`.
- [ ] `public/OneSignalSDKWorker.js` is already included and served from the site root.

**4. Deploy** — full walkthrough in `docs/deployment.md`
- [ ] Push to GitHub, import into Vercel, add all `.env.example` variables.
- [ ] Vercel crons (from `vercel.json`) need a paid plan for minute-level schedules; alternatives in the deployment doc.
- [ ] Set `CRON_SECRET` and configure Vercel cron to send `Authorization: Bearer <CRON_SECRET>`.

**5. First run**
- [ ] Sign in, open Settings, confirm escalation/reminder timings.
- [ ] Press "Sync from Shopify" to backfill recent orders.
- [ ] Place a £0/£1 test order in Shopify → it should appear within seconds with a sound alert.
- [ ] On each staff tablet/phone: open the site, allow notifications, Add to Home Screen.
- [ ] Add `public/icons/icon-192.png`, `icon-512.png` and `public/sounds/new-order.mp3` (placeholders documented in those folders).

**6. Verify** — run the test plan in `docs/test-plan.md`.

## Demo mode

`supabase/seed_demo.sql` inserts realistic pickup + delivery orders (confirmed times, Time TBC, overdue, allergy note, gift message, cancelled, refunded, fulfilled). Demo orders use fake Shopify IDs (≥ 900000000000) and a `demo` tag; **all Shopify write paths refuse to call Shopify for them** (`isDemoOrder`), so you can exercise every button safely. Set `DEMO_MODE=true` to acknowledge you're running with seed data.

## Architecture at a glance

- `src/app/api/webhooks/shopify` — single endpoint for all topics: HMAC verify → idempotent store (unique `X-Shopify-Webhook-Id`) → fast 200 → async full-order re-fetch from Shopify (`waitUntil`), with a cron retry net.
- `src/lib/shopify/sync.ts` — normalisation: fulfilment method from **Fulfillment Orders** (`deliveryMethod.methodType`), `required_fulfilment_at` derivation (slot → note attributes → created-at fallback marked Time TBC), stale-write guard on `updatedAt`, reminder-job reconciliation.
- `src/lib/shopify/actions.ts` — writes: `fulfillmentOrderLineItemsPreparedForPickup`, `fulfillmentCreate` (full/partial, tracking, notify toggle), tags/metafields mirror. All failures land in `shopify_write_errors` (admin retry log).
- `src/app/api/cron/*` — reminders (1 h before confirmed times, Europe/London-safe), escalations (configurable), webhook retry.
- Roles enforced server-side in every route via `requireRole` — UI hiding is cosmetic only.

## Docs

- `docs/shopify-setup.md` — custom app, scopes, webhook subscriptions
- `docs/deployment.md` — Vercel + Supabase deployment
- `docs/test-plan.md` — full acceptance test plan
- `docs/known-limitations.md` — confirmed Shopify capabilities vs internal statuses vs future work
