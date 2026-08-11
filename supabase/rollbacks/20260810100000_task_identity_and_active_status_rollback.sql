-- ============================================================
-- Rollback for 20260810100000_task_identity_and_active_status.sql
--
-- Non-destructive by design:
--  - tasks.assignee_id / tasks.claimed_by_id are NOT dropped and their
--    backfilled values are NOT cleared — this was real, audited
--    identity-mapping effort; dropping it would lose information for
--    no benefit (the columns are inert/unused again once the RLS/RPC
--    migration that reads them is also rolled back).
--  - boards.statuses[].ownerId IS stripped back out — this is fully
--    reversible without any loss, since the original owner (text)
--    key is never touched and remains authoritative again.
--  - profiles.is_active is only dropped if every row is still `true`
--    (i.e. deactivation was never actually used) — if any row was
--    ever set to false, dropping the column would silently discard
--    that fact, so this refuses and raises instead of guessing.
-- ============================================================

update public.boards b
   set statuses = (
     select jsonb_agg(s - 'ownerId' order by ord)
     from jsonb_array_elements(b.statuses) with ordinality as arr(s, ord)
   )
 where exists (select 1 from jsonb_array_elements(b.statuses) s where s ? 'ownerId');

do $$
begin
  if exists (select 1 from public.profiles where is_active = false) then
    raise exception 'refusing to drop profiles.is_active — at least one profile has is_active=false (deactivation has been used); dropping the column would silently lose that state. Resolve manually if this rollback is really intended.' using errcode = 'P0001';
  end if;
  alter table public.profiles drop column if exists is_active;
end $$;

-- tasks.assignee_id / tasks.claimed_by_id: deliberately left in place.
