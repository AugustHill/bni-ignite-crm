-- Run this once in the SQL Editor. Lets a caller add her own contacts
-- (assigned to herself only, can't assign to someone else), and tracks
-- who added every contact and when.

-- created_at already exists and covers "when". This adds "who": defaults
-- to auth.uid() at the database level, so every existing insert path
-- (the admin Add Contact form, bulk add, and the new caller form below)
-- gets stamped automatically with no code needing to set it explicitly.
-- Existing contacts backfill to null (no way to know retroactively who
-- added them) -- the UI shows "Unknown" for those.
alter table contacts add column if not exists created_by uuid references profiles(id) default auth.uid();

drop policy if exists "caller adds contacts assigned to herself" on contacts;
create policy "caller adds contacts assigned to herself" on contacts for insert
  to authenticated with check (assigned_to = auth.uid());
