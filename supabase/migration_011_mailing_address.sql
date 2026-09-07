-- Migration 011: adds mailing_address and additional_info to contacts.
-- mailing_address holds a full address as one freeform string (uploaded
-- files store address parts in all kinds of shapes, no point forcing a
-- rigid street/city/state/zip structure on it). additional_info holds
-- anything from an uploaded file that doesn't map to a known field, so
-- that data is kept and shown on the contact instead of silently dropped.
-- Run this once in the Supabase SQL Editor.

alter table contacts add column if not exists mailing_address text;
alter table contacts add column if not exists additional_info text;
