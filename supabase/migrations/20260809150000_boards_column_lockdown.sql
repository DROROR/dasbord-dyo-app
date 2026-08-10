-- ============================================================
-- 004b: Boards column lockdown — Migration B of the two-part rollout
-- started in 20260809140000_docs_and_board_access.sql.
--
-- Deploy this ONLY after the new frontend (the one whose
-- updateBoard() sends exactly {name, statuses, priorities} and never
-- touches boards.access directly — see src/lib/database.ts) is
-- confirmed live. Before that point, the still-deployed old frontend
-- sends a full-row UPDATE (id/name/is_default/access/statuses/
-- priorities/created_at) on every board-settings save, and Postgres
-- rejects an UPDATE outright if any named column in the SET list
-- isn't granted — applying this lockdown early would silently break
-- "save board settings" for every user of the old frontend.
--
-- access is never client-writable directly after this point — only
-- through the update-resource-access Edge Function (service-role,
-- after an explicit can_manage_permissions() check, already deployed
-- alongside Migration A). name/statuses/priorities (ordinary board
-- settings, not the ACL) stay directly writable.
-- ============================================================

revoke update on public.boards from authenticated, anon;
grant update (name, statuses, priorities) on public.boards to authenticated;

-- ============================================================
-- Rollback: see supabase/rollbacks/
-- 20260809150000_boards_column_lockdown_rollback.sql
-- ============================================================
