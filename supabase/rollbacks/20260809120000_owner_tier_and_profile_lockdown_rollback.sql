-- ============================================================
-- ROLLBACK for 20260809120000_owner_tier_and_profile_lockdown.sql
--
-- NOT a forward migration — lives in supabase/rollbacks/, not
-- supabase/migrations/, so `supabase db push` never picks it up.
-- Run manually only if that migration needs to be reverted:
--   npx supabase db query --linked --file supabase/rollbacks/20260809120000_owner_tier_and_profile_lockdown_rollback.sql
--
-- Precondition: run this BEFORE (or instead of) ever deploying
-- 20260809120100_has_permission_and_rls.sql, or after that migration
-- has itself already been rolled back via its own rollback file
-- (20260809120100_has_permission_and_rls_rollback.sql). That later
-- migration's RLS policies call has_permission(), which this script
-- drops — if those policies still exist, the DROP FUNCTION statements
-- below will fail loudly with a dependency error (deliberately not
-- using CASCADE, so this fails safe instead of silently breaking
-- live policies).
--
-- Scope note on "previous profile RLS policies": the original
-- migration (20260809120000) never created, dropped, or altered any
-- RLS POLICY on profiles — it only changed column grants, columns,
-- defaults, functions and a trigger. The profiles SELECT policy swap
-- happened in 20260809120100 and is reverted by THAT migration's own
-- rollback file, not this one. Nothing to do here for policies.
--
-- Explicitly NOT touched by this script, by design:
--   - profiles.permissions data (any row's stored grant, whether from
--     the original migration's merge-only backfill or any edit made
--     since) — reverting it would mean guessing at or destroying
--     values we have no reliable snapshot of. Left exactly as-is.
--   - profiles.name / profiles.email / any other row content.
--   - profiles.is_technical_support — this column predates the
--     original migration (added by 20260803141327, already applied
--     before ours ran); the original migration's own `add column if
--     not exists` was a no-op against live data, so there is nothing
--     of ours to remove here. Dropping it would destroy real,
--     unrelated data outside this migration's scope.
--
-- SECURITY WARNING: step 3 below restores the original, broad UPDATE
-- grant on profiles to authenticated/anon (full column access). That
-- is the exact pre-migration state — but it also reopens the
-- self-privilege-escalation gap the original migration existed to
-- close (any authenticated user can UPDATE their own role/permissions
-- again, since the RLS row-check alone never restricted columns).
-- This is an intentional, faithful rollback, not a bug — do not run
-- it in production without accepting that trade-off.
-- ============================================================

-- ── 1. Drop the owner-immutability trigger + function ─────────
drop trigger if exists trg_enforce_profile_role_rules on public.profiles;
drop function if exists public.enforce_profile_role_rules();

-- ── 2. Drop the new permission functions ───────────────────────
-- No CASCADE: if 20260809120100's RLS policies still reference
-- has_permission(), this errors out here rather than silently
-- dropping live policies. Roll back that migration first in that case.
drop function if exists public.can_manage_permissions();
drop function if exists public.has_permission(text, text);
drop function if exists public.permission_rank(text);

-- ── 3. Restore original column-level UPDATE grants ─────────────
-- Original state (confirmed via live information_schema.column_privileges
-- during the Step 0 audit, before the original migration ran): both
-- authenticated and anon held full, table-level UPDATE on profiles
-- (Supabase's default schema-wide grant — RLS, not column grants, was
-- the only gate). The original migration's `revoke update ... grant
-- update (name)` narrowed this; this restores the original breadth.
grant update on public.profiles to authenticated, anon;

-- ── 4. Restore the original default for profiles.permissions ───
-- Original live default (Step 0 audit, information_schema.columns):
alter table public.profiles
  alter column permissions
  set default '{}'::jsonb;

-- ── 5. Restore the original handle_new_user() trigger body ─────
-- Exact original definition, captured verbatim via
-- pg_get_functiondef() during the Step 0 audit.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role, permissions)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'staff',
    '{}'::jsonb
  );
  return new;
end;
$$;

-- ── 6. Drop the is_owner constraint, index, then column ─────────
-- Explicit order (constraint/index before column) rather than relying
-- on implicit cascade from DROP COLUMN, so each step is visible and
-- individually verifiable.
alter table public.profiles
  drop constraint if exists profiles_owner_is_admin;

drop index if exists public.profiles_single_owner;

alter table public.profiles
  drop column if exists is_owner;

-- ============================================================
-- End of rollback. profiles.permissions, profiles.name,
-- profiles.email, profiles.role, profiles.is_technical_support and
-- profiles.created_at are untouched by every statement above — no
-- row data was read, computed from, or written to in this script.
-- ============================================================
