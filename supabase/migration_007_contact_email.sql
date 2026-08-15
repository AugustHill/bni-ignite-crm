-- Run this once in the SQL Editor. Adds an email address to contacts,
-- optional (a lot of cold-call prospects will only have a phone number
-- on file). Powers the "Email" button on each contact.
alter table contacts add column if not exists email text;
