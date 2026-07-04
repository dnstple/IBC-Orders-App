-- v2 demo data: pickup-scheduler example orders (run AFTER 0002).
-- Fake Shopify IDs ≥ 900000000000 + 'demo' tag ⇒ write actions never touch Shopify.
-- Covers: pickup today 3:30–4:00pm · pickup tomorrow · delivery today ·
--         completed historical delivery · cancelled historical pickup.

insert into orders (shopify_order_id, shopify_order_gid, order_number, shopify_admin_url,
  shopify_created_at, shopify_updated_at, financial_status, shopify_fulfillment_status,
  fulfillment_method, pickup_location, customer_name, customer_email,
  note_attributes, tags, currency, subtotal, shipping_total, tax_total, total,
  required_fulfilment_at, time_confirmed, date_source, internal_status,
  pickup_requested, pickup_date, pickup_slot_start, pickup_slot_end, pickup_slot_label,
  pickup_delay_minutes, operational_date, cancelled_at, delivery_address)
values
-- 1. Pickup TODAY 3:30–4:00pm (confirmed slot)
(900000000101, 'gid://shopify/Order/900000000101', '#2042', 'https://admin.shopify.com/store/demo/orders/900000000101',
  now() - interval '2 hours', now() - interval '2 hours', 'PAID', 'UNFULFILLED',
  'pickup', '{"name":"Italian Bear Chocolate"}', 'Livia Conti', 'livia@example.com',
  '[{"name":"ibc_pickup_requested","value":"true"},{"name":"ibc_pickup_date","value":"__TODAY__"},{"name":"ibc_pickup_slot_label","value":"Today, 3:30–4:00pm"}]',
  '{demo}', 'GBP', 42.50, 0, 0, 42.50,
  (current_date::timestamp at time zone 'Europe/London') + interval '15 hours 30 minutes', true, 'ibc_slot', 'new',
  true, current_date,
  (current_date::timestamp at time zone 'Europe/London') + interval '15 hours 30 minutes',
  (current_date::timestamp at time zone 'Europe/London') + interval '16 hours',
  'Today, 3:30–4:00pm', 60, current_date, null, null),

-- 2. Pickup TOMORROW 11:00–11:30am
(900000000102, 'gid://shopify/Order/900000000102', '#2043', 'https://admin.shopify.com/store/demo/orders/900000000102',
  now() - interval '1 hour', now() - interval '1 hour', 'PAID', 'UNFULFILLED',
  'pickup', '{"name":"Italian Bear Chocolate"}', 'Marco Vitale', 'marco@example.com',
  '[{"name":"ibc_pickup_requested","value":"true"},{"name":"ibc_pickup_date","value":"__TOMORROW__"}]',
  '{demo}', 'GBP', 65.00, 0, 0, 65.00,
  ((current_date + 1)::timestamp at time zone 'Europe/London') + interval '11 hours', true, 'ibc_slot', 'new',
  true, current_date + 1,
  ((current_date + 1)::timestamp at time zone 'Europe/London') + interval '11 hours',
  ((current_date + 1)::timestamp at time zone 'Europe/London') + interval '11 hours 30 minutes',
  'Tomorrow, 11:00–11:30am', 60, current_date + 1, null, null),

-- 3. Delivery placed TODAY
(900000000103, 'gid://shopify/Order/900000000103', '#2044', 'https://admin.shopify.com/store/demo/orders/900000000103',
  now() - interval '3 hours', now() - interval '3 hours', 'PAID', 'UNFULFILLED',
  'shipping', null, 'Sofia Marino', 'sofia@example.com',
  '[]', '{demo}', 'GBP', 61.00, 4.95, 0, 65.95,
  now() - interval '3 hours', false, 'shopify_created', 'new',
  false, null, null, null, null, null, current_date, null,
  '{"name":"Sofia Marino","address1":"22 Sample Street","city":"London","zip":"E2 7AA"}'),

-- 4. Completed historical delivery (3 days ago, fulfilled)
(900000000104, 'gid://shopify/Order/900000000104', '#2020', 'https://admin.shopify.com/store/demo/orders/900000000104',
  now() - interval '3 days', now() - interval '2 days', 'PAID', 'FULFILLED',
  'shipping', null, 'Ben Carter', 'ben@example.com',
  '[]', '{demo}', 'GBP', 38.00, 4.95, 0, 42.95,
  now() - interval '3 days', false, 'shopify_created', 'fulfilled',
  false, null, null, null, null, null, current_date - 3, null,
  '{"name":"Ben Carter","address1":"9 Old Road","city":"London","zip":"N1 1AA"}'),

-- 5. Cancelled historical pickup (2 days ago)
(900000000105, 'gid://shopify/Order/900000000105', '#2018', 'https://admin.shopify.com/store/demo/orders/900000000105',
  now() - interval '2 days', now() - interval '2 days', 'REFUNDED', 'UNFULFILLED',
  'pickup', '{"name":"Italian Bear Chocolate"}', 'Farah Hussain', 'farah@example.com',
  '[{"name":"ibc_pickup_requested","value":"true"},{"name":"ibc_pickup_date","value":"__TWO_DAYS_AGO__"}]',
  '{demo}', 'GBP', 30.00, 0, 0, 30.00,
  ((current_date - 2)::timestamp at time zone 'Europe/London') + interval '14 hours', true, 'ibc_slot', 'cancelled',
  true, current_date - 2,
  ((current_date - 2)::timestamp at time zone 'Europe/London') + interval '14 hours',
  ((current_date - 2)::timestamp at time zone 'Europe/London') + interval '14 hours 30 minutes',
  '2:00–2:30pm', 60, current_date - 2, now() - interval '2 days', null)
on conflict (shopify_order_id) do nothing;

update orders set note_attributes = replace(replace(replace(note_attributes::text,
  '__TODAY__', to_char(current_date, 'YYYY-MM-DD')),
  '__TOMORROW__', to_char(current_date + 1, 'YYYY-MM-DD')),
  '__TWO_DAYS_AGO__', to_char(current_date - 2, 'YYYY-MM-DD'))::jsonb
where shopify_order_id between 900000000101 and 900000000105;

insert into order_line_items (order_id, shopify_line_item_id, shopify_line_item_gid, title, variant_title, sku, quantity, fulfilled_quantity, unit_price, properties)
select o.id, v.li_id, 'gid://shopify/LineItem/' || v.li_id, v.title, v.variant, v.sku, v.qty, v.fq, v.price, '[]'::jsonb
from (values
  (900000000101, 800000001011::bigint, 'Signature Praline Box', '16 pieces', 'IB-PRA-16', 1, 0, 32.50),
  (900000000101, 800000001012::bigint, 'Dark Sea-Salt Bar', '70%', 'IB-BAR-DSS', 2, 0, 5.00),
  (900000000102, 800000001021::bigint, 'Anniversary Hamper', 'Large', 'IB-HAM-L', 1, 0, 65.00),
  (900000000103, 800000001031::bigint, 'Tasting Selection', '8 bars', 'IB-TST-08', 1, 0, 34.00),
  (900000000103, 800000001032::bigint, 'Gianduja Bar', null, 'IB-BAR-GIA', 3, 0, 9.00),
  (900000000104, 800000001041::bigint, 'Hot Chocolate Flakes', 'Classic', 'IB-HCF-01', 4, 4, 9.50),
  (900000000105, 800000001051::bigint, 'Easter Egg', 'Dark', 'IB-EGG-D', 1, 0, 30.00)
) as v(so_id, li_id, title, variant, sku, qty, fq, price)
join orders o on o.shopify_order_id = v.so_id
on conflict (order_id, shopify_line_item_id) do nothing;

insert into fulfillment_groups (order_id, shopify_fulfillment_order_gid, status, delivery_method_type, assigned_location, line_items, supported_actions)
select o.id, 'gid://shopify/FulfillmentOrder/' || (o.shopify_order_id - 900000000000 + 700000001000),
  case when o.internal_status in ('fulfilled','cancelled','refunded') then 'CLOSED' else 'OPEN' end,
  case when o.pickup_requested then 'PICK_UP' when o.fulfillment_method = 'shipping' then 'SHIPPING' else 'NONE' end,
  '{"name":"Italian Bear Chocolate"}',
  (select coalesce(jsonb_agg(jsonb_build_object(
      'ffoLineItemGid', 'gid://shopify/FulfillmentOrderLineItem/' || li.shopify_line_item_id,
      'orderLineItemGid', li.shopify_line_item_gid,
      'remainingQuantity', li.quantity - li.fulfilled_quantity,
      'totalQuantity', li.quantity)), '[]'::jsonb)
    from order_line_items li where li.order_id = o.id),
  array['CREATE_FULFILLMENT']::text[]
from orders o where o.shopify_order_id between 900000000101 and 900000000105
on conflict (shopify_fulfillment_order_gid) do nothing;
