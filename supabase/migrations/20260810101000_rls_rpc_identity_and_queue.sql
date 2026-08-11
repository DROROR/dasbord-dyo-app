-- ============================================================
-- 005c: RLS/RPC for stable identity, the configurable shared support
-- queue, atomic claiming, status-owner routing, and is_active
-- enforcement across every existing authorization gate.
-- ============================================================


-- ================================================================
-- PART A — is_active hardening of the four existing gate functions
-- ================================================================
-- A banned Auth user (ban_duration) cannot sign in or refresh a
-- token again, but the installed Supabase SDK (@supabase/auth-js,
-- checked locally in node_modules) exposes no "invalidate this
-- user's already-issued session" admin call — GoTrueAdminApi.signOut()
-- takes a live JWT, not a user id, and there is no bulk-revoke-by-id
-- method. So an already-issued, unexpired access token could in
-- principle still be presented after deactivation. Threading
-- is_active through every central RLS gate closes that: even if a
-- stale token is replayed, every permission check now fails the
-- moment is_active=false, regardless of token validity. Bodies are
-- otherwise byte-identical to the live versions captured before this
-- change — only the "and p.is_active" clause is new in each.

create or replace function public.has_permission(module text, min_level text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and ( p.is_owner
            or public.permission_rank(coalesce(p.permissions ->> module, 'none'))
               >= public.permission_rank(min_level) )
  );
$$;

create or replace function public.can_manage_permissions()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and ( p.is_owner
            or (p.role = 'admin' and public.permission_rank(p.permissions ->> 'permissions') = 3) )
  );
$$;

create or replace function public.has_board_access(board_id_in text, min_level text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner and p.is_active)
    or exists (
      select 1 from public.boards b
      where b.id = board_id_in
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
        and board_access_rank(coalesce(b.access ->> auth.uid()::text, 'none')) >= board_access_rank(min_level)
    );
$$;

create or replace function public.has_doc_access(doc_id uuid, min_level text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner and p.is_active)
    or exists (
      select 1 from public.work_docs d
      where d.id = doc_id
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
        and permission_rank(coalesce(d.access ->> auth.uid()::text, 'none')) >= permission_rank(min_level)
    );
$$;


-- ================================================================
-- PART B — profiles RLS: retire the legacy is_admin()-based policy
-- ================================================================
-- is_admin() (role='admin' only) predates the 3-tier model and lets
-- ANY admin — not just one explicitly granted can_manage_permissions()
-- — update any profile's name via a direct API call (no UI ever
-- exposed this, but the RLS/grant combination technically permitted
-- it). Column-level grants already restrict this to the `name`
-- column only (migration 20260809120000), so the practical impact was
-- always narrow, but "user and permission management must use
-- can_manage_permissions()" applies here too.
drop policy if exists "admin can update any profile" on public.profiles;
create policy "authorized admin can update any profile" on public.profiles for update
  using (public.can_manage_permissions())
  with check (public.can_manage_permissions());

drop policy if exists "admin can delete profiles" on public.profiles;
create policy "authorized admin can delete profiles" on public.profiles for delete
  using (public.can_manage_permissions());
-- Owner-deletion is still independently blocked by
-- enforce_profile_role_rules (20260809120000) regardless of this
-- policy — unchanged, not touched here.

-- role/permissions/is_owner/is_technical_support/is_active are still
-- not directly client-writable at all — the column-level lockdown
-- from 20260809120000 already restricts UPDATE to `name` only for
-- `authenticated`, and that lockdown is untouched by this migration.
-- Every write to those fields goes through a service-role Edge
-- Function after its own can_manage_permissions() check, same as
-- before.

-- Audit finding: "authenticated can view profiles" (20260809120100)
-- is `using (true)` — ANY authenticated role, with no is_active check
-- on the CALLER at all. Every other gate in this app now fails closed
-- for a deactivated caller except this one: a deactivated user with a
-- still-valid access token could keep reading the full profiles table
-- (everyone's name/email/role/permissions/is_owner/is_technical_support)
-- via a direct PostgREST call, even though they can no longer do
-- anything with has_permission()/can_manage_permissions()-gated data.
-- Fixed the same way as every other table here: a SECURITY DEFINER
-- helper (avoids the classic recursive-RLS trap of a policy on
-- `profiles` querying `profiles` directly) gates on is_active, with
-- the same unconditional is_owner bypass every other gate function
-- uses.
create or replace function public.caller_is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.is_owner or p.is_active)
  );
$$;

revoke execute on function public.caller_is_active() from public;
grant  execute on function public.caller_is_active() to authenticated;

drop policy if exists "authenticated can view profiles" on public.profiles;
create policy "authenticated can view profiles" on public.profiles for select
  to authenticated
  using (public.caller_is_active());

-- Audit finding: enforce_profile_role_rules (20260809120000) already
-- blocks is_owner/role/permissions changes and deletion on the owner
-- row, independent of RLS — but says nothing about is_active. Today
-- the ONLY thing stopping the owner from being deactivated is
-- deactivate-member's own application-level `if (targetRow.is_owner)`
-- check. Adding the same DB-level belt-and-suspenders protection this
-- trigger already gives every other owner field, so a bug in that
-- Edge Function (or a direct service-role/SQL Editor mistake) can't
-- deactivate the owner either. Byte-identical to the live
-- 20260809120000 body otherwise.
create or replace function public.enforce_profile_role_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_owner then
      raise exception 'owner profile cannot be deleted';
    end if;
    return old;
  end if;

  if new.is_owner is distinct from old.is_owner then
    raise exception 'is_owner cannot be changed directly (see migration 001 comment for the escape hatch)';
  end if;

  if old.is_owner and (new.role is distinct from old.role or new.permissions is distinct from old.permissions) then
    raise exception 'owner role/permissions are immutable';
  end if;

  if old.is_owner and new.is_active is distinct from old.is_active and new.is_active = false then
    raise exception 'owner cannot be deactivated';
  end if;

  return new;
end;
$$;
-- Trigger trg_enforce_profile_role_rules already exists (20260809120000)
-- and picks up this new body automatically via CREATE OR REPLACE
-- FUNCTION — no need to recreate it.


-- ================================================================
-- PART C — technical-support / support-queue helpers
-- ================================================================

-- Active + technical-support membership, in one hardened, reusable
-- check. SECURITY DEFINER (bypasses RLS on its own profiles lookup,
-- same pattern as every other gate function here) — no recursion.
create or replace function public.is_technical_support_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and is_technical_support
  );
$$;

revoke execute on function public.is_technical_support_staff() from public;
grant  execute on function public.is_technical_support_staff() to authenticated;

-- Whether a task currently qualifies for the shared support queue —
-- true if its board has all_tasks_to_support_queue, or its priority
-- has showInSupportQueue. Deliberately does not consider claimed/
-- status here (callers combine this with their own claimed/status
-- checks) so it stays a pure "would this task type ever queue" check,
-- reusable by both the RLS policy and claim_task().
create or replace function public.task_eligible_for_support_queue(task_id_in uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(b.all_tasks_to_support_queue, false) or coalesce(
    (select (p->>'showInSupportQueue')::boolean
       from jsonb_array_elements(b.priorities) p
      where p->>'id' = t.priority),
    -- Boards with no stored priorities array at all
    -- (apps_to_update_pfcpmlwc, prosperity — see 20260810100500's
    -- audit note) fall back to the frontend's DEFAULT_PRIORITY_DEFS at
    -- read time, where only 'critical' is flagged. Mirror that same
    -- fallback here so RLS/claim_task never disagree with what the UI
    -- shows a support agent.
    jsonb_array_length(coalesce(b.priorities, '[]'::jsonb)) = 0 and t.priority = 'critical'
  )
  from public.tasks t join public.boards b on b.id = t.board
  where t.id = task_id_in;
$$;

revoke execute on function public.task_eligible_for_support_queue(uuid) from public;
grant  execute on function public.task_eligible_for_support_queue(uuid) to authenticated;

-- Resolves the active status-owner (by UUID) of a specific board
-- status, or null if that status has no ownerId. Reads
-- boards.statuses[].ownerId (added by the identity migration).
create or replace function public.status_owner_of(board_id_in text, status_id_in text)
returns uuid language sql stable security definer set search_path = public as $$
  select nullif(s->>'ownerId','')::uuid
  from public.boards b, jsonb_array_elements(b.statuses) s
  where b.id = board_id_in and s->>'id' = status_id_in
  limit 1;
$$;

revoke execute on function public.status_owner_of(text, text) from public;
grant  execute on function public.status_owner_of(text, text) to authenticated;


-- ================================================================
-- PART D — tasks: view — support-queue and status-owner visibility
-- ================================================================
-- Two additional OR-branches, both narrowly scoped to specific
-- eligible rows, never the rest of an inaccessible board:
--   - status_owner_of(...) = auth.uid(): the "safety path" from the
--     approved plan — a status owner can always see a task routed to
--     them, independent of has_board_access (board access is
--     auto-granted separately by enforce_board_access_rules below,
--     but this path exists even if that somehow hasn't landed yet).
--   - is_technical_support_staff() AND unclaimed AND open AND
--     task_eligible_for_support_queue(id): exposes only that specific
--     row, not the board it lives on.
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


-- ================================================================
-- PART E — atomic claim_task() RPC
-- ================================================================
-- Row-locks the task (`for update`) before checking `claimed` — a
-- second concurrent caller blocks on that lock until the first
-- transaction commits, then re-reads claimed=true and is rejected
-- with a clear error, never silently overwriting the first claim.
-- Sets both the new UUID columns (authoritative) and the legacy text
-- columns (kept as display snapshots, same convention as
-- add_task_comment's author field). Status moves to the stable id
-- 'in_progress' — never a translated label. Does not touch
-- boards.access — claim never grants broader board access; the
-- claimant's continued visibility comes from the assignee_id match in
-- "tasks: view"'s has_board_access(...) path once that's true, or
-- from staying eligible via this same support-queue path until it's
-- moved out of an open/unclaimed state (which claiming itself does).
create or replace function public.claim_task(task_id uuid)
returns public.tasks
language plpgsql security definer set search_path = public as $$
declare
  v_row public.tasks%rowtype;
  v_caller_name text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not public.has_permission('work', 'edit') then
    raise exception 'insufficient work permission' using errcode = '42501';
  end if;

  if not public.is_technical_support_staff() then
    raise exception 'only active technical-support staff may claim shared-queue tasks' using errcode = '42501';
  end if;

  select * into v_row from public.tasks where id = task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if v_row.status in ('done', 'archived') then
    raise exception 'task is closed and cannot be claimed' using errcode = 'P0001';
  end if;

  if v_row.claimed then
    raise exception 'task already claimed' using errcode = 'P0001';
  end if;

  if not public.task_eligible_for_support_queue(task_id) then
    raise exception 'task is not eligible for the shared support queue' using errcode = '42501';
  end if;

  select name into v_caller_name from public.profiles where id = auth.uid();

  update public.tasks
     set claimed       = true,
         claimed_by_id = auth.uid(),
         assignee_id   = auth.uid(),
         claimed_by    = coalesce(v_caller_name, claimed_by),
         assignee      = coalesce(v_caller_name, assignee),
         status        = 'in_progress',
         updated_at    = now()
   where id = task_id
   returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.claim_task(uuid) from public;
grant  execute on function public.claim_task(uuid) to authenticated;


-- ================================================================
-- PART F — status-owner <-> board-access synchronization
-- ================================================================
-- Rewrites enforce_board_access_rules (20260809140000) to add:
--   1. An unconditional auto-grant of 'view' for any brand-new status
--      ownerId (one that wasn't already a status owner on this
--      board) who doesn't already have at least 'view' — a system
--      side effect of a legitimate statuses edit (already gated by
--      "boards: update"'s own has_permission/has_board_access check),
--      not a manual access edit, so it is NOT subject to the
--      can_manage_permissions()/service_role gate below.
--   2. An explicit REJECTION (not a silent override) if an EXISTING
--      status owner's access would drop below 'view' as a result of
--      this statement — "remove status ownership first" per the
--      required UX, surfaced as a clear Postgres exception rather
--      than quietly re-adding it back.
--   3. A rejection if a brand-new status owner is not an active
--      profile — defense in depth; the frontend also only offers
--      active profiles in the picker.
-- The original explicit-access-change gate (can_manage_permissions()
-- or service_role) is unchanged and still runs first, against exactly
-- what the client submitted, before any of the above is applied.
create or replace function public.enforce_board_access_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_owners uuid[];
  v_new_owners uuid[];
  v_owner_id   uuid;
  v_access     jsonb;
begin
  -- current_user is unreliable here (this function is SECURITY DEFINER,
  -- so current_user always resolves to the function owner, not the
  -- caller — see 20260809141500 for the incident this caused the first
  -- time). auth.role() reads the JWT-claims GUC instead, unaffected by
  -- that substitution — carried forward from the fix, not reintroduced.
  if new.access is distinct from old.access
     and not public.can_manage_permissions()
     and coalesce(auth.role(), '') <> 'service_role'
  then
    raise exception 'only the owner or an authorized admin may change board access' using errcode = 'P0001';
  end if;

  select array_agg(distinct nullif(s->>'ownerId','')::uuid) into v_old_owners
    from jsonb_array_elements(coalesce(old.statuses, '[]'::jsonb)) s
    where s->>'ownerId' is not null;

  select array_agg(distinct nullif(s->>'ownerId','')::uuid) into v_new_owners
    from jsonb_array_elements(coalesce(new.statuses, '[]'::jsonb)) s
    where s->>'ownerId' is not null;

  v_access := coalesce(new.access, '{}'::jsonb);

  if v_new_owners is not null then
    foreach v_owner_id in array v_new_owners loop
      if board_access_rank(coalesce(v_access ->> v_owner_id::text, 'none')) < board_access_rank('view') then
        if v_old_owners is not null and v_owner_id = any(v_old_owners) then
          raise exception 'cannot leave status owner % with less than view access on this board — remove their status ownership first', v_owner_id using errcode = 'P0001';
        end if;
        if not exists (select 1 from public.profiles where id = v_owner_id and is_active) then
          raise exception 'status owner % is not an active profile', v_owner_id using errcode = 'P0001';
        end if;
        v_access := v_access || jsonb_build_object(v_owner_id::text, 'view');
      end if;
    end loop;
  end if;

  new.access := v_access;
  return new;
end;
$$;


-- ================================================================
-- PART G — compatibility trigger: keep tasks.assignee_id/claimed_by_id
-- in sync with the text fields during the old-frontend rollout window
-- ================================================================
-- Audit finding: the currently-deployed frontend's taskToRow() never
-- references assignee_id/claimed_by_id at all (confirmed by reading
-- it directly), so its writes never NULL those columns out — that
-- part is already safe. But it DOES still write `assignee`/
-- `claimed_by` (text) on every reassignment/claim. If the old
-- frontend edits an ALREADY-uuid-linked task (e.g. one this
-- migration's own backfill resolved, or one the new claim_task() RPC
-- already touched), the text field would move to a new person while
-- the UUID field silently stays pointed at the OLD one — and per this
-- app's own "UUID is authoritative" rule (MyBoard.tsx's isMine()),
-- the stale UUID would win, silently misrouting the task to the wrong
-- person. This trigger keeps the UUID in sync whenever ONLY the text
-- changed (the caller didn't also touch the UUID column in the same
-- statement — new_frontend paths like claim_task() always set both
-- together and are therefore left alone here).
--
-- Never guesses: an exact single profiles.name match resolves the
-- UUID; zero matches or an empty text clears the UUID (falls back to
-- name-only display via isMine(), never left stale-and-wrong); more
-- than one profile sharing that exact name raises loudly rather than
-- picking one. Deliberately NOT filtered to is_active profiles —
-- unlike status ownership (a live routing capability), assignee/
-- claimed_by are identity/history fields, and a deactivated person is
-- still who a task was legitimately assigned to or claimed by; is_active
-- has no bearing on that history and blocks their own access regardless.
create or replace function public.derive_task_identity_from_text()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_match_count int;
  v_match_id    uuid;
begin
  if (tg_op = 'INSERT' and coalesce(new.assignee_id::text, '') = '')
     or (tg_op = 'UPDATE' and new.assignee is distinct from old.assignee
         and new.assignee_id is not distinct from old.assignee_id)
  then
    if coalesce(new.assignee, '') = '' then
      new.assignee_id := null;
    else
      select count(*), max(id) into v_match_count, v_match_id
        from public.profiles where name = new.assignee;
      if v_match_count > 1 then
        raise exception 'task assignee "%" matches more than one profile by name — resolve manually (rename a profile or set assignee_id explicitly) before this task can be saved', new.assignee using errcode = 'P0001';
      else
        new.assignee_id := v_match_id; -- v_match_id is null when v_match_count = 0 — never a guess
      end if;
    end if;
  end if;

  if (tg_op = 'INSERT' and coalesce(new.claimed_by_id::text, '') = '')
     or (tg_op = 'UPDATE' and new.claimed_by is distinct from old.claimed_by
         and new.claimed_by_id is not distinct from old.claimed_by_id)
  then
    if coalesce(new.claimed_by, '') = '' then
      new.claimed_by_id := null;
    else
      select count(*), max(id) into v_match_count, v_match_id
        from public.profiles where name = new.claimed_by;
      if v_match_count > 1 then
        raise exception 'task claimed_by "%" matches more than one profile by name — resolve manually before this task can be saved', new.claimed_by using errcode = 'P0001';
      else
        new.claimed_by_id := v_match_id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_derive_task_identity_from_text on public.tasks;
create trigger trg_derive_task_identity_from_text
  before insert or update on public.tasks
  for each row execute function public.derive_task_identity_from_text();


-- ================================================================
-- PART H — compatibility trigger: keep statuses[].ownerId in sync
-- with statuses[].owner (text) during the old-frontend rollout window
-- ================================================================
-- Same class of problem as Part G: the old frontend's status-owner
-- picker (confirmed by reading it directly) only ever writes the
-- `owner` text key via `{...status, owner: newValue}` — it round-trips
-- `ownerId` untouched if already present, but never sets or updates
-- it. If an admin uses the OLD frontend to reassign a status's owner
-- to someone new, `ownerId` would keep silently pointing at whoever
-- was set before, actively misrouting live tasks. Fires before
-- enforce_board_access_rules (alphabetically "derive" < "enforce", so
-- Postgres fires this one first) so the access-invariant check below
-- always sees the fully-resolved ownerId, including one just derived
-- from a text-only edit.
--
-- Unlike Part G, this DOES require the matched profile to be active —
-- status ownership is live routing capability, not a history field;
-- routing to an inactive profile's UUID would silently orphan the
-- task exactly like the no-match case, so both are treated the same
-- way: clear ownerId (falls back to "no status owner", the safe
-- default), never guess, never point at someone who cannot act on it.
create or replace function public.derive_status_owner_from_text()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_result   jsonb := '[]'::jsonb;
  v_new_s    jsonb;
  v_old_s    jsonb;
  v_count    int;
  v_match_id uuid;
begin
  for v_new_s in select jsonb_array_elements(coalesce(new.statuses, '[]'::jsonb)) loop
    -- SELECT ... INTO leaves the target UNCHANGED (not null) when zero
    -- rows match, so a brand-new status with no corresponding old
    -- entry would otherwise silently reuse the PREVIOUS loop
    -- iteration's v_old_s — reset explicitly every iteration first.
    v_old_s := null;
    select s into v_old_s
      from jsonb_array_elements(coalesce(old.statuses, '[]'::jsonb)) s
      where s->>'id' = v_new_s->>'id'
      limit 1;

    if coalesce(v_new_s->>'owner', '') is distinct from coalesce(v_old_s->>'owner', '')
       and coalesce(v_new_s->>'ownerId', '') is not distinct from coalesce(v_old_s->>'ownerId', '')
    then
      if coalesce(v_new_s->>'owner', '') = '' then
        v_new_s := v_new_s - 'ownerId';
      else
        select count(*), max(id) into v_count, v_match_id
          from public.profiles where name = v_new_s->>'owner' and is_active;
        if v_count > 1 then
          raise exception 'status owner "%" matches more than one active profile by name — resolve manually (rename a profile or set the owner via the picker) before this board can be saved', v_new_s->>'owner' using errcode = 'P0001';
        elsif v_count = 1 then
          v_new_s := v_new_s || jsonb_build_object('ownerId', v_match_id::text);
        else
          v_new_s := v_new_s - 'ownerId';
        end if;
      end if;
    end if;

    v_result := v_result || jsonb_build_array(v_new_s);
  end loop;

  new.statuses := v_result;
  return new;
end;
$$;

drop trigger if exists trg_derive_status_owner_from_text on public.boards;
create trigger trg_derive_status_owner_from_text
  before update on public.boards
  for each row execute function public.derive_status_owner_from_text();


-- ================================================================
-- PART I — clear status ownership when its owner is deactivated
-- ================================================================
-- Audit finding: status_owner_of()/statusOwnerIdOf() (client) return
-- whatever UUID is stored, with no is_active check of their own —
-- reasonable for a pure lookup, but nothing else was clearing that
-- UUID when its owner became inactive. A deactivated status owner can
-- never see or act on anything again (is_active blocks every gate),
-- so a task still routed to them would sit invisible to their My
-- Board (deactivated) AND hidden from the original assignee's My
-- Board (MyBoard.tsx only shows it back to them once ownerId is
-- empty) — an orphaned task nobody's personal queue surfaces, even
-- though it's still reachable via the ordinary Tasks/Gantt board
-- view. Clear handling rule: the moment is_active flips to false,
-- strip ONLY ownerId (never the display-name `owner` text — that
-- stays as a historical label, same "never delete text history"
-- convention as everywhere else) from every status that named them,
-- across every board. Runs as an AFTER trigger on profiles so it
-- fires regardless of caller — deactivate-member's service-role
-- UPDATE, a future different deactivation path, or a direct SQL
-- Editor edit all trigger it identically; it cannot be bypassed by
-- calling something other than the Edge Function.
create or replace function public.clear_status_ownership_on_deactivation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_active = false and old.is_active is distinct from false then
    update public.boards b
       set statuses = (
         select jsonb_agg(
           case when s->>'ownerId' = new.id::text then s - 'ownerId' else s end
           order by ord
         )
         from jsonb_array_elements(b.statuses) with ordinality as arr(s, ord)
       )
     where exists (
       select 1 from jsonb_array_elements(b.statuses) s where s->>'ownerId' = new.id::text
     );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clear_status_ownership_on_deactivation on public.profiles;
create trigger trg_clear_status_ownership_on_deactivation
  after update of is_active on public.profiles
  for each row execute function public.clear_status_ownership_on_deactivation();

-- ============================================================
-- Rollback: see supabase/rollbacks/
-- 20260810101000_rls_rpc_identity_and_queue_rollback.sql
-- ============================================================
