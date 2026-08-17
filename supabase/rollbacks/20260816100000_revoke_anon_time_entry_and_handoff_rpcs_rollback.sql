-- Rollback for 20260816100000_revoke_anon_time_entry_and_handoff_rpcs.sql
--
-- Restores only the two grants this migration removed. Does not touch
-- authenticated, postgres, or service_role access, and does not touch
-- any other function.

grant execute on function public.update_task_time_entry(uuid, text, integer, integer, text) to anon;
grant execute on function public.handoff_task_assignment(uuid, uuid) to anon;
