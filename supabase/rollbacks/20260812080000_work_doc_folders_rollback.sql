-- ============================================================
-- Rollback for 20260812080000_work_doc_folders.sql
--
-- Non-destructive: does NOT drop the work_doc_folders table, does NOT
-- drop the work_docs.folder_id column, and does NOT delete any folder
-- or document row. Any existing folder/document data (and every
-- folder_id already set on a document) is left exactly as it is —
-- only the feature's write/read surface is turned off, and the two
-- shared functions this migration extended (has_doc_access,
-- set_work_doc_creator_access) are reverted to their exact prior
-- definitions so root-level documents behave byte-identically to
-- before this migration ever ran.
-- ============================================================

-- Revert has_doc_access to its exact 20260810101000 definition (no
-- folder-path check).
create or replace function public.has_doc_access(doc_id uuid, min_level text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner and p.is_active)
    or exists (
      select 1 from public.work_docs d
      where d.id = doc_id
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
        and permission_rank(coalesce(d.access ->> auth.uid()::text, 'none')) >= permission_rank(min_level)
    );
$$;

-- Revert set_work_doc_creator_access to its exact 20260809140000
-- definition (always creator-only 'full', no folder copy).
create or replace function public.set_work_doc_creator_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.access := jsonb_build_object(auth.uid()::text, 'full');
  end if;
  return new;
end;
$$;

-- Revert work_docs' insert policy to its exact pre-folder definition.
drop policy if exists "work_docs: insert" on public.work_docs;
create policy "work_docs: insert" on public.work_docs for insert
  with check (has_permission('work_docs', 'full'));

-- Stop new documents from being filed into a folder and stop moving
-- existing ones between folders — root-level documents are untouched
-- either way since has_doc_access no longer checks folder_id at all.
revoke update (folder_id) on public.work_docs from authenticated;

drop trigger if exists trg_enforce_folder_depth on public.work_doc_folders;
drop function if exists public.enforce_folder_depth();

drop trigger if exists trg_set_work_doc_folder_creator_access on public.work_doc_folders;
drop function if exists public.set_work_doc_folder_creator_access();

drop policy if exists "work_doc_folders: view" on public.work_doc_folders;
drop policy if exists "work_doc_folders: insert" on public.work_doc_folders;
drop policy if exists "work_doc_folders: update" on public.work_doc_folders;
drop policy if exists "work_doc_folders: delete" on public.work_doc_folders;

drop function if exists public.delete_work_doc_folder(uuid);
drop function if exists public.my_folder_access_level(public.work_doc_folders);
drop function if exists public.has_folder_access(uuid, text);

-- Lock the table down completely rather than deleting it or any row
-- in it — same convention as the Work Report privilege-lockdown
-- rollback. No role can read or write work_doc_folders anymore, but
-- every row (and every work_docs.folder_id pointing at one) is
-- preserved untouched, so a future re-run of the forward migration
-- picks up exactly where this left off.
revoke all on public.work_doc_folders from public, anon, authenticated;

-- ============================================================
-- The table, the work_docs.folder_id column, and every row of data
-- are deliberately left in place. Manually dropping them (only if a
-- full teardown is genuinely intended) is documented here but never
-- run automatically:
--
--   alter table public.work_docs drop column folder_id;
--   drop table public.work_doc_folders;
--
-- Never run as part of this rollback.
-- ============================================================
