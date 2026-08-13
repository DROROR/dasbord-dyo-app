-- ================================================================
-- 012: Two independent corrections, bundled in one migration because
-- both are small, additive/narrowing-only, and were reviewed together:
--
-- PART A — move_task_to_board(): stale-source protection.
--   The deployed version (20260812090000) row-locks the task and reads
--   its CURRENT board, but never compares that against what the CALLER
--   believed the source board was when they opened the move dialog.
--   Concretely: user opens a task on board A; before they confirm the
--   move, someone else moves it to board B; the first user's stale
--   dialog (still showing "from A") confirms — the RPC would silently
--   execute the move FROM B (the live board), not from the board the
--   user actually saw and reasoned about. Not a security hole (every
--   other check still applies correctly against the live board), but a
--   real correctness/trust gap: the user never sees or approves "this
--   is actually moving from B, not A". Fixed by adding a required
--   expected_source_board argument, checked immediately after the row
--   lock and before anything else (authorization, validation, the
--   UPDATE, or the history INSERT) — a mismatch aborts the whole call
--   with zero side effects, using a distinct SQLSTATE ('40001') the
--   frontend can key off of to show a specific "reload and retry"
--   message rather than a generic failure.
--
-- PART B — work_docs table-grant lockdown.
--   Audited first (outside this file, reported separately): every
--   direct frontend UPDATE payload against work_docs sends only a
--   subset of {title, content, folder_id, updated_at} — never id,
--   access, created_by, created_at, or updated_by. Confirmed via a live
--   read of information_schema that work_docs (unlike every table
--   created THIS session) was never locked down at the table-grant
--   level in its original migration (20260809140000) — anon currently
--   holds table-wide SELECT/INSERT/DELETE/REFERENCES/TRIGGER/TRUNCATE,
--   and authenticated holds the same plus broad INSERT/SELECT on every
--   column. RLS has been the only real gate (anon's auth.uid() is
--   always null, so has_permission()/has_doc_access() already fail
--   closed) — this migration adds the same explicit revoke-then-narrow
--   grant treatment already applied to every other table this session,
--   purely as defense in depth. RLS policies themselves are untouched;
--   access-map writes still go exclusively through the service-role
--   update-resource-access Edge Function.
-- ================================================================


-- ================================================================
-- PART A — move_task_to_board() stale-source protection
-- ================================================================

-- Drop the deployed 5-argument overload so exactly one
-- move_task_to_board signature exists after this migration — a second,
-- differently-shaped overload left in place (CREATE OR REPLACE cannot
-- replace a function whose argument list changed) would otherwise let
-- old cached PostgREST schema/clients keep calling the un-protected
-- version.
drop function if exists public.move_task_to_board(uuid, text, text, text, uuid);

create or replace function public.move_task_to_board(
  task_id_in uuid,
  expected_source_board text,
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

  -- Row-locks the task first — see 20260812090000's own note on this
  -- pattern (mirrors claim_task()). Everything read from v_task below
  -- is guaranteed current as of this transaction.
  select * into v_task from public.tasks where id = task_id_in for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  -- Stale-source protection — the very first thing checked after the
  -- lock, before any authorization, validation, UPDATE, or history
  -- INSERT. If the task's live board no longer matches what the caller
  -- saw when they opened the move dialog, abort immediately: nothing
  -- below this point has run yet, so a mismatch leaves zero trace (no
  -- task_board_moves row, no task_status_events row, no column
  -- touched). errcode '40001' (serialization_failure) is deliberately
  -- distinct from every other error this function raises, so the
  -- frontend can detect this specific case and show a "reload and
  -- retry" message instead of a generic failure.
  if v_task.board is distinct from expected_source_board then
    raise exception 'this task has moved to a different board since it was opened — reload the task and try again'
      using errcode = '40001';
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

revoke execute on function public.move_task_to_board(uuid, text, text, text, text, uuid) from public, anon;
grant  execute on function public.move_task_to_board(uuid, text, text, text, text, uuid) to authenticated;


-- ================================================================
-- PART B — work_docs table-grant lockdown
-- ================================================================
-- Column-level UPDATE was already narrowed to (title, content,
-- updated_at) by 20260809140000, then extended to include folder_id by
-- 20260812080000 — both preserved verbatim below. This only adds the
-- missing TABLE-level revoke/narrow-grant (SELECT/INSERT/DELETE),
-- matching the treatment every table created this session already got.
revoke all on public.work_docs from public, anon, authenticated;
grant select, insert, delete on public.work_docs to authenticated;
grant update (title, content, folder_id, updated_at) on public.work_docs to authenticated;


-- ================================================================
-- Rollback: see supabase/rollbacks/
-- 20260813060000_move_task_stale_source_and_workdocs_lockdown_rollback.sql
-- ================================================================
