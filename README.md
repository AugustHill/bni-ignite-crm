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
- Authentication → Users → **Add User**, twice: once for you, once for your
  caller. Set a real password for each (share hers with her directly,
  outside this file). Copy each person's **User UID** after creating them —
  you'll need both in the next step.
- SQL Editor again → run this once, filling in the two UIDs you just copied:

  ```sql
  insert into profiles (id, full_name, role, hourly_rate) values
    ('paste-your-own-uid-here', 'Derrick McKenzie', 'coordinator', null),
    ('paste-her-uid-here', 'Her Name', 'caller', 20.00);
  ```

  (Set the hourly rate to whatever you're actually paying — it drives the
  "amount owed" numbers on the Hours & Pay tab. You can also change it later
  right from that tab.)
- Project Settings → API → copy the **Project URL** and **anon public key**
  into `js/supabase-config.js` (both values, one file, shared by every page).

### 2. Netlify (hosting)

Same pattern as your other sites: push this folder to a new GitHub repo,
connect it to a new Netlify site for continuous deployment. Say the word and
I'll set that part up once you're ready to go live — it doesn't need
anything from you except a green light.

## How the pieces fit together

- **`index.html`** — the only login page. After signing in, it checks your
  role in `profiles` and sends you to `caller.html` or `admin.html`
  automatically. There's no public sign-up page on purpose, since it's just
  the two of you — accounts only get created the way described above.
- **`caller.html`** — her queue of assigned contacts, a log-a-call form
  (outcome, notes, optional follow-up date), and her self-reported hours.
  Logging an outcome of "asked not to be called again" flags that contact
  DNC automatically and it drops out of her queue from then on — reversible
  only from your DNC tab, not from her side.
- **`admin.html`** — your Dashboard (calling funnel + progress toward the
  35-member goal), Contacts (add one at a time or paste many at once),
  DNC List, and Hours & Pay (her rate, hours, and amount owed).
- **`gps-plan.html`** — your 1-3-5: the goal at the top, then your three
  priorities each broken into five strategies you can fill in and check off
  as you go. Linked from the top of `admin.html`.

## Not built yet, on purpose

Automated contact sourcing (Google Places API or a data provider like
Apollo) — you said you'd add contacts by hand to start, so the core system
came first. Say when you want to revisit this; it needs its own account/API
key setup on your end regardless of which route we take.
