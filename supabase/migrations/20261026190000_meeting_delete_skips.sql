-- Deleting a meeting has to mean deleted.
--
-- Cancelling keeps the row, strikes it out and tells Slack it is off, which is
-- right for a meeting the team was already expecting. But there was no way to
-- simply remove one, and a straight delete of a weekly occurrence would not
-- have worked anyway: the worker fills every rule day that has no row, so the
-- deleted one would reappear within twenty seconds.
--
-- A skip is the tombstone that makes it stick — the rule day the team decided
-- not to hold. The worker treats a skipped day as already dealt with.
--
-- The one delete that must NOT leave a tombstone is the rule's own rewrite:
-- when a rule moves, clear_future_schedule_meetings() sweeps its untouched
-- future rows so they can be laid down at the new time. That path announces
-- itself through a transaction-local setting, and the trigger below stands
-- aside for it.

create table if not exists public.meeting_schedule_skips (
  schedule_id     uuid not null references public.meeting_schedules(id) on delete cascade,
  occurrence_date date not null,
  skipped_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (schedule_id, occurrence_date)
);

create or replace function public.record_meeting_skip()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The rule rewriting its own future is not somebody skipping a day.
  if coalesce(current_setting('app.schedule_rewrite', true), '') = '1' then
    return old;
  end if;
  if old.schedule_id is not null and old.occurrence_date is not null then
    insert into public.meeting_schedule_skips (schedule_id, occurrence_date, skipped_by)
    values (old.schedule_id, old.occurrence_date, auth.uid())
    on conflict (schedule_id, occurrence_date) do nothing;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_record_meeting_skip on public.meetings;
create trigger trg_record_meeting_skip
  after delete on public.meetings
  for each row execute function public.record_meeting_skip();

-- The rewrite path, now flagged so the tombstone trigger lets it through.
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

  perform set_config('app.schedule_rewrite', '1', true);

  delete from public.meetings
   where schedule_id = rule_id
     and customized = false
     and starts_at > now();

  perform set_config('app.schedule_rewrite', '0', true);

  return coalesce(new, old);
end;
$$;

alter table public.meeting_schedule_skips enable row level security;

drop policy if exists "meeting_schedule_skips: view"   on public.meeting_schedule_skips;
drop policy if exists "meeting_schedule_skips: insert" on public.meeting_schedule_skips;
drop policy if exists "meeting_schedule_skips: delete" on public.meeting_schedule_skips;

create policy "meeting_schedule_skips: view" on public.meeting_schedule_skips for select
  using (has_permission('work', 'view'));

-- The rows are written by the trigger above, which runs as its definer; these
-- are here so a skipped day can be put back by hand later.
create policy "meeting_schedule_skips: insert" on public.meeting_schedule_skips for insert
  with check (has_permission('work', 'edit'));

create policy "meeting_schedule_skips: delete" on public.meeting_schedule_skips for delete
  using (has_permission('work', 'edit'));

revoke all on public.meeting_schedule_skips from anon;
grant select, insert, delete on public.meeting_schedule_skips to authenticated;
