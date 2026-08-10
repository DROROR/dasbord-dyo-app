-- ============================================================
-- Rollback for 20260809150000_boards_column_lockdown.sql (Migration B)
--
-- Restores the exact pre-lockdown grant, captured live from production
-- via information_schema.table_privileges before Migration B was
-- written: full-table UPDATE to both authenticated and anon (RLS was
-- always the real gate on boards, not column privileges, until
-- Migration B). Non-destructive — grants only, no data touched.
-- ============================================================

grant update on public.boards to authenticated, anon;
