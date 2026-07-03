-- Italian Bear Orders — initial schema
-- All timestamps are timestamptz (UTC in storage; Europe/London in UI).

create extension if not exists "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────────────────
create type staff_role as enum ('staff', 'manager', 'admin');

create type fulfillment_method as enum ('pickup', 'local_delivery', 'shipping', 'unknown');

-- Internal operational status (never a claim about Shopify state).
create type internal_status as enum (
  'new',            -- arrived, nobody has acknowledged
  'acknowledged',
  'preparing',
  'ready_for_pickup',   -- pickup only; set after Shopify confirms
  'packed',             -- delivery only
  'courier_booked',     -- delivery only
  'fulfilled',          -- set only after Shopify fulfillmentCreate succeeds / Shopify reports fulfilled
  'cancelled',
  'refunded'
);

create type webhook_status as enum ('received', 'processing', 'processed', 'failed', 'skipped_stale', 'duplicate');
create type job_status as enum ('pending', 'sent', 'cancelled', 'failed');
create type write_error_status as enum ('open', 'retrying', 'resolved', 'dismissed');

-- ── Staff ────────────────────────────────────────────────────────────────
create table staff_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role staff_role not null default 'staff',
  is_active boolean not null default true,
  onesignal_player_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Orders ───────────────────────────────────────────────────────────────
create table orders (
  id uuid primary key default gen_random_uuid(),
  -- Shopify identity
  shopify_order_id bigint not null unique,          -- numeric legacy id
  shopify_order_gid text not null unique,           -- gid://shopify/Order/…
  order_number text not null,                       -- human-readable, e.g. #1842
  shopify_admin_url text not null,
  -- Shopify state (source of truth, mirrored)
  shopify_created_at timestamptz not null,
  shopify_updated_at timestamptz not null,          -- stale-write guard
  financial_status text,                            -- PAID, PARTIALLY_REFUNDED, REFUNDED, …
  shopify_fulfillment_status text,                  -- UNFULFILLED, PARTIALLY_FULFILLED, FULFILLED, …
  cancelled_at timestamptz,
  closed_at timestamptz,
  test boolean not null default false,
  -- Fulfilment classification
  fulfillment_method fulfillment_method not null default 'unknown',
  pickup_location jsonb,                            -- { id, name, address }
  delivery_address jsonb,                           -- shippingAddress snapshot
  -- Customer (minimum needed for ops)
  customer_name text,
  customer_email text,
  customer_phone text,
  -- Notes / attributes / tags / money
  note text,
  note_attributes jsonb not null default '[]',      -- [{name, value}]
  tags text[] not null default '{}',
  discounts jsonb not null default '[]',
  currency text not null default 'GBP',
  subtotal numeric(12,2),
  shipping_total numeric(12,2),
  tax_total numeric(12,2),
  total numeric(12,2),
  refund_summary jsonb not null default '[]',       -- [{id, createdAt, note, amount}]
  -- Required-action date (normalized)
  required_fulfilment_at timestamptz,
  time_confirmed boolean not null default false,    -- false ⇒ "Time TBC"
  date_source text not null default 'shopify_created', -- pickup_slot | note_attribute | shopify_created
  -- Future pickup-slot support
  pickup_slot_id uuid,
  -- Internal operational state
  internal_status internal_status not null default 'new',
  acknowledged_at timestamptz,
  acknowledged_by uuid references staff_profiles (id),
  assigned_staff_id uuid references staff_profiles (id),
  needs_attention boolean not null default false,
  needs_attention_reason text,
  -- Courier details (delivery orders)
  courier_name text,
  courier_booking_ref text,
  courier_tracking_url text,
  -- Debugging / sync
  raw_payload jsonb,                                -- latest full Shopify order (server-only via RLS column policy: kept out of UI queries)
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_required_at_idx on orders (required_fulfilment_at);
create index orders_method_status_idx on orders (fulfillment_method, internal_status);
create index orders_needs_attention_idx on orders (needs_attention) where needs_attention;

create table order_line_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  shopify_line_item_id bigint not null,
  shopify_line_item_gid text not null,
  title text not null,
  variant_title text,
  sku text,
  quantity int not null,
  fulfilled_quantity int not null default 0,
  refunded_quantity int not null default 0,
  unit_price numeric(12,2),
  image_url text,
  properties jsonb not null default '[]',           -- custom line-item properties (gift msg, etc.)
  requires_shipping boolean not null default true,
  created_at timestamptz not null default now(),
  unique (order_id, shopify_line_item_id)
);

-- Shopify Fulfillment Orders (an order may have several groups/locations)
create table fulfillment_groups (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  shopify_fulfillment_order_gid text not null unique,
  status text not null,                             -- OPEN, IN_PROGRESS, CLOSED, CANCELLED, INCOMPLETE, …
  request_status text,
  delivery_method_type text,                        -- PICK_UP, LOCAL, SHIPPING, NONE, RETAIL, …
  assigned_location jsonb,
  fulfill_at timestamptz,
  line_items jsonb not null default '[]',           -- [{ffoLineItemGid, orderLineItemGid, remainingQuantity, totalQuantity}]
  supported_actions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fulfillment_groups_order_idx on fulfillment_groups (order_id);

-- ── Audit / events ───────────────────────────────────────────────────────
create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  actor_id uuid references staff_profiles (id),     -- null ⇒ system/Shopify
  actor_name text not null default 'System',
  event_type text not null,                         -- acknowledged, status_changed, ready_for_pickup, fulfilled, shopify_update, note_added, …
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index order_events_order_idx on order_events (order_id, created_at);

create table staff_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  staff_id uuid not null references staff_profiles (id),
  assigned_by uuid references staff_profiles (id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz
);

-- ── Notifications & scheduling ───────────────────────────────────────────
create table notification_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders (id) on delete cascade,
  kind text not null,               -- new_order, escalation_dashboard, escalation_push, reminder_1h, manager_escalation
  channel text not null,            -- push, dashboard
  dedupe_key text not null unique,  -- e.g. "reminder_1h:<order_id>:<required_fulfilment_at ISO>"
  payload jsonb not null default '{}',
  sent_at timestamptz not null default now()
);

create table scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders (id) on delete cascade,
  kind text not null,               -- reminder_1h, escalation_check
  run_at timestamptz not null,
  status job_status not null default 'pending',
  dedupe_key text not null unique,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scheduled_jobs_due_idx on scheduled_jobs (status, run_at) where status = 'pending';

-- ── Webhook idempotency & health ─────────────────────────────────────────
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  shopify_webhook_id text not null unique,          -- X-Shopify-Webhook-Id
  topic text not null,
  shopify_order_id bigint,
  api_version text,
  triggered_at timestamptz,
  payload jsonb,
  status webhook_status not null default 'received',
  attempts int not null default 0,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index webhook_events_status_idx on webhook_events (status, received_at);

-- ── Shopify write-error log (admin retry) ────────────────────────────────
create table shopify_write_errors (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders (id) on delete set null,
  action text not null,             -- ready_for_pickup, fulfillment_create, tags_add, metafields_set, …
  request jsonb not null,
  user_errors jsonb,
  http_status int,
  status write_error_status not null default 'open',
  actor_id uuid references staff_profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ── Future pickup slots ──────────────────────────────────────────────────
create table pickup_slots (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  capacity int not null default 4,
  booked_count int not null default 0,
  is_confirmed boolean not null default true,
  location_id text,
  created_at timestamptz not null default now(),
  unique (slot_date, start_time, location_id)
);

alter table orders
  add constraint orders_pickup_slot_fk
  foreign key (pickup_slot_id) references pickup_slots (id) on delete set null;

-- ── Settings ─────────────────────────────────────────────────────────────
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references staff_profiles (id),
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value) values
  ('escalation', '{"dashboard_repeat_minutes": 2, "push_repeat_minutes": 5, "manager_escalation_minutes": 15, "manager_escalation_enabled": false}'),
  ('reminders', '{"pickup_lead_minutes": 60, "delivery_lead_minutes": 60}'),
  ('date_attribute_keys', '{"pickup_date": ["Pickup Date", "Pickup-Date", "pickup_date"], "pickup_time": ["Pickup Time", "pickup_time"], "delivery_date": ["Delivery Date", "delivery_date", "Dispatch Date"], "delivery_time": ["Delivery Time", "delivery_time"]}'),
  ('flags', '{"allergy_keywords": ["allergy", "allergen", "nut", "gluten", "dairy", "intoleran"], "gift_keywords": ["gift", "message"]}');

-- ── updated_at triggers ──────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger orders_updated_at before update on orders for each row execute function set_updated_at();
create trigger fulfillment_groups_updated_at before update on fulfillment_groups for each row execute function set_updated_at();
create trigger scheduled_jobs_updated_at before update on scheduled_jobs for each row execute function set_updated_at();
create trigger staff_profiles_updated_at before update on staff_profiles for each row execute function set_updated_at();

-- ── Helper: current staff role ───────────────────────────────────────────
create or replace function current_staff_role() returns staff_role
language sql stable security definer set search_path = public as $$
  select role from staff_profiles where id = auth.uid() and is_active;
$$;

create or replace function is_active_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_profiles where id = auth.uid() and is_active);
$$;

-- ── Row-level security ───────────────────────────────────────────────────
-- Policy model: the browser only ever READS (for lists + realtime).
-- Every write goes through Next.js API routes using the service-role key,
-- which bypasses RLS after performing its own role checks.

alter table staff_profiles enable row level security;
alter table orders enable row level security;
alter table order_line_items enable row level security;
alter table fulfillment_groups enable row level security;
alter table order_events enable row level security;
alter table staff_assignments enable row level security;
alter table notification_events enable row level security;
alter table scheduled_jobs enable row level security;
alter table webhook_events enable row level security;
alter table shopify_write_errors enable row level security;
alter table pickup_slots enable row level security;
alter table app_settings enable row level security;

-- Active staff can read operational data
create policy staff_read_orders on orders for select using (is_active_staff());
create policy staff_read_line_items on order_line_items for select using (is_active_staff());
create policy staff_read_ffgroups on fulfillment_groups for select using (is_active_staff());
create policy staff_read_events on order_events for select using (is_active_staff());
create policy staff_read_assignments on staff_assignments for select using (is_active_staff());
create policy staff_read_slots on pickup_slots for select using (is_active_staff());
create policy staff_read_settings on app_settings for select using (is_active_staff());

-- Staff can read their own profile; managers/admins can read all
create policy read_own_profile on staff_profiles for select
  using (id = auth.uid() or current_staff_role() in ('manager', 'admin'));

-- Admin-only technical tables
create policy admin_read_webhooks on webhook_events for select using (current_staff_role() = 'admin');
create policy admin_read_write_errors on shopify_write_errors for select using (current_staff_role() in ('manager','admin'));
create policy manager_read_notifications on notification_events for select using (current_staff_role() in ('manager','admin'));
create policy admin_read_jobs on scheduled_jobs for select using (current_staff_role() = 'admin');

-- Realtime: publish order changes to authenticated staff
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_events;
