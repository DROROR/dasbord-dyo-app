-- ============================================================
-- 005b: Configurable shared-support-queue eligibility — replaces the
-- hardcoded "board id = 'support'" / "priority = 'critical' or label
-- matches /urgent|דחוף/i" checks with explicit, admin-configurable
-- flags on boards and priority definitions.
--
-- Live audit performed before writing this migration (read-only):
-- every board's priorities were inspected. Two boards
-- (app_production, development) have an explicitly stored 4-tier
-- scheme: critical/high/medium/low. The other three
-- (apps_to_update_pfcpmlwc, prosperity, support) have an empty
-- stored priorities array and fall back to the frontend's
-- DEFAULT_PRIORITY_DEFS constant at read time (same 4 ids). No
-- priority anywhere is named "Urgent" or contains "דחוף" — the only
-- id that ever matched the old regex/critical check is 'critical'.
-- This mapping is unambiguous: showInSupportQueue = true only for
-- id='critical', false for the other three, on every board. The
-- DEFAULT_PRIORITY_DEFS frontend constant is updated identically in
-- this same change so the three empty-array boards behave the same
-- way without needing their own stored array.
-- ============================================================

alter table public.boards
  add column if not exists all_tasks_to_support_queue boolean not null default false;

-- The existing boards column-lockdown (20260809150000) grants
-- UPDATE(name, statuses, priorities) only — a newly added column is
-- NOT automatically included in that list. This board setting belongs
-- in the same "editable by a full-access board admin" group as those
-- three, so it needs its own explicit grant.
grant update (all_tasks_to_support_queue) on public.boards to authenticated;

-- Backfill: the existing Support Tickets board is the one place every
-- task currently enters the shared queue regardless of priority.
update public.boards
   set all_tasks_to_support_queue = true
 where id = 'support';

-- Backfill: showInSupportQueue on every stored priority definition,
-- true only for id='critical' (the only value that ever drove the old
-- hardcoded check). Boards with an empty priorities array are
-- untouched here — they inherit the updated DEFAULT_PRIORITY_DEFS
-- constant on the frontend instead.
update public.boards b
   set priorities = (
     select jsonb_agg(
       p || jsonb_build_object('showInSupportQueue', (p->>'id') = 'critical')
       order by ord
     )
     from jsonb_array_elements(b.priorities) with ordinality as arr(p, ord)
   )
 where jsonb_array_length(b.priorities) > 0;

-- ============================================================
-- Rollback: see supabase/rollbacks/
-- 20260810100500_support_queue_config_rollback.sql
-- ============================================================
