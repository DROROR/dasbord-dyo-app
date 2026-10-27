-- PostgREST upsert conflict resolution requires a unique CONSTRAINT, not just a
-- partial unique index. The existing notifications_dedupe_key_idx is partial
-- (WHERE dedupe_key IS NOT NULL), which PostgREST cannot use as an ON CONFLICT
-- target — it returns HTTP 400 on every deduped notification upsert.
--
-- Adding a full unique constraint (which PostgreSQL still allows multiple NULLs
-- through, so existing rows with NULL dedupe_key are unaffected) gives PostgREST
-- the handle it needs.

alter table public.notifications
  add constraint notifications_dedupe_key_unique unique (dedupe_key);
