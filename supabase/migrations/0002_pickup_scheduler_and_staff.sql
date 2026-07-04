-- v2: pickup scheduler (ibc_* attributes), staff approval flow, sync state.
-- Run AFTER 0001_init.sql. Each statement is idempotent where possible.

-- ── Pickup scheduler fields (parsed from Shopify order custom attributes) ──
alter table orders add column if not exists pickup_requested boolean not null default false;
alter table orders add column if not exists pickup_date date;
alter table orders add column if not exists pickup_slot_start timestamptz;
alter table orders add column if not exists pickup_slot_end timestamptz;
alter table orders add column if not exists pickup_slot_label text;
alter table orders add column if not exists pickup_delay_minutes int;

-- Operational date drives Today / Future / Past grouping (Europe/London day).
-- Pickup: ibc_pickup_date. Delivery: order creation date (London).
alter table orders add column if not exists operational_date date;
update orders set operational_date = (shopify_created_at at time zone 'Europe/London')::date
  where operational_date is null;
alter table orders alter column operational_date set not null;

create index if not exists orders_operational_date_idx on orders (operational_date, fulfillment_method);
create index if not exists orders_slot_start_idx on orders (pickup_slot_start) where pickup_slot_start is not null;

-- ── Staff approval flow ─────────────────────────────────────────────────
-- New role values. (ALTER TYPE ... ADD VALUE must run outside an aborted tx;
-- run this file top-to-bottom in the Supabase SQL editor.)
alter type staff_role add value if not exists 'pending';
alter type staff_role add value if not exists 'suspended';

alter table staff_profiles add column if not exists requested_at timestamptz not null default now();
alter table staff_profiles add column if not exists approved_by uuid references staff_profiles (id);
alter table staff_profiles add column if not exists approved_at timestamptz;
alter table staff_profiles add column if not exists notification_prefs jsonb not null default
  '{"new_pickup": true, "new_delivery": true, "pickup_reminders": true, "status_changes": false, "sync_errors": false}';

-- Auto-create a PENDING profile whenever someone signs up.
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into staff_profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'pending',
    false
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Access gate: only approved, active operational roles may read order data.
-- 'pending' and 'suspended' users authenticate but see nothing.
create or replace function is_active_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_profiles
    where id = auth.uid()
      and is_active
      and role in ('staff', 'manager', 'admin')
  );
$$;

-- Index for the admin approval screen.
create index if not exists staff_profiles_role_idx on staff_profiles (role, requested_at);

-- ── Sync state (auto-reconcile lock + dashboard health) ────────────────
insert into app_settings (key, value) values
  ('sync_state', '{"running": false, "started_at": null, "last_success": null, "last_error": null, "interval_minutes": 3}')
on conflict (key) do nothing;
