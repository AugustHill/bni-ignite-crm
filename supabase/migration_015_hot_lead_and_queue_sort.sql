-- Migration 015: adds "hot" as a third lead-temperature tier alongside the
-- existing warm/cold (no data change needed, existing rows are already
-- valid under the wider constraint). Everything else in this round
-- (industry filter, sort by name/lead type/status on the caller's queue)
-- is client-side only, no schema involved.
-- Run this once in the Supabase SQL Editor.

alter table contacts drop constraint if exists contacts_lead_temperature_check;
alter table contacts add constraint contacts_lead_temperature_check
  check (lead_temperature in ('hot', 'warm', 'cold'));
