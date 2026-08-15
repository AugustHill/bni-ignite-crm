-- Run this once in the SQL Editor. Adds a warm/cold descriptor to
-- contacts. Safe on existing rows -- NOT NULL with a default, so every
-- contact you've already added backfills to 'cold' (this app exists for
-- cold-calling, so that's the sane default for anything entered before
-- this column existed).

alter table contacts add column if not exists lead_temperature text not null default 'cold';

alter table contacts drop constraint if exists contacts_lead_temperature_check;
alter table contacts add constraint contacts_lead_temperature_check
  check (lead_temperature in ('warm', 'cold'));
