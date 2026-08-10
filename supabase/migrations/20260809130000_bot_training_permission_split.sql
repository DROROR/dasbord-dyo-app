-- ============================================================
-- 003: Split 'bot_training' out of the 'agents' permission module
--
-- The frontend's page/permission registry (src/lib/permissions.ts,
-- PAGES) used to map both the "Agents" page and the "Bot Training"
-- page onto the same module key ('agents') — an original shortcut
-- (Decision C in the first permissions audit) that meant granting
-- someone Agents access silently also gave them Bot Training access
-- and vice versa, with no way to separate the two. They are genuinely
-- separate pages backed by separate tables (agent_logs vs.
-- bot_config/bot_training) and now get separate permission keys.
--
-- Reminder for whoever adds the NEXT page: adding a row to the PAGES
-- registry only wires up frontend gating (nav, route guard, the
-- Permissions grid, default grants for new users). It does NOT, by
-- itself, protect any database table the new page owns — that always
-- needs its own explicit RLS migration, exactly like this one, adding
-- policies keyed on has_permission('<new_module>', ...) for that
-- page's table(s). Nothing in the frontend registry can do this for
-- you; forgetting it leaves the table exactly as open as it was
-- before any permission existed for it.
-- ============================================================

-- ── 1. Preserve existing access across the split ───────────────
-- Every non-owner profile's NEW bot_training permission starts as a
-- copy of whatever their 'agents' permission already was — nobody's
-- effective Bot Training access changes the moment this migration
-- lands; the owner can now split them apart going forward via the
-- Permissions page. jsonb `||` with the freshly-built object on the
-- LEFT means any pre-existing 'bot_training' key (e.g. if this
-- migration were ever re-run) wins over this backfill — idempotent,
-- never clobbers a deliberate later choice with the original
-- copied-from-agents value.
--
-- `where not is_owner` is required, not optional: the owner-protection
-- trigger (enforce_profile_role_rules, migration
-- 20260809120000_owner_tier_and_profile_lockdown.sql) rejects ANY
-- change to the owner's `permissions` column, including a merge-only
-- key addition like this one — by design, that trigger has no
-- carve-out for "harmless" changes. Excluding the owner here is also
-- simply correct on its own terms: is_owner bypasses
-- has_permission()/can_manage_permissions() entirely, so what's
-- stored in the owner's `permissions` is never consulted regardless.
update public.profiles
   set permissions = jsonb_build_object('bot_training', coalesce(permissions ->> 'agents', 'none')) || permissions
 where not is_owner;

-- ── 2. Real default for profiles.permissions now includes bot_training ──
alter table public.profiles
  alter column permissions
  set default '{"dashboard":"view","clients":"view","billing":"none","whatsapp":"none","leads":"view","agents":"none","bot_training":"none","work":"edit","pricing":"none","permissions":"none"}'::jsonb;

-- ── 3. New-user trigger: explicit grant, including bot_training ──
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

-- ── 4. Move bot_config / bot_training RLS onto the new module key ──
-- has_permission() itself is module-agnostic (it just reads
-- permissions ->> module) — no SQL function changes needed, only
-- which module string each policy passes in.
drop policy if exists "bot_config: view"   on public.bot_config;
drop policy if exists "bot_config: insert" on public.bot_config;
drop policy if exists "bot_config: update" on public.bot_config;
drop policy if exists "bot_config: delete" on public.bot_config;

create policy "bot_config: view" on public.bot_config for select
  using (public.has_permission('bot_training', 'view'));
create policy "bot_config: insert" on public.bot_config for insert
  with check (public.has_permission('bot_training', 'full'));
create policy "bot_config: update" on public.bot_config for update
  using (public.has_permission('bot_training', 'full'))
  with check (public.has_permission('bot_training', 'full'));
create policy "bot_config: delete" on public.bot_config for delete
  using (public.has_permission('bot_training', 'full'));

drop policy if exists "bot_training: view"   on public.bot_training;
drop policy if exists "bot_training: insert" on public.bot_training;
drop policy if exists "bot_training: update" on public.bot_training;
drop policy if exists "bot_training: delete" on public.bot_training;

create policy "bot_training: view" on public.bot_training for select
  using (public.has_permission('bot_training', 'view'));
create policy "bot_training: insert" on public.bot_training for insert
  with check (public.has_permission('bot_training', 'full'));
create policy "bot_training: update" on public.bot_training for update
  using (public.has_permission('bot_training', 'full'))
  with check (public.has_permission('bot_training', 'full'));
create policy "bot_training: delete" on public.bot_training for delete
  using (public.has_permission('bot_training', 'full'));

-- agent_logs (the actual "Agents" page's table) is untouched — it
-- keeps using has_permission('agents', ...) exactly as migration
-- 20260809120100 left it.

-- ============================================================
-- Rollback: see supabase/rollbacks/
-- 20260809130000_bot_training_permission_split_rollback.sql
-- ============================================================
