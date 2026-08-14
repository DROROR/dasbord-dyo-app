-- ================================================================
-- Personal collaboration: subtasks, targeted notifications and
-- atomic time logging for task participants.
--
-- Prepared for review only. Do not deploy without explicit approval.
-- ================================================================

-- Notifications raised for an individual must not be visible to the
-- rest of the team. Legacy rows keep recipient_id NULL and therefore
-- remain shared, preserving the behaviour of existing system alerts.
alter table public.notifications
  add column if not exists recipient_id uuid references public.profiles(id) on delete cascade,
  add column if not exists subtask_id uuid;

create index if not exists notifications_recipient_id_idx
  on public.notifications (recipient_id, read, created_at desc);

drop policy if exists "notifications_select_authenticated" on public.notifications;
create policy "notifications_select_authenticated"
  on public.notifications for select
  to authenticated
  using (recipient_id is null or recipient_id = auth.uid());

drop policy if exists "notifications_update_authenticated" on public.notifications;
create policy "notifications_update_authenticated"
  on public.notifications for update
  to authenticated
  using (recipient_id is null or recipient_id = auth.uid())
  with check (recipient_id is null or recipient_id = auth.uid());

drop policy if exists "notifications_delete_authenticated" on public.notifications;
create policy "notifications_delete_authenticated"
  on public.notifications for delete
  to authenticated
  using (recipient_id is null or recipient_id = auth.uid());


-- One main task can contain several independently assigned pieces of work.
-- The parent task remains the object shown on My Board; these rows only
-- describe the participant's part inside it.
create table if not exists public.task_subtasks (
  id                     uuid primary key default gen_random_uuid(),
  task_id                uuid not null references public.tasks(id) on delete cascade,
  title                  text not null check (char_length(btrim(title)) between 1 and 500),
  description            text,
  status                 text not null default 'not_started'
                         check (status in ('not_started', 'in_progress', 'done')),
  assignee_id            uuid references public.profiles(id) on delete set null,
  assignee_name_snapshot text,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists task_subtasks_task_idx
  on public.task_subtasks (task_id, created_at);
create index if not exists task_subtasks_assignee_idx
  on public.task_subtasks (assignee_id, status, updated_at desc);

alter table public.task_subtasks enable row level security;

-- SECURITY DEFINER avoids an RLS recursion: the tasks SELECT policy below
-- needs to know whether the viewer owns a child row, while the child SELECT
-- policy also follows visibility of its parent task.
create or replace function public.is_task_collaborator(task_id_in uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.task_subtasks s
     where s.task_id = task_id_in
       and s.assignee_id = auth.uid()
       and s.status <> 'done'
  );
$$;

revoke execute on function public.is_task_collaborator(uuid) from public;
grant execute on function public.is_task_collaborator(uuid) to authenticated;

-- Keep every task with its original assignee while additionally exposing the
-- full parent task to the employee assigned to one of its active subtasks.
drop policy if exists "tasks: view" on public.tasks;
create policy "tasks: view" on public.tasks for select
  using (
    has_permission('work', 'view') and (
      has_board_access(board, 'view')
      or status_owner_of(board, status) = auth.uid()
      or public.is_task_collaborator(id)
      or (
        is_technical_support_staff()
        and not claimed
        and status not in ('done', 'archived')
        and task_eligible_for_support_queue(id)
      )
    )
  );

create policy "task_subtasks: view" on public.task_subtasks for select
  using (
    has_permission('work', 'view') and (
      assignee_id = auth.uid()
      or exists (select 1 from public.tasks t where t.id = task_id)
    )
  );


-- Full board editors manage the structure. An assigned participant may only
-- change the status of their own row; they cannot silently rename or reassign
-- somebody else's work.
create or replace function public.create_task_subtask(
  task_id_in uuid,
  title_in text,
  description_in text,
  assignee_id_in uuid
)
returns public.task_subtasks
language plpgsql security definer set search_path = public
as $$
declare
  v_board text;
  v_assignee_name text;
  v_assignee_owner boolean;
  v_assignee_active boolean;
  v_access jsonb;
  v_row public.task_subtasks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select t.board into v_board from public.tasks t where t.id = task_id_in;
  if v_board is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if not has_permission('work', 'edit') or not has_board_access(v_board, 'full') then
    raise exception 'insufficient access to create a subtask' using errcode = '42501';
  end if;

  if nullif(btrim(title_in), '') is null or char_length(btrim(title_in)) > 500 then
    raise exception 'subtask title must contain 1 to 500 characters' using errcode = '22023';
  end if;

  select p.name, p.is_owner, p.is_active
    into v_assignee_name, v_assignee_owner, v_assignee_active
    from public.profiles p
   where p.id = assignee_id_in;

  if not found or not v_assignee_active then
    raise exception 'subtask assignee must be an active profile' using errcode = '22023';
  end if;

  select b.access into v_access from public.boards b where b.id = v_board;
  if not v_assignee_owner
     and board_access_rank(coalesce(v_access ->> assignee_id_in::text, 'none')) < board_access_rank('view') then
    raise exception 'subtask assignee must have access to the task board' using errcode = '22023';
  end if;

  insert into public.task_subtasks (
    task_id, title, description, assignee_id, assignee_name_snapshot, created_by
  ) values (
    task_id_in, btrim(title_in), nullif(btrim(description_in), ''),
    assignee_id_in, v_assignee_name, auth.uid()
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.update_task_subtask(
  subtask_id_in uuid,
  title_in text,
  description_in text,
  status_in text,
  assignee_id_in uuid
)
returns public.task_subtasks
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.task_subtasks%rowtype;
  v_board text;
  v_can_manage boolean;
  v_assignee_name text;
  v_assignee_owner boolean;
  v_assignee_active boolean;
  v_access jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into v_row from public.task_subtasks where id = subtask_id_in for update;
  if not found then
    raise exception 'subtask not found' using errcode = 'P0002';
  end if;

  select t.board into v_board from public.tasks t where t.id = v_row.task_id;
  v_can_manage := has_permission('work', 'edit') and has_board_access(v_board, 'full');

  if not v_can_manage then
    if not has_permission('work', 'edit') or v_row.assignee_id is distinct from auth.uid() then
      raise exception 'insufficient access to update this subtask' using errcode = '42501';
    end if;
    if btrim(title_in) is distinct from v_row.title
       or nullif(btrim(description_in), '') is distinct from v_row.description
       or assignee_id_in is distinct from v_row.assignee_id then
      raise exception 'a participant may only update their subtask status' using errcode = '42501';
    end if;
  end if;

  if status_in not in ('not_started', 'in_progress', 'done') then
    raise exception 'invalid subtask status' using errcode = '22023';
  end if;

  if nullif(btrim(title_in), '') is null or char_length(btrim(title_in)) > 500 then
    raise exception 'subtask title must contain 1 to 500 characters' using errcode = '22023';
  end if;

  if assignee_id_in is not null then
    select p.name, p.is_owner, p.is_active
      into v_assignee_name, v_assignee_owner, v_assignee_active
      from public.profiles p
     where p.id = assignee_id_in;
    if not found or not v_assignee_active then
      raise exception 'subtask assignee must be an active profile' using errcode = '22023';
    end if;
    select b.access into v_access from public.boards b where b.id = v_board;
    if not v_assignee_owner
       and board_access_rank(coalesce(v_access ->> assignee_id_in::text, 'none')) < board_access_rank('view') then
      raise exception 'subtask assignee must have access to the task board' using errcode = '22023';
    end if;
  else
    v_assignee_name := null;
  end if;

  update public.task_subtasks
     set title = btrim(title_in),
         description = nullif(btrim(description_in), ''),
         status = status_in,
         assignee_id = assignee_id_in,
         assignee_name_snapshot = v_assignee_name,
         updated_at = now()
   where id = subtask_id_in
   returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.delete_task_subtask(subtask_id_in uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_board text;
begin
  select t.board into v_board
    from public.task_subtasks s
    join public.tasks t on t.id = s.task_id
   where s.id = subtask_id_in;

  if v_board is null then
    raise exception 'subtask not found' using errcode = 'P0002';
  end if;
  if not has_permission('work', 'edit') or not has_board_access(v_board, 'full') then
    raise exception 'insufficient access to delete this subtask' using errcode = '42501';
  end if;

  delete from public.task_subtasks where id = subtask_id_in;
end;
$$;

revoke execute on function public.create_task_subtask(uuid, text, text, uuid) from public;
revoke execute on function public.update_task_subtask(uuid, text, text, text, uuid) from public;
revoke execute on function public.delete_task_subtask(uuid) from public;
grant execute on function public.create_task_subtask(uuid, text, text, uuid) to authenticated;
grant execute on function public.update_task_subtask(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.delete_task_subtask(uuid) to authenticated;


-- Existing time entries already carry loggedById. This RPC keeps that design,
-- but provides an atomic append path for an assigned participant who can view
-- the whole task without granting them permission to edit the whole task row.
create or replace function public.add_task_time_entry(
  task_id_in uuid,
  entry_id_in text,
  date_in date,
  hours_in integer,
  minutes_in integer,
  note_in text default null,
  is_locked_in boolean default false,
  subtask_id_in uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_user_name text;
  v_entry jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not has_permission('work', 'edit') then
    raise exception 'insufficient work permission' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = task_id_in for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if not (
    has_board_access(v_task.board, 'full')
    or v_task.assignee_id = auth.uid()
    or public.is_task_collaborator(v_task.id)
  ) then
    raise exception 'you may only log time on a task assigned to you' using errcode = '42501';
  end if;

  if hours_in < 0 or minutes_in < 0 or minutes_in > 59 or (hours_in = 0 and minutes_in = 0) then
    raise exception 'invalid time duration' using errcode = '22023';
  end if;
  if nullif(btrim(entry_id_in), '') is null then
    raise exception 'time entry id is required' using errcode = '22023';
  end if;

  if subtask_id_in is not null and not exists (
    select 1 from public.task_subtasks s
     where s.id = subtask_id_in
       and s.task_id = task_id_in
       and s.assignee_id = auth.uid()
  ) then
    raise exception 'the selected subtask is not assigned to you' using errcode = '42501';
  end if;

  -- Timer retries are idempotent: the same locally-generated entry id is
  -- returned as already saved instead of being appended twice.
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_task.time_entries, '[]'::jsonb)) e
     where e->>'id' = entry_id_in
  ) then
    return coalesce(v_task.time_entries, '[]'::jsonb);
  end if;

  select p.name into v_user_name from public.profiles p where p.id = auth.uid();
  v_entry := jsonb_strip_nulls(jsonb_build_object(
    'id', entry_id_in,
    'date', date_in::text,
    'hours', hours_in,
    'minutes', minutes_in,
    'loggedBy', coalesce(v_user_name, 'Unknown'),
    'loggedById', auth.uid()::text,
    'note', nullif(btrim(note_in), ''),
    'isLocked', is_locked_in,
    'subtaskId', subtask_id_in,
    'createdAt', now()
  ));

  update public.tasks
     set time_entries = coalesce(time_entries, '[]'::jsonb) || jsonb_build_array(v_entry),
         updated_at = now()
   where id = task_id_in
   returning time_entries into v_task.time_entries;

  return v_task.time_entries;
end;
$$;

revoke execute on function public.add_task_time_entry(uuid, text, date, integer, integer, text, boolean, uuid) from public;
grant execute on function public.add_task_time_entry(uuid, text, date, integer, integer, text, boolean, uuid) to authenticated;


-- Assignment notifications are created server-side so every write path
-- (modal, quick edit or future integration) behaves identically.
create or replace function public.notify_task_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor_name text;
  v_recipient_name text;
begin
  if new.assignee_id is null
     or new.assignee_id is not distinct from auth.uid()
     or (tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id) then
    return new;
  end if;

  select name into v_actor_name from public.profiles where id = auth.uid();
  select name into v_recipient_name from public.profiles where id = new.assignee_id;
  insert into public.notifications (
    type, message, recipient, recipient_id, task_id, task_title
  ) values (
    'task_assigned',
    format('%s assigned you to "%s"', coalesce(v_actor_name, 'A team member'), new.title),
    v_recipient_name, new.assignee_id, new.id, new.title
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_task_assignment on public.tasks;
create trigger trg_notify_task_assignment
  after insert or update of assignee_id on public.tasks
  for each row execute function public.notify_task_assignment();

create or replace function public.notify_subtask_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor_name text;
  v_recipient_name text;
  v_task_title text;
begin
  if new.assignee_id is null
     or new.assignee_id is not distinct from auth.uid()
     or (tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id) then
    return new;
  end if;

  select name into v_actor_name from public.profiles where id = auth.uid();
  select name into v_recipient_name from public.profiles where id = new.assignee_id;
  select title into v_task_title from public.tasks where id = new.task_id;
  insert into public.notifications (
    type, message, recipient, recipient_id, task_id, task_title, subtask_id
  ) values (
    'subtask_assigned',
    format('%s assigned you the subtask "%s" in "%s"', coalesce(v_actor_name, 'A team member'), new.title, v_task_title),
    v_recipient_name, new.assignee_id, new.task_id, v_task_title, new.id
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_subtask_assignment on public.task_subtasks;
create trigger trg_notify_subtask_assignment
  after insert or update of assignee_id on public.task_subtasks
  for each row execute function public.notify_subtask_assignment();

create or replace function public.notify_status_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_owner_id uuid;
  v_owner_name text;
  v_actor_name text;
  v_status_label text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_owner_id := public.status_owner_of(new.board, new.status);
  if v_owner_id is null or v_owner_id is not distinct from auth.uid() then return new; end if;

  select name into v_owner_name from public.profiles where id = v_owner_id;
  select name into v_actor_name from public.profiles where id = auth.uid();
  select s->>'label' into v_status_label
    from public.boards b, jsonb_array_elements(b.statuses) s
   where b.id = new.board and s->>'id' = new.status
   limit 1;

  insert into public.notifications (
    type, message, recipient, recipient_id, task_id, task_title
  ) values (
    'status_owner_assigned',
    format('%s moved "%s" to %s', coalesce(v_actor_name, 'A team member'), new.title, coalesce(v_status_label, new.status)),
    v_owner_name, v_owner_id, new.id, new.title
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_status_owner on public.tasks;
create trigger trg_notify_status_owner
  after update of status on public.tasks
  for each row execute function public.notify_status_owner();
