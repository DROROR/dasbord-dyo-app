-- Folders may now nest to any reasonable depth, not just two levels.
--
-- 20260812080000 capped the tree at root + one subfolder, and two things leaned
-- on that cap:
--
--   1. enforce_folder_depth() rejected any parent that was itself a subfolder,
--      and checked only DIRECT children when looking for a cycle ("with depth
--      capped at 2, the only possible descendant of new.id is a direct child").
--   2. has_folder_access() walked exactly one level up — the folder and its
--      immediate parent — which was the whole ancestor path back then.
--
-- Both are replaced with real recursive walks here. (2) is the security-relevant
-- one: without it a folder three levels down would stop being gated by its
-- grandparent, which would widen access. It is widened to the full chain, so the
-- rule stays exactly what it says: min_level on EVERY folder up to the root.

-- ── The guard: cycles out, depth capped high enough not to be felt ───────────
-- A hard ceiling stays, because the breadcrumb and the indented tree have to
-- remain readable, and it keeps a runaway chain from ever being built.
create or replace function public.enforce_folder_depth()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_depth int;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'a folder cannot be its own parent' using errcode = '23514';
  end if;

  -- Walking DOWN from this folder: if the chosen parent turns up among its own
  -- descendants, the move would detach the subtree into a cycle.
  if exists (
    with recursive descendants as (
      select f.id from public.work_doc_folders f where f.parent_id = new.id
      union all
      select c.id
        from public.work_doc_folders c
        join descendants d on c.parent_id = d.id
    )
    select 1 from descendants where id = new.parent_id
  ) then
    raise exception 'cannot move a folder beneath one of its own descendants' using errcode = '23514';
  end if;

  -- Walking UP from the chosen parent: how deep would this folder sit?
  with recursive ancestors as (
    select f.id, f.parent_id, 1 as depth
      from public.work_doc_folders f where f.id = new.parent_id
    union all
    select p.id, p.parent_id, a.depth + 1
      from public.work_doc_folders p
      join ancestors a on a.parent_id = p.id
  )
  select coalesce(max(depth), 0) into v_depth from ancestors;

  if v_depth >= 10 then
    raise exception 'folders may be nested up to 10 levels deep' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ── Access: the whole ancestor chain, however long it is ─────────────────────
-- Same contract as before (min_level on every folder from this one up to the
-- root, null passes, owner bypasses), with the one-level walk replaced by a
-- recursive one. The cycle guard above is what makes this terminate.
create or replace function public.has_folder_access(folder_id_in uuid, min_level text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  with recursive folder_chain as (
    select f.id, f.access, f.parent_id
      from public.work_doc_folders f
     where f.id = folder_id_in
    union all
    select p.id, p.access, p.parent_id
      from public.work_doc_folders p
      join folder_chain c on c.parent_id = p.id
  )
  select
    folder_id_in is null
    or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_owner and pr.is_active)
    or (
      exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_active)
      and (select count(*) from folder_chain) > 0
      and not exists (
        select 1 from folder_chain fc
        where permission_rank(coalesce(fc.access ->> auth.uid()::text, 'none')) < permission_rank(min_level)
      )
    );
$$;

revoke execute on function public.has_folder_access(uuid, text) from public, anon;
grant  execute on function public.has_folder_access(uuid, text) to authenticated;
