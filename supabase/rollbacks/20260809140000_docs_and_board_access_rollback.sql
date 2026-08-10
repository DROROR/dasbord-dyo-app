-- ============================================================
-- Rollback for 20260809140000_docs_and_board_access.sql (Migration A)
--
-- work_docs: NO automatic data loss. This is a brand-new table with
-- no "before" state to restore, so the automatic rollback only revokes
-- all client access to it (the feature stops working) — it does NOT
-- drop the table or touch any row. Dropping the table (including the
-- two real seeded documents, and anything created after deploy) is a
-- separate, explicit, manual-only emergency step at the bottom of this
-- file that refuses to run by default.
--
-- boards / tasks: restores the exact prior policies, captured live
-- from production immediately before this migration was written
-- (pg_policies). Does NOT touch boards' column grants — Migration A
-- never changed them (that lockdown is Migration B, with its own
-- separate rollback), so there is nothing to restore here. Does NOT
-- touch boards.access data — the backfill this migration performed
-- (mock names -> akinpros/dyoapp1 UUIDs) is left in place; it is
-- additive/corrective data, not something a structural rollback should
-- undo.
-- ============================================================

-- ── work_docs: lock down, do not drop ──────────────────────────
revoke all on public.work_docs from authenticated, anon;
drop trigger if exists trg_set_work_doc_creator_access on public.work_docs;
drop function if exists public.set_work_doc_creator_access();
drop function if exists public.has_doc_access(uuid, text);
drop function if exists public.my_doc_access_level(public.work_docs);
-- Policies are dropped implicitly with revoke all in effect (no
-- grants means RLS is moot), but drop them explicitly for cleanliness:
drop policy if exists "work_docs: view" on public.work_docs;
drop policy if exists "work_docs: insert" on public.work_docs;
drop policy if exists "work_docs: update" on public.work_docs;
drop policy if exists "work_docs: delete" on public.work_docs;

-- ── boards: drop the new triggers added by Migration A ─────────
-- (column grants are untouched by Migration A — nothing to restore there)
drop trigger if exists trg_set_board_creator_access on public.boards;
drop function if exists public.set_board_creator_access();
drop trigger if exists trg_enforce_board_access_rules on public.boards;
drop function if exists public.enforce_board_access_rules();

-- ── boards: restore the exact prior policies ────────────────────
drop policy if exists "boards: view" on public.boards;
create policy "boards: view" on public.boards for select
  using (has_permission('work'::text, 'view'::text));

drop policy if exists "boards: update" on public.boards;
create policy "boards: update" on public.boards for update
  using (has_permission('work'::text, 'full'::text))
  with check (has_permission('work'::text, 'full'::text));

drop policy if exists "boards: delete" on public.boards;
create policy "boards: delete" on public.boards for delete
  using (has_permission('work'::text, 'full'::text));

-- ── tasks: restore the exact prior policies ─────────────────────
drop policy if exists "tasks: view" on public.tasks;
create policy "tasks: view" on public.tasks for select
  using (has_permission('work'::text, 'view'::text));

drop policy if exists "tasks: insert" on public.tasks;
create policy "tasks: insert" on public.tasks for insert
  with check (has_permission('work'::text, 'edit'::text));

drop policy if exists "tasks: update" on public.tasks;
create policy "tasks: update" on public.tasks for update
  using (has_permission('work'::text, 'edit'::text))
  with check (has_permission('work'::text, 'edit'::text));

drop policy if exists "tasks: delete" on public.tasks;
create policy "tasks: delete" on public.tasks for delete
  using (has_permission('work'::text, 'full'::text));

-- ── tasks: drop the comment RPC added by Migration A ────────────
-- Non-destructive: removes the ability to add NEW comments through
-- this function going forward, but does not touch any comment data
-- already written into existing tasks' `comments` column.
drop function if exists public.add_task_comment(uuid, text, text[]);

-- ── drop the board-access helper functions ─────────────────────
drop function if exists public.has_board_access(text, text);
drop function if exists public.board_access_rank(text);

-- ============================================================
-- MANUAL EMERGENCY ONLY — never run automatically, never part of
-- the rollback above. Permanently deletes the work_docs table and
-- all its data. Refuses to run if more than the 2 known seed
-- documents exist, forcing a conscious decision rather than an
-- accidental data-destroying rollback.
-- ============================================================
-- do $$
-- begin
--   if (select count(*) from public.work_docs) > 2 then
--     raise exception 'refusing automatic drop: % documents exist beyond the 2 seed docs — delete manually and explicitly if that is really the intent', (select count(*) from public.work_docs);
--   end if;
--   drop table public.work_docs cascade;
-- end $$;
