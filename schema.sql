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

create table if not exists history (
  id       serial primary key,
  task_id  integer not null references tasks(id) on delete cascade,
  at       timestamptz not null default now(),
  by_who   text,
  kind     text not null default 'done'            -- 'done' | 'skipped'
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
