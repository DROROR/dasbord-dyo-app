-- Persistent, private storage for Work task attachments.
-- Files are stored by task id and exposed to the UI only through short-lived
-- signed URLs. The task row continues to hold attachment metadata as JSON.

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-attachments', 'task-attachments', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "work users can view task attachments" on storage.objects;
create policy "work users can view task attachments"
on storage.objects for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and public.has_permission('work', 'view')
);

drop policy if exists "work editors can upload task attachments" on storage.objects;
create policy "work editors can upload task attachments"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'task-attachments'
  and public.has_permission('work', 'edit')
);

drop policy if exists "work editors can delete task attachments" on storage.objects;
create policy "work editors can delete task attachments"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'task-attachments'
  and public.has_permission('work', 'edit')
);
