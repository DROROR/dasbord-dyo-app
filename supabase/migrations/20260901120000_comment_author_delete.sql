-- Comment deletion must be creator-only and server-authorized. New comments
-- carry the caller's UUID; legacy comments remain readable but intentionally
-- cannot be deleted because they only contain a non-authoritative display name.

create or replace function public.add_task_comment(task_id uuid, comment_text text, mentions text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board   text;
  v_author  text;
  v_comment jsonb;
  v_updated jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if comment_text is null or btrim(comment_text) = '' then
    raise exception 'comment text must not be empty' using errcode = '22023';
  end if;
  if length(comment_text) > 4000 then
    raise exception 'comment text is too long (max 4000 characters)' using errcode = '22023';
  end if;
  if mentions is not null and array_length(mentions, 1) > 50 then
    raise exception 'too many mentions' using errcode = '22023';
  end if;

  select board into v_board from public.tasks where id = task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if not (public.has_permission('work', 'view') and public.has_board_access(v_board, 'comment')) then
    raise exception 'insufficient board access to comment on this task' using errcode = '42501';
  end if;

  select name into v_author from public.profiles where id = auth.uid();
  v_comment := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'author', coalesce(v_author, 'Unknown'),
    'authorId', auth.uid()::text,
    'text', btrim(comment_text),
    'timestamp', to_jsonb(now()),
    'mentions', coalesce(to_jsonb(mentions), '[]'::jsonb)
  );

  update public.tasks
     set comments = coalesce(comments, '[]'::jsonb) || jsonb_build_array(v_comment),
         updated_at = now()
   where id = task_id
   returning comments into v_updated;
  return v_updated;
end;
$$;

create or replace function public.delete_task_comment(task_id uuid, comment_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board    text;
  v_comments jsonb;
  v_target   jsonb;
  v_updated  jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select board, coalesce(comments, '[]'::jsonb)
    into v_board, v_comments
    from public.tasks
   where id = task_id
   for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if not (public.has_permission('work', 'view') and public.has_board_access(v_board, 'comment')) then
    raise exception 'insufficient board access to delete a comment' using errcode = '42501';
  end if;

  select value into v_target
    from jsonb_array_elements(v_comments)
   where value ->> 'id' = comment_id
   limit 1;
  if v_target is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
  if v_target ->> 'authorId' is distinct from auth.uid()::text then
    raise exception 'only the comment author can delete this comment' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
    into v_updated
    from jsonb_array_elements(v_comments) with ordinality
   where value ->> 'id' <> comment_id;

  update public.tasks
     set comments = v_updated,
         updated_at = now()
   where id = task_id;
  return v_updated;
end;
$$;

revoke execute on function public.delete_task_comment(uuid, text) from public;
grant execute on function public.delete_task_comment(uuid, text) to authenticated;

-- Recover ownership for legacy comments only when the stored display name maps
-- to exactly one profile. Ambiguous names remain untouched and undeletable.
with unique_profile_names as (
  select min(id::text) as author_id, name
    from public.profiles
   group by name
  having count(*) = 1
), rebuilt as (
  select t.id,
         jsonb_agg(
           case
             when c.value ? 'authorId' then c.value
             when p.author_id is not null
               then c.value || jsonb_build_object('authorId', p.author_id)
             else c.value
           end
           order by c.ordinality
         ) as comments
    from public.tasks t
    cross join lateral jsonb_array_elements(coalesce(t.comments, '[]'::jsonb))
      with ordinality as c(value, ordinality)
    left join unique_profile_names p on p.name = c.value ->> 'author'
   group by t.id
)
update public.tasks t
   set comments = r.comments
  from rebuilt r
 where t.id = r.id
   and t.comments is distinct from r.comments;
