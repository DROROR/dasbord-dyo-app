-- Task product tags and reliable server-side notification/email queue.
-- Apply remotely only after explicit approval and backup/review.

alter table public.tasks
  add column if not exists platforms text[] not null default '{}'::text[];

alter table public.tasks drop constraint if exists tasks_platforms_valid;
alter table public.tasks add constraint tasks_platforms_valid check (
  platforms <@ array['admin', 'website', 'mobile_app', 'super_admin']::text[]
);

create table if not exists public.task_email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('task_assigned', 'task_status_changed')),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  task_title text not null,
  subject text not null,
  message text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists task_email_outbox_pending_idx
  on public.task_email_outbox (status, created_at) where status in ('queued', 'failed');
alter table public.task_email_outbox enable row level security;

create or replace function public.notify_task_assignee_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor_name text;
  v_recipient_name text;
  v_recipient_email text;
  v_status_label text;
  v_message text;
begin
  select name into v_actor_name from public.profiles where id = auth.uid();

  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select name, email into v_recipient_name, v_recipient_email from public.profiles where id = new.assignee_id;
    if v_recipient_email is not null then
      insert into public.task_email_outbox(event_type, recipient_id, recipient_email, task_id, task_title, subject, message)
      values ('task_assigned', new.assignee_id, v_recipient_email, new.id, new.title,
        'Task assigned: ' || new.title,
        format('%s assigned you to "%s".', coalesce(v_actor_name, 'A team member'), new.title));
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.assignee_id is not null then
    select name, email into v_recipient_name, v_recipient_email from public.profiles where id = new.assignee_id;
    select s->>'label' into v_status_label from public.boards b, jsonb_array_elements(b.statuses) s
      where b.id = new.board and s->>'id' = new.status limit 1;
    v_message := format('%s changed "%s" to %s.', coalesce(v_actor_name, 'A team member'), new.title, coalesce(v_status_label, new.status));
    if new.assignee_id is distinct from auth.uid() then
      insert into public.notifications(type, message, recipient, recipient_id, task_id, task_title)
      values ('task_status_changed', v_message, v_recipient_name, new.assignee_id, new.id, new.title);
    end if;
    if v_recipient_email is not null then
      insert into public.task_email_outbox(event_type, recipient_id, recipient_email, task_id, task_title, subject, message)
      values ('task_status_changed', new.assignee_id, v_recipient_email, new.id, new.title,
        'Task status changed: ' || new.title, v_message);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_task_assignee_changes on public.tasks;
create trigger trg_notify_task_assignee_changes
  after insert or update of assignee_id, status on public.tasks
  for each row execute function public.notify_task_assignee_changes();

revoke all on public.task_email_outbox from anon, authenticated;
