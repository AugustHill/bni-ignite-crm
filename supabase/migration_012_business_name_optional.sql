-- Migration 012: makes contacts.business_name optional. Some of Derrick's
-- uploaded files are personal contacts with no business attached, and a
-- phone number is the only thing every contact is guaranteed to have.
-- Run this once in the Supabase SQL Editor.

alter table contacts alter column business_name drop not null;
