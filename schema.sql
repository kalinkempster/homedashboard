-- Run once in the Neon SQL editor.

create table if not exists tasks (
  id           serial primary key,
  name         text not null,
  interval_days integer not null,
  mode         text not null default 'interval',   -- 'interval' | 'weekday'
  weekday      integer,                            -- 0=Sun .. 6=Sat, when mode='weekday'
  last_done    date,
  last_done_by text,
  streak       integer not null default 0,
  notes        text default '',
  archived     boolean not null default false,
  snoozed_to   date,
  last_pinged  date
);

-- Each row carries the task state it replaced, so an undo restores exactly what
-- was there instead of inferring it from whatever rows are left.
create table if not exists history (
  id           serial primary key,
  task_id      integer not null references tasks(id) on delete cascade,
  at           timestamptz not null default now(),
  by_who       text,
  kind         text not null default 'done',       -- 'done' | 'skipped'
  prev_last_done    date,
  prev_last_done_by text,
  prev_streak       integer,
  prev_last_pinged  date
);

create index if not exists history_at_idx on history (at desc);
create index if not exists history_task_at_idx on history (task_id, at desc);

-- One row per day on which the reminder run has already gone out, so the
-- hourly trigger can be safely hit all day and only send once.
create table if not exists run_log (
  day date primary key,
  at  timestamptz not null default now()
);

-- The shared shopping list. An item is either still wanted or already in the
-- trolley; that is the whole model.
create table if not exists grocery (
  id         serial primary key,
  name       text not null,
  done       boolean not null default false,
  added_by   text,
  done_by    text,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);

create table if not exists subscriptions (
  id         serial primary key,
  who        text not null,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Seed: the agreed job list. Staggers last_done so nothing all lands at once.
insert into tasks (name, interval_days, last_done) values
  ('Vacuum house', 7, current_date - 2),
  ('Mop floors', 7, current_date - 5),
  ('Change bed sheets', 14, current_date - 8),
  ('Change towels', 14, current_date - 10),
  ('Clean dog poo', 3, current_date - 1),
  ('Grocery shop', 14, current_date - 6),
  ('Empty bins', 14, current_date - 7),
  ('Clean toilets', 14, current_date - 9),
  ('Laundry', 3, current_date - 2),
  ('Water plants', 7, current_date - 4),
  ('Wash dog bed', 28, current_date - 20);

-- Birthdays and anniversaries. Google builds these from the address book and
-- never publishes them to an iCal feed, so the dashboard keeps its own copy.
-- Month and day only: it's an annual date, not an instant.
create table if not exists birthdays (
  id    serial primary key,
  name  text not null,
  kind  text not null default 'birthday',
  month integer not null check (month between 1 and 12),
  day   integer not null check (day between 1 and 31),
  unique (name, kind)
);

-- The regulars: one-tap chips on the grocery page. Seeded from the last five
-- Coles orders, edited freely afterwards.
create table if not exists staples (
  id       serial primary key,
  name     text not null unique,
  rank     integer not null default 100,
  category text
);
