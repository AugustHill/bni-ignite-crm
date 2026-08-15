-- Run this once in your Supabase project's SQL Editor (Supabase dashboard
-- -> SQL Editor -> New Query -> paste -> Run). See README.md for the full
-- setup sequence (this file is one step of several).

-- ============================================================================
-- profiles: one row per app user (coordinator or caller), linked 1:1 to
-- Supabase's own auth.users. Created manually per README.md after you add
-- each person in Authentication -> Users, since the dashboard's "Add user"
-- form doesn't have a spot for role/name/rate.
-- ============================================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('owner', 'coordinator', 'caller')),
  hourly_rate numeric(10,2),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- security definer function so policies can check "is this user any kind
-- of admin" without the check itself recursing back into a profiles policy
-- (a classic RLS gotcha on self-referencing tables). Despite the name, this
-- returns true for 'owner' too -- owner is a superset of coordinator
-- everywhere except the owner's own private area (is_owner(), below), kept
-- as one function rather than updating every policy that references it.
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

-- For the one tier that's genuinely owner-only: the private area, and
-- excluding the owner's own GPS plan from what other admins can read.
create or replace function is_owner()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'owner');
$$;

create policy "read own profile or all if coordinator"
  on profiles for select
  to authenticated
  using (id = auth.uid() or is_coordinator());

create policy "coordinator manages all profiles"
  on profiles for all
  to authenticated
  using (is_coordinator())
  with check (is_coordinator());

-- ============================================================================
-- contacts: businesses to call. Coordinator has full access; a caller can
-- see and log against only the contacts assigned to her. Stage mostly moves
-- forward automatically via the call_logs trigger below -- the coordinator
-- edits it directly for the later steps only she'd know about firsthand
-- (a visitor actually showing up, applying, getting approved).
-- ============================================================================
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text,
  phone text not null,
  industry text,
  lead_temperature text not null default 'cold' check (lead_temperature in ('warm', 'cold')),
  notes text,
  stage text not null default 'not_called' check (stage in (
    'not_called', 'called', 'reached', 'visitor_booked', 'visitor_attended',
    'applied', 'joined', 'not_interested'
  )),
  dnc boolean not null default false,
  dnc_reason text,
  dnc_at timestamptz,
  assigned_to uuid references profiles(id),
  created_by uuid references profiles(id) default auth.uid(),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table contacts enable row level security;

create policy "coordinator full access to contacts"
  on contacts for all
  to authenticated
  using (is_coordinator())
  with check (is_coordinator());

create policy "caller reads her assigned contacts"
  on contacts for select
  to authenticated
  using (assigned_to = auth.uid());

create policy "caller adds contacts assigned to herself"
  on contacts for insert
  to authenticated
  with check (assigned_to = auth.uid());

-- ============================================================================
-- call_logs: one row per call attempt. This is the caller's real write
-- surface -- she logs outcomes here rather than editing contacts directly,
-- and a trigger below rolls the outcome up into contacts.stage/dnc so the
-- two can never disagree.
-- ============================================================================
create table if not exists call_logs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  caller_id uuid not null references profiles(id),
  outcome text not null check (outcome in (
    'no_answer', 'left_voicemail', 'reached_conversation', 'not_interested',
    'dnc_requested', 'accepted_invitation', 'callback_requested'
  )),
  notes text,
  follow_up_date date,
  called_at timestamptz not null default now()
);

alter table call_logs enable row level security;

create policy "coordinator reads all call logs"
  on call_logs for select
  to authenticated
  using (is_coordinator());

create policy "caller reads her own call logs"
  on call_logs for select
  to authenticated
  using (caller_id = auth.uid());

create policy "caller logs calls for her assigned contacts"
  on call_logs for insert
  to authenticated
  with check (
    caller_id = auth.uid()
    and exists (
      select 1 from contacts c
      where c.id = contact_id and c.assigned_to = auth.uid()
    )
  );

-- Applies a logged call's outcome to its parent contact: advances stage,
-- and -- this is the DNC enforcement Derrick asked for -- the instant
-- "dnc_requested" is logged, the contact is flagged and drops out of the
-- caller's active queue (queue filtering happens in caller.html, keyed off
-- this same dnc flag).
create or replace function apply_call_outcome()
returns trigger
language plpgsql
security definer
as $$
begin
  update contacts set
    updated_at = now(),
    stage = case new.outcome
      when 'reached_conversation' then 'reached'
      when 'not_interested' then 'not_interested'
      when 'dnc_requested' then 'not_interested'
      when 'accepted_invitation' then 'visitor_booked'
      else case when stage = 'not_called' then 'called' else stage end
    end,
    dnc = case when new.outcome = 'dnc_requested' then true else dnc end,
    dnc_reason = case when new.outcome = 'dnc_requested'
      then coalesce(new.notes, 'Asked not to be called again') else dnc_reason end,
    dnc_at = case when new.outcome = 'dnc_requested' then now() else dnc_at end
  where id = new.contact_id;
  return new;
end;
$$;

drop trigger if exists on_call_logged on call_logs;
create trigger on_call_logged
  after insert on call_logs
  for each row execute function apply_call_outcome();

-- ============================================================================
-- hours_log: self-reported hours, entirely her own to add/edit/remove.
-- Coordinator sees everyone's; she sees and manages only her own.
-- ============================================================================
create table if not exists hours_log (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references profiles(id),
  work_date date not null,
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  note text,
  created_at timestamptz not null default now()
);

alter table hours_log enable row level security;

create policy "coordinator reads all hours"
  on hours_log for select
  to authenticated
  using (is_coordinator());

create policy "caller manages her own hours"
  on hours_log for all
  to authenticated
  using (caller_id = auth.uid())
  with check (caller_id = auth.uid());

-- ============================================================================
-- GPS (Goals, Priorities, Strategies) plans -- everyone's own 1-3-5, owned
-- per-person (owner_id). The app auto-creates a blank goal + 3 priorities +
-- 5 action slots each the first time a person opens gps-plan.html, so there's
-- no seed data to insert here. A coordinator can read (not edit) anyone's
-- plan; each person fully manages only their own.
-- ============================================================================
create table if not exists gps_goal (
  owner_id uuid primary key references profiles(id),
  goal_text text not null,
  starting_number int not null,
  target_number int not null,
  target_date date not null
);

create table if not exists gps_priorities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  title text not null,
  sort_order int not null
);

create table if not exists gps_actions (
  id uuid primary key default gen_random_uuid(),
  priority_id uuid not null references gps_priorities(id) on delete cascade,
  text text not null default '',
  done boolean not null default false,
  sort_order int not null
);

alter table gps_goal enable row level security;
alter table gps_priorities enable row level security;
alter table gps_actions enable row level security;

create policy "owner manages own goal" on gps_goal for all
  to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "coordinator reads non-owner goals" on gps_goal for select
  to authenticated using (
    is_coordinator() and not exists (
      select 1 from profiles p where p.id = gps_goal.owner_id and p.role = 'owner'
    )
  );

create policy "owner manages own priorities" on gps_priorities for all
  to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "coordinator reads non-owner priorities" on gps_priorities for select
  to authenticated using (
    is_coordinator() and not exists (
      select 1 from profiles p where p.id = gps_priorities.owner_id and p.role = 'owner'
    )
  );

create policy "owner manages own actions" on gps_actions for all
  to authenticated
  using (exists (select 1 from gps_priorities p where p.id = priority_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from gps_priorities p where p.id = priority_id and p.owner_id = auth.uid()));
create policy "coordinator reads non-owner actions" on gps_actions for select
  to authenticated using (
    is_coordinator() and not exists (
      select 1 from gps_priorities p
      join profiles pr on pr.id = p.owner_id
      where p.id = gps_actions.priority_id and pr.role = 'owner'
    )
  );

-- ============================================================================
-- private_todos -- owner-only, full stop. No owner_id column since there's
-- only ever one owner; per-row ownership would be pointless here.
-- ============================================================================
create table if not exists private_todos (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  category text not null default 'Personal'
    check (category in ('BNI', 'Power Plates', 'Personal', 'Real Estate', 'Coaching Task')),
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table private_todos enable row level security;

create policy "owner only" on private_todos for all
  to authenticated using (is_owner()) with check (is_owner());
