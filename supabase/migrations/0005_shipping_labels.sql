-- Shopify Shipping labels bought from inside the app (shippingLabelPurchase).
-- Shopify remains the source of truth for the label and the fulfilment; this
-- table only remembers which purchase belongs to which order so staff can
-- print (and re-print) the label without opening Shopify.
create table if not exists shipping_labels (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  -- pending → purchased | failed. Pending rows are refreshed from Shopify.
  status text not null default 'pending' check (status in ('pending', 'purchased', 'failed')),
  purchase_result_gid text,          -- gid://shopify/ShippingLabelPurchaseResult/…
  shipping_label_gid text,           -- gid://shopify/ShippingLabel/…
  package jsonb not null,            -- { lengthCm, widthCm, heightCm, weightGrams }
  carrier_code text,
  service_code text,
  tracking_number text,
  tracking_company text,
  tracking_url text,
  error text,
  purchased_by uuid references staff_profiles(id),
  purchased_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipping_labels_order_idx on shipping_labels (order_id, created_at desc);

-- One live label per order: a second "Buy label" tap (or a second iPad)
-- can never buy twice. Failed attempts don't count, so staff can retry.
create unique index if not exists shipping_labels_one_live_per_order
  on shipping_labels (order_id) where status in ('pending', 'purchased');

alter table shipping_labels enable row level security;
create policy staff_read_shipping_labels on shipping_labels for select using (is_active_staff());
-- Writes go through the service role in API routes only.

notify pgrst, 'reload schema';
