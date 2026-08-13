-- ============================================================
-- Rollback for 20260813060000_move_task_stale_source_and_workdocs_lockdown.sql
--
-- Non-destructive: does not delete any folder, document, task, or
-- history row. Reverts move_task_to_board() to the exact 5-argument
-- signature/body deployed by 20260812090000 (WITHOUT stale-source
-- protection), and reverts public.work_docs's table/column grants to
-- the exact state captured live, immediately before this correction
-- was applied.
--
-- ******************************************************************
-- WARNING: running this rollback re-opens two things the forward
-- migration closed:
--   1. move_task_to_board() loses stale-source detection — a client
--      holding a stale "source board" belief can once again silently
--      move a task from its CURRENT (not the client's last-seen)
--      board without any warning.
--   2. public.work_docs regains its pre-correction broad anon/
--      authenticated/service_role table-level grants (DELETE, INSERT,
--      REFERENCES, SELECT, TRIGGER, TRUNCATE — including for anon).
--      RLS remains the real gate (anon's auth.uid() is always null, so
--      has_permission()/has_doc_access() still fail closed), but this
--      is a genuine reduction in defense-in-depth, re-introducing the
--      exact gap the forward migration's Part B was written to close.
-- Only run this rollback if reverting BOTH corrections is genuinely
-- intended — there is no partial-rollback path in this file.
-- ******************************************************************
-- ============================================================


-- ================================================================
-- PART A — restore the exact 5-argument move_task_to_board()
-- ================================================================

drop function if exists public.move_task_to_board(uuid, text, text, text, text, uuid);

create or replace function public.move_task_to_board(
  task_id_in uuid,
  dest_board_id_in text,
  dest_status_id_in text,
  dest_priority_id_in text,
  dest_assignee_id_in uuid
)
returns public.tasks
language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks%rowtype;
  v_dest_board public.boards%rowtype;
  v_status_exists boolean;
  v_priority_exists boolean;
  v_assignee_name text;
  v_from_status_label text;
  v_to_status_label text;
  v_from_priority_label text;
  v_to_priority_label text;
  v_source_board_name text;
  v_dest_board_name text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'inactive account' using errcode = '42501';
  end if;

  if not public.has_permission('work', 'full') then
    raise exception 'insufficient work permission to move tasks between boards' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = task_id_in for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if not public.has_board_access(v_task.board, 'full') then
    raise exception 'insufficient access to the source board' using errcode = '42501';
  end if;
  if not public.has_board_access(dest_board_id_in, 'full') then
    raise exception 'insufficient access to the destination board' using errcode = '42501';
  end if;

  select * into v_dest_board from public.boards where id = dest_board_id_in;
  if not found then
    raise exception 'destination board does not exist' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from jsonb_array_elements(v_dest_board.statuses) s where s ->> 'id' = dest_status_id_in
  ) into v_status_exists;
  if not v_status_exists then
    raise exception 'destination status does not belong to the destination board' using errcode = '22023';
  end if;

  if dest_priority_id_in is not null then
    select exists (
      select 1 from jsonb_array_elements(coalesce(v_dest_board.priorities, '[]'::jsonb)) p
       where p ->> 'id' = dest_priority_id_in
    ) into v_priority_exists;
    if not v_priority_exists then
      raise exception 'destination priority does not belong to the destination board' using errcode = '22023';
    end if;
  end if;

  if dest_assignee_id_in is not null then
    select name into v_assignee_name from public.profiles
     where id = dest_assignee_id_in and is_owner and is_active;

    if v_assignee_name is null then
      select p.name into v_assignee_name
        from public.profiles p
       where p.id = dest_assignee_id_in
         and p.is_active
         and not p.is_owner
         and board_access_rank(coalesce(v_dest_board.access ->> p.id::text, 'none')) > board_access_rank('none');
    end if;

    if v_assignee_name is null then
      raise exception 'destination assignee is not an active profile with access to the destination board' using errcode = '42501';
    end if;
  end if;

  v_from_status_label   := public.status_label_of(v_task.board, v_task.status);
  v_to_status_label     := public.status_label_of(dest_board_id_in, dest_status_id_in);
  v_from_priority_label := public.priority_label_of(v_task.board, v_task.priority);
  v_to_priority_label   := public.priority_label_of(dest_board_id_in, dest_priority_id_in);
  v_source_board_name   := public.board_name_of(v_task.board);
  v_dest_board_name     := public.board_name_of(dest_board_id_in);

  insert into public.task_board_moves (
    task_id, task_title_snapshot,
    source_board_id, source_board_name_snapshot,
    dest_board_id, dest_board_name_snapshot,
    from_status_id, from_status_label, to_status_id, to_status_label,
    from_priority_id, from_priority_label, to_priority_id, to_priority_label,
    from_assignee_id, from_assignee_name_snapshot, to_assignee_id, to_assignee_name_snapshot,
    moved_by
  ) values (
    v_task.id, v_task.title,
    v_task.board, v_source_board_name,
    dest_board_id_in, v_dest_board_name,
    v_task.status, v_from_status_label, dest_status_id_in, v_to_status_label,
    v_task.priority, v_from_priority_label, dest_priority_id_in, v_to_priority_label,
    v_task.assignee_id, v_task.assignee, dest_assignee_id_in, v_assignee_name,
    auth.uid()
  );

  update public.tasks
     set board = dest_board_id_in,
         status = dest_status_id_in,
         priority = dest_priority_id_in,
         assignee_id = dest_assignee_id_in,
         assignee = v_assignee_name
   where id = task_id_in
  returning * into v_task;

  return v_task;
end;
$$;

revoke execute on function public.move_task_to_board(uuid, text, text, text, uuid) from public, anon;
grant  execute on function public.move_task_to_board(uuid, text, text, text, uuid) to authenticated;


-- ================================================================
-- PART B — restore work_docs's exact pre-correction grants
-- (captured live via information_schema immediately before this
-- correction was written — see the checkpoint report for the full
-- captured matrix). See the WARNING at the top of this file.
-- ================================================================
revoke all on public.work_docs from public, anon, authenticated, service_role;

grant delete, insert, references, select, trigger, truncate
  on public.work_docs to anon, authenticated, service_role;

grant update (content, folder_id, title, updated_at)
  on public.work_docs to authenticated;

grant update (access, content, created_at, created_by, folder_id, id, title, updated_at, updated_by)
  on public.work_docs to service_role;
