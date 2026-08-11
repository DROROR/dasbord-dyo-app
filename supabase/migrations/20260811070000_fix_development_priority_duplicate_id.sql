-- ============================================================
-- 009: Corrective fix for the known duplicate priority id "high" on
-- the `development` board, plus a server-side guard preventing this
-- from happening again on any board.
--
-- Live data confirmed immediately before writing this migration
-- (jsonb_pretty(priorities) for board id='development'):
--   1. critical / "Urgent"
--   2. high     / "This Week"   <- kept as-is
--   3. medium   / "Weekly Snack Task"
--   4. low      / "High"
--   5. high     / "Normal"      <- id changed to "normal" below
--   6. backlog  / "Backlog"
-- Exactly 2 tasks use priority='high' on this board (both
-- id 04c5e530-74f8-4a7a-b9bb-ea1831bb5981 and
-- cf7353a4-f0f8-42c9-8818-d044ef035796, both titled
-- "Test Task – Dummy Entry", both status='archived') — reported to
-- the user as genuinely ambiguous (dummy/test data, no content
-- indicating which of "This Week"/"Normal" was intended) rather than
-- guessed. Per the user's explicit decision: "This Week" keeps id
-- "high", so both of those archived dummy tasks now unambiguously
-- resolve to "This Week" — no task row is read, updated, or deleted
-- by this migration; only the one duplicate priority OBJECT's id
-- changes.
-- ============================================================

do $$
declare
  v_priorities  jsonb;
  v_count_total int;
  v_count_high  int;
  v_this_week   jsonb;
  v_normal      jsonb;
begin
  select priorities into v_priorities from public.boards where id = 'development';

  if v_priorities is null then
    raise exception 'development board has no priorities array — aborting, nothing changed';
  end if;

  v_count_total := jsonb_array_length(v_priorities);
  select count(*) into v_count_high from jsonb_array_elements(v_priorities) p where p->>'id' = 'high';

  -- Fail loudly rather than silently doing the wrong thing if live
  -- data has drifted from what was just confirmed above (e.g. this
  -- migration is accidentally run twice, or the board was edited
  -- again in between).
  if v_count_total <> 6 or v_count_high <> 2 then
    raise exception 'development board priorities do not match the expected pre-fix shape (expected 6 entries with 2 sharing id "high"; found % entries, % with id "high") — aborting, nothing changed. If this migration already ran, no further action is needed.', v_count_total, v_count_high;
  end if;

  select p into v_this_week from jsonb_array_elements(v_priorities) p where p->>'id' = 'high' and p->>'label' = 'This Week';
  select p into v_normal    from jsonb_array_elements(v_priorities) p where p->>'id' = 'high' and p->>'label' = 'Normal';

  if v_this_week is null or v_normal is null then
    raise exception 'could not find exactly one "This Week" and one "Normal" priority both using id "high" — aborting, nothing changed';
  end if;

  -- Rebuild the array in its ORIGINAL order, changing only the `id`
  -- key of the single element matching id='high' AND label='Normal'
  -- via jsonb_set (a targeted single-key merge) — every other key on
  -- that object (label, textCls, bgCls, dotCls, borderCls, and the
  -- deliberate absence of showInSupportQueue) and every other
  -- priority object, in their original positions, is untouched.
  update public.boards
     set priorities = (
       select jsonb_agg(
         case when p->>'id' = 'high' and p->>'label' = 'Normal'
              then jsonb_set(p, '{id}', '"normal"'::jsonb)
              else p
         end
         order by ord
       )
       from jsonb_array_elements(priorities) with ordinality as arr(p, ord)
     )
   where id = 'development';
end $$;


-- ================================================================
-- Guard: every priority on a board must have a unique id, enforced
-- server-side going forward (the frontend's addPriority() already
-- guards against re-introducing a collision via the "add priority" UI
-- specifically, but this is the authoritative, un-bypassable check —
-- covers direct API/SQL writes and any future UI path too). Runs
-- AFTER the corrective UPDATE above (this trigger doesn't exist yet
-- when that UPDATE executes), so the fix itself can never be blocked
-- by the very check it's designed to require going forward.
-- ================================================================
create or replace function public.enforce_unique_priority_ids()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dup_id text;
begin
  select p->>'id' into v_dup_id
    from jsonb_array_elements(coalesce(new.priorities, '[]'::jsonb)) p
   group by p->>'id'
  having count(*) > 1
   limit 1;

  if v_dup_id is not null then
    raise exception 'board % priorities contain duplicate id "%" — every priority on a board must have a unique id', new.id, v_dup_id
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_unique_priority_ids on public.boards;
create trigger trg_enforce_unique_priority_ids
  before insert or update on public.boards
  for each row execute function public.enforce_unique_priority_ids();

-- ============================================================
-- Rollback: see supabase/rollbacks/
-- 20260811070000_fix_development_priority_duplicate_id_rollback.sql
-- ============================================================
