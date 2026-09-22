-- Migration 021: adds tags and contact_tags -- a coordinator-managed label
-- vocabulary (Interested, Not Interested, and whatever else gets added
-- from the Contacts tab), attachable to any number of contacts by either
-- the coordinator or the caller assigned to that contact. Many-to-many on
-- purpose, a contact can carry more than one tag at once. Seeds Interested
-- and Not Interested since those were asked for by name.
-- Run this once in the Supabase SQL Editor.

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

alter table tags enable row level security;
alter table contact_tags enable row level security;

create policy "everyone reads tags"
  on tags for select
  to authenticated using (true);

create policy "coordinator manages tags"
  on tags for all
  to authenticated
  using (is_coordinator())
  with check (is_coordinator());

create policy "coordinator manages all contact tags"
  on contact_tags for all
  to authenticated
  using (is_coordinator())
  with check (is_coordinator());

create policy "caller manages tags on her own contacts"
  on contact_tags for all
  to authenticated
  using (exists (select 1 from contacts c where c.id = contact_id and c.assigned_to = auth.uid()))
  with check (exists (select 1 from contacts c where c.id = contact_id and c.assigned_to = auth.uid()));

insert into tags (name) values ('Interested'), ('Not Interested') on conflict (name) do nothing;
