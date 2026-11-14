-- Every saved version of the Visit emails settings and copy, so nothing
-- typed on the tab is ever lost: the tab lists them and can load any back.
-- Only adds a table; nothing existing changes.

create table if not exists visit_email_settings_history (
  id bigint generated always as identity primary key,
  value jsonb not null,
  saved_by uuid references staff_profiles (id),
  saved_at timestamptz not null default now()
);
create index if not exists visit_email_settings_history_at on visit_email_settings_history (saved_at desc);

alter table visit_email_settings_history enable row level security;
-- No policies: service role only (admin-gated API routes).

-- Keep a copy of what is saved right now as the first version.
insert into visit_email_settings_history (value, saved_by, saved_at)
select value, updated_by, updated_at from app_settings where key = 'visit_emails'
  and not exists (select 1 from visit_email_settings_history);

notify pgrst, 'reload schema';
