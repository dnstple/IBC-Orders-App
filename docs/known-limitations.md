# Known limitations

## Confirmed Shopify capabilities (what Shopify really does)
- `fulfillmentOrderLineItemsPreparedForPickup` marks local-pickup fulfilment orders ready **and Shopify automatically emails the customer** "Ready for pickup". It applies to whole fulfilment orders; Shopify does not support per-line "ready" granularity here.
- `fulfillmentCreate` supports full and partial line-item quantities, tracking info, and an opt-in/out customer notification — the dashboard exposes all three.
- Cancellations, refunds, edits and Shopify-side fulfilments flow back via webhooks; Shopify remains the source of truth and its state always wins over internal state.
- Shopify Basic checkout does not natively collect pickup slots; dates currently come from cart/note attributes if your theme/app adds them.

## Internal-only app statuses (never claims in Shopify)
- **Acknowledge, Preparing, Packed, Courier booked** exist only in this app's database (plus an optional cosmetic `ib_status:*` tag/metafield mirror in Shopify). They never change Shopify fulfilment state.
- Courier name/booking reference/tracking URL for "Courier booked" live in Supabase + an order metafield; the tracking number only reaches the official Shopify fulfilment when "Handed to courier & fulfil" runs.
- Escalation alarms, assignment, and audit timeline are internal.

## Future pickup-time-selection work (schema ready, not built)
- `pickup_slots` table + `orders.pickup_slot_id` (date, start/end, capacity, confirmation) exist and already outrank note attributes in `required_fulfilment_at` derivation — the boards, countdowns and 1-hour reminders will work unchanged once slots are populated.
- The customer-facing booking flow (planned for the post-checkout order status page) is not built. It must be a separate, public, rate-limited surface writing via a dedicated API — never exposing the staff dashboard or service-role key.
- Until then, orders without parseable date attributes appear under **Time TBC** and receive no 1-hour reminder (by design).

## Operational caveats
- Minute-level cron scheduling requires a paid Vercel plan or an external pinger (see deployment doc); reminders may drift by up to one cron interval.
- Web push on iOS requires the PWA to be added to the Home Screen (iOS 16.4+) and notification permission granted per device.
- Audible alerts require one user interaction with the page after load (browser autoplay policy); the visual flash always works.
- The manual sync scans the last 14 days + unfulfilled orders (bounded for rate limits); older history isn't backfilled automatically.
- Supabase Realtime delivers UI updates; if a device is offline it catches up on next load (the boards refetch on every change event rather than patching state).
