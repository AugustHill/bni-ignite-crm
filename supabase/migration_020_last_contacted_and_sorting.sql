-- Migration 020: adds contacts.last_contacted_at, backfilled from existing
-- call_logs history and kept in sync going forward by the call-outcome
-- trigger. Uses greatest() rather than a flat assignment so a backdated
-- call logged out of order can't regress it earlier than the true most
-- recent call. Powers the new "Last Called" sortable column in
-- admin.html's Contacts table (added alongside "Date Added" and
-- click-to-sort on Business Name, Type, and Status -- all sorting is
-- client-side over the already-loaded table, no schema needed for that
-- part).
-- Run this once in the Supabase SQL Editor.

alter table contacts add column if not exists last_contacted_at timestamptz;

update contacts c
set last_contacted_at = (
  select max(called_at) from call_logs cl where cl.contact_id = c.id
);

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
    last_contacted_at = greatest(coalesce(last_contacted_at, new.called_at), new.called_at),
    dnc = case when new.outcome = 'dnc_requested' then true else dnc end,
    dnc_reason = case when new.outcome = 'dnc_requested'
      then coalesce(new.notes, 'Asked not to be called again') else dnc_reason end,
    dnc_at = case when new.outcome = 'dnc_requested' then now() else dnc_at end
  where id = new.contact_id;
  return new;
end;
$$;
