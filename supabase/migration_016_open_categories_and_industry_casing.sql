-- Migration 016: adds open_categories (the BNI categories currently being
-- recruited for, shown with a fire icon on the caller's page), and
-- title-cases every existing industry value already in contacts so the
-- Industry dropdown/filter doesn't start out with casing-duplicates like
-- "roofing" and "Roofing" both showing up. Going forward, the app itself
-- title-cases industry on every write (add, edit, CSV import).
-- Run this once in the Supabase SQL Editor.

create table if not exists open_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table open_categories enable row level security;

create policy "everyone reads open categories"
  on open_categories for select
  to authenticated using (true);

create policy "coordinator manages open categories"
  on open_categories for all
  to authenticated
  using (is_coordinator())
  with check (is_coordinator());

update contacts set industry = initcap(industry) where industry is not null;
