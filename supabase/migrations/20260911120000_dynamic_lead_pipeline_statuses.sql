-- Dynamic, shared Lead pipeline statuses. The legacy lead_status enum remains
-- intact for integrations; pipeline_status_id is the UI's extensible status.
create table if not exists public.lead_pipeline_statuses (
  id uuid primary key default gen_random_uuid(),
  legacy_status public.lead_status unique,
  label_he text not null check (length(btrim(label_he)) between 1 and 80),
  label_en text not null check (length(btrim(label_en)) between 1 and 80),
  color text not null default 'blue' check (color in ('blue','green','violet','amber','rose','cyan','orange','slate')),
  position integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

insert into public.lead_pipeline_statuses (legacy_status, label_he, label_en, color, position, is_archived)
values
  ('new',        'ליד חדש',          'New lead',                'blue',   10, false),
  ('meeting',    'נקבעה שיחה',       'Meeting scheduled',       'green',  20, false),
  ('producing',  'מעוניין — בהפקה',  'Interested — production', 'violet', 30, false),
  ('followup',   'לחזור אליו',        'Follow up',               'amber',  40, false),
  ('irrelevant', 'לא רלוונטי',        'Not relevant',            'slate',  50, true)
on conflict (legacy_status) do update set
  label_he = excluded.label_he,
  label_en = excluded.label_en,
  color = excluded.color,
  position = excluded.position,
  is_archived = excluded.is_archived;

alter table public.leads
  add column if not exists pipeline_status_id uuid references public.lead_pipeline_statuses(id) on delete restrict;

update public.leads l
set pipeline_status_id = s.id
from public.lead_pipeline_statuses s
where s.legacy_status = l.status
  and l.pipeline_status_id is null;

create index if not exists leads_pipeline_status_id_idx on public.leads(pipeline_status_id);
create index if not exists lead_pipeline_statuses_position_idx on public.lead_pipeline_statuses(position);

create or replace function public.sync_lead_pipeline_status()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.pipeline_status_id is null or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    select id into new.pipeline_status_id
    from public.lead_pipeline_statuses
    where legacy_status = new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_lead_pipeline_status on public.leads;
create trigger trg_sync_lead_pipeline_status
before insert or update of status on public.leads
for each row execute function public.sync_lead_pipeline_status();

alter table public.lead_pipeline_statuses enable row level security;

create policy "lead statuses: view" on public.lead_pipeline_statuses for select
  using (public.has_permission('leads', 'view'));
create policy "lead statuses: insert" on public.lead_pipeline_statuses for insert
  with check (public.has_permission('leads', 'edit'));
create policy "lead statuses: update" on public.lead_pipeline_statuses for update
  using (public.has_permission('leads', 'edit'))
  with check (public.has_permission('leads', 'edit'));
create policy "lead statuses: delete" on public.lead_pipeline_statuses for delete
  using (public.has_permission('leads', 'full') and legacy_status is null);

grant select on public.lead_pipeline_statuses to authenticated;
grant insert, update on public.lead_pipeline_statuses to authenticated;
grant delete on public.lead_pipeline_statuses to authenticated;
