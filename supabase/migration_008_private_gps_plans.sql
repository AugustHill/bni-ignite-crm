-- Run this once in the SQL Editor. Lets you (the owner) create more than
-- one GPS plan for the Private section -- your main role-based GPS plan
-- (the "Your GPS Plan" link, gps-plan.html) is a completely separate,
-- untouched system; these are additional plans that live only here,
-- for whatever else you want to run a 1-3-5 on (Power Plates, real
-- estate, personal, etc.).

create table if not exists private_gps_plans (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  goal_text text,
  starting_number int,
  target_number int,
  target_date date,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists private_gps_priorities (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references private_gps_plans(id) on delete cascade,
  title text not null default '',
  sort_order int not null
);

create table if not exists private_gps_actions (
  id uuid primary key default gen_random_uuid(),
  priority_id uuid not null references private_gps_priorities(id) on delete cascade,
  text text not null default '',
  done boolean not null default false,
  sort_order int not null
);

alter table private_gps_plans enable row level security;
alter table private_gps_priorities enable row level security;
alter table private_gps_actions enable row level security;

create policy "owner only" on private_gps_plans for all
  to authenticated using (is_owner()) with check (is_owner());
create policy "owner only" on private_gps_priorities for all
  to authenticated using (is_owner()) with check (is_owner());
create policy "owner only" on private_gps_actions for all
  to authenticated using (is_owner()) with check (is_owner());
