-- Joins duplicate customer records into one. Everything moves in a single
-- transaction, so it either all happens or none of it does.
-- Nothing here runs on its own; it is called from the Clients page after a
-- person has chosen which record to keep.
create or replace function public.merge_clients(
  keep_id          uuid,
  remove_ids       uuid[],
  drop_billing_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
as $$
declare
  moved jsonb;
begin
  if keep_id is null or remove_ids is null or array_length(remove_ids, 1) is null then
    raise exception 'merge_clients needs a record to keep and at least one to merge in';
  end if;

  if keep_id = any(remove_ids) then
    raise exception 'The record being kept cannot also be one of the records being merged in';
  end if;

  -- Billing rows the person chose to discard when two records covered the
  -- same month. Anything not listed here is kept and moved across.
  delete from public.billing_records where id = any(drop_billing_ids);

  update public.billing_records          set client_id    = keep_id where client_id    = any(remove_ids);
  update public.tasks                    set client_id    = keep_id where client_id    = any(remove_ids);
  update public.client_contacts          set client_id    = keep_id where client_id    = any(remove_ids);
  update public.notifications            set client_id    = keep_id where client_id    = any(remove_ids);
  update public.bot_conversations        set client_id    = keep_id where client_id    = any(remove_ids);
  update public.pending_whatsapp_messages set client_id   = keep_id where client_id    = any(remove_ids);
  update public.conversation_state       set client_id    = keep_id where client_id    = any(remove_ids);
  update public.messages                 set recipient_id = keep_id where recipient_id = any(remove_ids);

  delete from public.clients where id = any(remove_ids);

  select jsonb_build_object(
    'kept', keep_id,
    'merged', array_length(remove_ids, 1),
    'billing',  (select count(*) from public.billing_records where client_id = keep_id),
    'tasks',    (select count(*) from public.tasks           where client_id = keep_id),
    'contacts', (select count(*) from public.client_contacts where client_id = keep_id)
  ) into moved;

  return moved;
end;
$$;

grant execute on function public.merge_clients(uuid, uuid[], uuid[]) to authenticated;;
