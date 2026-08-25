-- Run this once in the SQL Editor. Adds a Script Book: everyone with a
-- login can read the scripts, only an administrator (coordinator or
-- owner) can add/edit/delete them.

create table if not exists call_scripts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table call_scripts enable row level security;

create policy "everyone reads scripts" on call_scripts for select
  to authenticated using (true);
create policy "coordinator manages scripts" on call_scripts for all
  to authenticated using (is_coordinator()) with check (is_coordinator());

-- Seeds the three GRIP-method scripts. Edit freely from the Scripts page
-- once it's live -- this is just the starting content.
insert into call_scripts (title, body, sort_order) values
(
  'Cold Call (No Prior Connection)',
  'GREET
Hi, is this [Prospect Name]? Hi [Name], this is [Your Name] calling on behalf of BNI Ignite here in the Tampa Bay area. Do you have about a minute?

[If no] No problem at all, when''s a better time to catch you? I promise it''s quick.
[If yes, continue]

REASON
The reason I''m calling is BNI Ignite is a local business networking group that meets weekly in Palm Harbor, and we''re always on the lookout for strong local businesses to invite in. I came across [Their Business Name] and thought you''d be a great fit, especially since we don''t currently have a [their industry] in our chapter.

INVITE
Here''s how it works: business owners get together once a week, build real relationships, and send each other qualified referrals, real, paid business, not just a handshake. I''d love to have you come check out a meeting as our guest, completely no obligation, just come see if it''s a fit for you. We meet Wednesday mornings at 7:30 at the Keller Williams office on US-19 in Palm Harbor. Breakfast is on us.

PRESS (for commitment)
Does this coming Wednesday work for you? [Wait for answer]
Great, let me get you registered as our guest. Can I grab your email? I''ll send the details straight over so it''s on your calendar.
[Confirm name, email, phone, industry, and the date]
Perfect, we''ll see you at 7:30. If anything comes up, you''ve got my number, just give me a call.',
  1
),
(
  'Warm Call (Referral / Prior Connection)',
  'GREET
Hi, is this [Prospect Name]? Hi [Name], this is [Your Name], I''m calling on behalf of BNI Ignite. [Referral Name] actually gave me your number.

REASON
[Referral Name] mentioned you run [Their Business Name] and thought you''d be a great fit for our chapter here in Palm Harbor. They speak really highly of your work and wanted me to reach out personally.

INVITE
Since [Referral Name] is already a member, you probably know roughly how it works, but the short version: business owners meet weekly, build real relationships, and send each other qualified referrals. I''d love to have you come check out a meeting as our guest, no obligation, just come see for yourself. We meet Wednesday mornings at 7:30 at the Keller Williams office on US-19 in Palm Harbor, breakfast included.

PRESS (for commitment)
Does this Wednesday work? [Wait for answer]
I''ll get you registered as our guest, and I''ll let [Referral Name] know you''re coming so there''s already a familiar face in the room. Can I grab your email to send the details over?
[Confirm name, email, phone, industry, and the date]
Great, see you Wednesday at 7:30.',
  2
),
(
  'Voicemail',
  'Hi [Name], this is [Your Name] calling on behalf of BNI Ignite here in Palm Harbor, sorry I missed you! We''re a local business networking group, we meet Wednesday mornings, and I think [Their Business Name] would be a great fit to come check us out as a guest. Give me a call back at [Your Number] when you get a chance, or I''ll go ahead and try you again in a few days. Thanks so much, have a great day!',
  3
)
on conflict do nothing;
