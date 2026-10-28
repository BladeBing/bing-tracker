-- Bing's 24-Week Tracker: database setup for Supabase
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- Row-level security means each signed-in account can only see and change its own rows.

create table if not exists public.days (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date         date not null,
  weight       numeric(5,1),
  kcal         integer,
  protein      integer,
  steps        integer,
  sleep        numeric(4,2),
  training     text,
  pain         smallint check (pain between 0 and 10),
  agent_hours  numeric(4,2),
  learn_hours  numeric(4,2),
  apps_sent    integer,
  rehab_am     boolean default false,
  rehab_pm     boolean default false,
  swelling     boolean default false,
  notes        text,
  updated_at   timestamptz default now(),
  primary key (user_id, date)
);

create table if not exists public.applications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company     text not null,
  role        text,
  applied_on  date,
  status      text,
  note        text,
  created_at  timestamptz default now()
);

create table if not exists public.ankle_tests (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date     date not null,
  ktw_op   numeric(4,1),
  ktw_ok   numeric(4,1),
  cr_op    integer,
  cr_ok    integer,
  squat    text,
  primary key (user_id, date)
);

alter table public.days         enable row level security;
alter table public.applications enable row level security;
alter table public.ankle_tests  enable row level security;

drop policy if exists "own rows" on public.days;
drop policy if exists "own rows" on public.applications;
drop policy if exists "own rows" on public.ankle_tests;

create policy "own rows" on public.days
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.applications
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.ankle_tests
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ---------------------------------------------------------------
-- Bonus: SQL practice on your own data (run these any time later)
-- ---------------------------------------------------------------

-- 1. Weekly averages, with the change from the week before (window function)
-- select date_trunc('week', date)::date as week_start,
--        round(avg(weight), 1)                 as avg_kg,
--        round(avg(weight) - lag(avg(weight)) over (order by date_trunc('week', date)), 2) as change_kg,
--        round(avg(protein))                   as avg_protein_g,
--        sum(agent_hours)                      as agent_hours
-- from days
-- group by 1
-- order by 1;

-- 2. 7-day rolling average weight (the same number the app shows)
-- select date, weight,
--        round(avg(weight) over (order by date rows between 6 preceding and current row), 1) as avg_7d
-- from days
-- where weight is not null
-- order by date;

-- 3. Application funnel: how many reached each stage
-- select status, count(*) from applications group by status order by count(*) desc;
