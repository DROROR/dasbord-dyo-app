-- ============================================================
-- 006: Work Report — Owner-controlled daily team activity report.
--
-- Revised in place before any deployment (nothing in this file has
-- ever been pushed) after review: the first draft only logged
-- transitions INTO 'done'. That undercounts real daily activity — a
-- task moved through three statuses today but not yet finished
-- produced zero report signal. This revision logs EVERY real status
-- transition, not just completions; "tasks completed" becomes a
-- secondary count derived from the same event log rather than a
-- separate concept.
--
-- Audit performed before writing the original version of this
-- migration (still accurate, unaffected by this revision — see the
-- accompanying report for full detail):
--   - task completion/progress has never been recorded as a real
--     historical event anywhere in the existing schema.
--     tasks.status_history[] records {status, timestamp, changedBy}
--     but changedBy is a free-text display name, never a profile
--     UUID — the same unreliable-identity problem the assignee/
--     claimed_by migration (20260810100000) already solved for those
--     two fields. It cannot answer "who progressed this task" by UUID
--     for anything already in the database. This migration adds a
--     real, server-verified, append-only transition event log GOING
--     FORWARD (Part A) — it does not and cannot fabricate a
--     trustworthy actor UUID for transitions that already happened
--     before this trigger existed.
--   - live status IDs confirmed identical (query run before writing
--     this): all 5 boards use 'done' as the completed-status id,
--     every board's 'done' entry has canDelete=false (a protected,
--     stable convention, not board-specific admin content).
--   - the Support Tickets board's id is verified live as 'support'
--     (name "Support Tickets" is the admin-editable display label —
--     id is the stable identity, matching this project's established
--     id-vs-name convention used everywhere else).
--   - time_entries[] (tasks.time_entries jsonb) has never carried a
--     profile UUID — only loggedBy (free-text name), confirmed by
--     reading TimerContext.tsx and TaskDetailModal's manual-entry
--     path. Also confirmed: entries have no start/end timestamps,
--     only a summary {hours, minutes} duration tagged to a single
--     `date` (YYYY-MM-DD) — the day the timer was stopped (or the
--     manually-chosen day), never split across a midnight crossing.
--     Part C below adds an additive loggedById, backfilled only on an
--     exact unique profiles.name match — never guessed.
--
-- Second revision (consolidated pre-deployment review, still before
-- any push): closed 6 gaps found on re-audit, all still inside this
-- same pending file, no overlapping second model:
--   1. log_task_status_event() no longer logs anything on INSERT — a
--      task's creation (including an automated Support Ticket
--      creation) is no longer itself a reportable event; only a real
--      status-changing UPDATE is. This also means an automatically-
--      created Support Ticket is never counted as "handled" merely by
--      existing.
--   2. task_status_events now carries task_title_snapshot (not null)
--      and board_name_snapshot, captured at the moment of the
--      transition — get_work_report() no longer live-joins tasks for
--      display text, so a later task/board rename never rewrites a
--      historical row, and a later task DELETE never removes it from
--      history either (see next point).
--   3. task_id is now a plain uuid with NO foreign key to tasks(id) —
--      deliberately not even ON DELETE SET NULL. The only writer of
--      this table is the trigger below, which only ever inserts a
--      genuine task's own id, so referential correctness is already
--      guaranteed at write time without a DB-level FK; dropping the
--      FK means deleting a task can never cascade-delete, block, or
--      null out its historical events, and task_id stays a stable,
--      permanent dedup key forever (a deleted task's events keep
--      counting correctly toward that one task, never fragmenting).
--      The report still can't open a deleted task — that already
--      falls out of the frontend only ever offering "Open" for a
--      taskId present in its own currently-loaded, non-deleted task
--      list.
--   4. A new trg_enrich_time_entries_logged_by BEFORE trigger applies
--      the same "exact unique active-profile name match" rule from
--      the one-time Part C backfill to every future write, not just
--      historical rows — so an old-frontend entry saved after this
--      migration deploys still gets loggedById filled in going
--      forward. Unlike the one-time backfill (which intentionally
--      blocks the whole migration on an ambiguous name so it can be
--      resolved once, by hand, before cutover), the ongoing trigger
--      silently leaves loggedById unset on an ambiguous or unmatched
--      name — it must never abort an ordinary user's save over a
--      pre-existing data-quality edge case elsewhere. Neither path
--      ever touches hours/minutes/date/note/isLocked/createdAt/
--      loggedBy on any entry — only ever adds the one missing key.
--   5. work_report_access now also revokes all table-level privileges
--      from anon/public and grants authenticated only select/insert/
--      delete (no update — matches the "grant present or absent,
--      never edited" rule already documented below) — defense in
--      depth alongside the existing owner-only RLS policies, matching
--      how every SECURITY DEFINER function in this file already
--      revokes execute from anon explicitly rather than relying on
--      RLS/default-deny alone.
-- ============================================================


-- ================================================================
-- PART A — task_status_events: every real status transition, logged
-- ================================================================
-- Never read directly by any client — only get_work_report() (Part D)
-- may read it, via SECURITY DEFINER. RLS is enabled with zero
-- policies, so even a future accidental broad GRANT still returns no
-- rows to anyone querying the table directly.
--
-- One row per genuine status change only (from_status_id/to_status_id
-- differ) — a task's creation is never itself logged here (see the
-- second-revision header note), so from_status_id/from_status_label
-- are populated on every row this table will ever contain. Label
-- snapshots are captured AT THE MOMENT of the transition, resolved
-- from the board's current statuses[] — so a later rename of that
-- status or the board's other labels never rewrites what already
-- happened; the event keeps showing what the status was actually
-- called when it happened.
create table public.task_status_events (
  id                      uuid primary key default gen_random_uuid(),
  -- No foreign key on purpose (see the second-revision header note
  -- above) — the only writer is the trigger below, which always
  -- inserts a genuine task's own id, so referential correctness is
  -- guaranteed at write time. Never nulled, cascaded, or blocked by a
  -- later task deletion; stays a stable permanent dedup key.
  task_id                 uuid not null,
  -- Snapshot of the task's board at the moment of this transition —
  -- not a live join, so a task later moved to a different board
  -- doesn't retroactively change what board it was progressed on.
  board_id                text not null,
  -- Display-name snapshot of that board at the moment of the
  -- transition (via board_name_of() below) — a later board rename
  -- never rewrites what this event showed when it happened.
  board_name_snapshot     text,
  -- Snapshot of the task's title at the moment of the transition — a
  -- later task rename, or the task being deleted entirely, never
  -- changes or removes what this historical row displays.
  task_title_snapshot     text not null,
  from_status_id          text,
  from_status_label       text,
  to_status_id            text not null,
  to_status_label         text not null,
  -- The real authenticated actor who performed the UPDATE, from
  -- auth.uid() at trigger time — never client-supplied. NULL means a
  -- service-role/automation transition (e.g. a migration backfill, an
  -- n8n-driven change) — never guessed or invented as an employee.
  changed_by              uuid references public.profiles(id),
  -- Snapshot of the task's claimed_by_id AT THE MOMENT of this
  -- transition — shown alongside an event for context (e.g. "claimed
  -- by X") but deliberately NEVER used to override who actually
  -- performed the transition (changed_by) in any count — see the
  -- support-ticket attribution rule in Part D.
  claimed_by_id_at_change uuid references public.profiles(id),
  changed_at              timestamptz not null default now(),
  created_at              timestamptz not null default now()
);

alter table public.task_status_events enable row level security;
-- Deliberately zero policies: default-deny for every ordinary role.
-- Only SECURITY DEFINER functions (which bypass RLS on their own
-- queries, the same established pattern as every other gate function
-- in this project) can ever read this table.

create index task_status_events_task_id_idx    on public.task_status_events (task_id);
create index task_status_events_changed_at_idx on public.task_status_events (changed_at);
create index task_status_events_to_status_idx  on public.task_status_events (to_status_id);

-- Resolves a status id's current label from a specific board's
-- statuses[], falling back to the raw id if that status has since
-- been renamed away/removed from the board's config — a lookup
-- failure must never block logging the event itself. Internal helper
-- only (called from the trigger below under its own SECURITY
-- DEFINER context, which does not depend on grants); not meant to be
-- invoked directly, so not granted to authenticated.
create or replace function public.status_label_of(board_id_in text, status_id_in text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s->>'label' from public.boards b, jsonb_array_elements(b.statuses) s
      where b.id = board_id_in and s->>'id' = status_id_in limit 1),
    status_id_in
  );
$$;

revoke execute on function public.status_label_of(text, text) from public;
revoke execute on function public.status_label_of(text, text) from anon;

-- Resolves a board id's current display name, falling back to the raw
-- id if the board has since been renamed away/removed — same
-- never-block-the-event-on-a-lookup-miss guarantee as
-- status_label_of() above. Internal helper only, not granted to
-- authenticated.
create or replace function public.board_name_of(board_id_in text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.boards where id = board_id_in), board_id_in);
$$;

revoke execute on function public.board_name_of(text) from public;
revoke execute on function public.board_name_of(text) from anon;

-- Fires only on a real UPDATE where status actually changed — never
-- on INSERT (a task's creation, including an automatically-created
-- Support Ticket, is not itself a reportable event) and never on a
-- save that merely edits an unrelated field. Dynamic by construction:
-- it reads whatever statuses/board name actually exist via
-- status_label_of()/board_name_of() rather than any hard-coded list,
-- so a brand-new custom status an admin adds later is logged
-- correctly with zero code changes here. Works identically regardless
-- of which frontend (old or new) or code path performed the UPDATE —
-- a DB trigger fires on the write itself, not on any particular
-- client call site.
create or replace function public.log_task_status_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from_label  text;
  v_to_label    text;
  v_board_name  text;
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    v_from_label := public.status_label_of(old.board, old.status);
    v_to_label   := public.status_label_of(new.board, new.status);
    v_board_name := public.board_name_of(new.board);
    insert into public.task_status_events
      (task_id, board_id, board_name_snapshot, task_title_snapshot,
       from_status_id, from_status_label, to_status_id, to_status_label,
       changed_by, claimed_by_id_at_change)
    values
      (new.id, new.board, v_board_name, new.title,
       old.status, v_from_label, new.status, v_to_label,
       auth.uid(), new.claimed_by_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_task_status_event on public.tasks;
create trigger trg_log_task_status_event
  after insert or update on public.tasks
  for each row execute function public.log_task_status_event();


-- ================================================================
-- PART B — work_report_access: Owner-only grant/revoke, binary
-- ================================================================
-- Deliberately NOT modeled on the work_docs/boards access-map pattern
-- (a jsonb column + update-resource-access Edge Function): those
-- exist because any can_manage_permissions() admin may manage them,
-- which needs a service-role escalation. Work Report access may only
-- ever be granted or removed by the Owner — who already has a real,
-- unconditional authenticated session — so a plain is_owner-gated RLS
-- table is sufficient and smaller; no Edge Function needed. This is
-- also why the model is binary (a row exists = View; no row = No
-- Access) rather than a multi-level map: the report has exactly two
-- states, per the requirement.
create table public.work_report_access (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now()
);

alter table public.work_report_access enable row level security;

create policy "work_report_access: owner can view" on public.work_report_access for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner));

create policy "work_report_access: owner can grant" on public.work_report_access for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner));

create policy "work_report_access: owner can revoke" on public.work_report_access for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner));

-- No update policy: a grant is present or absent, never "edited".

-- Defense in depth alongside the RLS policies above: even if a future
-- accidental broad GRANT is ever applied at the schema level, anon
-- keeps zero privileges on this specific table, and authenticated
-- (which the Owner's own session is) gets only the three operations
-- the policies above actually allow — never update, truncate, or
-- references — matching how every SECURITY DEFINER function in this
-- file already revokes execute from anon explicitly rather than
-- trusting RLS/default-deny alone.
revoke all on public.work_report_access from public, anon;
grant select, insert, delete on public.work_report_access to authenticated;


-- ================================================================
-- PART C — additive loggedById on existing time_entries
-- ================================================================
-- Same "never guess, never fabricate" rule as the original identity
-- migration: an exact, UNIQUE, ACTIVE profiles.name match backfills
-- loggedById; zero matches leaves it unset (the entry stays
-- attributable by name only, exactly as it always displayed); more
-- than one active profile sharing that exact name stops the migration
-- with a clear exception rather than guessing. camelCase key
-- (loggedById), matching this project's established jsonb payload
-- convention (assigneeId, claimedById, ownerId, showInSupportQueue).
-- Scoped to ACTIVE profiles specifically (unlike the original task
-- identity backfill, which intentionally did not filter by is_active
-- for historical accuracy) because loggedById here directly feeds
-- live hour totals for a still-usable report — matching an inactive,
-- no-longer-real teammate would misattribute hours to an account that
-- can no longer be verified against; the entry simply stays
-- name-only in that case, same as a zero-match.
do $$
declare
  ambiguous_names text;
begin
  create temporary table _report_name_counts on commit drop as
    select name, count(*) as cnt from public.profiles where is_active group by name;

  select string_agg(distinct e->>'loggedBy', ', ') into ambiguous_names
    from public.tasks t, jsonb_array_elements(coalesce(t.time_entries, '[]'::jsonb)) e
    join _report_name_counts nc on nc.name = e->>'loggedBy'
    where nc.cnt > 1;

  if ambiguous_names is not null then
    raise exception 'time_entries loggedById backfill blocked — these names match more than one active profile: [%]. Resolve manually (rename a profile) before re-running.', ambiguous_names
      using errcode = 'P0001';
  end if;
end $$;

update public.tasks t
   set time_entries = (
     select jsonb_agg(
       case
         when e ? 'loggedById' then e
         else coalesce(
           (select e || jsonb_build_object('loggedById', p.id::text)
              from public.profiles p where p.name = e->>'loggedBy' and p.is_active),
           e
         )
       end
       order by ord
     )
     from jsonb_array_elements(coalesce(t.time_entries, '[]'::jsonb)) with ordinality as arr(e, ord)
   )
 where jsonb_array_length(coalesce(t.time_entries, '[]'::jsonb)) > 0;

-- Ongoing counterpart to the one-time backfill above: the backfill
-- only ever touches rows that already existed at migration time. The
-- old frontend is still deployed and keeps writing entries without
-- loggedById going forward, so this trigger applies the exact same
-- "unique active-profile name match" rule to every future write.
-- Unlike the one-time backfill, it never raises on an ambiguous name
-- — it silently leaves loggedById unset instead, because this fires
-- on an ordinary user's save and must never abort it over a
-- pre-existing data-quality edge case elsewhere; that entry simply
-- stays name-only, same as a zero-match. An entry that already
-- carries loggedById (from either the new frontend, which sets it
-- directly at write time, or a prior enrichment) is left byte-for-
-- byte untouched, and no entry's hours/minutes/date/note/isLocked/
-- createdAt/loggedBy is ever rewritten — only the one missing key is
-- ever added.
create or replace function public.enrich_time_entries_logged_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.time_entries is null or jsonb_array_length(new.time_entries) = 0 then
    return new;
  end if;

  new.time_entries := (
    select jsonb_agg(
      case
        when e ? 'loggedById' then e
        else coalesce(
          (select e || jsonb_build_object('loggedById', p.id::text)
             from public.profiles p
             where p.name = e->>'loggedBy' and p.is_active
               and (select count(*) from public.profiles p2
                      where p2.name = e->>'loggedBy' and p2.is_active) = 1),
          e
        )
      end
      order by ord
    )
    from jsonb_array_elements(new.time_entries) with ordinality as arr(e, ord)
  );
  return new;
end;
$$;

drop trigger if exists trg_enrich_time_entries_logged_by on public.tasks;
create trigger trg_enrich_time_entries_logged_by
  before insert or update of time_entries on public.tasks
  for each row execute function public.enrich_time_entries_logged_by();


-- ================================================================
-- PART D — has_work_report_access() and get_work_report() RPC
-- ================================================================
create or replace function public.has_work_report_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and ( p.is_owner
            or exists (select 1 from public.work_report_access wra where wra.profile_id = p.id) )
  );
$$;

revoke execute on function public.has_work_report_access() from public;
revoke execute on function public.has_work_report_access() from anon;
grant  execute on function public.has_work_report_access() to authenticated;

-- Single narrow RPC, returning only what the report needs: team
-- totals (including a dynamic status-destination breakdown and a
-- separate system/unattributed activity list) + a per-active-employee
-- breakdown with a full chronological transition timeline and time
-- entries for the given day — already scoped server-side. Never
-- grants the caller broader SELECT access to boards/tasks they
-- otherwise couldn't see — every underlying query here runs inside
-- this SECURITY DEFINER function, not as the caller's own RLS-scoped
-- session.
--
-- Counting rules (see accompanying report for full rationale):
--   - "tasks progressed" (team and per-employee) counts DISTINCT
--     task_id among today's events — a task transitioned 3 times
--     today, by the same or different employees, still counts once
--     team-wide; each employee who genuinely performed at least one
--     of those transitions counts it once on their own card. Reopen
--     + recomplete on the same day is the same rule: one task, one
--     count, however many events — but every individual event still
--     appears in the full timeline.
--   - "tickets handled" mirrors this, scoped to board_id = 'support'
--     (the verified stable board id — never a translated label).
--     Attribution is always the real transitioning actor
--     (changed_by), NEVER silently reassigned to claimed_by_id —
--     that field is only ever included in the timeline for display.
--   - the status breakdown counts individual events per destination
--     status (not distinct tasks) — "Moved to X: N" is a raw activity
--     count, a different question from the unique-task headline.
--   - system/unattributed transitions (changed_by is null — a
--     service-role or automation write) are surfaced in their own
--     section, never folded into any employee's numbers.
--
-- Reporting-day boundary: Asia/Jerusalem (per requirement — this
-- project has no other defined business timezone). Applied to
-- task_status_events.changed_at (a real, full-precision server
-- timestamptz this migration controls). NOT applied to
-- time_entries[].date: that field is a bare YYYY-MM-DD string with no
-- time-of-day, already computed client-side via a UTC date slice
-- (confirmed in TimerContext.tsx/TaskDetailModal) and already treated
-- as the authoritative "which day" value everywhere else in this app
-- (e.g. MyBoard's "hours this month" grouping) — matched literally
-- against report_date instead, so the report never disagrees with
-- the rest of the app about which day an entry belongs to. This is a
-- pre-existing, out-of-scope characterization, not a new gap
-- introduced here.
create or replace function public.get_work_report(report_date date)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_day_start timestamptz;
  v_day_end   timestamptz;
  v_result    jsonb;
begin
  if report_date is null then
    raise exception 'report_date is required' using errcode = '22023';
  end if;
  if report_date < date '2020-01-01' or report_date > (current_date + 1) then
    raise exception 'report_date out of range' using errcode = '22023';
  end if;

  if not public.has_work_report_access() then
    raise exception 'insufficient access to the work report' using errcode = '42501';
  end if;

  v_day_start := (report_date::timestamp) at time zone 'Asia/Jerusalem';
  v_day_end   := v_day_start + interval '1 day';

  with
  -- No join to tasks here on purpose: title/board display text comes
  -- entirely from the snapshot columns captured at transition time,
  -- so an event for a task that has since been renamed OR deleted
  -- still surfaces correctly here (see the second-revision header
  -- note). Whether it can still be *opened* is decided by the
  -- frontend, which only offers "Open" for a taskId present in its
  -- own currently-loaded, non-deleted task list.
  events_today as (
    select e.*
    from public.task_status_events e
    where e.changed_at >= v_day_start and e.changed_at < v_day_end
  ),
  time_entries_today as (
    select
      t.id as task_id, t.title, t.board,
      (te->>'loggedById')::uuid as logged_by_id,
      (coalesce((te->>'hours')::numeric, 0) + coalesce((te->>'minutes')::numeric, 0) / 60.0) as entry_hours
    from public.tasks t, jsonb_array_elements(coalesce(t.time_entries, '[]'::jsonb)) te
    where te->>'date' = report_date::text
  ),
  active_profiles as (
    select id, name from public.profiles where is_active
  ),
  team_tasks as (
    select distinct task_id from events_today
  ),
  team_support_tasks as (
    select distinct task_id from events_today where board_id = 'support'
  ),
  team_done_tasks as (
    select distinct task_id from events_today where to_status_id = 'done'
  ),
  status_breakdown as (
    select
      to_status_id,
      (array_agg(to_status_label order by changed_at desc))[1] as to_status_label,
      count(*) as cnt
    from events_today
    group by to_status_id
  ),
  employee_tasks as (
    select distinct changed_by as profile_id, task_id
    from events_today
    where changed_by is not null
  ),
  employee_support_tasks as (
    select distinct changed_by as profile_id, task_id
    from events_today
    where changed_by is not null and board_id = 'support'
  ),
  per_employee as (
    select
      ap.id, ap.name,
      coalesce((select count(*) from employee_tasks et where et.profile_id = ap.id), 0) as tasks_progressed,
      coalesce((select count(*) from employee_support_tasks est where est.profile_id = ap.id), 0) as tickets_handled,
      coalesce((select sum(entry_hours) from time_entries_today te where te.logged_by_id = ap.id), 0) as hours_worked
    from active_profiles ap
  ),
  employee_events as (
    select
      ev.changed_by as profile_id,
      jsonb_agg(jsonb_build_object(
        'taskId', ev.task_id, 'title', ev.task_title_snapshot, 'board', ev.board_name_snapshot,
        'fromStatusId', ev.from_status_id, 'fromStatusLabel', ev.from_status_label,
        'toStatusId', ev.to_status_id, 'toStatusLabel', ev.to_status_label,
        'changedAt', ev.changed_at, 'claimedById', ev.claimed_by_id_at_change
      ) order by ev.changed_at) as events
    from events_today ev
    where ev.changed_by is not null
    group by ev.changed_by
  ),
  employee_time as (
    select
      te.logged_by_id as profile_id,
      jsonb_agg(jsonb_build_object('taskId', te.task_id, 'title', te.title, 'board', te.board, 'hours', te.entry_hours)) as time_entries
    from time_entries_today te
    where te.logged_by_id is not null
    group by te.logged_by_id
  ),
  system_events as (
    select jsonb_agg(jsonb_build_object(
      'taskId', task_id, 'title', task_title_snapshot, 'board', board_name_snapshot,
      'fromStatusId', from_status_id, 'fromStatusLabel', from_status_label,
      'toStatusId', to_status_id, 'toStatusLabel', to_status_label,
      'changedAt', changed_at, 'claimedById', claimed_by_id_at_change
    ) order by changed_at) as events
    from events_today
    where changed_by is null
  )
  select jsonb_build_object(
    'reportDate', report_date,
    'timezone', 'Asia/Jerusalem',
    'team', jsonb_build_object(
      'tasksProgressed', (select count(*) from team_tasks),
      'ticketsHandled', (select count(*) from team_support_tasks),
      'tasksCompleted', (select count(*) from team_done_tasks),
      -- Excludes entries with no loggedById (pre-migration, unmatched
      -- legacy entries only — see Part C) so this total always
      -- reconciles exactly with the sum of the employee cards below,
      -- rather than silently including hours no card accounts for.
      'hoursWorked', coalesce((select sum(entry_hours) from time_entries_today where logged_by_id is not null), 0)
    ),
    'statusBreakdown', coalesce((
      select jsonb_agg(jsonb_build_object('statusId', to_status_id, 'statusLabel', to_status_label, 'count', cnt) order by cnt desc, to_status_id)
      from status_breakdown
    ), '[]'::jsonb),
    'systemActivity', coalesce((select events from system_events), '[]'::jsonb),
    'employees', (
      select jsonb_agg(jsonb_build_object(
        'id', pe.id, 'name', pe.name,
        'tasksProgressed', pe.tasks_progressed,
        'ticketsHandled', pe.tickets_handled,
        'hoursWorked', pe.hours_worked,
        'events', coalesce(ee.events, '[]'::jsonb),
        'timeEntries', coalesce(et.time_entries, '[]'::jsonb)
      ) order by pe.name)
      from per_employee pe
      left join employee_events ee on ee.profile_id = pe.id
      left join employee_time et on et.profile_id = pe.id
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_work_report(date) from public;
revoke execute on function public.get_work_report(date) from anon;
grant  execute on function public.get_work_report(date) to authenticated;

-- ============================================================
-- Rollback: see supabase/rollbacks/
-- 20260810110000_work_report_rollback.sql
-- ============================================================
