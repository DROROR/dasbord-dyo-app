-- ============================================================
-- ROLLBACK for 20260809130000_bot_training_permission_split.sql
--
-- NOT a forward migration — lives in supabase/rollbacks/, not
-- supabase/migrations/, so `supabase db push` never picks it up.
-- Run manually only if that migration needs to be reverted:
--   npx supabase db query --linked --file supabase/rollbacks/20260809130000_bot_training_permission_split_rollback.sql
--
-- Restores bot_config/bot_training RLS to exactly what
-- 20260809120100_has_permission_and_rls.sql left them as (gated on
-- 'agents', the shared key that existed before the split), and
-- restores the profiles.permissions default + handle_new_user() body
-- to what 20260809120000_owner_tier_and_profile_lockdown.sql left
-- them as (no bot_training key).
--
-- Explicitly NOT touched, by design: the 'bot_training' key that the
-- forward migration added to every profile's permissions jsonb. Once
-- this rollback runs, bot_config/bot_training RLS reads 'agents'
-- again, so the leftover 'bot_training' key becomes inert — but it is
-- still real data (whatever the owner may have set it to after the
-- split shipped), and stripping it out would risk silently discarding
-- a deliberate choice with no way to tell "never customized" apart
-- from "customized then rolled back". Same non-destructive principle
-- as the other rollbacks in this directory.
-- ============================================================

-- ── 1. Restore bot_config / bot_training RLS to use 'agents' ────
drop policy if exists "bot_config: view"   on public.bot_config;
drop policy if exists "bot_config: insert" on public.bot_config;
drop policy if exists "bot_config: update" on public.bot_config;
drop policy if exists "bot_config: delete" on public.bot_config;

create policy "bot_config: view" on public.bot_config for select
  using (public.has_permission('agents', 'view'));
create policy "bot_config: insert" on public.bot_config for insert
  with check (public.has_permission('agents', 'full'));
create policy "bot_config: update" on public.bot_config for update
  using (public.has_permission('agents', 'full'))
  with check (public.has_permission('agents', 'full'));
create policy "bot_config: delete" on public.bot_config for delete
  using (public.has_permission('agents', 'full'));

drop policy if exists "bot_training: view"   on public.bot_training;
drop policy if exists "bot_training: insert" on public.bot_training;
drop policy if exists "bot_training: update" on public.bot_training;
drop policy if exists "bot_training: delete" on public.bot_training;

create policy "bot_training: view" on public.bot_training for select
  using (public.has_permission('agents', 'view'));
create policy "bot_training: insert" on public.bot_training for insert
  with check (public.has_permission('agents', 'full'));
create policy "bot_training: update" on public.bot_training for update
  using (public.has_permission('agents', 'full'))
  with check (public.has_permission('agents', 'full'));
create policy "bot_training: delete" on public.bot_training for delete
  using (public.has_permission('agents', 'full'));

-- ── 2. Restore the pre-split default for profiles.permissions ───
alter table public.profiles
  alter column permissions
  set default '{"dashboard":"view","clients":"view","billing":"none","whatsapp":"none","leads":"view","agents":"none","work":"edit","pricing":"none","permissions":"none"}'::jsonb;

-- ── 3. Restore the pre-split handle_new_user() body ──────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role, permissions)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'staff',
    '{"dashboard":"view","clients":"view","billing":"none","whatsapp":"none","leads":"view","agents":"none","work":"edit","pricing":"none","permissions":"none"}'::jsonb
  );
  return new;
end;
$$;

-- ============================================================
-- End of rollback. profiles.permissions row data (including the
-- inert leftover 'bot_training' keys) is untouched by every
-- statement above.
-- ============================================================
