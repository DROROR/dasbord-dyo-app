-- ============================================================
-- Rollback for 20260811050000_work_report_privilege_lockdown.sql
--
-- *** WARNING — DO NOT RUN THIS CASUALLY ***
-- This rollback does not just "undo a feature" — it RE-OPENS the
-- exact broad, unintended privileges the forward migration exists to
-- close: it restores ALL table privileges (SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) to anon AND
-- authenticated on task_status_events, and ALL table privileges to
-- authenticated on work_report_access. This is a genuine security
-- regression, not a neutral rollback. It exists only for exact
-- symmetry with this project's established rollback convention (every
-- migration gets a matching rollback) and for emergency use if the
-- lockdown is ever found to have broken something unexpectedly. Do
-- not run this to "clean up" or as a routine reversal.
--
-- Restores exactly the live pre-correction state captured via
-- aclexplode(relacl) immediately before writing the forward
-- migration — nothing more, nothing less:
--   task_status_events : anon=ALL(8), authenticated=ALL(8)
--   work_report_access : authenticated=ALL(8)  (anon had none before
--                         either, and still has none after this
--                         rollback — nothing to restore there)
-- RLS itself, and the three Owner-only policies on work_report_access,
-- were never touched by the forward migration and are not touched
-- here either — this file only concerns the table-grant layer.
-- No row of data in either table is read, written, or deleted by
-- this rollback.
-- ============================================================

grant all on public.task_status_events to anon, authenticated;

grant all on public.work_report_access to authenticated;
-- anon is intentionally NOT re-granted anything on work_report_access
-- — it held zero privileges before the forward migration too, so
-- there is nothing to restore for that role on this table.
