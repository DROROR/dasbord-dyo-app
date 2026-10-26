-- Team meetings: the shared list of Google Meet calls for a team split across
-- Israel, Pakistan and Ukraine, plus the weekly rules that fill it by itself.
--
-- Two tables, on purpose:
--
--   meeting_schedules  the standing rule — "every Monday 17:00 Pakistan time".
--                      A wall clock plus the zone it is read in, never an
--                      instant: 17:00 in Karachi stays 17:00 in Karachi when
--                      Israel or Ukraine change their clocks, which is exactly
--                      what a recurring team meeting means.
--
--   meetings           one real meeting. Each is a single timestamptz instant,
--                      so the three clocks the team sees are one moment shown
--                      three ways and cannot drift apart. Rows either come from
--                      a schedule (the worker creates them a fortnight ahead)
--                      or are set by hand for a one-off.
--
-- An occurrence can be edited like any other meeting — moved, given its own
-- link, cancelled. Doing so sets `customized`, and from then on the schedule
-- leaves that one alone: changing the rule rewrites only the untouched future
-- occurrences.
--
-- Each meeting warns twice — at remind_minutes (5 by default) and again at
-- final_remind_minutes (1) — on Slack and in the planner. The three
-- slack_*_sent_at stamps are what keeps the webhook from repeating itself: the
-- worker (server/meeting-reminders.mjs) posts only where the matching stamp is
-- still null and claims it in the same step, so a restart or a second copy of
-- the worker cannot double-post.

-- ── The standing weekly rules ──────────────────────────────────────────────────

create table if not exists public.meeting_schedules (
  id                   uuid primary key default gen_random_uuid(),
  title                text    not null,
  weekday              smallint not null,              -- 0 = Sunday … 6 = Saturday
  local_time           time    not null,               -- the wall clock, read in `timezone`
  timezone             text    not null default 'Asia/Jerusalem',
  duration_minutes     integer not null default 30,
  meet_link            text    not null default 'https://meet.google.com/bzt-qtnh-vds',
  notes                text,
  remind_minutes       integer not null default 5,
  final_remind_minutes integer not null default 1,
  active               boolean not null default true,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint meeting_schedules_weekday_check  check (weekday between 0 and 6),
  constraint meeting_schedules_duration_check check (duration_minutes between 5 and 600),
  constraint meeting_schedules_remind_check   check (remind_minutes between 1 and 180),
  constraint meeting_schedules_final_check    check (final_remind_minutes between 1 and remind_minutes),
  constraint meeting_schedules_title_check    check (length(btrim(title)) > 0),
  -- The three clocks the team actually works in. A zone name the server could
  -- not resolve would silently produce meetings at the wrong hour, and a check
  -- constraint may only hold an immutable expression, so the list is spelled
  -- out rather than handed to the time-zone database at write time.
  constraint meeting_schedules_timezone_check
    check (timezone in ('Asia/Jerusalem', 'Asia/Karachi', 'Europe/Kyiv'))
);

-- ── The meetings themselves ────────────────────────────────────────────────────

create table if not exists public.meetings (
  id                     uuid primary key default gen_random_uuid(),
  title                  text        not null,
  starts_at              timestamptz not null,          -- the instant
  duration_minutes       integer     not null default 30,
  meet_link              text        not null default 'https://meet.google.com/bzt-qtnh-vds',
  notes                  text,
  remind_minutes         integer     not null default 5,  -- first warning, minutes before the start
  final_remind_minutes   integer     not null default 1,  -- last call, minutes before the start
  input_timezone         text        not null default 'Asia/Jerusalem', -- the zone the time was typed in
  schedule_id            uuid        references public.meeting_schedules(id) on delete set null,
  occurrence_date        date,                          -- which day of the rule this row is
  customized             boolean     not null default false, -- edited by hand; the rule stops rewriting it
  created_by             uuid        references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  cancelled_at           timestamptz,                   -- soft cancel: the row stays, the meeting stops counting
  slack_created_sent_at  timestamptz,                   -- "new meeting" post
  slack_reminder_sent_at timestamptz,                   -- first warning post
  slack_final_sent_at    timestamptz,                   -- last call post
  constraint meetings_duration_check check (duration_minutes between 5 and 600),
  constraint meetings_remind_check   check (remind_minutes between 1 and 180),
  -- The last call can never sit before the first warning.
  constraint meetings_final_check    check (final_remind_minutes between 1 and remind_minutes),
  constraint meetings_title_check    check (length(btrim(title)) > 0),
  constraint meetings_input_timezone_check
    check (input_timezone in ('Asia/Jerusalem', 'Asia/Karachi', 'Europe/Kyiv'))
);

-- Every read is "the meetings around now, soonest first".
create index if not exists meetings_starts_at_idx on public.meetings (starts_at);

-- The worker's own query: rows still waiting for one of the three posts.
create index if not exists meetings_pending_slack_idx on public.meetings (starts_at)
  where cancelled_at is null
    and (slack_created_sent_at is null or slack_reminder_sent_at is null or slack_final_sent_at is null);

-- What makes filling the calendar idempotent: one row per rule per day, so the
-- worker can run every twenty seconds and still create each meeting once.
create unique index if not exists meetings_schedule_day_idx
  on public.meetings (schedule_id, occurrence_date)
  where schedule_id is not null and occurrence_date is not null;

-- ── Stamps ─────────────────────────────────────────────────────────────────────

-- created_by and updated_at are stamped server-side so they stay truthful no
-- matter what the client sends (same pattern as stamp_doc_attachment_uploader).
create or replace function public.stamp_meeting_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- A human touching an occurrence takes it out of the rule's hands. The
    -- worker's own writes (service_role, no auth.uid()) are not that.
    if tg_table_name = 'meetings' and auth.uid() is not null and new.schedule_id is not null
       and (new.starts_at <> old.starts_at or new.meet_link <> old.meet_link
            or new.title <> old.title or new.duration_minutes <> old.duration_minutes
            or new.notes is distinct from old.notes or new.cancelled_at is distinct from old.cancelled_at) then
      new.customized := true;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_stamp_meeting_row on public.meetings;
create trigger trg_stamp_meeting_row
  before insert or update on public.meetings
  for each row execute function public.stamp_meeting_row();

create or replace function public.stamp_meeting_schedule_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_stamp_meeting_schedule_row on public.meeting_schedules;
create trigger trg_stamp_meeting_schedule_row
  before insert or update on public.meeting_schedules
  for each row execute function public.stamp_meeting_schedule_row();

-- Moving a meeting (or un-cancelling it) has to let Slack speak again, or the
-- team would get the old time and nothing else. Clearing the stamps here, in
-- the database, means every path that edits a meeting gets this for free.
create or replace function public.reset_meeting_slack_stamps()
returns trigger language plpgsql as $$
begin
  if new.starts_at <> old.starts_at
     or new.meet_link <> old.meet_link
     or (old.cancelled_at is not null and new.cancelled_at is null) then
    new.slack_created_sent_at  := null;
    new.slack_reminder_sent_at := null;
    new.slack_final_sent_at    := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_meeting_slack_stamps on public.meetings;
create trigger trg_reset_meeting_slack_stamps
  before update on public.meetings
  for each row execute function public.reset_meeting_slack_stamps();

-- ── Changing a rule ────────────────────────────────────────────────────────────

-- When the rule moves — a different day, hour, zone, link or duration, or it is
-- switched off or deleted — its future occurrences that nobody has touched are
-- cleared away, and the worker lays down the new ones within the next pass.
-- Occurrences already under way, already past, or edited by hand are left
-- exactly as they are: the rule never overwrites somebody's own adjustment, and
-- never removes a meeting the team is already in.
create or replace function public.clear_future_schedule_meetings()
returns trigger language plpgsql as $$
declare
  rule_id uuid := coalesce(old.id, new.id);
begin
  if tg_op = 'UPDATE'
     and new.weekday = old.weekday and new.local_time = old.local_time
     and new.timezone = old.timezone and new.active = old.active
     and new.duration_minutes = old.duration_minutes and new.meet_link = old.meet_link
     and new.title = old.title and new.notes is not distinct from old.notes
     and new.remind_minutes = old.remind_minutes and new.final_remind_minutes = old.final_remind_minutes then
    return new;
  end if;

  delete from public.meetings
   where schedule_id = rule_id
     and customized = false
     and starts_at > now();

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_clear_future_schedule_meetings on public.meeting_schedules;
create trigger trg_clear_future_schedule_meetings
  after update or delete on public.meeting_schedules
  for each row execute function public.clear_future_schedule_meetings();

-- ── Who may see and set what ───────────────────────────────────────────────────

alter table public.meetings          enable row level security;
alter table public.meeting_schedules enable row level security;

drop policy if exists "meetings: view"   on public.meetings;
drop policy if exists "meetings: insert" on public.meetings;
drop policy if exists "meetings: update" on public.meetings;
drop policy if exists "meetings: delete" on public.meetings;

-- Gated on the existing 'work' module, not a new one: the meeting list is the
-- team's own working calendar and is reached from the top bar on every page.
-- Anyone who can see Work sees the meetings; anyone who can edit Work can set,
-- move and cancel them.
create policy "meetings: view" on public.meetings for select
  using (has_permission('work', 'view'));

create policy "meetings: insert" on public.meetings for insert
  with check (has_permission('work', 'edit'));

create policy "meetings: update" on public.meetings for update
  using (has_permission('work', 'edit')) with check (has_permission('work', 'edit'));

create policy "meetings: delete" on public.meetings for delete
  using (has_permission('work', 'edit'));

drop policy if exists "meeting_schedules: view"   on public.meeting_schedules;
drop policy if exists "meeting_schedules: insert" on public.meeting_schedules;
drop policy if exists "meeting_schedules: update" on public.meeting_schedules;
drop policy if exists "meeting_schedules: delete" on public.meeting_schedules;

create policy "meeting_schedules: view" on public.meeting_schedules for select
  using (has_permission('work', 'view'));

create policy "meeting_schedules: insert" on public.meeting_schedules for insert
  with check (has_permission('work', 'edit'));

create policy "meeting_schedules: update" on public.meeting_schedules for update
  using (has_permission('work', 'edit')) with check (has_permission('work', 'edit'));

create policy "meeting_schedules: delete" on public.meeting_schedules for delete
  using (has_permission('work', 'edit'));

revoke all on public.meetings          from anon;
revoke all on public.meeting_schedules from anon;
grant select, insert, update, delete on public.meetings          to authenticated;
grant select, insert, update, delete on public.meeting_schedules to authenticated;
