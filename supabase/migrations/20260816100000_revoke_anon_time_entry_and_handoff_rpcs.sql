-- ================================================================
-- Targeted hardening: anon should never have hold EXECUTE on the two
-- Checkpoint-A RPCs. Both already reject an unauthenticated caller at
-- their first line (auth.uid() is null), so this closes a
-- defense-in-depth gap rather than a live hole — but it should still
-- be closed explicitly rather than left relying on that internal
-- check alone.
--
-- Root cause (confirmed by inspection, not guessed): revoke ... from
-- public only strips the implicit PUBLIC pseudo-role grant. It does
-- NOT touch this Supabase project's separate default-privilege grant
-- of EXECUTE to anon/authenticated/service_role applied automatically
-- at function-creation time — which is why anon still showed up in
-- information_schema.role_routine_grants after the prior migration's
-- "revoke ... from public; grant ... to authenticated" pair. The same
-- gap pre-dates this migration on add_task_time_entry and claim_task,
-- but per the current checkpoint's scope this migration touches only
-- the two functions named below, not a broader audit.
--
-- Prepared for review only. Do not deploy without explicit approval.
-- ================================================================

revoke execute on function public.update_task_time_entry(uuid, text, integer, integer, text) from anon;
revoke execute on function public.handoff_task_assignment(uuid, uuid) from anon;

-- authenticated keeps EXECUTE (untouched, already correct).
-- postgres (owner) and service_role are unaffected by this migration:
-- neither statement above names them, and service_role's access to
-- SECURITY DEFINER functions in this project is never granted through
-- these per-object EXECUTE grants in the first place — it bypasses
-- RLS and object-level grants entirely as the Supabase backend role,
-- exactly as it does for every other RPC in this schema.

-- ================================================================
-- Rollback: see supabase/rollbacks/
-- 20260816100000_revoke_anon_time_entry_and_handoff_rpcs_rollback.sql
-- ================================================================
