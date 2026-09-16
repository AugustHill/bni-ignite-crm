-- Migration 013: lets a caller update her own assigned contacts (business
-- name, phone, email, industry, mailing address, notes, etc. -- the same
-- info fields the coordinator can already edit from admin.html). She's had
-- no update policy on contacts at all until now, only select and insert,
-- so this is a new capability, not a widening of an existing one. The
-- "with check" clause stops her from reassigning a contact away from
-- herself through this policy, and she still has no delete policy, that
-- stays coordinator-only.
-- Run this once in the Supabase SQL Editor.

create policy "caller updates her assigned contacts"
  on contacts for update
  to authenticated
  using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());
