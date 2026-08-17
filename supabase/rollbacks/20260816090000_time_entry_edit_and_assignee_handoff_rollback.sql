-- Rollback for 20260816090000_time_entry_edit_and_assignee_handoff.sql
--
-- Both functions are net-new (no prior version existed to restore),
-- and neither created a table, column, trigger, or policy — dropping
-- them fully reverses this migration with no data loss.

drop function if exists public.handoff_task_assignment(uuid, uuid);
drop function if exists public.update_task_time_entry(uuid, text, integer, integer, text);
