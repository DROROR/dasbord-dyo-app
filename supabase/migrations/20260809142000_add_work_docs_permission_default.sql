-- ============================================================
-- 004b: Add work_docs to the profiles.permissions default and
-- handle_new_user() — closes a gap found during a post-deploy audit
-- of Migration A: the work_docs module (added to the frontend PAGES
-- registry and the Edge Function MODULES list earlier this session)
-- was never actually added to the database-side default or the
-- new-user trigger, and none of the three existing profiles
-- (including the Owner) have a work_docs key in their permissions at
-- all. Consequence, confirmed live: update-member-permissions v2
-- rejects any request whose permissions payload contains a
-- work_docs key (its deployed MODULES whitelist doesn't recognize
-- it) — the Owner cannot currently grant work_docs access to anyone.
--
-- This migration only touches profiles.permissions defaults/backfill.
-- It does not touch boards, tasks, work_docs documents, or any
-- access map — those are unrelated to this gap.
-- ============================================================

-- 1. Real default for new rows going forward — identical to the
-- existing 10-key default from 20260809130000, with work_docs added
-- (defaults to 'none', fail-closed, same as bot_training's precedent
-- when IT was added).
alter table public.profiles
  alter column permissions
  set default '{"dashboard":"view","clients":"view","billing":"none","whatsapp":"none","leads":"view","agents":"none","bot_training":"none","work":"edit","work_docs":"none","pricing":"none","permissions":"none"}'::jsonb;

-- 2. New-user trigger: identical body to the live function, with the
-- inserted literal gaining "work_docs":"none". Nothing else changed.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role, permissions)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'staff',
    '{"dashboard":"view","clients":"view","billing":"none","whatsapp":"none","leads":"view","agents":"none","bot_training":"none","work":"edit","work_docs":"none","pricing":"none","permissions":"none"}'::jsonb
  );
  return new;
end;
$$;

-- 3/4/5. Backfill: every non-owner profile's permissions gains
-- work_docs:'none' if missing. jsonb `||` with the freshly-built
-- object on the LEFT means any pre-existing work_docs key (there
-- isn't one today, but this stays idempotent/safe if re-run) wins
-- over this backfill — no existing value, for work_docs or any other
-- module, is ever overwritten. `where not is_owner` is required, not
-- optional: enforce_profile_role_rules (20260809120000) rejects ANY
-- change to the owner's permissions column, including a merge-only
-- key addition like this one. The Owner doesn't need this key anyway
-- — is_owner bypasses has_permission()/hasPermission() entirely, so
-- nothing in the Owner's stored permissions is ever consulted.
update public.profiles
   set permissions = jsonb_build_object('work_docs', 'none') || permissions
 where not is_owner;

-- ============================================================
-- Rollback: see supabase/rollbacks/
-- 20260809142000_add_work_docs_permission_default_rollback.sql
-- ============================================================
