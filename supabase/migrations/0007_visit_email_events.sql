-- Delivery and engagement events for visit emails, reported by Resend's
-- webhook (/api/webhooks/resend). Clicks are already counted by the app
-- itself (visit_email_clicks). Only adds columns; nothing existing changes.

alter table visit_emails
  add column if not exists delivered_at timestamptz,
  add column if not exists delayed_at timestamptz,
  add column if not exists opened_at timestamptz,     -- first open
  add column if not exists open_count int not null default 0,
  add column if not exists bounced_at timestamptz,
  add column if not exists bounce_type text,          -- Permanent / Transient
  add column if not exists complained_at timestamptz; -- marked as spam

create index if not exists visit_emails_provider_idx on visit_emails (provider_message_id)
  where provider_message_id is not null;

notify pgrst, 'reload schema';
