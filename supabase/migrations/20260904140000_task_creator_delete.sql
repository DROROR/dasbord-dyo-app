-- Immutable task creator identity and creator-scoped deletion.
-- Owner retains global deletion; every non-owner may delete only their own
-- task while they still hold Work edit permission.

alter table public.tasks
  add column if not exists created_by_id uuid references public.profiles(id) on delete set null;

-- Legacy task creation stored the creator name in the first status-history
-- entry. Backfill only when that name maps to exactly one profile; ambiguous
-- or missing identities remain null and therefore cannot grant delete access.
with creator_names as (
  select
    t.id,
    coalesce(nullif(btrim(t.created_by), ''), t.status_history -> 0 ->> 'changedBy') as creator_name
  from public.tasks t
  where t.created_by_id is null
),
unique_profile_names as (
  select name, min(id::text)::uuid as profile_id
  from public.profiles
  where nullif(btrim(name), '') is not null
  group by name
  having count(*) = 1
)
update public.tasks t
   set created_by_id = u.profile_id,
       created_by = coalesce(nullif(btrim(t.created_by), ''), u.name)
  from creator_names c
  join unique_profile_names u on u.name = c.creator_name
 where t.id = c.id
   and t.created_by_id is null;

create or replace function public.stamp_task_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if tg_op = 'UPDATE' then
    new.created_by_id := old.created_by_id;
    new.created_by := old.created_by;
    return new;
  end if;

  if auth.uid() is not null then
    select p.name into v_name
      from public.profiles p
     where p.id = auth.uid()
       and p.is_active;
    if v_name is null then
      raise exception 'active profile required to create a task' using errcode = '42501';
    end if;
    new.created_by_id := auth.uid();
    new.created_by := v_name;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_task_creator on public.tasks;
create trigger trg_stamp_task_creator
  before insert or update on public.tasks
  for each row execute function public.stamp_task_creator();

drop policy if exists "tasks: delete" on public.tasks;
create policy "tasks: delete" on public.tasks for delete
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner and p.is_active)
    or (created_by_id = auth.uid() and public.has_permission('work', 'edit'))
  );
