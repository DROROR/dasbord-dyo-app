-- ============================================================
-- 005a: Stable UUID identity for task assignment/claiming/status
-- ownership, and profiles.is_active — additive only.
--
-- tasks.assignee / tasks.claimed_by / boards.statuses[].owner are all
-- free-text display-name snapshots. Renaming a user (a feature being
-- added alongside this migration) would silently orphan their own
-- task visibility if nothing else changed. This migration adds
-- authoritative UUID columns/keys alongside the existing text ones —
-- the text fields are kept as display/history fallbacks, never
-- removed, never overwritten with a guess.
--
-- Live mapping audit performed before writing this migration
-- (read-only, see the accompanying report for full detail):
--   tasks.assignee distinct values: 'Dror' (7, exact match: Owner,
--     9119ab55-b733-49b9-ad82-3e6e0f3f932e), 'Droror' (3, exact
--     match: dyoapp1, 6975acc8-2312-400e-aee3-68c896c2969a),
--     'droryosef1' (3, NO exact profile.name match — resembles the
--     Owner's email local-part but is not auto-mapped, see below),
--     'Fahad' (2, NO matching profile at all — mock/historical data),
--     'Prosperity' (13, exact match: akinpros,
--     d940b1af-a539-48fd-859d-851646d30cd3).
--   tasks.claimed_by distinct values: 'Dror' (1, exact match, same
--     UUID as above).
--   boards.statuses[].owner: exactly one status has an owner set —
--     development/pending_code_review = 'Droror' (exact match, same
--     UUID as above). Every other status on every board has no owner.
--   The two unmatched assignee values ('droryosef1' x3, 'Fahad' x2)
--   are ALL on already-archived tasks (confirmed live) — not active
--   assignments. The guard below only blocks on ACTIVE unmapped rows,
--   so it does not fire against current data; these 5 rows simply
--   keep assignee_id/claimed_by_id NULL and their original text intact.
-- ============================================================

alter table public.tasks
  add column if not exists assignee_id uuid references public.profiles(id),
  add column if not exists claimed_by_id uuid references public.profiles(id);

alter table public.profiles
  add column if not exists is_active boolean not null default true;

-- Guard: never guess. Fails loudly (rolling back the whole migration)
-- if any ACTIVE task's assignee/claimed_by, or any status owner
-- anywhere, doesn't match exactly one profile.name. Already-closed
-- (done/archived) tasks are exempt — see the header note above for
-- why that's exactly today's situation.
do $$
declare
  unmapped_assignees   text;
  ambiguous_assignees  text;
  unmapped_claimed     text;
  ambiguous_claimed    text;
  unmapped_owners      text;
  ambiguous_owners     text;
begin
  create temporary table _name_counts on commit drop as
    select name, count(*) as cnt from public.profiles group by name;

  select string_agg(distinct t.assignee, ', ') into unmapped_assignees
    from public.tasks t
    where t.assignee is not null and t.assignee <> ''
      and t.status not in ('done','archived')
      and not exists (select 1 from _name_counts nc where nc.name = t.assignee);

  select string_agg(distinct t.assignee, ', ') into ambiguous_assignees
    from public.tasks t join _name_counts nc on nc.name = t.assignee
    where t.status not in ('done','archived') and nc.cnt > 1;

  select string_agg(distinct t.claimed_by, ', ') into unmapped_claimed
    from public.tasks t
    where t.claimed_by is not null and t.claimed_by <> ''
      and t.status not in ('done','archived')
      and not exists (select 1 from _name_counts nc where nc.name = t.claimed_by);

  select string_agg(distinct t.claimed_by, ', ') into ambiguous_claimed
    from public.tasks t join _name_counts nc on nc.name = t.claimed_by
    where t.status not in ('done','archived') and nc.cnt > 1;

  select string_agg(distinct s->>'owner', ', ') into unmapped_owners
    from public.boards b, jsonb_array_elements(b.statuses) s
    where s->>'owner' is not null and s->>'owner' <> ''
      and not exists (select 1 from _name_counts nc where nc.name = s->>'owner');

  select string_agg(distinct s->>'owner', ', ') into ambiguous_owners
    from public.boards b, jsonb_array_elements(b.statuses) s
    join _name_counts nc on nc.name = s->>'owner'
    where nc.cnt > 1;

  if unmapped_assignees is not null or ambiguous_assignees is not null
     or unmapped_claimed is not null or ambiguous_claimed is not null
     or unmapped_owners is not null or ambiguous_owners is not null
  then
    raise exception 'identity backfill blocked — resolve manually before re-running (fix the profile name or the task/status text so exactly one profile matches). unmapped active assignees: [%], ambiguous (duplicate-name) assignees: [%], unmapped active claimed_by: [%], ambiguous claimed_by: [%], unmapped status owners: [%], ambiguous status owners: [%]',
      coalesce(unmapped_assignees,'none'), coalesce(ambiguous_assignees,'none'),
      coalesce(unmapped_claimed,'none'), coalesce(ambiguous_claimed,'none'),
      coalesce(unmapped_owners,'none'), coalesce(ambiguous_owners,'none')
    using errcode = 'P0001';
  end if;
end $$;

-- Backfill: exact-name-match only, for ALL tasks/statuses (not just
-- active ones) — an already-closed task with a matchable name still
-- gets its UUID filled in for consistency; one with no match (the 5
-- archived rows above) simply keeps assignee_id/claimed_by_id NULL.
update public.tasks t
   set assignee_id = p.id
  from public.profiles p
 where p.name = t.assignee and t.assignee_id is null;

update public.tasks t
   set claimed_by_id = p.id
  from public.profiles p
 where p.name = t.claimed_by and t.claimed_by_id is null;

-- boards.statuses[].owner -> ownerId (camelCase, matching this
-- project's existing convention for jsonb payload keys like pillCls/
-- leftBorderCls/canDelete), added alongside the existing
-- owner text key (never removed), order-preserving.
update public.boards b
   set statuses = (
     select jsonb_agg(
       case
         when s ? 'owner' and (s->>'owner') <> '' then
           s || jsonb_build_object('ownerId', (select p.id from public.profiles p where p.name = s->>'owner'))
         else s
       end
       order by ord
     )
     from jsonb_array_elements(b.statuses) with ordinality as arr(s, ord)
   )
 where exists (
   select 1 from jsonb_array_elements(b.statuses) s where s ? 'owner' and (s->>'owner') <> ''
 );

-- ============================================================
-- Rollback: see supabase/rollbacks/
-- 20260810100000_task_identity_and_active_status_rollback.sql
-- ============================================================
