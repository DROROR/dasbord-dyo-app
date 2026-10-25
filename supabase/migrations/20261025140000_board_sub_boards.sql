-- Sub-boards: a board may sit inside another board and render as a tab there.
--
-- Deliberately NOT how the Support board's two tabs work. Those are a view
-- over one board, split by a per-task field (tasks.ticket_kind, else the
-- admin's category) — copying that mechanism for existing boards would mean
-- merging them into one and rewriting every task's `board`, which moves data.
--
-- Here a sub-board stays a whole, ordinary board: same id, same tasks, same
-- statuses, priorities, access and support-queue flag. Nothing about a task
-- changes — `tasks.board` still names the sub-board. Only where the board is
-- DRAWN changes: out of the top strip, into a tab inside its parent. Clearing
-- parent_board_id puts it back in the top strip exactly as it is today, so the
-- whole feature is reversible without touching a row of task data.
alter table public.boards
  add column if not exists parent_board_id text;

-- The parent must be a board that exists. ON DELETE SET NULL so deleting a
-- parent releases its children back to the top strip rather than leaving them
-- pointing at a board that is gone — there is no app code that has to
-- remember to do this, and no window in which a board is unreachable.
alter table public.boards drop constraint if exists boards_parent_board_id_fkey;
alter table public.boards add constraint boards_parent_board_id_fkey
  foreign key (parent_board_id) references public.boards(id) on delete set null;

-- A board can never be its own parent.
alter table public.boards drop constraint if exists boards_parent_not_self_check;
alter table public.boards add constraint boards_parent_not_self_check
  check (parent_board_id is null or parent_board_id <> id);

create index if not exists boards_parent_board_id_idx
  on public.boards (parent_board_id) where parent_board_id is not null;

-- Exactly one level of nesting, which also rules out every cycle: a cycle
-- needs each board in it to have a parent, and the first rule below forbids
-- choosing a parent that already has one.
--
-- The access check is the parent side only. Reparenting a board is an UPDATE
-- on that board, so the "boards: update" policy already demands work:'full'
-- plus full access to the board being moved; without this, a member could file
-- their board inside a board they cannot even see. Skipped for a connection
-- with no authenticated user (psql, migrations) and for service_role, the same
-- exemption enforce_board_access_rules() makes, so admin paths never break.
create or replace function public.enforce_board_nesting()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_board_id is null then
    return new;
  end if;

  if exists (
    select 1 from public.boards b
     where b.id = new.parent_board_id and b.parent_board_id is not null
  ) then
    raise exception 'that board is already a sub-board, so it cannot hold sub-boards of its own'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.boards b where b.parent_board_id = new.id) then
    raise exception 'this board holds sub-boards, so it cannot become one itself'
      using errcode = '22023';
  end if;

  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.has_board_access(new.parent_board_id, 'view')
  then
    raise exception 'you do not have access to the board you are filing this one under'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_board_nesting on public.boards;
create trigger trg_enforce_board_nesting
  before insert or update of parent_board_id on public.boards
  for each row execute function public.enforce_board_nesting();

-- UPDATE on public.boards is granted column by column (the table-level grant
-- deliberately withholds it, which is how `access` stays non-client-writable).
-- Without this the dashboard could read parent_board_id but never set it.
grant update (parent_board_id) on public.boards to authenticated;

comment on column public.boards.parent_board_id is
  'The board this one is nested inside, drawn as a tab there; null means a top-level board. One level only (enforced by enforce_board_nesting). Never affects tasks.board — a sub-board keeps all of its own tasks, statuses, priorities and access.';
