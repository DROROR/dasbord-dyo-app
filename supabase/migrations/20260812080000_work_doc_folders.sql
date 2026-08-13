-- ================================================================
-- 010: Documentation folders — two-level folder hierarchy for
-- work_docs, with folder-level access (none/view/full) that
-- intersects with each document's own access map. Additive only:
-- every existing document keeps its exact title/content/access/
-- created_by/timestamps and stays at root (folder_id = null).
--
-- Phase 0 audit findings this migration is built on (all confirmed by
-- reading the live schema, not assumed):
--   - permission_rank() (none=0,view=1,edit/send=2,full=3, IMMUTABLE)
--     is directly reusable for folder ranking — work_doc_folders uses
--     the same 3-value vocabulary as work_docs (none/view/full), so no
--     new rank function is needed.
--   - has_doc_access(doc_id, min_level) (as of 20260810101000) already
--     checks: owner+active bypass, else caller is_active AND
--     permission_rank(own access entry) >= min_level. This migration
--     extends it with one more AND-branch (folder-path access) and
--     changes nothing else — every existing root-level document
--     (folder_id null) is completely unaffected, because
--     has_folder_access(null, ...) short-circuits true below.
--   - set_work_doc_creator_access() currently always resets `access`
--     to `{creator: full}` on INSERT, ignoring folder entirely. This
--     migration extends it to seed from the target folder's access map
--     (when folder_id is set) before forcing the creator to 'full' —
--     root-level document creation (folder_id null) is byte-identical
--     to before.
--   - This project's default ACLs auto-grant every table privilege to
--     anon/authenticated/service_role on any new table (confirmed
--     during the Work Report privilege-lockdown migration) — so
--     work_doc_folders gets the same explicit revoke-then-narrow-grant
--     treatment applied there, from the moment it's created.
-- ================================================================


-- ================================================================
-- PART A — work_doc_folders table
-- ================================================================

create table public.work_doc_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  parent_id   uuid references public.work_doc_folders(id) on delete restrict,
  access      jsonb not null default '{}'::jsonb,  -- { "<profile-uuid>": "none" | "view" | "full" }
  order_index integer not null default 0,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.work_doc_folders enable row level security;

create index work_doc_folders_parent_id_idx on public.work_doc_folders(parent_id);

-- Documents may optionally live in a folder. Nullable, so every
-- existing row defaults to root with zero data migration required.
-- on delete restrict: a folder that still contains documents can
-- never be deleted out from under them, even by a raw client call
-- that bypasses delete_work_doc_folder() below — belt and suspenders,
-- same principle as every other "never cascade-delete" rule in this
-- project.
alter table public.work_docs add column folder_id uuid references public.work_doc_folders(id) on delete restrict;

create index work_docs_folder_id_idx on public.work_docs(folder_id);


-- ================================================================
-- PART B — max-depth-2 / no-self-parent / no-cycle guard
-- ================================================================
-- Max depth is exactly two levels: a root folder (parent_id null) and
-- one subfolder level beneath it. A folder is rejected as a parent if
-- it is not itself a root folder (i.e. its own parent_id is not
-- null) — that alone caps depth at 2 and, combined with the
-- descendant check below, rules out every cycle a 2-level hierarchy
-- can form.
create or replace function public.enforce_folder_depth()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_parent_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'a folder cannot be its own parent' using errcode = '23514';
  end if;

  -- Reject moving/creating a folder beneath one of its own
  -- descendants. With depth capped at 2, the only possible descendant
  -- of new.id is a direct child, so checking direct children only is
  -- sufficient (there can never be a grandchild to also check).
  if exists (
    select 1 from public.work_doc_folders d
    where d.parent_id = new.id and d.id = new.parent_id
  ) then
    raise exception 'cannot move a folder beneath one of its own descendants' using errcode = '23514';
  end if;

  select parent_id into v_parent_parent_id from public.work_doc_folders where id = new.parent_id;
  if v_parent_parent_id is not null then
    raise exception 'folders may only be nested two levels deep — the selected parent is already a subfolder' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_folder_depth
  before insert or update on public.work_doc_folders
  for each row execute function public.enforce_folder_depth();


-- ================================================================
-- PART C — creator access: folders copy their parent's access map,
-- documents copy their folder's access map (root-level unchanged)
-- ================================================================

-- Same anti-forgery convention as set_work_doc_creator_access(): only
-- applies when auth.uid() is not null (every real client request has
-- one), always overrides whatever the client sent for access/
-- created_by.
create or replace function public.set_work_doc_folder_creator_access()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_access jsonb;
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    if new.parent_id is not null then
      select access into v_parent_access from public.work_doc_folders where id = new.parent_id;
      -- Copy the parent's access map as the starting default, then
      -- ensure the creator specifically has 'full' regardless of what
      -- that map says — otherwise a creator who somehow only had
      -- 'view' on the parent (not reachable today, since the INSERT
      -- policy below already requires 'full' on the parent to create
      -- a subfolder at all — kept as defense in depth) would be unable
      -- to manage the very subfolder they just created.
      new.access := coalesce(v_parent_access, '{}'::jsonb) || jsonb_build_object(auth.uid()::text, 'full');
    else
      new.access := jsonb_build_object(auth.uid()::text, 'full');
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_set_work_doc_folder_creator_access
  before insert on public.work_doc_folders
  for each row execute function public.set_work_doc_folder_creator_access();

-- Extends set_work_doc_creator_access (created 20260809140000) so a
-- document created inside a folder copies that folder's access map as
-- its initial default, then forces the creator to 'full' on top of
-- it — while a root-level document (folder_id null) keeps the exact
-- original behavior (creator-only 'full'), unchanged in every respect.
create or replace function public.set_work_doc_creator_access()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_folder_access jsonb;
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    if new.folder_id is not null then
      select access into v_folder_access from public.work_doc_folders where id = new.folder_id;
      new.access := coalesce(v_folder_access, '{}'::jsonb) || jsonb_build_object(auth.uid()::text, 'full');
    else
      new.access := jsonb_build_object(auth.uid()::text, 'full');
    end if;
  end if;
  return new;
end;
$$;
-- (trigger trg_set_work_doc_creator_access already exists from
-- 20260809140000 and keeps pointing at this function — no re-create
-- needed.)


-- ================================================================
-- PART D — folder access helper + has_doc_access extended to
-- intersect with the ancestor folder chain
-- ================================================================

-- True when the caller has at least min_level on EVERY folder from
-- folder_id_in up to (and including) the root — i.e. the whole
-- ancestor path. A null folder_id (root-level document, or "is this
-- folder accessible" for a document with no folder) trivially passes:
-- there is no folder-level gate for root content, only the module
-- permission and the document's own ACL, exactly as before this
-- migration existed.
create or replace function public.has_folder_access(folder_id_in uuid, min_level text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  with folder_chain as (
    select f.id, f.access, f.parent_id
      from public.work_doc_folders f
     where f.id = folder_id_in
    union all
    select p.id, p.access, p.parent_id
      from public.work_doc_folders p
      join public.work_doc_folders c on c.parent_id = p.id
     where c.id = folder_id_in
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

-- Extends has_doc_access (last defined 20260810101000) with exactly
-- one new AND-branch: the caller must also hold min_level on the
-- document's whole ancestor folder path. Every other branch (owner
-- bypass, caller is_active, own access-map entry) is untouched. For a
-- root-level document, has_folder_access(null, ...) is true, so this
-- is a strict no-op for every document that existed before folders did.
create or replace function public.has_doc_access(doc_id uuid, min_level text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner and p.is_active)
    or exists (
      select 1 from public.work_docs d
      where d.id = doc_id
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
        and permission_rank(coalesce(d.access ->> auth.uid()::text, 'none')) >= permission_rank(min_level)
        and public.has_folder_access(d.folder_id, min_level)
    );
$$;

-- Mirrors my_doc_access_level's own PostgREST computed-column pattern
-- so the folder-tree UI can learn the caller's own level on a folder
-- inline with the normal folder-list query, without exposing the full
-- access map (which stays behind update-resource-access).
create or replace function public.my_folder_access_level(f public.work_doc_folders)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner and p.is_active) then 'full'
    else coalesce(f.access ->> auth.uid()::text, 'none')
  end;
$$;

revoke execute on function public.my_folder_access_level(public.work_doc_folders) from public, anon;
grant  execute on function public.my_folder_access_level(public.work_doc_folders) to authenticated;


-- ================================================================
-- PART E — RLS on work_doc_folders
-- ================================================================
-- Every policy also requires has_permission('work_docs', 'view') —
-- the general module permission gate that governs whether Documentation
-- is visible at all, same convention as work_docs itself.

create policy "work_doc_folders: view" on public.work_doc_folders for select
  using (has_permission('work_docs', 'view') and has_folder_access(id, 'view'));

-- Creating a root folder (parent_id null) only requires module-level
-- 'full', same bar as creating a root-level document. Creating a
-- subfolder additionally requires 'full' on the target parent, since
-- that's a content-management operation on that parent folder.
create policy "work_doc_folders: insert" on public.work_doc_folders for insert
  with check (
    has_permission('work_docs', 'full')
    and (parent_id is null or has_folder_access(parent_id, 'full'))
  );

-- Rename and move (reparent): USING checks 'full' on the folder's
-- CURRENT ancestor chain (its old parent), WITH CHECK checks 'full' on
-- the folder itself plus its RESULTING parent — the same "USING =
-- current, WITH CHECK = resulting" split already proven for the tasks
-- board-move column. A plain rename (parent_id unchanged) trivially
-- satisfies both sides with the same chain.
create policy "work_doc_folders: update" on public.work_doc_folders for update
  using (has_permission('work_docs', 'view') and has_folder_access(id, 'full'))
  with check (
    has_permission('work_docs', 'view')
    and has_folder_access(id, 'full')
    and (parent_id is null or has_folder_access(parent_id, 'full'))
  );

create policy "work_doc_folders: delete" on public.work_doc_folders for delete
  using (has_permission('work_docs', 'full') and has_folder_access(id, 'full'));

-- access is never client-writable directly — only through the
-- update-resource-access Edge Function, once extended to include
-- work_doc_folders (see supabase/functions/update-resource-access —
-- code updated in this change set, not deployed by this migration).
-- name/parent_id/order_index/updated_at stay directly writable,
-- protected by the RLS "work_doc_folders: update" policy above.
revoke all on public.work_doc_folders from public, anon;
grant select, insert, delete on public.work_doc_folders to authenticated;
grant update (name, parent_id, order_index, updated_at) on public.work_doc_folders to authenticated;

-- Same explicit anon lockdown extension for work_docs' new folder_id
-- column: the general "revoke update ... grant update (title, content,
-- updated_at)" from 20260809140000 already excludes any column not
-- named, but folder_id must be explicitly added so a client can
-- actually move a document between folders.
grant update (folder_id) on public.work_docs to authenticated;


-- ================================================================
-- PART F — updated INSERT check on work_docs: creating a document
-- inside a folder requires 'full' on that folder, not just the module
-- permission. Root-level creation (folder_id null) is unchanged.
-- ================================================================
drop policy if exists "work_docs: insert" on public.work_docs;
create policy "work_docs: insert" on public.work_docs for insert
  with check (
    has_permission('work_docs', 'full')
    and (folder_id is null or has_folder_access(folder_id, 'full'))
  );
-- work_docs: view/update/delete are unchanged in this migration — they
-- all call has_doc_access(id, ...), which now transparently includes
-- the folder-path check via PART D above.


-- ================================================================
-- PART G — safe folder deletion RPC
-- ================================================================
-- The FK "on delete restrict" on both work_docs.folder_id and
-- work_doc_folders.parent_id already makes it impossible to delete a
-- non-empty folder through ANY path, including a raw client DELETE —
-- that is the unconditional backstop. This RPC exists purely to give
-- the frontend a clear, friendly message instead of a raw foreign-key
-- violation, by checking emptiness explicitly before attempting the
-- delete. It re-derives the same authorization the RLS delete policy
-- would apply (has_permission('work_docs','full') and
-- has_folder_access(id,'full')) rather than relying on the policy
-- alone, since as SECURITY DEFINER it does not go through RLS.
create or replace function public.delete_work_doc_folder(folder_id_in uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_doc_count int;
  v_subfolder_count int;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not (public.has_permission('work_docs', 'full') and public.has_folder_access(folder_id_in, 'full')) then
    raise exception 'insufficient access to delete this folder' using errcode = '42501';
  end if;

  select count(*) into v_doc_count from public.work_docs where folder_id = folder_id_in;
  select count(*) into v_subfolder_count from public.work_doc_folders where parent_id = folder_id_in;

  if v_doc_count > 0 or v_subfolder_count > 0 then
    raise exception 'folder is not empty (% document(s), % subfolder(s)) — move or delete its contents first', v_doc_count, v_subfolder_count
      using errcode = '23503';
  end if;

  delete from public.work_doc_folders where id = folder_id_in;
end;
$$;

revoke execute on function public.delete_work_doc_folder(uuid) from public, anon;
grant  execute on function public.delete_work_doc_folder(uuid) to authenticated;


-- ================================================================
-- Rollback: see supabase/rollbacks/
-- 20260812080000_work_doc_folders_rollback.sql
-- ================================================================
