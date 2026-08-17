-- ================================================================
-- Checkpoint A: secure per-entry time-entry editing, plus a narrowly
-- scoped RPC letting a task's current main assignee remove themselves
-- or hand the task directly to another eligible active user.
--
-- Prepared for review only. Do not deploy without explicit approval.
-- ================================================================

-- ----------------------------------------------------------------
-- update_task_time_entry: employee-safe edit of hours/minutes/note.
--
-- Mirrors add_task_time_entry's own conventions exactly (row-locked
-- task, search_path pinned, revoked-then-granted execute). An
-- employee may only touch a time entry whose loggedById is their own
-- auth.uid() — never by matching the loggedBy display name, so a
-- legacy entry with no loggedById can only be fixed by a full board
-- editor, never "claimed" by name collision. Full board editors keep
-- their existing unrestricted access. Only hours/minutes/note are
-- ever written; id/date/loggedBy/loggedById/isLocked/subtaskId/
-- createdAt are carried over unchanged for every entry in the array,
-- including every entry that is NOT the one being edited.
--
-- No delete counterpart is defined here by design — delete stays on
-- the existing full-board-only "tasks: update" RLS path, so an
-- employee editing their own entry never gains the ability to remove
-- it.
create or replace function public.update_task_time_entry(
  task_id_in uuid,
  entry_id_in text,
  hours_in integer,
  minutes_in integer,
  note_in text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_entry jsonb;
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'inactive account' using errcode = '42501';
  end if;

  if not has_permission('work', 'edit') then
    raise exception 'insufficient work permission' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = task_id_in for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  select e into v_entry
    from jsonb_array_elements(coalesce(v_task.time_entries, '[]'::jsonb)) e
   where e->>'id' = entry_id_in;
  if v_entry is null then
    raise exception 'time entry not found' using errcode = 'P0002';
  end if;

  if not (
    has_board_access(v_task.board, 'full')
    or v_entry->>'loggedById' = auth.uid()::text
  ) then
    raise exception 'you may only edit a time entry you logged yourself' using errcode = '42501';
  end if;

  if hours_in < 0 or minutes_in < 0 or minutes_in > 59 or (hours_in = 0 and minutes_in = 0) then
    raise exception 'invalid time duration' using errcode = '22023';
  end if;

  v_note := nullif(btrim(note_in), '');

  -- Rebuilt from the live, row-locked column (not the earlier v_task
  -- snapshot) in the same statement — the same idiom
  -- enrich_time_entries_logged_by() and the priority-dedup migration
  -- use to patch one jsonb array element without disturbing the rest,
  -- so a concurrent, unrelated entry added by someone else between
  -- the SELECT ... FOR UPDATE above and this UPDATE can never be lost.
  update public.tasks
     set time_entries = (
       select jsonb_agg(
         case
           when e->>'id' = entry_id_in then
             (e - 'note')
               || jsonb_build_object('hours', hours_in, 'minutes', minutes_in)
               || case when v_note is not null then jsonb_build_object('note', v_note) else '{}'::jsonb end
           else e
         end
         order by ord
       )
       from jsonb_array_elements(coalesce(time_entries, '[]'::jsonb)) with ordinality as arr(e, ord)
     ),
     updated_at = now()
   where id = task_id_in
   returning time_entries into v_task.time_entries;

  return v_task.time_entries;
end;
$$;

revoke execute on function public.update_task_time_entry(uuid, text, integer, integer, text) from public;
grant execute on function public.update_task_time_entry(uuid, text, integer, integer, text) to authenticated;


-- ----------------------------------------------------------------
-- handoff_task_assignment: the current main assignee may remove
-- themselves (new_assignee_id_in = null) or transfer the task
-- directly to another eligible active user — nothing else.
--
-- Caller must literally BE tasks.assignee_id right now; this does not
-- broaden Owner/Admin/full-board-access assignment, which continues
-- to go through the ordinary "tasks: update" RLS path unchanged.
--
-- Only assignee_id and (for a self-unassign only) assignee are ever
-- written — see the note above the UPDATE below for exactly why
-- assignee needs an explicit null there. The existing
-- trg_validate_task_assignee trigger independently re-validates the
-- destination (defense in depth — this function's own eligibility
-- check mirrors it exactly) and, for a TRANSFER, unconditionally
-- re-syncs the authoritative display name from the resolved profile
-- regardless of what this statement sends — confirmed by inspection,
-- not duplicated here. The existing trg_notify_task_assignment
-- trigger raises the normal personal "assigned you" notification for
-- a transfer and, because it already bails out whenever
-- new.assignee_id is null, raises no notification at all for a
-- self-unassign. Neither trigger is modified by this migration.
create or replace function public.handoff_task_assignment(
  task_id_in uuid,
  new_assignee_id_in uuid default null
)
returns public.tasks
language plpgsql security definer set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'inactive account' using errcode = '42501';
  end if;

  if not has_permission('work', 'edit') then
    raise exception 'insufficient work permission' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = task_id_in for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if v_task.assignee_id is null or v_task.assignee_id <> auth.uid() then
    raise exception 'only the current main assignee may hand off this task' using errcode = '42501';
  end if;

  if new_assignee_id_in is not null then
    -- Eligibility mirrors validate_task_assignee()'s own rule exactly:
    -- active Owner unconditional, otherwise an active, non-owner
    -- profile with explicit access above 'none' on this task's
    -- CURRENT board. Never bypassed by board-full or work:'full' —
    -- a replacement with no real access to the board would just be
    -- handed a task they cannot see.
    select name into v_name from public.profiles
     where id = new_assignee_id_in and is_owner and is_active;

    if v_name is null then
      select p.name into v_name
        from public.profiles p
        join public.boards b on b.id = v_task.board
       where p.id = new_assignee_id_in
         and p.is_active
         and not p.is_owner
         and board_access_rank(coalesce(b.access ->> p.id::text, 'none')) > board_access_rank('none');
    end if;

    if v_name is null then
      raise exception 'replacement assignee is not an active profile with access to this task''s board' using errcode = '42501';
    end if;
  end if;

  -- trg_validate_task_assignee only nulls the legacy display name when
  -- it finds new.assignee ALREADY empty at trigger time (that guard
  -- exists to protect genuine old-frontend free-text names — see its
  -- own header comment); it never blanks a non-empty one itself. Left
  -- alone, this statement would leave the PREVIOUS assignee's stale
  -- name paired with a null assignee_id. So the self-unassign branch
  -- clears it here, explicitly and atomically, in the same statement —
  -- matching the same convention the general assignee dropdown already
  -- uses (assignee:'' alongside assigneeId:'' in the one save() call).
  -- A transfer leaves this expression as a same-value no-op: the
  -- trigger's own eligibility branches unconditionally overwrite
  -- new.assignee from the resolved target profile's current name
  -- regardless of what is sent here, so nothing needs to be computed
  -- for that case.
  update public.tasks
     set assignee_id = new_assignee_id_in,
         assignee = case when new_assignee_id_in is null then null else assignee end,
         updated_at = now()
   where id = task_id_in
   returning * into v_task;

  return v_task;
end;
$$;

revoke execute on function public.handoff_task_assignment(uuid, uuid) from public;
grant execute on function public.handoff_task_assignment(uuid, uuid) to authenticated;

-- ================================================================
-- Rollback: see supabase/rollbacks/
-- 20260816090000_time_entry_edit_and_assignee_handoff_rollback.sql
-- ================================================================
