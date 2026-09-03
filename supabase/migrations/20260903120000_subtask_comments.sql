-- Separate, atomic comments for child work items. Existing subtasks receive
-- an empty array and no task/comment data is rewritten.
alter table public.task_subtasks
  add column if not exists comments jsonb not null default '[]'::jsonb;

alter table public.task_subtasks
  drop constraint if exists task_subtasks_comments_array;
alter table public.task_subtasks
  add constraint task_subtasks_comments_array
  check (jsonb_typeof(comments) = 'array');

create or replace function public.add_subtask_comment(
  subtask_id_in uuid,
  comment_text_in text,
  mentions_in text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtask public.task_subtasks%rowtype;
  v_board text;
  v_status text;
  v_author text;
  v_comment jsonb;
  v_comments jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if nullif(btrim(comment_text_in), '') is null then
    raise exception 'comment cannot be empty' using errcode = '22023';
  end if;

  select * into v_subtask
    from public.task_subtasks
   where id = subtask_id_in
   for update;
  if not found then
    raise exception 'subtask not found' using errcode = 'P0002';
  end if;

  select t.board, t.status into v_board, v_status
    from public.tasks t
   where t.id = v_subtask.task_id;

  if not has_permission('work', 'view')
     or not (
       has_board_access(v_board, 'comment')
       or v_subtask.assignee_id = auth.uid()
       or status_owner_of(v_board, v_status) = auth.uid()
     ) then
    raise exception 'insufficient access to comment on this subtask' using errcode = '42501';
  end if;

  select p.name into v_author
    from public.profiles p
   where p.id = auth.uid()
     and p.is_active;
  if v_author is null then
    raise exception 'active profile required' using errcode = '42501';
  end if;

  v_comment := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'author', v_author,
    'authorId', auth.uid()::text,
    'text', btrim(comment_text_in),
    'timestamp', now(),
    'mentions', to_jsonb(coalesce(mentions_in, '{}'::text[]))
  );

  update public.task_subtasks
     set comments = comments || jsonb_build_array(v_comment),
         updated_at = now()
   where id = subtask_id_in
   returning comments into v_comments;

  return v_comments;
end;
$$;

revoke execute on function public.add_subtask_comment(uuid, text, text[]) from public;
grant execute on function public.add_subtask_comment(uuid, text, text[]) to authenticated;
