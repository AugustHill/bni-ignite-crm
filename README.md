# BNI Ignite Growth CRM

Derrick McKenzie's internal tool for growing BNI Ignite: a CRM for the paid
caller doing cold-call outreach to invite business owners to visit, plus a
GPS (Goals, Priorities, Strategies) 1-3-5 plan for the Growth Coordinator
role itself. Plain HTML/CSS/JS, no build step, same pattern as the Power
Plates and Dunedin Home Sales sites — the difference from those is this one
needs real logins, since the caller's view and the coordinator's view show
different, private data.

## Local preview

From the outer `Code` folder, use the `bni-ignite-crm` launch config
(already added to `.claude/launch.json`), or manually:

```
python -m http.server 8082 --directory bni-ignite-crm
```

Pages won't load any real data until the Supabase setup below is done —
until then you'll see a "not connected yet" message, which is expected.

## Setup (Supabase + Netlify)

### 1. Supabase (login + database)

- Create a **new, separate** Supabase project at supabase.com — don't reuse
  the Dunedin project, this is different data.
- SQL Editor → paste in `supabase/schema.sql` → Run. This creates every
  table (`profiles`, `contacts`, `call_logs`, `hours_log`, `gps_goal`,
  `gps_priorities`, `gps_actions`), the row-level security policies that
  separate what you see from what the caller sees, and seeds your goal (21
  → 35 members by 2027-08-13) and your three priorities. Edit the
  `gps_goal`/`gps_priorities` insert statements at the bottom of the file
  first if any of those numbers or titles need to change.
- Authentication → Users → **Add User**, just for yourself (your one
  bootstrap account — every other login gets created from the Team tab once
  you're in, see below). Copy your **User UID** after creating it.
- SQL Editor again → run this once, filling in the UID you just copied:

  ```sql
  insert into profiles (id, full_name, role, hourly_rate) values
    ('paste-your-own-uid-here', 'Derrick McKenzie', 'owner', null);
  ```

  (`owner` is the one-per-install tier — everything a `coordinator` can do,
  plus the private area described below. Any team member you add later from
  the Team tab is a `coordinator` or `caller`; `owner` isn't offered there
  on purpose.)
- Project Settings → API → copy the **Project URL**, **anon public key**,
  and **service_role key** (three values total, the service_role one is
  separate from and more powerful than the anon key — keep it secret).
  Project URL + anon key go into `js/supabase-config.js`. The service_role
  key does **not** go in any file that gets committed — see the Netlify
  environment variables step below instead.

### 2. Netlify (hosting)

Live at **bni-ignite-crm.netlify.app**, continuous deployment from
`github.com/AugustHill/bni-ignite-crm` — every push to `main` auto-deploys.

Adding team members from the app (instead of the Supabase dashboard) needs
one function to run, which needs its own two environment variables (Site
configuration → Environment variables in the Netlify dashboard, not in any
file — this keeps the powerful service_role key out of the codebase and out
of chat):
- `SUPABASE_URL` — same value as in `js/supabase-config.js`
- `SUPABASE_SERVICE_ROLE_KEY` — the service_role key from Supabase's API
  settings (see step 1 above)

After adding those, a redeploy is needed for them to take effect — tell me
once they're set and I'll trigger one.

### 3. Catching up an already-running install

Run these once each, in order, in the SQL Editor — both are safe on a live
database, neither touches existing data beyond tagging ownership:

- `supabase/migration_002_team_and_personal_gps.sql` — makes GPS plans
  per-person instead of one shared plan.
- `supabase/migration_003_owner_role_and_private_space.sql` — adds the
  `owner` role tier and promotes your account to it by email, and adds the
  private to-do list. Skip this one if you haven't hit "owner" anywhere
  yet (older setups than 2026-08-14).

## How the pieces fit together

- **`index.html`** — the only login page. After signing in, it checks your
  role in `profiles` and sends you to `caller.html` or `admin.html`
  automatically. There's still no public sign-up page — every login gets
  created deliberately, either your one bootstrap account (above) or through
  the Team tab from here on.
- **`caller.html`** — her queue of assigned contacts, a log-a-call form
  (outcome, notes, optional follow-up date), her self-reported hours, and a
  link to her own GPS plan. Logging an outcome of "asked not to be called
  again" flags that contact DNC automatically and it drops out of her queue
  from then on — reversible only from your DNC tab, not from her side.
- **`admin.html`** — Dashboard (calling funnel + progress toward the
  35-member goal), Contacts (add one at a time or paste many at once), DNC
  List, Hours & Pay (rate, hours, and amount owed per person), and **Team**
  (everyone with a login — edit name/role/rate inline, view anyone's GPS
  plan, add a new caller or administrator with a real working login on the
  spot). The owner sees an extra **Private** button in the header that no
  one else gets.
- **`private.html`** — owner-only (enforced by RLS, not just a hidden
  button): a to-do list, plus a link to the owner's own GPS plan. Room to
  add more here later.
- **`gps-plan.html`** — everyone's own 1-3-5: the goal at the top, then
  three priorities each broken into five strategies, fill in and check off
  as you go. Each person gets their own automatically the first time they
  open it. A coordinator can open anyone's via the "View GPS Plan" link on
  the Team tab — read-only, since it's that person's plan to fill in, not
  yours to edit for them.

## Not built yet, on purpose

Automated contact sourcing (Google Places API or a data provider like
Apollo) — you said you'd add contacts by hand to start, so the core system
came first. Say when you want to revisit this; it needs its own account/API
key setup on your end regardless of which route we take.
