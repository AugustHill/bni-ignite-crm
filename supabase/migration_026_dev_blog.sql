-- Migration 026: the Dev Blog. Short posts about what's new in the app,
-- shown on updates.html to everyone who is logged in (callers included).
-- Only the owner can write, edit, or delete posts, and only the owner can
-- see drafts. Starts out with the app's history so far. Safe to run twice
-- (the history is only added when the table is empty).

create table if not exists dev_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'new' check (category in ('new', 'improved', 'fixed', 'note')),
  published boolean not null default true,
  published_at timestamptz not null default now(),
  author_id uuid references profiles(id) default auth.uid(),
  author_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dev_posts_published_at_idx on dev_posts (published_at desc);

create or replace function touch_dev_post()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dev_post_touch on dev_posts;
create trigger dev_post_touch
  before update on dev_posts
  for each row execute function touch_dev_post();

alter table dev_posts enable row level security;

drop policy if exists "everyone signed in reads published posts" on dev_posts;
create policy "everyone signed in reads published posts"
  on dev_posts for select
  to authenticated
  using (published or is_owner());

drop policy if exists "owner writes posts" on dev_posts;
create policy "owner writes posts"
  on dev_posts for all
  to authenticated
  using (is_owner())
  with check (is_owner());

with seed (title, body, category, published_at) as (
  values
    ($b$Welcome to the Dev Blog$b$, $b$This page is where updates to the Growth CRM get posted, so everyone who uses it can see what is new without having to ask.

- The newest updates are at the top.
- A small dot appears next to Dev Blog in the top menu whenever there is something you have not read yet.
- Questions or ideas? Tell Derrick.$b$, 'note', '2026-11-08 23:00:00+00'),
    ($b$Chapter Seats, plus a warning before you invite someone whose seat is taken$b$, $b$Everyone can now see who is in the chapter and which category (seat) each member holds.

- Callers: open the new **Chapter Seats** tab on your page. It lists every member with their company and phone number, and the open seats we are recruiting for.
- If a prospect looks like a seat that is already taken, their card shows a "Seat may be taken" tag with the member's name. BNI allows one member per category, so check with Derrick before inviting them.
- Prospects in a category we are recruiting for get a flame "Open seat" tag, and your queue now starts with them ("Open seats first" is the new default sort).
- Registering a visitor shows the same heads-up inside the popup.

The tags are a guide, not a rule. If one looks wrong, tell Derrick and he can adjust it.$b$, 'new', '2026-11-08 20:00:00+00'),
    ($b$Guest check-in, next-day follow-ups, and an Applied step$b$, $b$After each meeting, a coordinator can open **Check-In** from the top menu and tap Attended or No-show for each guest.

- **Attended:** the guest gets a thank-you email, and they show up in the caller's Follow-Up Pool the next day, so the follow-up call happens while the visit is fresh.
- **No-show:** the guest goes into the caller's No-Show Pool to be invited again.
- There is a new **Applied** status between Visit Attended and Joined BNI, so we can see who has started an application. Coordinators set it with Mark applied on the Visitors tab.$b$, 'new', '2026-11-08 19:00:00+00'),
    ($b$Dashboard goal now counts real members, with a pace line$b$, $b$The member count on the coordinator Dashboard now comes from the Members list, so it stays right when someone joins or leaves.

Under the progress bar there is a new pace line. It shows how many more members we need, how often we need to add one to hit the goal date, and, once there is enough history, how many guests per week that takes at our own close rate.$b$, 'improved', '2026-11-08 18:00:00+00'),
    ($b$Profession vote for chapter members$b$, $b$Chapter members can now tell us which professions they most want to see join, and how much they would pledge toward recruiting each one.

- Members use one shared link and pick their name from a list. No login needed.
- A pledge is a promise, collected only if someone in that profession joins the chapter. A pledge of $0 is recorded but does not count.
- Only Derrick sees the results, ranked by total dollars pledged.$b$, 'new', '2026-11-07 17:00:00+00'),
    ($b$Register a Visitor, with automatic emails$b$, $b$Callers can now register a guest for a specific Wednesday right from their page.

- Click **Register Visitor** on a contact card, or **Register a Guest** for someone who is not in the list yet. Pick the Wednesday and confirm their details.
- The guest gets a welcome email with the time, address, parking, dress code, and a button to add the meeting to their Google Calendar. Derrick is copied.
- Need to move the date or cancel? **Change date** and **Cancel** are on the contact's card, and the guest is emailed either way.
- The day before, the guest gets a reminder email.
- Guests who did not show up appear in your new **No-Show Pool** tab so you can invite them again. Click Done following up when you are finished.$b$, 'new', '2026-10-25 16:00:00+00'),
    ($b$Row numbers and a Productivity card$b$, $b$Contacts are now numbered from top to bottom, and the numbers do not change when you sort or filter.

The coordinator Dashboard also has a new **Productivity & Conversion** card: calls per hour, conversations per hour, show-up rate, close rate, and DNC rate.$b$, 'new', '2026-09-28 16:00:00+00'),
    ($b$Interested status, and phone numbers on one line$b$, $b$There is a new **Interested** status for people who had a real conversation and are open to visiting but do not have a date yet.

Phone numbers also stay on one line now in the Contacts table.$b$, 'new', '2026-09-27 16:00:00+00'),
    ($b$Meeting-invite emails, tags, search, and a simpler Contacts table$b$, $b$- The Email button now offers **Invite to a Meeting**. It fills in the standard invite (Wednesday at 7:30 AM, the Palm Harbor address, bring business cards). You pick the date on a calendar where only Wednesdays can be chosen.
- Click anywhere on a contact's row to open its details. No more scrolling sideways to find Edit.
- **Tags** label contacts, like Interested or Not Interested. Coordinators create tags, and callers and coordinators can both apply them. Coordinators can filter by tag and search by business name.$b$, 'new', '2026-09-22 16:00:00+00'),
    ($b$Sort the Contacts table by any column$b$, $b$On the coordinator Contacts tab, click Business, Type, Status, Date Added, or Last Called to sort by that column. Click again to reverse the order.$b$, 'improved', '2026-09-21 16:00:00+00'),
    ($b$Phone formatting, and fixable call history$b$, $b$Phone numbers are now formatted like 727-555-0100 everywhere, including numbers that were already in the system.

Coordinators can also edit or delete a call log entry to fix a mistake.$b$, 'improved', '2026-09-17 16:00:00+00'),
    ($b$A big round of caller tools$b$, $b$- **Follow-Up Pool:** a tab listing everyone with a follow-up date, soonest first, with overdue ones marked.
- **Edit your own contacts:** callers can correct contact information right on their cards.
- **Hot, Warm, Cold:** contacts carry a lead type, and your queue can be sorted by it or filtered by industry.
- **Categories we are recruiting for** appear at the top of your page with a flame.
- **Call history** shows on each card, and you can log a call that happened earlier with its real date and time.
- Coordinators also got an **Activity** tab showing what callers have been doing.$b$, 'new', '2026-09-16 16:00:00+00'),
    ($b$CSV import wizard$b$, $b$Coordinators can upload a spreadsheet of contacts. The wizard asks what each column is, shows a preview, lets you choose who the contacts are assigned to, and checks for duplicate phone numbers before importing.$b$, 'new', '2026-09-07 16:00:00+00'),
    ($b$Script Book$b$, $b$A **Script Book** is now linked at the top of every page, with call scripts to read from. Everyone can read it, and coordinators can edit it.$b$, 'new', '2026-08-24 16:00:00+00'),
    ($b$The Growth CRM is live$b$, $b$Everyone has their own login. Callers see their own list and log calls, hours, and notes. Coordinators see everything and manage the team.

Each person also has their own GPS plan (Goals, Priorities, Strategies) to fill in and check off.$b$, 'note', '2026-08-14 16:00:00+00')
)
insert into dev_posts (title, body, category, published_at)
select title, body, category, published_at::timestamptz
from seed
where not exists (select 1 from dev_posts);
