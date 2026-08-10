
create table if not exists public.hub_kv (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.hub_kv enable row level security;
drop policy if exists hub_kv_anon_all on public.hub_kv;
create policy hub_kv_anon_all on public.hub_kv for all to anon using (true) with check (true);
;
