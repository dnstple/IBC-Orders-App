# Visit emails (thank-you after a visit)

One email to each guest after a table booking at Soho or Fitzrovia, once
TableAgent shows they arrived. Admins run it from the **Visit emails** tab (hidden from staff and managers).

## How it works

```
TableAgent ──► ibc-booking worker  GET /admin/api/visits   (read-only, MAILER_KEY)
                   │
                   ▼
Orders app  /api/cron/visit-emails  (every 15 min, cron-job.org)
   1. read the last 4 days of bookings
   2. decide: wait / skip (with reason) / queue (full or plain version)
   3. send what's due: batch size, daily cap, send window (London time)
   Links in the email ──► /r/<token>/<link>  (counts the click, adds UTMs, redirects)
   Footer opt-out    ──► /r/<token>/unsubscribe
```

Rules, in order: café switched on → status is one of the "arrived" statuses
(otherwise wait 48 h for staff to update it, then skip as not arrived) → has
an email → not opted out → marketing switch (Yes only, or everyone) → not
emailed in the last N days (either café) → due *delay* hours after the booking,
moved into the send window. Each booking is handled once, ever.

Modes: **Off** (nothing), **Dry run** (everything recorded and counted, no
email leaves), **Live** (sends). Live is locked twice: the dashboard switch and
`VISIT_EMAILS_ALLOW_LIVE=true` + `RESEND_API_KEY` in Vercel.

## Setup

1. **Worker**: in `C:\Users\danie\Documents\ibc-booking\worker`
   - `npx.cmd wrangler secret put MAILER_KEY` (type a long random password)
   - `npx.cmd wrangler deploy`
2. **Database**: run `supabase/migrations/0006_visit_emails.sql` in the Supabase SQL editor.
3. **Vercel env**: `VISITS_FEED_KEY` = the same password; leave `VISIT_EMAILS_ALLOW_LIVE=false`.
4. **Cron**: cron-job.org, every 15 minutes, `GET https://<app>/api/cron/visit-emails`
   with header `Authorization: Bearer <CRON_SECRET>`.
5. On the tab: **Load statuses from TableAgent**, tick the ones that mean
   "arrived", add the Google review link for each café, check the preview, set
   **Dry run**, save.

## Going live (later)

1. Resend: add the domain, add its DNS records (SPF/DKIM on a `send.`
   subdomain + `resend._domainkey`; DMARC on the root), wait for "Verified".
2. Vercel: `RESEND_API_KEY`, `VISIT_EMAILS_ALLOW_LIVE=true`, redeploy.
3. Tab: send yourself a test (backfill a day you visited with your own email),
   then switch to **Live**. Use **Re-queue dry-run emails** only if the guests
   from the dry-run period should get the real email.

## Click and sales tracking

- Clicks: counted per button on the tab (scanners such as Outlook Safe Links are
  flagged and left out).
- Sales: links to italianbearchocolate.com carry `utm_source=visit-email`,
  `utm_medium=email`, `utm_campaign=thank-you-for-visiting`,
  `utm_content=<button>-<café>`. In Shopify: Analytics → Reports → sessions or
  sales by UTM campaign.

## Data kept

Email + first name only on rows that are queued or sent; skipped bookings keep
booking id, date, café and reason. Opt-outs go to `visit_email_suppressions`.

## Brand fonts

The name (League Gothic) and the closing line (Cookie) are PNG images drawn by
`/r/img/wordmark` and `/r/img/tagline?t=…` (fonts bundled next to that route,
SIL Open Font License), because Gmail and Outlook ignore web fonts. Change
`IMG_V` in `render.ts` if the images change, so inboxes fetch the new ones.

## Funnel (delivered / opened / bounced / spam)

1. Run `supabase/migrations/0007_visit_email_events.sql`.
2. Resend → Webhooks → Add endpoint `https://ibc-orders.vercel.app/api/webhooks/resend`,
   events: email.delivered, email.delivery_delayed, email.bounced, email.complained, email.opened.
3. Copy its signing secret (`whsec_…`) into Vercel as `RESEND_WEBHOOK_SECRET`, redeploy.
4. Opens: Resend → Domains → the domain → turn on open tracking.

Permanent bounces and spam complaints are added to the do-not-email list automatically.

## Styles, saved versions and sales

- **Style**: Letter (default; plain, small name at the top) or Branded (header bar). Both use the same copy boxes.
- **Saved versions**: run `supabase/migrations/0008_visit_email_settings_history.sql`. Every Save is kept; "Saved versions" on the tab loads any back. Unsaved edits are kept as a draft in the browser and leaving the page asks first.
- **Sales** (funnel step 5): Shopify orders whose visit carried `utm_campaign` (customerJourneySummary), plus a wider count of orders by emailed guests within 30 days.
- Code changes never edit the saved settings; new options only add defaults for fields that were never saved.
