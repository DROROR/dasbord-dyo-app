-- Support ticket deployment tracking.
--
-- Support board tasks are created by the create-support-ticket edge function
-- on behalf of the web-admin app. Until now, the originating Firebase
-- ticket_id and app_id were only embedded as plain text in the task
-- description — not queryable. This migration promotes them to proper columns
-- so the dashboard can reference them when triggering the deployed-to-admin
-- notification back to Firebase.
--
-- Two deployment-state columns are also added:
--   deployed_to_admin — flipped to true when a developer marks the fix as
--                       live in the admin's app.
--   update_message    — the human-readable release note written by the
--                       developer (e.g. "We fixed X — please recheck.").
--
-- All four columns are nullable and default-safe so existing tasks and the
-- tasks: insert RLS policy are unaffected.

alter table public.tasks
  add column if not exists ticket_id        text,
  add column if not exists app_id           text,
  add column if not exists deployed_to_admin boolean not null default false,
  add column if not exists update_message   text;
