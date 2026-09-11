-- Details required by manual entry and the upcoming Google Sheets sync.
-- Existing columns and integrations remain intact.
alter table public.leads
  add column if not exists email text,
  add column if not exists form_answer text,
  add column if not exists notes text,
  add column if not exists due_at timestamptz,
  add column if not exists status_updated_at timestamptz not null default now(),
  add column if not exists sheet_row_key text;

update public.leads
set notes = follow_up_note
where notes is null and follow_up_note is not null;

create unique index if not exists leads_sheet_row_key_unique_idx
  on public.leads(sheet_row_key) where sheet_row_key is not null;
create index if not exists leads_due_at_idx
  on public.leads(due_at) where due_at is not null;

create or replace function public.track_lead_status_update()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status is distinct from old.status
     or new.pipeline_status_id is distinct from old.pipeline_status_id then
    new.status_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_track_lead_status_update on public.leads;
create trigger trg_track_lead_status_update
before update of status, pipeline_status_id on public.leads
for each row execute function public.track_lead_status_update();
