-- Migration 024: profession vote. Members open one shared public form
-- (vote.html), pick their name from the roster, and name up to three
-- professions they'd like the chapter to recruit, with a dollar pledge for
-- each. Only the owner sees the results (the Profession Vote tab in
-- admin.html), ranked by total dollars pledged; $0 entries are recorded but
-- never count toward the ranking.
--
-- Design notes:
-- * The public form never touches these tables directly. It goes through the
--   profession-vote Netlify function, which uses the service role. So there
--   are deliberately no policies for anonymous visitors, and the only
--   policies below are owner-only (the owner's pages read/write directly).
-- * One submission per member (unique member_id). Deleting a roster member
--   deletes their vote too (on delete cascade).
-- * group_name lets the owner combine look-alike entries ("Plumber" and
--   "Plumbing") under one profession; null means "use what they typed".
-- Run this once in the Supabase SQL Editor.

create table if not exists vote_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists vote_members_name_unique on vote_members (lower(name));

create table if not exists vote_submissions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references vote_members(id) on delete cascade,
  submitted_at timestamptz not null default now()
);

create table if not exists vote_pledges (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references vote_submissions(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  profession text not null,
  amount integer not null default 0 check (amount >= 0 and amount <= 1000000),
  group_name text,
  unique (submission_id, slot)
);

create table if not exists vote_settings (
  id smallint primary key default 1 check (id = 1),
  is_open boolean not null default true
);

insert into vote_settings (id, is_open) values (1, true) on conflict (id) do nothing;

alter table vote_members enable row level security;
alter table vote_submissions enable row level security;
alter table vote_pledges enable row level security;
alter table vote_settings enable row level security;

create policy "owner manages vote members"
  on vote_members for all
  to authenticated using (is_owner()) with check (is_owner());

create policy "owner manages vote submissions"
  on vote_submissions for all
  to authenticated using (is_owner()) with check (is_owner());

create policy "owner manages vote pledges"
  on vote_pledges for all
  to authenticated using (is_owner()) with check (is_owner());

create policy "owner manages vote settings"
  on vote_settings for all
  to authenticated using (is_owner()) with check (is_owner());
