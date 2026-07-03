# Deployment (Vercel + Supabase)

## Vercel

1. Push the repo to GitHub and **Import Project** in Vercel (framework auto-detected: Next.js).
2. Add every variable from `.env.example` in Project → Settings → Environment Variables. `SUPABASE_SERVICE_ROLE_KEY`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, `ONESIGNAL_REST_API_KEY` and `CRON_SECRET` are server-only secrets — never prefix them `NEXT_PUBLIC_`.
3. Deploy. Set `NEXT_PUBLIC_APP_URL` to the final production URL and redeploy.
4. **Crons** — `vercel.json` schedules:
   - `/api/cron/reminders` every minute
   - `/api/cron/escalations` every minute
   - `/api/cron/retry` every 5 minutes

   Minute-level Vercel crons require a paid plan. On Hobby, use an external pinger (e.g. cron-job.org or GitHub Actions) hitting those URLs every minute with header `Authorization: Bearer <CRON_SECRET>`. In Vercel project settings, configure the cron jobs to send the same header (Vercel Cron supports a `CRON_SECRET` env convention; the routes check `Authorization: Bearer`).

## Supabase

1. Run `supabase/migrations/0001_init.sql`.
2. Authentication → URL Configuration → set Site URL to the Vercel URL.
3. Realtime is enabled for `orders` and `order_events` by the migration (`supabase_realtime` publication).
4. Create staff users + `staff_profiles` rows (see README).

## Post-deploy smoke test

1. `curl -i https://<app>/api/webhooks/shopify -d '{}'` → **401** (HMAC rejected) proves the endpoint is up and verifying.
2. Sign in → Pickup tab loads with summary cards.
3. Trigger a test order in Shopify → appears in seconds; check `webhook_events` shows `processed`.
4. `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/reminders` → `{ ok: true … }`.
