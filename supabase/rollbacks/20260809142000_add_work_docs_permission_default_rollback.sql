-- ============================================================
-- Rollback for 20260809142000_add_work_docs_permission_default.sql
--
-- Restores the column default and handle_new_user() body to their
-- exact state immediately before this migration (both captured live
-- from production, matching what 20260809130000 left them as).
-- Deliberately does NOT strip work_docs from any profile's
-- permissions — the backfilled key is additive/corrective data, the
-- same non-destructive stance already applied to every other
-- permissions backfill in this project (e.g. the bot_training split's
-- own rollback). Rolling back only turns off the *default* for new
-- rows and the new-user literal; existing rows keep whatever they
-- have.
-- ============================================================

alter table public.profiles
  alter column permissions
  set default '{"dashboard":"view","clients":"view","billing":"none","whatsapp":"none","leads":"view","agents":"none","bot_training":"none","work":"edit","pricing":"none","permissions":"none"}'::jsonb;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role, permissions)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'staff',
    '{"dashboard":"view","clients":"view","billing":"none","whatsapp":"none","leads":"view","agents":"none","bot_training":"none","work":"edit","pricing":"none","permissions":"none"}'::jsonb
  );
  return new;
end;
$$;
