-- Slack has to hear about every change to a meeting, not only about the
-- meeting being set: postponed, brought forward, re-linked, cancelled, put
-- back. Up to now a change quietly cleared the "already posted" stamps and the
-- next pass announced it again as if it were brand new, which told the team the
-- new time but not that anything had moved.
--
-- Two columns carry that:
--
--   previous_starts_at   the time the team was last told, kept only until the
--                        "moved" post goes out. Its presence is what lets the
--                        worker say "was Mon 17:00, now Tue 18:00" instead of
--                        announcing the meeting a second time.
--   slack_cancel_sent_at the cancellation post, claimed the same way as the
--                        other three so it can never go out twice.
--
-- Duration also goes: nobody knows in advance how long a meeting will run, so
-- it is no longer asked for or shown. The column stays, at a flat hour, purely
-- as the point after which a meeting stops counting as live in the list.

alter table public.meetings
  add column if not exists previous_starts_at   timestamptz,
  add column if not exists slack_cancel_sent_at timestamptz;

alter table public.meetings          alter column duration_minutes set default 60;
alter table public.meeting_schedules alter column duration_minutes set default 60;

-- Bumping a rule's duration is still a change to the rule, so the "the rule
-- moved, lay its meetings down again" trigger would fire and sweep away six
-- already-announced meetings — which the worker would then recreate and
-- announce to Slack a second time. Nothing about the meetings themselves is
-- changing here, so the trigger is held back for exactly these two statements.
alter table public.meeting_schedules disable trigger trg_clear_future_schedule_meetings;
update public.meetings          set duration_minutes = 60 where duration_minutes = 30;
update public.meeting_schedules set duration_minutes = 60 where duration_minutes = 30;
alter table public.meeting_schedules enable trigger trg_clear_future_schedule_meetings;

-- The worker's sweep now has to find cancelled rows too, so it can post the
-- cancellation; the old index deliberately excluded them.
drop index if exists public.meetings_pending_slack_idx;
create index if not exists meetings_pending_slack_idx on public.meetings (starts_at)
  where slack_created_sent_at is null
     or slack_reminder_sent_at is null
     or slack_final_sent_at is null
     or (cancelled_at is not null and slack_cancel_sent_at is null);

create or replace function public.reset_meeting_slack_stamps()
returns trigger language plpgsql as $$
begin
  -- A move, a new link, or a meeting put back on: the team has to be told
  -- again, so every "already said this" stamp goes.
  if new.starts_at <> old.starts_at
     or new.meet_link <> old.meet_link
     or (old.cancelled_at is not null and new.cancelled_at is null) then
    -- Remember what they were last told, but only if they were told at all and
    -- only while an unsent "moved" notice is still waiting: a second move
    -- before the first notice goes out keeps pointing at the original time,
    -- which is the one the team actually has in their heads.
    if new.starts_at <> old.starts_at and old.slack_created_sent_at is not null
       and old.previous_starts_at is null then
      new.previous_starts_at := old.starts_at;
    end if;
    new.slack_created_sent_at  := null;
    new.slack_reminder_sent_at := null;
    new.slack_final_sent_at    := null;
  end if;

  -- Cancelled now, or put back: either way the cancellation notice is free to
  -- go out again next time it applies.
  if new.cancelled_at is distinct from old.cancelled_at then
    new.slack_cancel_sent_at := null;
  end if;

  return new;
end;
$$;
