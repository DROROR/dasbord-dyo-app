-- Rollback for 20260813140000_subtasks_and_personal_notifications.sql

drop trigger if exists trg_notify_status_owner on public.tasks;
drop trigger if exists trg_notify_subtask_assignment on public.task_subtasks;
drop trigger if exists trg_notify_task_assignment on public.tasks;
drop function if exists public.notify_status_owner();
drop function if exists public.notify_subtask_assignment();
drop function if exists public.notify_task_assignment();
drop function if exists public.add_task_time_entry(uuid, text, date, integer, integer, text, boolean, uuid);
drop function if exists public.delete_task_subtask(uuid);
drop function if exists public.update_task_subtask(uuid, text, text, text, uuid);
drop function if exists public.create_task_subtask(uuid, text, text, uuid);

drop policy if exists "task_subtasks: view" on public.task_subtasks;

-- Restore the pre-collaboration task visibility policy.
drop policy if exists "tasks: view" on public.tasks;
create policy "tasks: view" on public.tasks for select
  using (
    has_permission('work', 'view') and (
      has_board_access(board, 'view')
      or status_owner_of(board, status) = auth.uid()
      or (
        is_technical_support_staff()
        and not claimed
        and status not in ('done', 'archived')
        and task_eligible_for_support_queue(id)
      )
    )
  );

drop function if exists public.is_task_collaborator(uuid);
drop table if exists public.task_subtasks;

drop policy if exists "notifications_select_authenticated" on public.notifications;
create policy "notifications_select_authenticated"
  on public.notifications for select to authenticated using (true);
drop policy if exists "notifications_update_authenticated" on public.notifications;
create policy "notifications_update_authenticated"
  on public.notifications for update to authenticated using (true) with check (true);
drop policy if exists "notifications_delete_authenticated" on public.notifications;
create policy "notifications_delete_authenticated"
  on public.notifications for delete to authenticated using (true);

drop index if exists public.notifications_recipient_id_idx;
alter table public.notifications
  drop column if exists subtask_id,
  drop column if exists recipient_id;
