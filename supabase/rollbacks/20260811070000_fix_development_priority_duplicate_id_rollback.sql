-- ============================================================
-- Rollback for 20260811070000_fix_development_priority_duplicate_id.sql
--
-- Drops the new unique-priority-id guard trigger/function — restores
-- the ability to save a board with duplicate priority ids (the prior,
-- unguarded behavior).
--
-- Deliberately does NOT revert the "normal" id back to "high" — doing
-- so would automatically RE-INTRODUCE the exact ambiguous duplicate
-- this migration fixed, which is never the right default for a
-- rollback (same principle already applied elsewhere in this
-- project: a rollback should never automatically re-open a fixed
-- defect). If reverting the id itself is genuinely intended, that is
-- a separate, explicit, manually-run decision:
--
--   update public.boards
--      set priorities = (
--        select jsonb_agg(
--          case when p->>'id' = 'normal' then jsonb_set(p, '{id}', '"high"'::jsonb) else p end
--          order by ord
--        )
--        from jsonb_array_elements(priorities) with ordinality as arr(p, ord)
--      )
--    where id = 'development';
--
-- Never run automatically as part of this rollback.
-- ============================================================

drop trigger if exists trg_enforce_unique_priority_ids on public.boards;
drop function if exists public.enforce_unique_priority_ids();
