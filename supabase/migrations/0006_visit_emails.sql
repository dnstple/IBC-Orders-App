-- Post-visit thank-you emails ("Visit emails" tab).
--
-- TableAgent stays the source of truth for bookings. The ibc-booking worker
-- exposes a read-only visits feed; this app polls it, decides who gets one
-- thank-you email and when, and records what happened. Settings and copy
-- live in app_settings under the key 'visit_emails'.
--
-- Data kept to the minimum: a guest's email and first name are stored only
-- on rows that will be (or were) emailed. Skipped bookings keep no contact
-- details. Nothing here is readable from the browser: every read and write
-- goes through manager-only API routes using the service role.

create table if not exists visit_emails (
  id uuid primary key default gen_random_uuid(),
  -- "<shop>:<TableAgent booking id>" - one row per booking, ever.
  booking_key text not null unique,
  shop text not null,
  booking_id text not null,
  visit_date date not null,
  visit_at timestamptz,
  party_size int,
  status_code text,
  marketing text check (marketing in ('yes', 'no')),   -- null = never answered
  email text,                                          -- null on skipped rows
  first_name text,
  source text not null default 'auto' check (source in ('auto', 'backfill')),
  -- queued → sent | dry_run | failed ; or skipped (with skip_reason)
  state text not null check (state in ('queued', 'sent', 'dry_run', 'failed', 'skipped', 'cancelled')),
  skip_reason text,
  variant text check (variant in ('marketing', 'plain')),
  due_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  error text,
  attempts int not null default 0,
  -- Random token used in tracked links and the opt-out link.
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists visit_emails_due_idx on visit_emails (state, due_at);
create index if not exists visit_emails_email_idx on visit_emails (email) where email is not null;
create index if not exists visit_emails_visit_idx on visit_emails (visit_date desc);

create trigger visit_emails_updated_at before update on visit_emails
  for each row execute function set_updated_at();

-- Every click on a link inside a visit email (via /r/<token>/<link>).
create table if not exists visit_email_clicks (
  id bigint generated always as identity primary key,
  visit_email_id uuid references visit_emails (id) on delete set null,
  link_key text not null,
  likely_bot boolean not null default false,   -- link scanners / prefetchers
  clicked_at timestamptz not null default now()
);
create index if not exists visit_email_clicks_link_idx on visit_email_clicks (link_key, clicked_at desc);

-- Addresses never to email again (opt-out link, bounces, spam complaints, manual).
create table if not exists visit_email_suppressions (
  email text primary key,
  reason text not null check (reason in ('opt_out', 'bounce', 'complaint', 'manual')),
  created_at timestamptz not null default now()
);

-- One row per poll/send run, for the dashboard's "last run" and problems.
create table if not exists visit_email_runs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('cron', 'manual', 'backfill')),
  mode text not null,
  fetched int not null default 0,
  queued int not null default 0,
  skipped int not null default 0,
  sent int not null default 0,
  dry_run int not null default 0,
  failed int not null default 0,
  statuses jsonb,             -- TableAgent status code -> count seen in this run
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table visit_emails enable row level security;
alter table visit_email_clicks enable row level security;
alter table visit_email_suppressions enable row level security;
alter table visit_email_runs enable row level security;
-- No policies on purpose: service role only (manager-gated API routes).

-- Default settings. Mode 'off' = nothing is queued or sent.
insert into app_settings (key, value) values ('visit_emails', '{"mode": "off"}')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
