-- ============================================================
-- Rollback for 20260810100500_support_queue_config.sql
--
-- Unlike the identity migration, this data is fully re-derivable
-- (a deterministic classification flag, not authored/audited
-- content), so a clean full revert is safe here — no information is
-- lost that couldn't be recomputed by re-running the migration.
-- ============================================================

update public.boards b
   set priorities = (
     select jsonb_agg(p - 'showInSupportQueue' order by ord)
     from jsonb_array_elements(b.priorities) with ordinality as arr(p, ord)
   )
 where jsonb_array_length(b.priorities) > 0;

alter table public.boards drop column if exists all_tasks_to_support_queue;
