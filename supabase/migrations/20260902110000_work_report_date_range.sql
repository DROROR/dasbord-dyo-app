create or replace function public.get_work_report_range(report_start date, report_end date)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_range_start timestamptz;
  v_range_end   timestamptz;
  v_result    jsonb;
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

  if not public.has_work_report_access() then
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
  ),
  time_entries_today as (
    select
      t.id as task_id, t.title, t.board,
      (te->>'loggedById')::uuid as logged_by_id,
      (coalesce((te->>'hours')::numeric, 0) + coalesce((te->>'minutes')::numeric, 0) / 60.0) as entry_hours
    from public.tasks t, jsonb_array_elements(coalesce(t.time_entries, '[]'::jsonb)) te
    where te->>'date' between report_start::text and report_end::text
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

