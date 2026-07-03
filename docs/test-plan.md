# Test plan

Run after deployment against a Shopify development store (or with test orders). For each case, verify the dashboard, Supabase (`orders`, `order_events`, `webhook_events`) **and the Shopify admin order page**.

## 1. Paid pickup order
Place an order with local pickup + `Pickup Date`/`Pickup Time` attributes, pay it.
Expect: appears in **Pickup** under the correct day group within seconds; status **New**; sound + flash on open dashboards; one push to opted-in devices ("New Italian Bear order #… — N items", no personal data); countdown shows if time confirmed; `webhook_events` row `processed`.

## 2. Paid delivery order
Place a local-delivery/shipping order.
Expect: appears in **Delivery**; delivery address on detail page; correct date group; Time TBC label when no attributes present.

## 3. Local pickup marked ready
On a pickup order: Acknowledge → Start preparing → **Ready for pickup**.
Expect: Shopify order timeline shows the fulfilment order marked ready; customer receives Shopify's "Ready for pickup" email; dashboard status Ready; audit entries with staff name + time; the button never appears on delivery orders (also verify the API rejects it: POST `/api/orders/<delivery-id>/ready-for-pickup` → 400).

## 4. Full fulfilment
Manager: "Collected & fulfil" (pickup) or "Handed to courier & fulfil" (delivery) with all quantities.
Expect: confirmation modal; after confirm, Shopify order becomes **Fulfilled**; dashboard shows fulfilled only after Shopify success; tracking details (if entered) visible on the Shopify fulfilment; notify toggle controls Shopify's confirmation email; order moves to **Past orders** the next day.

## 5. Partial fulfilment
Fulfil a subset of quantities.
Expect: Shopify shows **Partially fulfilled**; dashboard shows "Partially fulfilled" chip and remaining quantities; second fulfilment completes the order.

## 6. Cancellation
Cancel the order in Shopify.
Expect: webhook flips dashboard status to **Cancelled** promptly; action buttons disappear; order leaves Pickup/Delivery boards; appears in Past orders (from the next day).

## 7. Refund
Refund (full) in Shopify.
Expect: status **Refunded**, refund amount + date on the detail page; cancellation/refund chip on the card.

## 8. Shopify-side status change
Fulfil an order directly inside Shopify admin.
Expect: dashboard reflects **Fulfilled** via webhook without any app action; if a fulfilment is cancelled in Shopify, the order reopens as Acknowledged.

## 9. Duplicate webhook delivery
Re-send a webhook from Shopify's admin (Settings → Notifications → Webhooks → resend), or replay the same request with identical `X-Shopify-Webhook-Id`.
Expect: 200 with `duplicate: true`; exactly one `webhook_events` row; no duplicate `order_events`; no second push notification.

## 10. Missed acknowledgement escalation
Leave a new paid order unacknowledged.
Expect: dashboard alarm repeats every 2 min (configurable) while open; push repeats every 5 min (configurable) via `notification_events` rows with bucketed dedupe keys — never two sends for the same bucket; acknowledging stops both.

## 11. One-hour scheduled reminder
Create a pickup order with a confirmed time ~70 min ahead.
Expect: `scheduled_jobs` row `reminder_1h` with `run_at` = time − 60 min; at run time one push "Order #… — pickup at HH:MM. Due in 1 hour."; job flips to `sent`; **no reminder** if the order was already fulfilled/cancelled/refunded/ready (job auto-cancels); **no reminder** for Time TBC orders; changing the pickup time re-schedules (old job cancelled, new dedupe key).

## 12. Daylight-saving behaviour
Around the late-March/late-October transitions (or by temporarily faking dates):
- A pickup at `2026-10-25 14:00` (BST→GMT day) must remind at 13:00 **London wall time**.
- Verify `londonWallTimeToUtc('2026-03-29','14:00')` ≠ `…('2026-03-27','14:00')` UTC offset (13:00Z vs 14:00Z).
- All displayed times (cards, countdowns, timeline) remain Europe/London before and after the switch.

## Also verify (safeguards)
- No Square order is ever created (this app has no Square integration at all).
- Unknown fulfilment method → order sits in **Needs attention** with reason.
- Old unfulfilled order → **Past / unresolved** group + OVERDUE label, never silently hidden in Past orders.
- API routes reject staff-role fulfil attempts (403) even if called directly with curl.
- Webhook with bad HMAC → 401 and no database row.
