-- Follow-up tasks for leads: the phone calls a person has to make, and has to
-- say the result of, before a follow-up chain is allowed to move on.
--
-- Purely additive. One new table, and one more allowed value ('paused') on a
-- status column whose table holds no rows that use anything else. No existing
-- row is read, changed or removed by this file.

create table if not exists public.lead_followup_tasks (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  -- The chain this call belongs to. Null for a stand-alone callback ("call me
  -- back in ten days") that is not part of any chain.
  progress_id   uuid references public.lead_sequence_progress(id) on delete cascade,
  -- Which call of the chain this is (1 = first attempt). Null for a callback.
  step_no       integer check (step_no is null or step_no between 1 and 20),
  due_at        timestamptz not null,
  status        text not null default 'open'
                check (status in ('open', 'done', 'cancelled')),
  outcome       text check (outcome is null or outcome in (
                  'no_answer', 'interested_later', 'not_ready',
                  'meeting', 'not_relevant', 'customer')),
  note          text,
  completed_at  timestamptz,
  completed_by  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- What the daily reminder asks for: everything still open, oldest first.
create index if not exists lead_followup_tasks_open_idx
  on public.lead_followup_tasks (due_at) where status = 'open';
create index if not exists lead_followup_tasks_lead_idx
  on public.lead_followup_tasks (lead_id);
create index if not exists lead_followup_tasks_progress_idx
  on public.lead_followup_tasks (progress_id);

-- A chain can have only one open copy of each call. Two people confirming the
-- same call at the same moment would otherwise each schedule the next one.
create unique index if not exists lead_followup_tasks_one_open_step
  on public.lead_followup_tasks (progress_id, step_no)
  where status = 'open' and progress_id is not null;

alter table public.lead_followup_tasks enable row level security;

-- Same gates as the leads themselves. There is deliberately no delete policy:
-- a task is finished, rescheduled or cancelled, never erased.
drop policy if exists "lead_followup_tasks: view"   on public.lead_followup_tasks;
drop policy if exists "lead_followup_tasks: insert" on public.lead_followup_tasks;
drop policy if exists "lead_followup_tasks: update" on public.lead_followup_tasks;
create policy "lead_followup_tasks: view" on public.lead_followup_tasks for select
  using (public.has_permission('leads', 'view'));
create policy "lead_followup_tasks: insert" on public.lead_followup_tasks for insert
  with check (public.has_permission('leads', 'edit'));
create policy "lead_followup_tasks: update" on public.lead_followup_tasks for update
  using (public.has_permission('leads', 'edit'))
  with check (public.has_permission('leads', 'edit'));

-- A chain can now be paused and picked up again. 'active', 'done' and
-- 'stopped' keep meaning exactly what they meant.
alter table public.lead_sequence_progress
  drop constraint if exists lead_sequence_progress_status_check;
alter table public.lead_sequence_progress
  add constraint lead_sequence_progress_status_check
  check (status in ('active', 'paused', 'done', 'stopped'));
