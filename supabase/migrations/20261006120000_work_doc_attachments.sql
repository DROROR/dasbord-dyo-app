-- Attachments for work documents: a file list under each document, with
-- in-place preview and download.
--
-- Same shape as task attachments (20260825110000): the bytes live in a private
-- storage bucket and reach the UI only through short-lived signed URLs. Unlike
-- tasks, the metadata gets its own table rather than a JSON column, because a
-- document's access is per-document (`work_docs.access`) and each file has to
-- be reachable by exactly the people who can open the document it hangs off.

create table if not exists public.work_doc_attachments (
  id           uuid primary key default gen_random_uuid(),
  doc_id       uuid not null references public.work_docs(id) on delete cascade,
  name         text not null,                 -- the original filename, as uploaded
  mime_type    text,
  size_bytes   bigint,
  storage_path text not null,                 -- path inside work-doc-attachments
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- The list is always "every file on this document, newest first".
create index if not exists work_doc_attachments_doc_idx
  on public.work_doc_attachments (doc_id, created_at desc);

-- uploaded_by is stamped server-side, like stamp_meditation_creator, so it is a
-- truthful record no matter what the client sends.
create or replace function public.stamp_doc_attachment_uploader()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.uploaded_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_stamp_doc_attachment_uploader on public.work_doc_attachments;
create trigger trg_stamp_doc_attachment_uploader
  before insert on public.work_doc_attachments
  for each row execute function public.stamp_doc_attachment_uploader();

alter table public.work_doc_attachments enable row level security;

drop policy if exists "work_doc_attachments: view"   on public.work_doc_attachments;
drop policy if exists "work_doc_attachments: insert" on public.work_doc_attachments;
drop policy if exists "work_doc_attachments: delete" on public.work_doc_attachments;

-- Exactly the document's own rules: see the document, see its files; edit the
-- document ('full' on it, which is what the Save button needs), attach and
-- remove them. There is no update policy — a file is added or removed, never
-- edited in place.
create policy "work_doc_attachments: view" on public.work_doc_attachments for select
  using (has_permission('work_docs', 'view') and has_doc_access(doc_id, 'view'));

create policy "work_doc_attachments: insert" on public.work_doc_attachments for insert
  with check (has_permission('work_docs', 'view') and has_doc_access(doc_id, 'full'));

create policy "work_doc_attachments: delete" on public.work_doc_attachments for delete
  using (has_permission('work_docs', 'view') and has_doc_access(doc_id, 'full'));

revoke all on public.work_doc_attachments from anon;
grant select, insert, delete on public.work_doc_attachments to authenticated;

-- ── Storage ─────────────────────────────────────────────────────────────────
-- 20 MB a file, matching the task-attachments bucket and the client-side check.

insert into storage.buckets (id, name, public, file_size_limit)
values ('work-doc-attachments', 'work-doc-attachments', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

-- Every object is stored as '<doc id>/<uuid>-<filename>', so the document that
-- owns a file is readable straight off the object name. Guarding the cast in a
-- CASE (where SQL does fix the evaluation order, unlike an AND chain in a
-- policy) keeps a hand-made path from erroring the whole statement — anything
-- that is not a uuid-prefixed path simply belongs to nobody.
create or replace function public.doc_attachment_object_access(object_name text, min_level text)
returns boolean language sql security definer stable set search_path = public as $$
  select case
    when object_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
      then public.has_permission('work_docs', 'view')
       and public.has_doc_access(left(object_name, 36)::uuid, min_level)
    else false
  end;
$$;

revoke execute on function public.doc_attachment_object_access(text, text) from public;
grant  execute on function public.doc_attachment_object_access(text, text) to authenticated;

drop policy if exists "doc viewers can read doc attachments"    on storage.objects;
drop policy if exists "doc editors can upload doc attachments"  on storage.objects;
drop policy if exists "doc editors can delete doc attachments"  on storage.objects;

create policy "doc viewers can read doc attachments"
on storage.objects for select
to authenticated
using (
  bucket_id = 'work-doc-attachments'
  and public.doc_attachment_object_access(name, 'view')
);

create policy "doc editors can upload doc attachments"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'work-doc-attachments'
  and public.doc_attachment_object_access(name, 'full')
);

create policy "doc editors can delete doc attachments"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'work-doc-attachments'
  and public.doc_attachment_object_access(name, 'full')
);
