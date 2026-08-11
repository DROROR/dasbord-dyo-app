-- ============================================================
-- 008: Server-side validation for tasks.assignee_id.
--
-- Audit finding: a direct client UPDATE to tasks (gated only by the
-- existing "tasks: update" RLS policy — has_permission('work','edit')
-- AND has_board_access(board,'full')) can currently set assignee_id to
-- ANY uuid at all — an inactive profile, a profile with no access to
-- that task's board, or even a value that doesn't correspond to any
-- profile row. Nothing in the schema validates the CONTENT of
-- assignee_id today, only whether the caller is allowed to write to
-- the row at all. This migration closes that gap with a BEFORE
-- trigger, independent of and additive to the existing RLS policy —
-- it does not relax or replace any policy.
--
-- Eligibility mirrors eligibleAssigneesForBoard() (src/types/work.ts),
-- the client-side mirror used to populate the quick-edit/assignee
-- pickers, so the UI and the DB never disagree about who is a valid
-- assignee:
--   - NULL (unassigned) is always allowed — both assignee_id AND
--     assignee are nulled together, so a genuine unassign never
--     leaves a stale display name paired with no UUID.
--   - The active Owner is always allowed, regardless of board access.
--   - Any other active, non-owner profile is allowed only if they hold
--     explicit board access above 'none' on the task's board.
--   - An active technical-support staff member claiming a genuinely
--     shared-queue-eligible task (see claim_task() below) is also
--     allowed, independent of board access — this exists because
--     claim_task() itself sets assignee_id = auth.uid() for exactly
--     this case, and RLS's own "tasks: view" policy already grants
--     technical-support staff visibility into unclaimed queue-eligible
--     tasks independent of board access; without this branch,
--     claim_task() would start failing for any technical-support
--     staffer who lacks an explicit board.access entry, which would
--     be a functional regression, not a security tightening.
--   - Everything else is rejected.
--   - assignee (the display-name snapshot) is never trusted from the
--     client when assignee_id is supplied — it is always overwritten
--     here from the CURRENT, authoritative profiles.name of whichever
--     profile assignee_id resolved to. The one deliberate exception:
--     when assignee_id ends up NULL as a side effect of
--     derive_task_identity_from_text's own zero-match case (an
--     old-frontend caller typed a real, non-empty free-text name with
--     no matching profile), that name is genuine caller-provided data,
--     not a stale leftover — this trigger does not erase it, matching
--     derive's own "never guess, never destroy" convention documented
--     where it's defined.
--
-- Trigger execution order (both are BEFORE INSERT OR UPDATE on
-- tasks, so Postgres runs same-timing triggers in NAME order):
--   1. trg_derive_task_identity_from_text  ('d' < 'v')
--   2. trg_validate_task_assignee          (this one)
-- derive runs first and is the ONLY place assignee_id is ever derived
-- FROM a plain-text assignee change (old-frontend compatibility path);
-- when the caller already supplied assignee_id explicitly in the same
-- statement (every new-frontend write path, including the task-card
-- quick-edit and the fixed modal picker), derive's own guard
-- (`new.assignee_id is not distinct from old.assignee_id`) means it
-- does nothing at all. Either way, by the time this trigger runs,
-- assignee_id already holds its final, fully-resolved value for this
-- statement — validate_task_assignee is the single, final authority
-- that both enforces eligibility and re-syncs the paired display name
-- from that resolved UUID. This is a strictly one-directional
-- pipeline (text→uuid, then uuid→validated+authoritative-name) — at
-- no point does either trigger re-read or re-run after the other, so
-- they cannot clobber each other's writes.
-- ============================================================

-- Only validates a genuine assignee CHANGE (or a brand-new row via
-- INSERT) — an UPDATE that never touches assignee_id is never blocked
-- or altered by this trigger, even if the task's existing (unchanged)
-- assignee_id would not pass validation today (e.g. their board
-- access was revoked after the original assignment, or they were
-- deactivated). This is deliberate: the trigger governs new
-- assignments, it does not retroactively invalidate — or block
-- unrelated edits to — already-existing task data.
create or replace function public.validate_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;

  if new.assignee_id is null then
    -- Only null the display name if it's already empty — see the
    -- header note: a non-empty name here is real data an old-frontend
    -- caller just typed (derive_task_identity_from_text found no
    -- matching profile and correctly left assignee_id null without
    -- guessing), not a stale leftover to be silently erased.
    if coalesce(new.assignee, '') = '' then
      new.assignee := null;
    end if;
    new.assignee_id := null;
    return new;
  end if;

  -- Active Owner: unconditional, regardless of board access.
  select name into v_name from public.profiles
   where id = new.assignee_id and is_owner and is_active;
  if v_name is not null then
    new.assignee := v_name; -- authoritative — never the client-supplied text
    return new;
  end if;

  -- Active, non-owner profile with explicit board access above 'none'.
  select p.name into v_name
    from public.profiles p
    join public.boards b on b.id = new.board
   where p.id = new.assignee_id
     and p.is_active
     and not p.is_owner
     and board_access_rank(coalesce(b.access ->> p.id::text, 'none')) > board_access_rank('none');
  if v_name is not null then
    new.assignee := v_name;
    return new;
  end if;

  -- claim_task() compatibility (see header note): the claimant
  -- self-assigning a genuinely shared-queue-eligible task, mirroring
  -- the same board-access-independent bypass RLS already grants this
  -- exact class of user/task. Tightly scoped — the caller must BE the
  -- new assignee, the row must actually be claimed, and the task must
  -- actually be queue-eligible, so this can never become a general
  -- "any technical-support staffer can be assigned anywhere" hole.
  if new.assignee_id = auth.uid()
     and new.claimed
     and public.is_technical_support_staff()
     and public.task_eligible_for_support_queue(new.id)
  then
    select name into v_name from public.profiles where id = new.assignee_id and is_active;
    if v_name is not null then
      new.assignee := v_name;
      return new;
    end if;
  end if;

  raise exception 'assignee_id % is not an active profile with access to board %', new.assignee_id, new.board
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_validate_task_assignee on public.tasks;
create trigger trg_validate_task_assignee
  before insert or update on public.tasks
  for each row execute function public.validate_task_assignee();

-- ============================================================
-- Rollback: see supabase/rollbacks/
-- 20260811060000_task_assignee_validation_rollback.sql
-- ============================================================
