-- Migration 010: rename contacts.stage to contacts.status, and replace the
-- old 8-value stage vocabulary with the new 6-value status list (Uncontacted,
-- No Answer, Not Interested, Visit Scheduled, Visit Attended, Joined BNI).
-- Run this once in the Supabase SQL Editor.

-- 1. Drop the old check constraint so existing values can be remapped first.
alter table contacts drop constraint if exists contacts_stage_check;

-- 2. Remap every existing row to the new vocabulary while the column is
-- still named "stage". Two old values don't have a dedicated bucket in the
-- new 6-value list, so they fold into the nearest neighbor:
--   - "reached" (had a real conversation, nothing booked yet) -> no_answer,
--     since there's no "in progress" bucket anymore -- the granular outcome
--     is still on the call itself in call_logs, just not reflected here.
--   - "applied" (attended and applied, not yet an approved member) ->
--     visit_attended, rather than jumping straight to Joined BNI.
update contacts set stage = 'uncontacted' where stage = 'not_called';
update contacts set stage = 'no_answer' where stage in ('called', 'reached');
update contacts set stage = 'visit_scheduled' where stage = 'visitor_booked';
update contacts set stage = 'visit_attended' where stage in ('visitor_attended', 'applied');
update contacts set stage = 'joined_bni' where stage = 'joined';
-- 'not_interested' already matches its own new value; nothing to do there.

-- 3. Rename the column itself.
alter table contacts rename column stage to status;

-- 4. New check constraint with the new 6-value vocabulary.
alter table contacts add constraint contacts_status_check check (status in (
  'uncontacted', 'no_answer', 'not_interested', 'visit_scheduled',
  'visit_attended', 'joined_bni'
));

-- 5. New default for future inserts.
alter table contacts alter column status set default 'uncontacted';

-- 6. Update the call-outcome trigger to write the new vocabulary.
create or replace function apply_call_outcome()
returns trigger
language plpgsql
security definer
as $$
begin
  update contacts set
    updated_at = now(),
    status = case new.outcome
      when 'reached_conversation' then 'no_answer'
      when 'not_interested' then 'not_interested'
      when 'dnc_requested' then 'not_interested'
      when 'accepted_invitation' then 'visit_scheduled'
      else case when status = 'uncontacted' then 'no_answer' else status end
    end,
    dnc = case when new.outcome = 'dnc_requested' then true else dnc end,
    dnc_reason = case when new.outcome = 'dnc_requested'
      then coalesce(new.notes, 'Asked not to be called again') else dnc_reason end,
    dnc_at = case when new.outcome = 'dnc_requested' then now() else dnc_at end
  where id = new.contact_id;
  return new;
end;
$$;
