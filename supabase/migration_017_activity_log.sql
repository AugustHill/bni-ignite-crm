-- Migration 017: adds activity_log, a meaningful-actions audit trail (not
-- raw clicks) -- contact added/edited/deleted, a call logged, the Email
-- link clicked. Anyone logs their own actions as they happen; only a
-- coordinator can read it back. contact_label is a snapshot of the
-- contact's name at the time, not a live join, so the log still reads
-- correctly after a contact is deleted. Append-only: no update or delete
-- policy at all, on purpose.
-- Run this once in the Supabase SQL Editor.

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references profiles(id),
  action text not null,
  contact_id uuid references contacts(id) on delete set null,
  contact_label text,
  details text,
  created_at timestamptz not null default now()
);

alter table activity_log enable row level security;

create policy "anyone logs their own actions"
  on activity_log for insert
  to authenticated
  with check (actor_id = auth.uid());

create policy "coordinator reads activity log"
  on activity_log for select
  to authenticated
  using (is_coordinator());
