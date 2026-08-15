-- Run this once in the SQL Editor. Adds a third role tier, "owner" (you
-- specifically), that has every coordinator permission plus a private area
-- no one else, including other administrators, can see.

-- 1. Allow the new role value.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner', 'coordinator', 'caller'));

-- 2. Promote your own account, by email rather than a guess -- more
-- coordinators may exist by now than when the first migration ran.
update profiles set role = 'owner'
where id = (select id from auth.users where email = 'derrick.mckenzie@kw.com');

-- 3. is_coordinator() now covers 'owner' too, so every place that already
-- grants "any admin" access (contacts, call_logs, hours_log, profiles,
-- gps_* read-all) picks this up with no policy changes needed there. The
-- function keeps its original name rather than being renamed everywhere
-- it's referenced -- read it as "is admin-tier", not literally "is exactly
-- a coordinator", from here on.
create or replace function is_coordinator()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('owner', 'coordinator')
  );
$$;

create or replace function is_owner()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'owner');
$$;

-- 4. Close the actual privacy gap: before this, any coordinator could read
-- your GPS plan via the Team tab's "View GPS Plan" link, since
-- is_coordinator() didn't distinguish you from anyone else with admin
-- access. Replace the three "coordinator reads all" GPS policies with
-- versions that skip rows owned by an owner-role person.
drop policy if exists "coordinator reads all goals" on gps_goal;
create policy "coordinator reads non-owner goals" on gps_goal for select
  to authenticated using (
    is_coordinator() and not exists (
      select 1 from profiles p where p.id = gps_goal.owner_id and p.role = 'owner'
    )
  );

drop policy if exists "coordinator reads all priorities" on gps_priorities;
create policy "coordinator reads non-owner priorities" on gps_priorities for select
  to authenticated using (
    is_coordinator() and not exists (
      select 1 from profiles p where p.id = gps_priorities.owner_id and p.role = 'owner'
    )
  );

drop policy if exists "coordinator reads all actions" on gps_actions;
create policy "coordinator reads non-owner actions" on gps_actions for select
  to authenticated using (
    is_coordinator() and not exists (
      select 1 from gps_priorities p
      join profiles pr on pr.id = p.owner_id
      where p.id = gps_actions.priority_id and pr.role = 'owner'
    )
  );

-- 5. The private to-do list. Owner-only, full stop. No owner_id column --
-- there's only ever one owner, so per-row ownership would be pointless.
create table if not exists private_todos (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table private_todos enable row level security;

create policy "owner only" on private_todos for all
  to authenticated using (is_owner()) with check (is_owner());
