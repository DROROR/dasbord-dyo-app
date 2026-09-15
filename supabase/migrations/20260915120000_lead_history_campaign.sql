-- Append-only activity: preserve legacy notes and never infer calls from notes.
alter table public.leads
  add column if not exists campaign_name text,
  add column if not exists client_name text;

create table if not exists public.lead_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('note', 'completed_call', 'no_answer')),
  body text,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null default 'Unknown',
  check (kind <> 'note' or length(btrim(coalesce(body, ''))) > 0)
);

create index if not exists lead_history_lead_occurred_idx
  on public.lead_history(lead_id, occurred_at, recorded_at, id);

-- Existing free-text notes remain on leads for old integrations; import once.
insert into public.lead_history (lead_id, kind, body, occurred_at, recorded_at, author_name)
select id, 'note', notes, created_at, created_at, 'Legacy note'
from public.leads
where length(btrim(coalesce(notes, ''))) > 0
  and not exists (
    select 1 from public.lead_history h
    where h.lead_id = leads.id and h.kind = 'note'
      and h.body = leads.notes and h.author_name = 'Legacy note'
  );

create or replace function public.stamp_lead_history_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('leads', 'edit') then
    raise exception 'Lead edit permission required';
  end if;
  new.author_id := auth.uid();
  select coalesce(nullif(btrim(name), ''), 'Unknown') into new.author_name
  from public.profiles where id = auth.uid();
  new.author_name := coalesce(new.author_name, 'Unknown');
  new.recorded_at := now();
  if new.kind <> 'completed_call' then new.occurred_at := new.recorded_at; end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_lead_history_author on public.lead_history;
create trigger trg_stamp_lead_history_author before insert on public.lead_history
for each row execute function public.stamp_lead_history_author();

alter table public.lead_history enable row level security;
create policy "lead history: view" on public.lead_history for select to authenticated
  using (public.has_permission('leads', 'view'));
create policy "lead history: insert" on public.lead_history for insert to authenticated
  with check (public.has_permission('leads', 'edit'));
grant select, insert on public.lead_history to authenticated;
