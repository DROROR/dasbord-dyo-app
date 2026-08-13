-- ================================================================
-- 011: Atomic task board-move — move_task_to_board() RPC plus a
-- dedicated, permanent task_board_moves history table.
--
-- Phase 0 audit findings this migration is built on:
--   - has_board_access(board_id_in text, min_level text) (as of
--     20260810101000) already gives owner+active bypass and an
--     is_active check on the caller — reused unmodified for both the
--     source- and destination-board 'full' checks.
--   - validate_task_assignee() / derive_task_identity_from_text() /
--     log_task_status_event() are all ordinary BEFORE/AFTER triggers
--     on `tasks` that fire on any UPDATE, including one issued from
--     inside this SECURITY DEFINER function — they need no changes and
--     will run exactly as they do for any other task edit:
--       - validate_task_assignee re-verifies assignee eligibility
--         against the row's (already-updated-in-this-statement) board
--         and is the final authority on the `assignee` display-name
--         snapshot — this migration's own eligibility check is
--         intentionally redundant with it (defense in depth), and is
--         the ONLY enforcement in the one case validate_task_assignee
--         itself skips: assignee_id unchanged across the move.
--       - log_task_status_event fires automatically whenever the move
--         also changes `status`, inserting its own
--         task_status_events row — desired, not something this
--         migration needs to trigger itself.
--   - The existing "Status History" UI reads the legacy
--     tasks.status_history client array, not task_status_events or
--     any new table — this migration deliberately does not touch
--     status_history at all, per the explicit column list in the
--     spec (board, status, priority, assignee_id, assignee only).
--   - tasks.board/status/priority are all `text` (board is a slug, not
--     a uuid); tasks.priority is nullable, so a null destination
--     priority ("No Priority") is representable with no schema change.
-- ================================================================


-- ================================================================
-- PART A — priority_label_of() helper, mirrors the existing
-- status_label_of() exactly but for a board's priorities array.
-- ================================================================
create or replace function public.priority_label_of(board_id_in text, priority_id_in text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when priority_id_in is null then null
    else coalesce(
      (select p->>'label' from public.boards b, jsonb_array_elements(coalesce(b.priorities, '[]'::jsonb)) p
        where b.id = board_id_in and p->>'id' = priority_id_in limit 1),
      priority_id_in
    )
  end;
$$;

revoke execute on function public.priority_label_of(text, text) from public, anon;
grant  execute on function public.priority_label_of(text, text) to authenticated;


-- ================================================================
-- PART B — task_board_moves: permanent, durable history of every
-- board move. No FK on task_id (deliberately, same convention as
-- task_status_events) so a later task deletion can never cascade this
-- history away and a later board/status/priority rename or delete
-- can never rewrite it — every label and name below is a snapshot
-- captured at move time, not a live join.
-- ================================================================
create table public.task_board_moves (
  id                          uuid primary key default gen_random_uuid(),
  task_id                     uuid not null,
  task_title_snapshot         text not null,

  source_board_id             text not null,
  source_board_name_snapshot  text not null,
  dest_board_id                text not null,
  dest_board_name_snapshot     text not null,

  from_status_id              text,
  from_status_label           text,
  to_status_id                 text,
  to_status_label               text,

  from_priority_id            text,
  from_priority_label         text,
  to_priority_id                text,
  to_priority_label              text,

  from_assignee_id             uuid,
  from_assignee_name_snapshot text,
  to_assignee_id                uuid,
  to_assignee_name_snapshot      text,

  -- Nullable: a future service-role-initiated move (no user JWT, so
  -- no auth.uid()) stays explicitly unattributed rather than forcing
  -- a fabricated actor — same nullable convention already used by
  -- task_status_events.changed_by.
  moved_by                    uuid,
  moved_at                    timestamptz not null default now()
);

create index task_board_moves_task_id_idx on public.task_board_moves(task_id);

alter table public.task_board_moves enable row level security;

-- Readable by anyone who currently has at least 'view' on either the
-- source or the destination board (the task lived on one, now lives
-- on the other) — same has_board_access() owner/active-bypass
-- semantics as everywhere else, so nothing new to reason about here.
create policy "task_board_moves: view" on public.task_board_moves for select
  using (
    has_permission('work', 'view')
    and (has_board_access(source_board_id, 'view') or has_board_access(dest_board_id, 'view'))
  );

-- No insert/update/delete policy for authenticated at all — the only
-- writer is move_task_to_board() below, which runs as SECURITY
-- DEFINER (table owner privileges, bypassing both RLS and the table
-- grants) — this table's row history can never be created, edited, or
-- removed by a direct client call.
revoke all on public.task_board_moves from public, anon, authenticated;
grant select on public.task_board_moves to authenticated;


-- ================================================================
-- PART C — move_task_to_board(): the single atomic operation.
-- ================================================================
-- dest_priority_id_in = null means "No Priority" and is always valid
-- (tasks.priority is nullable); every other destination value is
-- validated strictly against the DESTINATION board's own
-- statuses/priorities/access — never the source board's, even when an
-- id happens to collide between the two.
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

  -- Row-locks the task first — the same pattern claim_task() uses to
  -- guard against a concurrent operation. Everything read from
  -- v_task below (in particular v_task.board, the "expected source
  -- board") is therefore guaranteed current as of this transaction,
  -- which is what makes the stale/concurrent-move safety requirement
  -- hold: a second, concurrent move attempt on the same task blocks
  -- here until the first commits, then re-reads the task's
  -- already-changed board and is validated against ITS new reality,
  -- never against a value read before the first move happened.
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

  -- Destination assignee eligibility — mirrors validate_task_assignee's
  -- own rule exactly (active Owner unconditional; otherwise active,
  -- non-owner profile with access above 'none' on the DESTINATION
  -- board). Deliberately excludes validate_task_assignee's separate
  -- claim_task() compatibility branch — that exists only for a
  -- claimant self-assigning via the support queue and must not become
  -- a general board-move bypass.
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

  -- Title, description, client, comments, attachments, dates,
  -- estimate/tracked time, claim/support metadata, status_history —
  -- everything else on the row is left completely untouched. Only
  -- these five columns move together, in one statement, so the row is
  -- never briefly inconsistent (e.g. new board with the old priority)
  -- even under concurrent readers.
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
-- Rollback: see supabase/rollbacks/
-- 20260812090000_move_task_to_board_rollback.sql
-- ================================================================
