-- Migration 022: adds "interested" as a status value, between No Answer
-- and Visit Scheduled, closing a gap flagged back in migration_010: there
-- was never a dedicated bucket for "talked to them, nothing scheduled
-- yet," it got folded into No Answer as a compromise. Updates the
-- call-outcome trigger so a "reached_conversation" call now lands on
-- Interested instead, and backfills existing contacts whose most recent
-- call was a reached_conversation that's still sitting at No Answer (the
-- old compromise) to Interested. A contact that's since moved further
-- along, or that a coordinator deliberately set, is left alone.
-- Run this once in the Supabase SQL Editor.

alter table contacts drop constraint if exists contacts_status_check;
alter table contacts add constraint contacts_status_check check (status in (
  'uncontacted', 'no_answer', 'interested', 'not_interested',
  'visit_scheduled', 'visit_attended', 'joined_bni'
));

create or replace function apply_call_outcome()
returns trigger
language plpgsql
security definer
as $$
begin
  update contacts set
    updated_at = now(),
    status = case new.outcome
      when 'reached_conversation' then 'interested'
      when 'not_interested' then 'not_interested'
      when 'dnc_requested' then 'not_interested'
      when 'accepted_invitation' then 'visit_scheduled'
      else case when status = 'uncontacted' then 'no_answer' else status end
    end,
    follow_up_date = new.follow_up_date,
    last_contacted_at = greatest(coalesce(last_contacted_at, new.called_at), new.called_at),
    dnc = case when new.outcome = 'dnc_requested' then true else dnc end,
    dnc_reason = case when new.outcome = 'dnc_requested'
      then coalesce(new.notes, 'Asked not to be called again') else dnc_reason end,
    dnc_at = case when new.outcome = 'dnc_requested' then now() else dnc_at end
  where id = new.contact_id;
  return new;
end;
$$;

update contacts c
set status = 'interested'
where status = 'no_answer'
  and exists (
    select 1 from call_logs cl
    where cl.contact_id = c.id
      and cl.called_at = c.last_contacted_at
      and cl.outcome = 'reached_conversation'
  );
