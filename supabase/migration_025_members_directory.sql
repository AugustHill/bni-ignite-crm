-- Migration 025: the chapter members directory, and an Applied status.
--
-- 1. The roster table that already feeds the profession vote (vote_members)
--    now also holds each member's company, phone, BNI category (their "seat")
--    and optional keywords, so the callers can see who holds which seat and
--    the app can warn when a prospect may be in a seat that's taken. The
--    table keeps its original name so the live vote form keeps working with
--    no downtime.
-- 2. Everyone signed in can READ the roster (callers included, that's the
--    point); only coordinators and the owner can change it.
-- 3. Adds "applied" as a contact status between Visit Attended and Joined BNI.
-- 4. Loads the 19 current members' details. Safe to run more than once.

alter table vote_members add column if not exists company text;
alter table vote_members add column if not exists phone text;
alter table vote_members add column if not exists category text;
alter table vote_members add column if not exists keywords text;

drop policy if exists "everyone signed in reads the chapter roster" on vote_members;
create policy "everyone signed in reads the chapter roster"
  on vote_members for select
  to authenticated
  using (true);

drop policy if exists "coordinators manage the chapter roster" on vote_members;
create policy "coordinators manage the chapter roster"
  on vote_members for all
  to authenticated
  using (is_coordinator())
  with check (is_coordinator());

alter table contacts drop constraint if exists contacts_status_check;
alter table contacts add constraint contacts_status_check check (status in (
  'uncontacted', 'no_answer', 'interested', 'not_interested',
  'visit_scheduled', 'visit_attended', 'applied', 'joined_bni'
));

with roster (name, company, phone, category, keywords) as (
  values
    ('Brian Forrester', 'Top Flite Home Loans', '813-361-6350', 'Mortgage Banker', 'mortgage, mortgage broker, loan officer, home loan, lender'),
    ('Piers Barnard', 'Ambrose Inspections', '727-637-3232', 'Home Inspector', 'home inspection, home inspector, inspector, inspection'),
    ('Thomas Temeyer', 'TSG Financial', '727-610-8116', 'Financial Advisor', 'financial advisor, financial planner, financial planning, wealth management, investment advisor'),
    ('Nicole Powell', 'Distinct Title Services', '727-309-6020', 'Title', 'title company, title agency, title services, escrow'),
    ('Kristina Celata', 'Air Zero', '727-404-0286', 'HVAC', 'hvac, air conditioning, heating and cooling, ac repair, furnace'),
    ('Derrick McKenzie', 'Derrick McKenzie PA', '440-752-9616', 'Residential Realtor', 'realtor, real estate agent, real estate broker, realty, real estate'),
    ('Kristin Karbowski', 'The Nurse Lawyer', '813-956-8515', 'Personal Injury Law', 'personal injury, injury attorney, injury lawyer, accident attorney, accident lawyer'),
    ('Jovan Johannason', 'Ferman Automotive Group', '727-686-5844', 'Commercial Fleet Sales', 'fleet sales, fleet, commercial vehicles, car dealership, auto dealership, car dealer, auto dealer'),
    ('Peter May', 'Safeway Pest Defense', '727-297-9606', 'Pest Control', 'pest control, pest, exterminator, extermination, termite'),
    ('Justin Levey', 'Edgewater Insurance', '727-512-7741', 'Residential P&C Insurance', 'insurance agent, insurance agency, home insurance, homeowners insurance, auto insurance, property and casualty'),
    ('Daniel Ruiz', 'Saint Petersburg Bookkeeping', '727-248-5325', 'Bookkeeping', 'bookkeeper, bookkeeping, book keeping'),
    ('George Linardos', 'Coastal Edge Property Solution', '727-628-3469', 'Handyman', 'handyman, handy man, home repair, property maintenance, home maintenance'),
    ('Yuri Yarmolchik', 'Purple Painting', '813-638-4663', 'Painting', 'painter, painting, painting contractor, house painter'),
    ('Will Poore', 'American Family Roofing', '321-290-7175', 'Residential Roofing', 'roofing, roofer, roof repair, roof replacement, roofing contractor'),
    ('Mia Bach', 'Bach Chiropractic and Acupuncture', '727-386-8229', 'Chiropractor', 'chiropractor, chiropractic, acupuncture, acupuncturist'),
    ('Jason Beninati', 'Manns Electric', '727-241-3205', 'Electrician', 'electrician, electrical contractor, electrical services, electrical'),
    ('Annette Slavik', 'Prodigy Complete IT Solutions', '727-756-8407', 'IT Solutions', 'it services, it support, managed it, managed services, computer repair, tech support, cybersecurity'),
    ('Steven Kustov', 'Flat6 Solutions', '727-743-2359', 'Web Design', 'web design, web designer, web developer, web development, website design, website development, website'),
    ('Angela Howard', 'Wilson Contracting LLC', '859-398-5811', 'General Contractor', 'general contractor, remodeling, home remodeling, renovation, construction, home builder')
),
updated as (
  update vote_members m
  set company = r.company, phone = r.phone, category = r.category, keywords = r.keywords
  from roster r
  where lower(m.name) = lower(r.name)
  returning m.id
)
insert into vote_members (name, company, phone, category, keywords)
select r.name, r.company, r.phone, r.category, r.keywords
from roster r
where not exists (select 1 from vote_members m where lower(m.name) = lower(r.name));
