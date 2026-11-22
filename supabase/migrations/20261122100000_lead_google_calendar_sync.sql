-- Two-way sync between lead meetings (leads.due_at) and the team's Google
-- Calendars, run by server/google-calendar-sync.mjs, plus a read-only copy of
-- every calendar's events so the leads calendar can show them.
--
-- google_synced_due_at is the meeting time Google last agreed with. While it
-- differs from due_at the dashboard holds a change Google has not seen yet,
-- which google_sync_pending exposes so the worker can query for it.

alter type public.lead_source add value if not exists 'website';

alter table public.leads
  add column if not exists google_event_id text,
  add column if not exists google_calendar_id text,
  add column if not exists google_synced_due_at timestamptz,
  add column if not exists meeting_ends_at timestamptz,
  add column if not exists google_sync_pending boolean
    generated always as (due_at is distinct from google_synced_due_at) stored;

create unique index if not exists leads_google_event_id_unique_idx
  on public.leads(google_event_id) where google_event_id is not null;
create index if not exists leads_google_sync_pending_idx
  on public.leads(id) where google_sync_pending;

-- Only upcoming meetings are sent to Google on the first run.
update public.leads
set google_synced_due_at = due_at
where due_at is not null and due_at < now();

-- position 0 is where meetings set on the dashboard are created.
create table if not exists public.google_calendars (
  calendar_id text primary key,
  name text,
  color text,
  position integer not null default 0,
  sync_token text,
  updated_at timestamptz not null default now()
);
alter table public.google_calendars enable row level security;
create policy "google calendars: view" on public.google_calendars for select
  using (public.has_permission('leads', 'view'));
-- The sync token is the worker's business only.
revoke select on public.google_calendars from anon, authenticated;
grant select (calendar_id, name, color, position) on public.google_calendars to authenticated;

create table if not exists public.google_calendar_events (
  calendar_id text not null references public.google_calendars(calendar_id) on delete cascade,
  event_id text not null,
  summary text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  html_link text,
  meet_link text,
  updated_at timestamptz not null default now(),
  primary key (calendar_id, event_id)
);
create index if not exists google_calendar_events_starts_at_idx on public.google_calendar_events(starts_at);
alter table public.google_calendar_events enable row level security;
create policy "google calendar events: view" on public.google_calendar_events for select
  using (public.has_permission('leads', 'view'));
