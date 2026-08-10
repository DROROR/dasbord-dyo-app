-- ============================================================
-- 004a: Real per-resource access control for Work > Docs and Work >
-- Boards — Migration A of a two-part rollout.
--
-- Docs ("work_docs") is a brand-new table — it never had any DB
-- persistence before this migration (100% local React state) and the
-- old production frontend has no code path that touches it at all, so
-- its full access-control model (including the column lockdown) ships
-- here in one step with no compatibility window to protect.
--
-- Boards ("boards.access") already existed and was already being
-- persisted, but was enforced client-side only — RLS granted every
-- board to anyone with work:'view'. This migration adds real
-- per-board enforcement via has_board_access() to EVERY operation
-- (not just viewing), converts the access map's keys from
-- display-name to profile UUID, and backfills the two real non-owner
-- accounts (akinpros, dyoapp1) onto the 5 existing boards so nobody's
-- current access silently disappears.
--
-- Authorization is hierarchical everywhere in this migration:
-- Work-section permission (has_permission('work', ...)) AND
-- per-board access (has_board_access(...)) are both required; neither
-- substitutes for the other. is_owner is the only universal bypass —
-- holding work:'full' does NOT bypass a board's own ACL for any
-- operation (view, update, delete, or moving a task in/out of it).
--
-- Unlike work_docs, boards.access stays CLIENT-WRITABLE at the column
-- -grant level (full table UPDATE grant, unchanged) in this migration
-- — the old, still-deployed frontend sends a full-row UPDATE on every
-- board-settings save (including id/is_default/access/created_at),
-- and Postgres rejects an UPDATE outright if any named column isn't
-- granted. Locking that down now would silently break "save board
-- settings" on the old frontend for the entire window between this
-- migration and the new frontend's deploy. That lockdown is Migration
-- B (20260809150000_boards_column_lockdown.sql), applied only once
-- the new frontend — which never sends more than
-- {name,statuses,priorities} — is confirmed live.
--
-- Even though the access COLUMN stays grant-writable until Migration
-- B, changing its VALUE is independently enforced by the
-- enforce_board_access_rules trigger below (see Part B) — a
-- board-level 'full' user cannot grant/change anyone's board access
-- unless they also pass can_manage_permissions(), regardless of
-- whether the column-level lockdown has landed yet.
--
-- Reminder for whoever adds the NEXT page/table (see
-- 20260809130000_bot_training_permission_split.sql for the original
-- version of this note): a PAGES registry entry alone does not
-- protect a database table — it needs its own RLS, exactly like this
-- migration adds for work_docs and boards/tasks.
-- ============================================================


-- ================================================================
-- PART A — work_docs
-- ================================================================

create table public.work_docs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null default '',
  access      jsonb not null default '{}'::jsonb,  -- { "<profile-uuid>": "none" | "view" | "full" }
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);

alter table public.work_docs enable row level security;

-- Atomically grants the creator 'full' access in the same INSERT
-- that creates the row, and ignores whatever the client sent for
-- access/created_by — otherwise a non-owner creator could either (a)
-- end up with an empty ACL and instantly lose access to their own
-- new document, or (b) forge an ACL entry for someone else. Only
-- applies when auth.uid() is not null (a real authenticated client
-- request always has one); the one-time seed INSERT below runs with
-- no session, so its explicit values are used as-is.
create or replace function public.set_work_doc_creator_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.access := jsonb_build_object(auth.uid()::text, 'full');
  end if;
  return new;
end;
$$;

create trigger trg_set_work_doc_creator_access
  before insert on public.work_docs
  for each row execute function public.set_work_doc_creator_access();

-- SECURITY DEFINER so its internal query against work_docs bypasses
-- RLS on that inner query (the same already-proven pattern
-- has_permission() uses querying profiles from within profiles'
-- own policies) — no recursion. doc_id/min_level are always
-- constants written into our own policies below, never client input.
create or replace function public.has_doc_access(doc_id uuid, min_level text default 'view')
returns boolean language sql security definer stable set search_path = public as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner)
    or exists (
      select 1 from public.work_docs d
      where d.id = doc_id
        and permission_rank(coalesce(d.access ->> auth.uid()::text, 'none')) >= permission_rank(min_level)
    );
$$;

revoke execute on function public.has_doc_access(uuid, text) from public;
grant  execute on function public.has_doc_access(uuid, text) to authenticated;

-- A PostgREST "computed column" (function taking the table's row type as
-- its sole argument, selectable inline as an ordinary column). Lets a
-- regular viewer learn their OWN access level on a doc as part of the
-- normal doc-list query, without exposing the full access map (which
-- would leak every other person's level to anyone who can merely view
-- the document) — the raw `access` column itself is never selected in
-- the ordinary list/read path, only through the gated Edge Function.
create or replace function public.my_doc_access_level(w public.work_docs)
returns text language sql security definer stable set search_path = public as $$
  select case
    when exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner) then 'full'
    else coalesce(w.access ->> auth.uid()::text, 'none')
  end;
$$;

revoke execute on function public.my_doc_access_level(public.work_docs) from public;
grant  execute on function public.my_doc_access_level(public.work_docs) to authenticated;

create policy "work_docs: view" on public.work_docs for select
  using (has_permission('work_docs', 'view') and has_doc_access(id, 'view'));

create policy "work_docs: insert" on public.work_docs for insert
  with check (has_permission('work_docs', 'full'));

create policy "work_docs: update" on public.work_docs for update
  using (has_permission('work_docs', 'view') and has_doc_access(id, 'full'))
  with check (has_permission('work_docs', 'view') and has_doc_access(id, 'full'));

create policy "work_docs: delete" on public.work_docs for delete
  using (has_permission('work_docs', 'full') and has_doc_access(id, 'full'));

-- access is never client-writable directly — only through the
-- update-resource-access Edge Function (service-role, after an
-- explicit can_manage_permissions() check). title/content/updated_at
-- stay directly writable, protected by the RLS "work_docs: update"
-- policy above (a view-only user's direct UPDATE fails
-- has_doc_access(id,'full'), not just because the Save button is
-- hidden client-side). updated_at must be granted too: Postgres checks
-- UPDATE privilege on every column named in the SET list, so the
-- client setting it on save (to show an accurate "Last updated" time)
-- would otherwise fail the whole statement.
--
-- This lockdown is safe to apply immediately (unlike boards' — see
-- Part B): work_docs is a brand-new table the old, still-deployed
-- frontend has no code path referencing at all (it renders Docs
-- entirely from local MOCK_DOCS state). There is no old query that
-- could be broken by restricting a table it never touches.
revoke update on public.work_docs from authenticated, anon;
grant update (title, content, updated_at) on public.work_docs to authenticated;

-- Seed: the exact two documents that exist today in
-- src/data/workMockData.ts (MOCK_DOCS), preserved verbatim. Their
-- mock ACL entries (Fahad/Alexander/Dana/Roi/Dror) don't map to any
-- real profile, so access starts empty (Owner-only, via the
-- has_doc_access owner bypass) rather than inventing a mapping.
insert into public.work_docs (title, content, access, created_by, updated_at)
values
  (
    'API Integration Guide — Cardcom',
    E'# Cardcom API Integration\n\n## Authentication\nUse the terminal number and API key from the Cardcom dashboard.\n\n## Token Creation\nPOST /v11/api/Token/Create\n\n## Subscription Management\n- Create: POST /v11/api/Subscription/Create\n- Update: POST /v11/api/Subscription/Update\n- Cancel: POST /v11/api/Subscription/Cancel\n\n## Webhooks\nAll payloads signed with HMAC-SHA256. Set callback URL in dashboard.',
    '{}'::jsonb,
    '9119ab55-b733-49b9-ad82-3e6e0f3f932e'::uuid,
    '2026-06-01T10:00:00Z'::timestamptz
  ),
  (
    'White Label Onboarding Checklist',
    E'# White Label Client Onboarding\n\n## Pre-launch\n- [ ] Theme config (colors, logo, fonts)\n- [ ] Custom domain setup\n- [ ] Payment gateway configured\n- [ ] Test accounts created\n\n## Launch Day\n1. DNS records updated\n2. SSL certificate issued\n3. Smoke test all pages\n4. Monitor error logs 24h\n\n## Post-launch\n- Send welcome email\n- Schedule 7-day check-in call',
    '{}'::jsonb,
    '9119ab55-b733-49b9-ad82-3e6e0f3f932e'::uuid,
    '2026-06-05T15:00:00Z'::timestamptz
  );


-- ================================================================
-- PART B — Boards & Tasks: per-board enforcement on every operation
-- ================================================================

-- Boards' access map uses a 4-value vocabulary (none/view/comment/full,
-- src/types/work.ts AccessLevel) that permission_rank() does not fully
-- recognize ('comment' is not one of its cases, which would make it
-- resolve to NULL and fail every comparison). A separate, small,
-- boards-only rank function avoids touching the already-deployed,
-- module-permission permission_rank() used everywhere else in the app.
--
-- Intended semantics for the 4 levels:
--   none    - no access at all.
--   view    - read the board and its tasks only.
--   comment - read, plus add comments on tasks — via the dedicated
--             add_task_comment() RPC below, not the ordinary
--             "tasks: update" policy (see the note above that
--             function). Cannot edit/move/archive/delete a task or
--             any of its other fields.
--   full    - create/update/move/archive/delete tasks, and edit
--             ordinary board content/settings. Does NOT include
--             changing who has access — that is
--             can_manage_permissions()-only, regardless of board
--             level (see enforce_board_access_rules below).
create or replace function public.board_access_rank(lvl text)
returns int language sql immutable as $$
  select case lvl
    when 'full' then 3
    when 'comment' then 2
    when 'view' then 1
    when 'none' then 0
    else null
  end;
$$;

-- Authorization is hierarchical and Owner-only bypasses the per-board
-- check: (1) has_permission('work', min_level) — Work-section access,
-- checked separately by the RLS policies below, not in here; (2) an
-- explicit entry in this specific board's access map at a sufficient
-- level; is_owner is the ONLY thing that skips (2). Holding
-- work:'full' does NOT bypass a board-level restriction, for ANY
-- operation — view, update, delete, or moving a task in/out of it. A
-- work manager with no entry (or an explicit 'none') on a given board
-- has no access to it, full stop.
--
-- SECURITY DEFINER so its internal query against boards bypasses RLS
-- on that inner query (same pattern as has_doc_access) — no recursion.
-- Fail-closed: a profile with no entry in a board's access map gets
-- 'none', not an open default.
create or replace function public.has_board_access(board_id_in text, min_level text default 'view')
returns boolean language sql security definer stable set search_path = public as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner)
    or exists (
      select 1 from public.boards b
      where b.id = board_id_in
        and board_access_rank(coalesce(b.access ->> auth.uid()::text, 'none')) >= board_access_rank(min_level)
    );
$$;

revoke execute on function public.board_access_rank(text) from public;
revoke execute on function public.has_board_access(text, text) from public;
grant  execute on function public.board_access_rank(text) to authenticated;
grant  execute on function public.has_board_access(text, text) to authenticated;

-- Atomically grants the creator 'full' access on the board they just
-- created, in the same INSERT, and discards whatever access map the
-- client sent — mirrors set_work_doc_creator_access() and is load
-- -bearing: has_board_access() has no work:'full' bypass, so without
-- this trigger a non-owner board creator (INSERT still only requires
-- work-section permission — see "boards: insert" below, unchanged)
-- would create a board they immediately cannot see or manage
-- themselves. It also closes the "arbitrary staff-side ACL forging"
-- gap — a client can no longer plant a fabricated access entry for
-- someone else at creation time; only the creator's own auth.uid() is
-- ever written here.
create or replace function public.set_board_creator_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.access := jsonb_build_object(auth.uid()::text, 'full');
  end if;
  return new;
end;
$$;

create trigger trg_set_board_creator_access
  before insert on public.boards
  for each row execute function public.set_board_creator_access();

drop policy if exists "boards: view" on public.boards;
create policy "boards: view" on public.boards for select
  using (has_permission('work', 'view') and has_board_access(id, 'view'));

-- "boards: insert" is intentionally left unchanged
-- (has_permission('work','full') only, from migration 20260809120100)
-- — there is no existing board to check per-board access against yet;
-- the new creator-access trigger above is what determines who gets
-- access to a board that's still being created.

drop policy if exists "boards: update" on public.boards;
create policy "boards: update" on public.boards for update
  using (has_permission('work', 'full') and has_board_access(id, 'full'))
  with check (has_permission('work', 'full') and has_board_access(id, 'full'));

drop policy if exists "boards: delete" on public.boards;
create policy "boards: delete" on public.boards for delete
  using (has_permission('work', 'full') and has_board_access(id, 'full'));

-- ── tasks ────────────────────────────────────────────────────────
-- Every task operation now also requires the appropriate level of
-- access to the task's board — not just the Work-section permission
-- that gated it before this migration.

drop policy if exists "tasks: view" on public.tasks;
create policy "tasks: view" on public.tasks for select
  using (has_permission('work', 'view') and has_board_access(board, 'view'));
-- Deliberately strict: a task on a board you can't access is fully
-- hidden, including tasks assigned to you personally. tasks.assignee
-- is a free-text display name, not a profile UUID (a known, already
-- documented limitation from the original permissions audit) — an
-- "assigned to me" carve-out would have to match on that fragile
-- field, so it is not implemented here.

drop policy if exists "tasks: insert" on public.tasks;
create policy "tasks: insert" on public.tasks for insert
  with check (has_permission('work', 'edit') and has_board_access(board, 'full'));

drop policy if exists "tasks: update" on public.tasks;
create policy "tasks: update" on public.tasks for update
  using (has_permission('work', 'edit') and has_board_access(board, 'full'))
  with check (has_permission('work', 'edit') and has_board_access(board, 'full'));
-- USING evaluates against the task's CURRENT (old) board, WITH CHECK
-- against its resulting (new) board — moving a task requires 'full'
-- access to BOTH the source and destination board, not just one.
--
-- Comment-level ('comment') access deliberately gets NO write path
-- through this policy — "tasks: update" stays 'full'-only. Comments
-- are added through the dedicated add_task_comment() RPC below
-- instead, which is the actual mechanism that makes 'comment' access
-- do something: a direct client UPDATE to any task column, from a
-- 'comment'-level user, still fails this policy exactly as it would
-- for a 'view'-level user.

drop policy if exists "tasks: delete" on public.tasks;
create policy "tasks: delete" on public.tasks for delete
  using (has_permission('work', 'full') and has_board_access(board, 'full'));

-- Comments are currently written by re-sending the ENTIRE task row
-- (TaskDetailModal's save() merges the new comment into the full task
-- object, then calls the same generic updateTask() used for every
-- other field — src/components/work/TaskDetailModal.tsx,
-- src/lib/database.ts). A column-level grant restricted to just
-- `comments` cannot accommodate that: Postgres rejects an UPDATE
-- outright if ANY named column in the SET list lacks privilege, even
-- alongside unchanged ones (the same issue already found and fixed
-- for boards/work_docs), and that path always carries every column.
-- Client-side merge-then-overwrite is also not concurrency-safe: two
-- people commenting near-simultaneously would each read the same
-- stale comments array and the second write would silently clobber
-- the first's comment (a classic lost update).
--
-- add_task_comment() replaces that path for comment-adding
-- specifically (TaskDetailModal is updated to call it instead of the
-- generic save()). It is SECURITY DEFINER — its own internal UPDATE
-- runs with elevated privilege, bypassing the 'full'-only
-- "tasks: update" RLS policy above — but it does its OWN explicit
-- authorization check first (has_board_access(board,'comment'), which
-- 'comment' and 'full' both satisfy and 'view'/'none' do not), and the
-- SQL body physically cannot touch any column other than `comments`
-- (+ updated_at) — there is no parameter or code path through which a
-- caller could smuggle a title/status/assignee/board change in. The
-- append itself is a single atomic `UPDATE ... SET comments = comments
-- || new_comment`, and the row is locked (`for update`) before that,
-- so two concurrent callers on the same task are serialized by
-- Postgres and both comments survive — neither overwrites the other.
create or replace function public.add_task_comment(task_id uuid, comment_text text, mentions text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board   text;
  v_author  text;
  v_comment jsonb;
  v_updated jsonb;
begin
  -- Authenticated caller validation — explicit, not just relying on grants.
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Validate comment text: reject empty or unreasonably large comments.
  if comment_text is null or btrim(comment_text) = '' then
    raise exception 'comment text must not be empty' using errcode = '22023';
  end if;
  if length(comment_text) > 4000 then
    raise exception 'comment text is too long (max 4000 characters)' using errcode = '22023';
  end if;
  if mentions is not null and array_length(mentions, 1) > 50 then
    raise exception 'too many mentions' using errcode = '22023';
  end if;

  -- Validate task ID: must reference a real task. Locks the row so a
  -- concurrent add_task_comment() call on the same task waits for this
  -- one to commit, then appends onto the already-updated value —
  -- that's what makes two simultaneous comments both survive.
  select board into v_board from public.tasks where id = task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  -- Authorization: Work-section view AND board access at 'comment' or
  -- above ('comment' or 'full' both qualify; 'view'/'none' do not).
  -- No is_owner/work:'full' special-case is needed here beyond what
  -- has_board_access() and has_permission() already provide.
  if not (public.has_permission('work', 'view') and public.has_board_access(v_board, 'comment')) then
    raise exception 'insufficient board access to comment on this task' using errcode = '42501';
  end if;

  -- Derive author identity and timestamp server-side — the caller
  -- cannot supply either; this is what prevents comment spoofing.
  select name into v_author from public.profiles where id = auth.uid();

  v_comment := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'author', coalesce(v_author, 'Unknown'),
    'text', btrim(comment_text),
    'timestamp', to_jsonb(now()),
    'mentions', coalesce(to_jsonb(mentions), '[]'::jsonb)
  );

  update public.tasks
     set comments   = coalesce(comments, '[]'::jsonb) || jsonb_build_array(v_comment),
         updated_at = now()
   where id = task_id
   returning comments into v_updated;

  return v_updated;
end;
$$;

revoke execute on function public.add_task_comment(uuid, text, text[]) from public;
grant  execute on function public.add_task_comment(uuid, text, text[]) to authenticated;

-- Backfill: preserve today's real effective access across the
-- name -> UUID key conversion. The stored keys today
-- (Fahad/Alexander/Dana/Roi/Dror/Prosperity) are mock names with no
-- real profile — they are dropped, not carried over. The two real
-- non-owner accounts (akinpros@gmail.com, dyoapp1@gmail.com) are
-- backfilled to 'full' on all 5 existing boards. This is load-bearing,
-- not a redundant safety net: has_board_access() has no work:'full'
-- bypass, so without this backfill both accounts would lose all
-- board/task visibility AND every write capability the moment this
-- migration lands. After deployment, the Owner can deliberately
-- narrow either account's per-board access via the (now-enforced)
-- Access Control panel.
update public.boards
   set access = jsonb_build_object(
     'd940b1af-a539-48fd-859d-851646d30cd3', 'full',  -- akinpros@gmail.com
     '6975acc8-2312-400e-aee3-68c896c2969a', 'full'    -- dyoapp1@gmail.com
   )
 where id in ('app_production', 'apps_to_update_pfcpmlwc', 'development', 'support', 'prosperity');

-- Independent of the column-grant lockdown (deferred to Migration B —
-- see the header comment): no UPDATE may change a board's `access`
-- value unless the caller passes can_manage_permissions(), or the
-- request is running as the service_role database role (which is what
-- the update-resource-access Edge Function authenticates as — and
-- that function has ALREADY performed its own can_manage_permissions()
-- check against the calling end-user's own JWT before it ever touches
-- the service-role client, so allowing service_role through here does
-- not skip authorization, it defers to authorization already done).
-- This closes the gap where a board-level 'full' user (who is NOT an
-- authorized admin) could otherwise grant/revoke other people's board
-- access simply because the `access` column happens to still be
-- grant-writable until Migration B lands.
--
-- Deliberately NOT exempted: "auth.uid() is null". That condition is
-- true both for a legitimate system context AND for an anonymous,
-- unauthenticated client request — it is not a safe stand-in for
-- "this is trusted". current_user is the actual authenticated
-- Postgres role in effect for this request (anon/authenticated/
-- service_role/a migration-time role), set server-side by
-- authentication, not something a client can influence — so checking
-- it directly, rather than inferring trust from a NULL uid, is what
-- makes this precise. anon requests run as current_user = 'anon',
-- which satisfies neither branch and is rejected here even if they
-- somehow got past the "boards: update" RLS policy's own
-- has_permission()/has_board_access() checks (which they also cannot,
-- since an anon session matches no profiles row at all).
--
-- This trigger is created here, AFTER the backfill UPDATE above, not
-- before it: the backfill is the migration's own system-level write —
-- it does not run as service_role or as an authenticated
-- can_manage_permissions() caller, so had this trigger existed
-- earlier in the file it would have rejected the migration's own
-- backfill (which is exactly what happened on the first deploy
-- attempt of this migration, before this fix). Creating the trigger
-- only after the one UPDATE statement that needed to bypass it removes
-- the need for any exemption logic at all — the trigger's ongoing
-- runtime behavior stays exactly as strict as intended.
create or replace function public.enforce_board_access_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.access is distinct from old.access
     and not public.can_manage_permissions()
     and current_user <> 'service_role'
  then
    raise exception 'only the owner or an authorized admin may change board access' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_board_access_rules
  before update on public.boards
  for each row execute function public.enforce_board_access_rules();

-- ============================================================
-- boards.access itself is NOT locked down to a restricted column
-- grant in this migration (see the header comment) — that is
-- Migration B (20260809150000_boards_column_lockdown.sql), applied
-- only after the new frontend is confirmed live. Changing the VALUE
-- of access is already enforced independently by
-- enforce_board_access_rules above regardless of that timing.
--
-- Rollback: see supabase/rollbacks/
-- 20260809140000_docs_and_board_access_rollback.sql
-- ============================================================
