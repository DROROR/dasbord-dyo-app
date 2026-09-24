-- Meditations library: Google Meet session recordings, stored as links
-- (Meet saves its recording to Drive automatically) so the whole team can
-- watch any session at any time.
--
-- Deliberately NOT gated by a permission module: the page entry in
-- src/lib/permissions.ts uses module: null, exactly like platform_content,
-- so every active authenticated member may both view and manage the
-- library. caller_is_active() (20260810101000) is therefore the only check
-- each policy needs. If this ever has to be restricted, give it a real
-- 'meditations' module in the registry and swap the four policies below to
-- has_permission('meditations', ...) plus a one-time backfill.

create table if not exists public.meditations (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  url         text not null,          -- Google Drive / YouTube link
  category    text,                   -- optional grouping for the filter bar
  recorded_at timestamptz,            -- when the session happened (date + time)
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Matches the list's own ordering (newest recording first, undated last).
create index if not exists meditations_recorded_at_idx
  on public.meditations (recorded_at desc nulls last, created_at desc);

-- created_by is stamped server-side and immutable afterwards, so it stays a
-- truthful record of who added an entry even though anyone may edit it.
-- Same convention as stamp_task_creator (20260810101000).
create or replace function public.stamp_meditation_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_meditation_creator on public.meditations;
create trigger trg_stamp_meditation_creator
  before insert or update on public.meditations
  for each row execute function public.stamp_meditation_creator();

alter table public.meditations enable row level security;

drop policy if exists "meditations: view"   on public.meditations;
drop policy if exists "meditations: insert" on public.meditations;
drop policy if exists "meditations: update" on public.meditations;
drop policy if exists "meditations: delete" on public.meditations;

create policy "meditations: view" on public.meditations for select
  using (public.caller_is_active());

create policy "meditations: insert" on public.meditations for insert
  with check (public.caller_is_active());

create policy "meditations: update" on public.meditations for update
  using (public.caller_is_active())
  with check (public.caller_is_active());

create policy "meditations: delete" on public.meditations for delete
  using (public.caller_is_active());

revoke all on public.meditations from anon;
grant select, insert, update, delete on public.meditations to authenticated;
