-- Migration 019: lets a coordinator edit or delete a call_logs entry, for
-- correcting a mistake or clearing out test data logged while building
-- this. There was previously no update or delete policy on call_logs at
-- all, for anyone. Note the call-outcome trigger only fires on insert, so
-- editing or deleting an entry doesn't retroactively change the contact's
-- current status -- that's a separate, direct edit on the Status dropdown
-- if it also needs fixing.
-- Run this once in the Supabase SQL Editor.

create policy "coordinator updates call logs"
  on call_logs for update
  to authenticated
  using (is_coordinator())
  with check (is_coordinator());

create policy "coordinator deletes call logs"
  on call_logs for delete
  to authenticated
  using (is_coordinator());
