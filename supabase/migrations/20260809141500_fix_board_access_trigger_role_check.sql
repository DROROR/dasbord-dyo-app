-- ============================================================
-- 004a-fix: enforce_board_access_rules() checked current_user, which
-- is unreliable inside a SECURITY DEFINER function.
--
-- Root cause, confirmed empirically (not assumed from the SQL text):
-- enforce_board_access_rules() is SECURITY DEFINER, owned by
-- `postgres` (confirmed via pg_proc.prosecdef / proowner). Inside a
-- SECURITY DEFINER function, current_user is temporarily switched to
-- the function's OWNER for the duration of the call — this is
-- documented core Postgres behavior, and was verified live in this
-- project via a throwaway diagnostic function: called via
-- `SET LOCAL ROLE service_role` / `authenticated` / `anon`, a plain
-- SECURITY INVOKER probe correctly reported the caller's role each
-- time, while a SECURITY DEFINER probe reported 'postgres' in EVERY
-- case regardless of the caller. The diagnostic function was dropped
-- immediately after — nothing was left behind.
--
-- Consequence: `current_user <> 'service_role'` inside
-- enforce_board_access_rules() was ALWAYS true (current_user is never
-- anything but 'postgres' in there), for every caller including the
-- update-resource-access Edge Function's service-role client. The
-- intended service_role exemption could never fire. Since the service
-- role's JWT has no 'sub' claim, can_manage_permissions() also
-- resolves to false for it (auth.uid() is null) — so the trigger
-- would have rejected every board-access write the Edge Function
-- ever attempted, once it was deployed. This was caught before
-- deploying the Edge Function specifically to prevent that.
--
-- Fix: read the caller's role from the JWT claims GUC via auth.role()
-- instead — the same STABLE, non-SECURITY-DEFINER, GUC-based
-- mechanism auth.uid() already uses throughout this project (defined
-- as `coalesce(current_setting('request.jwt.claim.role', true),
-- current_setting('request.jwt.claims', true)::jsonb->>'role')` —
-- confirmed via auth.role()'s live definition). GUC reads are not
-- affected by SECURITY DEFINER's current_user substitution, since
-- they are session/transaction-scoped configuration values, not part
-- of the privilege-checking identity that gets swapped. auth.uid()
-- already relies on this identical mechanism everywhere else in this
-- project (has_permission, has_board_access, has_doc_access, etc.)
-- and is proven reliable in production.
--
-- coalesce(auth.role(), '') — not a bare auth.role() <> 'service_role'
-- — deliberately: SQL's NULL <> 'service_role' evaluates to NULL, and
-- `if ... and NULL then` in plpgsql treats that as false and does NOT
-- raise, i.e. a NULL auth.role() would silently ALLOW the change
-- through (fail OPEN). Coalescing to '' first guarantees a definite,
-- always-true comparison in that case, so an unresolvable role fails
-- CLOSED instead — consistent with the fail-closed pattern used
-- throughout this project (see rankOf()/permission_rank() returning
-- NULL, never a permissive default, for unrecognized values).
--
-- This migration only replaces the function body (CREATE OR REPLACE
-- FUNCTION does not touch the existing trigger's binding — Postgres
-- triggers reference the function by a stable identity that survives
-- a body replacement, so trg_enforce_board_access_rules picks up the
-- corrected logic immediately with no DROP/CREATE TRIGGER needed).
-- It performs no data changes and needs no backfill-vs-trigger
-- ordering concern the way Migration A did — CREATE OR REPLACE
-- FUNCTION never fires the trigger it's replacing.
-- ============================================================

create or replace function public.enforce_board_access_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.access is distinct from old.access
     and not public.can_manage_permissions()
     and coalesce(auth.role(), '') <> 'service_role'
  then
    raise exception 'only the owner or an authorized admin may change board access' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ============================================================
-- Rollback: see supabase/rollbacks/
-- 20260809141500_fix_board_access_trigger_role_check_rollback.sql
-- ============================================================
