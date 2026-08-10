
create table if not exists public.time_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  person     text not null,
  work_date  date not null,
  task       text not null default '',
  hours      numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists time_logs_person_date_idx on public.time_logs (person, work_date);

alter table public.time_logs enable row level security;
create policy "authenticated full access time_logs"
  on public.time_logs for all to authenticated
  using (true) with check (true);
;
