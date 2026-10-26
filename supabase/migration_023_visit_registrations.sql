-- Migration 023: visitor registration. One row per visitor registered to
-- attend a Wednesday meeting (visit_registrations), plus a log of every
-- email sent about it (visit_emails). Powers the Register Visitor flow,
-- the Visitors tab in admin.html, and the caller's No-Show pool.
--
-- Design notes:
-- * meeting_date is checked to be a Wednesday at the database level, so a
--   wrong day can't get in no matter what the page does.
-- * A contact can only have ONE active (status = 'registered') registration
--   at a time, enforced by the partial unique index below. Moving a visitor
--   to another Wednesday edits that row (previous_meeting_date remembers
--   where they came from) rather than creating a second one.
-- * visit_emails is written only by the Netlify functions (service role),
--   there's deliberately no insert policy for logged-in users.
-- Run this once in the Supabase SQL Editor.

create table if not exists visit_registrations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  meeting_date date not null check (extract(dow from meeting_date) = 3),
  previous_meeting_date date,
  status text not null default 'registered'
    check (status in ('registered', 'attended', 'no_show', 'cancelled')),
  first_name text not null,
  last_name text,
  company text,
  phone text,
  email text not null,
  category text,
  registered_by uuid references profiles(id) default auth.uid(),
  registered_by_name text,
  reminder_sent_at timestamptz,
  followed_up_at timestamptz,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists one_active_registration_per_contact
  on visit_registrations (contact_id) where status = 'registered';
create index if not exists visit_registrations_meeting_date_idx
  on visit_registrations (meeting_date);

create or replace function touch_visit_registration()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.status is distinct from old.status then
    new.status_changed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists visit_registration_touch on visit_registrations;
create trigger visit_registration_touch
  before update on visit_registrations
  for each row execute function touch_visit_registration();

create table if not exists visit_emails (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references visit_registrations(id) on delete cascade,
  kind text not null
    check (kind in ('welcome', 'date_change', 'cancellation', 'reminder', 'thank_you')),
  to_email text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists visit_emails_registration_idx on visit_emails (registration_id);

alter table visit_registrations enable row level security;
alter table visit_emails enable row level security;

create policy "coordinator manages visit registrations"
  on visit_registrations for all
  to authenticated
  using (is_coordinator())
  with check (is_coordinator());

create policy "caller reads her visit registrations"
  on visit_registrations for select
  to authenticated
  using (exists (select 1 from contacts c where c.id = contact_id and c.assigned_to = auth.uid()));

create policy "caller registers visitors for her contacts"
  on visit_registrations for insert
  to authenticated
  with check (
    registered_by = auth.uid()
    and exists (select 1 from contacts c where c.id = contact_id and c.assigned_to = auth.uid())
  );

create policy "caller updates her visit registrations"
  on visit_registrations for update
  to authenticated
  using (exists (select 1 from contacts c where c.id = contact_id and c.assigned_to = auth.uid()))
  with check (exists (select 1 from contacts c where c.id = contact_id and c.assigned_to = auth.uid()));

create policy "coordinator reads visit emails"
  on visit_emails for select
  to authenticated
  using (is_coordinator());

create policy "caller reads emails on her visit registrations"
  on visit_emails for select
  to authenticated
  using (exists (
    select 1 from visit_registrations r
    join contacts c on c.id = r.contact_id
    where r.id = registration_id and c.assigned_to = auth.uid()
  ));
