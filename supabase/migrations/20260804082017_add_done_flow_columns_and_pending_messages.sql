-- Answered by the developer when a support ticket is closed.
alter table public.tasks
  add column if not exists requires_app_update boolean,
  add column if not exists source_task_id uuid references public.tasks(id);

comment on column public.tasks.requires_app_update is
  'Set when a support ticket moves to Done: does the fix need an app release?';
comment on column public.tasks.source_task_id is
  'On an app-update task, the support ticket that caused it.';

-- Customer updates written when a ticket is finished. Never sent
-- automatically; a person reviews, edits and sends them.
create table if not exists public.pending_whatsapp_messages (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references public.tasks(id) on delete cascade,
  task_title   text,
  client_id    uuid references public.clients(id),
  client_name  text,
  app_name     text,
  phone        text,
  summary      text,
  message      text not null,
  requires_app_update boolean not null default false,
  status       text not null default 'pending'
                 check (status in ('pending', 'waiting', 'sent')),
  created_by   text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  sent_by      text
);

create index if not exists pending_wa_status_idx on public.pending_whatsapp_messages (status, created_at desc);

alter table public.pending_whatsapp_messages enable row level security;

create policy "team can view pending messages"
  on public.pending_whatsapp_messages for select to authenticated using (true);
create policy "team can add pending messages"
  on public.pending_whatsapp_messages for insert to authenticated with check (true);
create policy "team can update pending messages"
  on public.pending_whatsapp_messages for update to authenticated using (true) with check (true);
create policy "team can delete pending messages"
  on public.pending_whatsapp_messages for delete to authenticated using (true);;
