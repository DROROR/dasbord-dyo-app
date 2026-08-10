-- Where each lead has got to in a nurturing sequence. One row per lead per
-- sequence, so a lead can never be sent the same step twice.
create table if not exists public.lead_sequence_progress (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  sequence_id   uuid not null references public.sequences(id) on delete cascade,
  started_at    timestamptz not null default now(),
  last_day_sent integer not null default -1,
  status        text not null default 'active' check (status in ('active', 'done', 'stopped')),
  updated_at    timestamptz not null default now(),
  unique (lead_id, sequence_id)
);

create index if not exists lead_sequence_progress_active_idx
  on public.lead_sequence_progress (status, started_at);

alter table public.lead_sequence_progress enable row level security;

create policy "team can view sequence progress"
  on public.lead_sequence_progress for select to authenticated using (true);
create policy "team can manage sequence progress"
  on public.lead_sequence_progress for all to authenticated using (true) with check (true);;
