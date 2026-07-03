-- Demo/seed data — realistic sample orders for local testing.
-- Run AFTER 0001_init.sql. Safe to re-run (idempotent on shopify_order_id).
-- These use fake Shopify IDs in the 900000000000+ range so they can never
-- collide with, or write back to, real Shopify orders. The sync layer and
-- write actions refuse to call Shopify for orders tagged 'demo'.

-- Pickup, today 14:00 Europe/London, confirmed time
insert into orders (shopify_order_id, shopify_order_gid, order_number, shopify_admin_url,
  shopify_created_at, shopify_updated_at, financial_status, shopify_fulfillment_status,
  fulfillment_method, pickup_location, customer_name, customer_email, customer_phone,
  note, note_attributes, tags, currency, subtotal, shipping_total, tax_total, total,
  required_fulfilment_at, time_confirmed, date_source, internal_status)
values
(900000000001, 'gid://shopify/Order/900000000001', '#1839', 'https://admin.shopify.com/store/demo/orders/900000000001',
  now() - interval '3 hours', now() - interval '3 hours', 'PAID', 'UNFULFILLED',
  'pickup', '{"name":"Italian Bear Chocolate – Shop","address":"12 Example Lane, London"}',
  'Amelia Rossi', 'amelia@example.com', '+44 7700 900001',
  'Please tie the ribbon in gold if possible',
  '[{"name":"Pickup Date","value":"__TODAY__"},{"name":"Pickup Time","value":"14:00"}]',
  '{demo}', 'GBP', 42.00, 0, 0, 42.00,
  (current_date::timestamp at time zone 'Europe/London') + interval '14 hours', true, 'note_attribute', 'new'),

-- Pickup, today, TIME TBC (no pickup time attribute) → fallback to created
(900000000002, 'gid://shopify/Order/900000000002', '#1840', 'https://admin.shopify.com/store/demo/orders/900000000002',
  now() - interval '1 hour', now() - interval '1 hour', 'PAID', 'UNFULFILLED',
  'pickup', '{"name":"Italian Bear Chocolate – Shop","address":"12 Example Lane, London"}',
  'Ben Carter', 'ben@example.com', '+44 7700 900002',
  'ALLERGY: severe nut allergy — please prepare separately',
  '[]', '{demo}', 'GBP', 18.50, 0, 0, 18.50,
  now() - interval '1 hour', false, 'shopify_created', 'acknowledged'),

-- Pickup, tomorrow 11:30, preparing
(900000000003, 'gid://shopify/Order/900000000003', '#1841', 'https://admin.shopify.com/store/demo/orders/900000000003',
  now() - interval '1 day', now() - interval '2 hours', 'PAID', 'UNFULFILLED',
  'pickup', '{"name":"Italian Bear Chocolate – Shop","address":"12 Example Lane, London"}',
  'Chiara Bianchi', 'chiara@example.com', null,
  null,
  '[{"name":"Pickup Date","value":"__TOMORROW__"},{"name":"Pickup Time","value":"11:30"},{"name":"Gift Message","value":"Happy anniversary, with love from Marco"}]',
  '{demo}', 'GBP', 65.00, 0, 0, 65.00,
  ((current_date + 1)::timestamp at time zone 'Europe/London') + interval '11 hours 30 minutes', true, 'note_attribute', 'preparing'),

-- Delivery, today, courier booked
(900000000004, 'gid://shopify/Order/900000000004', '#1842', 'https://admin.shopify.com/store/demo/orders/900000000004',
  now() - interval '5 hours', now() - interval '30 minutes', 'PAID', 'UNFULFILLED',
  'local_delivery', null, 'Daniel Okafor', 'daniel.o@example.com', '+44 7700 900004',
  'Leave with concierge if not home',
  '[{"name":"Delivery Date","value":"__TODAY__"},{"name":"Delivery Time","value":"16:00"}]',
  '{demo}', 'GBP', 88.00, 6.50, 0, 94.50,
  (current_date::timestamp at time zone 'Europe/London') + interval '16 hours', true, 'note_attribute', 'courier_booked'),

-- Shipping, dispatch date in 2 days, new
(900000000005, 'gid://shopify/Order/900000000005', '#1843', 'https://admin.shopify.com/store/demo/orders/900000000005',
  now() - interval '20 minutes', now() - interval '20 minutes', 'PAID', 'UNFULFILLED',
  'shipping', null, 'Emma Walsh', 'emma@example.com', '+44 7700 900005',
  null, '[]', '{demo}', 'GBP', 34.00, 4.95, 0, 38.95,
  now() - interval '20 minutes', false, 'shopify_created', 'new'),

-- OVERDUE: pickup 2 days ago, never collected → Needs attention
(900000000006, 'gid://shopify/Order/900000000006', '#1830', 'https://admin.shopify.com/store/demo/orders/900000000006',
  now() - interval '3 days', now() - interval '3 days', 'PAID', 'UNFULFILLED',
  'pickup', '{"name":"Italian Bear Chocolate – Shop","address":"12 Example Lane, London"}',
  'Farah Hussain', 'farah@example.com', '+44 7700 900006',
  null,
  '[{"name":"Pickup Date","value":"__TWO_DAYS_AGO__"},{"name":"Pickup Time","value":"15:00"}]',
  '{demo}', 'GBP', 25.00, 0, 0, 25.00,
  ((current_date - 2)::timestamp at time zone 'Europe/London') + interval '15 hours', true, 'note_attribute', 'ready_for_pickup'),

-- Unknown fulfilment method → Needs attention
(900000000007, 'gid://shopify/Order/900000000007', '#1844', 'https://admin.shopify.com/store/demo/orders/900000000007',
  now() - interval '10 minutes', now() - interval '10 minutes', 'PAID', 'UNFULFILLED',
  'unknown', null, 'Giorgio Ferrero', 'giorgio@example.com', null,
  null, '[]', '{demo}', 'GBP', 52.00, 0, 0, 52.00,
  now() - interval '10 minutes', false, 'shopify_created', 'new'),

-- Cancelled & refunded → Past orders
(900000000008, 'gid://shopify/Order/900000000008', '#1828', 'https://admin.shopify.com/store/demo/orders/900000000008',
  now() - interval '4 days', now() - interval '3 days', 'REFUNDED', 'UNFULFILLED',
  'pickup', '{"name":"Italian Bear Chocolate – Shop"}', 'Hana Sato', 'hana@example.com', null,
  null, '[]', '{demo}', 'GBP', 30.00, 0, 0, 30.00,
  now() - interval '4 days', false, 'shopify_created', 'refunded'),

-- Fulfilled pickup yesterday → Past orders
(900000000009, 'gid://shopify/Order/900000000009', '#1835', 'https://admin.shopify.com/store/demo/orders/900000000009',
  now() - interval '2 days', now() - interval '1 day', 'PAID', 'FULFILLED',
  'pickup', '{"name":"Italian Bear Chocolate – Shop"}', 'Isla Murray', 'isla@example.com', null,
  null,
  '[{"name":"Pickup Date","value":"__YESTERDAY__"},{"name":"Pickup Time","value":"12:00"}]',
  '{demo}', 'GBP', 47.50, 0, 0, 47.50,
  ((current_date - 1)::timestamp at time zone 'Europe/London') + interval '12 hours', true, 'note_attribute', 'fulfilled')
on conflict (shopify_order_id) do nothing;

-- Patch date placeholders in note_attributes
update orders set note_attributes = replace(replace(replace(replace(note_attributes::text,
  '__TODAY__', to_char(current_date, 'YYYY-MM-DD')),
  '__TOMORROW__', to_char(current_date + 1, 'YYYY-MM-DD')),
  '__YESTERDAY__', to_char(current_date - 1, 'YYYY-MM-DD')),
  '__TWO_DAYS_AGO__', to_char(current_date - 2, 'YYYY-MM-DD'))::jsonb
where 'demo' = any(tags);

-- Flag attention rows
update orders set needs_attention = true, needs_attention_reason = 'Overdue: pickup time passed and order not collected'
  where shopify_order_id = 900000000006;
update orders set needs_attention = true, needs_attention_reason = 'Fulfilment method could not be determined'
  where shopify_order_id = 900000000007;
update orders set cancelled_at = now() - interval '3 days' where shopify_order_id = 900000000008;

-- Line items
insert into order_line_items (order_id, shopify_line_item_id, shopify_line_item_gid, title, variant_title, sku, quantity, fulfilled_quantity, unit_price, properties)
select o.id, v.li_id, 'gid://shopify/LineItem/' || v.li_id, v.title, v.variant, v.sku, v.qty, v.fqty, v.price, v.props::jsonb
from (values
  (900000000001, 800000000101::bigint, 'Signature Praline Box', '16 pieces', 'IB-PRA-16', 1, 0, 32.00, '[{"name":"Ribbon","value":"Gold"}]'),
  (900000000001, 800000000102::bigint, 'Dark Sea-Salt Bar',     '70%',       'IB-BAR-DSS', 2, 0, 5.00,  '[]'),
  (900000000002, 800000000201::bigint, 'Hot Chocolate Flakes',  'Classic',   'IB-HCF-01', 1, 0, 9.50,  '[]'),
  (900000000002, 800000000202::bigint, 'Gianduja Bar',          null,        'IB-BAR-GIA', 1, 0, 9.00,  '[]'),
  (900000000003, 800000000301::bigint, 'Anniversary Gift Hamper', 'Large',   'IB-HAM-L',  1, 0, 65.00, '[{"name":"Gift Message","value":"Happy anniversary, with love from Marco"}]'),
  (900000000004, 800000000401::bigint, 'Celebration Cake Truffles', 'Box of 24', 'IB-TRF-24', 2, 0, 38.00, '[]'),
  (900000000004, 800000000402::bigint, 'Milk Hazelnut Bar',     null,        'IB-BAR-MHZ', 3, 0, 4.00,  '[]'),
  (900000000005, 800000000501::bigint, 'Tasting Selection',     '8 bars',    'IB-TST-08', 1, 0, 34.00, '[]'),
  (900000000006, 800000000601::bigint, 'Signature Praline Box', '9 pieces',  'IB-PRA-09', 1, 0, 25.00, '[]'),
  (900000000007, 800000000701::bigint, 'Corporate Gift Box',    null,        'IB-CGB-01', 4, 0, 13.00, '[]'),
  (900000000008, 800000000801::bigint, 'Easter Egg',            'Dark',      'IB-EGG-D',  1, 0, 30.00, '[]'),
  (900000000009, 800000000901::bigint, 'Signature Praline Box', '25 pieces', 'IB-PRA-25', 1, 1, 47.50, '[]')
) as v(so_id, li_id, title, variant, sku, qty, fqty, price, props)
join orders o on o.shopify_order_id = v.so_id
on conflict (order_id, shopify_line_item_id) do nothing;

-- Fulfillment groups (Fulfillment Orders)
insert into fulfillment_groups (order_id, shopify_fulfillment_order_gid, status, delivery_method_type, assigned_location, line_items, supported_actions)
select o.id, 'gid://shopify/FulfillmentOrder/' || (o.shopify_order_id - 900000000000 + 700000000000),
  case when o.internal_status in ('fulfilled','refunded') then 'CLOSED' else 'OPEN' end,
  case o.fulfillment_method when 'pickup' then 'PICK_UP' when 'local_delivery' then 'LOCAL' when 'shipping' then 'SHIPPING' else 'NONE' end,
  '{"name":"Italian Bear Chocolate – Shop"}',
  (select coalesce(jsonb_agg(jsonb_build_object(
      'ffoLineItemGid', 'gid://shopify/FulfillmentOrderLineItem/' || li.shopify_line_item_id,
      'orderLineItemGid', li.shopify_line_item_gid,
      'remainingQuantity', li.quantity - li.fulfilled_quantity,
      'totalQuantity', li.quantity)), '[]'::jsonb)
    from order_line_items li where li.order_id = o.id),
  case o.fulfillment_method when 'pickup' then array['CREATE_FULFILLMENT']::text[] else array['CREATE_FULFILLMENT']::text[] end
from orders o where 'demo' = any(o.tags)
on conflict (shopify_fulfillment_order_gid) do nothing;

-- A few audit events
insert into order_events (order_id, actor_name, event_type, details)
select o.id, 'System', 'order_synced', jsonb_build_object('source', 'seed')
from orders o where 'demo' = any(o.tags);
