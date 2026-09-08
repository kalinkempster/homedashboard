-- Brings a database created from the original schema.sql up to date.
-- Safe to run more than once, and safe to skip: the app creates the columns and
-- the run_log table on demand. Running it just gets the indexes too.

alter table history add column if not exists prev_last_done    date;
alter table history add column if not exists prev_last_done_by text;
alter table history add column if not exists prev_streak       integer;
alter table history add column if not exists prev_last_pinged  date;

create index if not exists history_at_idx      on history (at desc);
create index if not exists history_task_at_idx on history (task_id, at desc);

create table if not exists run_log (
  day date primary key,
  at  timestamptz not null default now()
);

create table if not exists grocery (
  id         serial primary key,
  name       text not null,
  done       boolean not null default false,
  added_by   text,
  done_by    text,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);

create table if not exists birthdays (
  id    serial primary key,
  name  text not null,
  kind  text not null default 'birthday',
  month integer not null check (month between 1 and 12),
  day   integer not null check (day between 1 and 31),
  unique (name, kind)
);
