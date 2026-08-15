-- Run this once in the SQL Editor. Adds a category and a priority to the
-- private to-do list. Safe on existing rows -- both new columns are
-- NOT NULL but carry a default, so anything already on your list backfills
-- to Personal / Medium automatically rather than erroring.

alter table private_todos
  add column if not exists category text not null default 'Personal',
  add column if not exists priority text not null default 'medium';

alter table private_todos drop constraint if exists private_todos_category_check;
alter table private_todos add constraint private_todos_category_check
  check (category in ('BNI', 'Power Plates', 'Personal', 'Real Estate', 'Coaching Task'));

alter table private_todos drop constraint if exists private_todos_priority_check;
alter table private_todos add constraint private_todos_priority_check
  check (priority in ('high', 'medium', 'low'));
