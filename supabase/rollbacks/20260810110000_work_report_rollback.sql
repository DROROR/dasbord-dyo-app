-- ============================================================
-- Rollback for 20260810110000_work_report.sql
--
-- Non-destructive by design, following this project's established
-- rollback philosophy:
--  - task_status_events rows ARE real, non-reconstructable historical
--    events (exactly like the assignee_id/claimed_by_id backfill in
--    20260810100000) — the table is NOT dropped, only the trigger
--    that populates it going forward.
--  - work_report_access rows reflect deliberate Owner decisions, not
--    disposable derived config — NOT dropped either, so nothing is
--    silently lost if this rollback is later undone by re-applying
--    the migration.
--  - the loggedById backfill on time_entries is preserved for the
--    same reason as the original identity migration's backfill: real,
--    audited work; stripping it back out would only lose information,
--    never gain safety.
-- Running this rollback removes the FEATURE's active surface (the
-- status-transition-logging trigger and all three RPCs/helpers) — no
-- data is deleted.
-- ============================================================

drop trigger if exists trg_log_task_status_event on public.tasks;
drop function if exists public.log_task_status_event();
drop function if exists public.status_label_of(text, text);
drop function if exists public.board_name_of(text);

drop trigger if exists trg_enrich_time_entries_logged_by on public.tasks;
drop function if exists public.enrich_time_entries_logged_by();

drop function if exists public.get_work_report(date);
drop function if exists public.has_work_report_access();

-- work_report_access's table-level anon/authenticated grants (added
-- in the second revision) are intentionally NOT reverted here — they
-- only ever narrow access further than the schema default, so leaving
-- them in place after a rollback is strictly safer, never a loss of
-- function for anything this rollback is trying to restore.

-- work_report_access, task_status_events: tables and their rows are
-- intentionally left in place — see the header note above. If a full
-- teardown is genuinely intended (not just disabling the feature),
-- that is a separate, explicit, manually-run decision:
--
--   drop table public.work_report_access;
--   drop table public.task_status_events;
--
-- Never run automatically as part of this rollback.
