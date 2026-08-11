-- ============================================================
-- Rollback for 20260811060000_task_assignee_validation.sql
--
-- Non-destructive: drops only the new trigger and function this
-- migration created. No data is deleted or rewritten — existing
-- tasks.assignee_id values (valid or not) are left exactly as they
-- are; this only removes the validation that runs on future writes.
-- ============================================================

drop trigger if exists trg_validate_task_assignee on public.tasks;
drop function if exists public.validate_task_assignee();
