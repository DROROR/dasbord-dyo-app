-- Three-level Work Report access. Existing grants remain View All.
alter table public.work_report_access
  add column if not exists access_level text not null default 'view_all';

alter table public.work_report_access drop constraint if exists work_report_access_level_check;
alter table public.work_report_access add constraint work_report_access_level_check
  check (access_level in ('view_all', 'personal'));

drop policy if exists "work_report_access: owner can update" on public.work_report_access;
create policy "work_report_access: owner can update" on public.work_report_access for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner));

revoke all on public.work_report_access from public, anon, authenticated;
grant select, insert, update, delete on public.work_report_access to authenticated;

create or replace function public.work_report_access_level()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when p.is_owner then 'view_all' else coalesce(w.access_level, 'none') end
      from public.profiles p
      left join public.work_report_access w on w.profile_id = p.id
     where p.id = auth.uid() and p.is_active
  ), 'none');
$$;

revoke execute on function public.work_report_access_level() from public, anon;
grant execute on function public.work_report_access_level() to authenticated;

create or replace function public.has_work_report_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.work_report_access_level() <> 'none';
$$;

revoke execute on function public.has_work_report_access() from public, anon;
grant execute on function public.has_work_report_access() to authenticated;

create or replace function public.get_work_report_range(report_start date, report_end date)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_range_start timestamptz;
  v_range_end   timestamptz;
  v_result    jsonb;
  v_access_level text;
  v_viewer_id uuid;
begin
  if report_start is null or report_end is null then
    raise exception 'report_start and report_end are required' using errcode = '22023';
  end if;
  if report_start < date '2020-01-01' or report_end > (current_date + 1) or report_start > report_end then
    raise exception 'report range is invalid' using errcode = '22023';
  end if;
  if report_end - report_start > 366 then
    raise exception 'report range cannot exceed one year' using errcode = '22023';
  end if;

  v_viewer_id := auth.uid();
  v_access_level := public.work_report_access_level();
  if v_access_level = 'none' then
    raise exception 'insufficient access to the work report' using errcode = '42501';
  end if;

  v_range_start := (report_start::timestamp) at time zone 'Asia/Jerusalem';
  v_range_end   := ((report_end + 1)::timestamp) at time zone 'Asia/Jerusalem';

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
    where e.changed_at >= v_range_start and e.changed_at < v_range_end
      and (v_access_level = 'view_all' or exists (select 1 from public.tasks assigned where assigned.id = e.task_id and assigned.assignee_id = v_viewer_id))
  ),
  time_entries_today as (
    select
      t.id as task_id, t.title, t.board,
      (te->>'loggedById')::uuid as logged_by_id,
      (coalesce((te->>'hours')::numeric, 0) + coalesce((te->>'minutes')::numeric, 0) / 60.0) as entry_hours
    from public.tasks t, jsonb_array_elements(coalesce(t.time_entries, '[]'::jsonb)) te
    where te->>'date' between report_start::text and report_end::text
      and (v_access_level = 'view_all' or t.assignee_id = v_viewer_id)
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
    'reportDate', report_end,
    'reportStart', report_start,
    'reportEnd', report_end,
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

revoke execute on function public.get_work_report_range(date, date) from public;
revoke execute on function public.get_work_report_range(date, date) from anon;
grant  execute on function public.get_work_report_range(date, date) to authenticated;


-- Cached/older clients using the daily RPC receive the same access-level enforcement.
create or replace function public.get_work_report(report_date date)
returns jsonb
language sql security definer stable set search_path = public as $$
  select public.get_work_report_range(report_date, report_date);
$$;

revoke execute on function public.get_work_report(date) from public, anon;
grant execute on function public.get_work_report(date) to authenticated;
