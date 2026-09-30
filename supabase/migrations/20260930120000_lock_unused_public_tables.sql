-- Lock unused legacy/public tables that were created without RLS.
-- These tables are not used by the DYO Planner app, but keeping them
-- avoids destructive cleanup while removing public anon/auth access.

alter table if exists public.kalshi_markets enable row level security;
alter table if exists public.mxb_institution_announcements enable row level security;
alter table if exists public.mxb_institutions enable row level security;
alter table if exists public.mxb_selection_members enable row level security;

revoke all on table public.kalshi_markets from anon, authenticated;
revoke all on table public.mxb_institution_announcements from anon, authenticated;
revoke all on table public.mxb_institutions from anon, authenticated;
revoke all on table public.mxb_selection_members from anon, authenticated;
