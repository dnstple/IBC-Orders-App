-- Same-day courier support.
-- Courier state itself lives in the order's cart attributes (owned by the
-- Pickup Scheduler app; strictly read-only here) and is already synced
-- verbatim into orders.note_attributes. The only new storage is the
-- local-delivery contact details Shopify keeps on the fulfilment order.
alter table fulfillment_groups add column if not exists delivery_info jsonb;
-- { "phone": "...", "instructions": "..." } from deliveryMethod.additionalInformation

notify pgrst, 'reload schema';
