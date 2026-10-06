-- A chosen emoji in place of the default icon on a document or folder row, so a
-- list of documents can be scanned by shape rather than read line by line.
--
-- Plain text, nullable: null means "use the built-in icon". The length check is
-- only there to keep it an icon — an emoji is several code points once skin
-- tones and joiners are involved, so the limit is generous rather than 1.

alter table public.work_docs        add column if not exists icon text;
alter table public.work_doc_folders add column if not exists icon text;

alter table public.work_docs        drop constraint if exists work_docs_icon_short;
alter table public.work_docs        add  constraint work_docs_icon_short
  check (icon is null or char_length(icon) <= 16);

alter table public.work_doc_folders drop constraint if exists work_doc_folders_icon_short;
alter table public.work_doc_folders add  constraint work_doc_folders_icon_short
  check (icon is null or char_length(icon) <= 16);

-- UPDATE on work_docs is granted column by column (title, content, folder_id,
-- updated_at) so that `access` stays unwritable from the client — a new column
-- is therefore NOT covered by the existing grant and needs its own.
grant update (icon) on public.work_docs        to authenticated;
grant update (icon) on public.work_doc_folders to authenticated;

-- Who may set it is unchanged: the existing row policies already require
-- has_doc_access(id, 'full') / has_folder_access(id, 'full') for an update.
