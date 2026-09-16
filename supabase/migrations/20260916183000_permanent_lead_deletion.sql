-- Keep Google Sheet leads deleted from Planner from being re-imported.
create table if not exists public.lead_sync_exclusions (
  sheet_row_key text primary key,
  excluded_at timestamptz not null default now(),
  excluded_by uuid references public.profiles(id) on delete set null
);

alter table public.lead_sync_exclusions enable row level security;
revoke all on public.lead_sync_exclusions from anon, authenticated;
grant select on public.lead_sync_exclusions to service_role;

create or replace function public.delete_lead_permanently(lead_id_in uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sync_key text;
begin
  if auth.uid() is null or not public.has_permission('leads', 'full') then
    raise exception 'Full Leads permission required';
  end if;

  select sheet_row_key into sync_key
  from public.leads
  where id = lead_id_in
  for update;

  if not found then
    return;
  end if;

  if sync_key is not null then
    insert into public.lead_sync_exclusions (sheet_row_key, excluded_by)
    values (sync_key, auth.uid())
    on conflict (sheet_row_key) do update
      set excluded_at = now(), excluded_by = excluded.excluded_by;
  end if;

  delete from public.leads where id = lead_id_in;
end;
$$;

revoke all on function public.delete_lead_permanently(uuid) from public, anon;
grant execute on function public.delete_lead_permanently(uuid) to authenticated;
