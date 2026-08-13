-- ============================================================
-- Rollback for 20260812090000_move_task_to_board.sql
--
-- Non-destructive: does NOT drop task_board_moves and does NOT delete
-- any history row already recorded. Every board move that already
-- happened stays permanently recorded, exactly as the forward
-- migration's own design intends ("history must survive later
-- deletion/renaming") — a rollback deliberately does not get to erase
-- history either. Only the write path (the RPC) and the read grant
-- are removed; tasks.board/status/priority/assignee_id/assignee
-- values already written by a prior move are left as they are (this
-- was always true — the RPC only ever changes those five columns
-- together, the same as any other task edit would).
-- ============================================================

revoke execute on function public.move_task_to_board(uuid, text, text, text, uuid) from authenticated;
drop function if exists public.move_task_to_board(uuid, text, text, text, uuid);

drop policy if exists "task_board_moves: view" on public.task_board_moves;
revoke all on public.task_board_moves from public, anon, authenticated;

drop function if exists public.priority_label_of(text, text);

-- ============================================================
-- The task_board_moves table and every row in it are deliberately
-- left in place. Dropping it (only if a full teardown is genuinely
-- intended, permanently losing board-move history) is documented here
-- but never run automatically:
--
--   drop table public.task_board_moves;
--
-- Never run as part of this rollback.
-- ============================================================
