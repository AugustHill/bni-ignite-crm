-- Migration 018: reformats every existing contact's phone number to
-- xxx-xxx-xxxx. Strips a leading "1" country code if present. Anything
-- that doesn't reduce to exactly 10 digits (an extension, a foreign
-- number, a partial entry) is left exactly as it is rather than forced
-- into a shape that might be wrong. Going forward, the app itself
-- formats phone the same way on every write (add, edit, CSV import).
-- Run this once in the Supabase SQL Editor.

with digits as (
  select id, regexp_replace(phone, '\D', '', 'g') as d
  from contacts
)
update contacts c
set phone = case
  when length(d.d) = 10 then
    substring(d.d from 1 for 3) || '-' || substring(d.d from 4 for 3) || '-' || substring(d.d from 7 for 4)
  when length(d.d) = 11 and left(d.d, 1) = '1' then
    substring(d.d from 2 for 3) || '-' || substring(d.d from 5 for 3) || '-' || substring(d.d from 8 for 4)
  else c.phone
end
from digits d
where c.id = d.id;
