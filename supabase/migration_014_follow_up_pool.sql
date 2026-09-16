-- Migration 014: adds contacts.follow_up_date and keeps it synced from the
-- call-outcome trigger, so the new Follow-Up Pool tab in caller.html can
-- query it directly instead of hunting through call_logs for the latest
-- row per contact. It always mirrors the most recently logged call's
-- follow_up_date (including back to null if the latest call didn't set
-- one).
-- Run this once in the Supabase SQL Editor.

alter table contacts add column if not exists follow_up_date date;

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
    follow_up_date = new.follow_up_date,
    dnc = case when new.outcome = 'dnc_requested' then true else dnc end,
    dnc_reason = case when new.outcome = 'dnc_requested'
      then coalesce(new.notes, 'Asked not to be called again') else dnc_reason end,
    dnc_at = case when new.outcome = 'dnc_requested' then now() else dnc_at end
  where id = new.contact_id;
  return new;
end;
$$;
