create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,
  message      text not null,
  recipient    text,
  severity     text not null default 'normal',
  read         boolean not null default false,
  task_id      uuid,
  task_title   text,
  client_id    uuid references public.clients(id),
  client_name  text,
  phone        text,
  wa_details   jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_read_idx      on public.notifications (read, created_at desc);
create index if not exists notifications_recipient_idx on public.notifications (recipient);

alter table public.notifications enable row level security;

create policy "notifications_select_authenticated"
  on public.notifications for select
  to authenticated using (true);

create policy "notifications_insert_authenticated"
  on public.notifications for insert
  to authenticated with check (true);

create policy "notifications_update_authenticated"
  on public.notifications for update
  to authenticated using (true) with check (true);

create policy "notifications_delete_authenticated"
  on public.notifications for delete
  to authenticated using (true);;
