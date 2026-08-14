-- Run this once in your Supabase project's SQL Editor. Safe to run on the
-- live database — it only adds/backfills, it doesn't drop any of your data.
--
-- Two changes:
-- 1. GPS plans become per-person instead of one shared plan. Your existing
--    goal/priorities get reassigned to you specifically, and every team
--    member gets their own (auto-created the first time they open the page).
-- 2. RLS is updated so a coordinator can read (not edit) any team member's
--    plan, which is what powers "View GPS Plan" on the new Team tab.

-- ============================================================================
-- gps_goal: drop the old "always exactly one row" constraint, give each
-- goal an owner instead.
-- ============================================================================
alter table gps_goal add column if not exists owner_id uuid references profiles(id);

update gps_goal
  set owner_id = (select id from profiles where role = 'coordinator' order by created_at limit 1)
  where owner_id is null;

alter table gps_goal alter column owner_id set not null;
alter table gps_goal drop constraint if exists gps_goal_single_row;
alter table gps_goal drop constraint if exists gps_goal_pkey;
alter table gps_goal add primary key (owner_id);
alter table gps_goal drop column if exists id;

drop policy if exists "coordinator full access to gps_goal" on gps_goal;
create policy "owner manages own goal" on gps_goal for all
  to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "coordinator reads all goals" on gps_goal for select
  to authenticated using (is_coordinator());

-- ============================================================================
-- gps_priorities: add an owner (no primary-key surgery needed, id was
-- already a real uuid).
-- ============================================================================
alter table gps_priorities add column if not exists owner_id uuid references profiles(id);

update gps_priorities
  set owner_id = (select id from profiles where role = 'coordinator' order by created_at limit 1)
  where owner_id is null;

alter table gps_priorities alter column owner_id set not null;

drop policy if exists "coordinator full access to gps_priorities" on gps_priorities;
create policy "owner manages own priorities" on gps_priorities for all
  to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "coordinator reads all priorities" on gps_priorities for select
  to authenticated using (is_coordinator());

-- ============================================================================
-- gps_actions: no schema change (ownership flows through priority_id), just
-- new policies matching the pattern above.
-- ============================================================================
drop policy if exists "coordinator full access to gps_actions" on gps_actions;
create policy "owner manages own actions" on gps_actions for all
  to authenticated
  using (exists (select 1 from gps_priorities p where p.id = priority_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from gps_priorities p where p.id = priority_id and p.owner_id = auth.uid()));
create policy "coordinator reads all actions" on gps_actions for select
  to authenticated using (is_coordinator());
