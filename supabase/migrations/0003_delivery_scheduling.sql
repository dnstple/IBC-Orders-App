-- Storefront fulfilment-choice attributes (delivery side).
-- delivery_method/delivery_option/delivery_date/delivery_label are part of
-- the theme<->functions<->app data contract; the pickup keys already exist.
alter table orders add column if not exists delivery_option text;      -- 'standard' | 'scheduled' | null
alter table orders add column if not exists delivery_date date;        -- requested day (a request, not a promise)
alter table orders add column if not exists delivery_label text;       -- display form, e.g. 'Sat 20th Sept'

create index if not exists orders_delivery_date_idx on orders (delivery_date) where delivery_date is not null;
