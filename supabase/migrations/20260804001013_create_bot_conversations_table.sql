-- Each turn of a WhatsApp support conversation. Keyed by phone so every
-- person keeps their own thread, and carrying client_id so the team can see
-- the whole picture for a client across all the people who contacted them.
create table if not exists public.bot_conversations (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  client_id  uuid references public.clients(id),
  role       text not null check (role in ('customer', 'bot')),
  message    text not null,
  action     text,
  created_at timestamptz not null default now()
);

create index if not exists bot_conversations_phone_idx
  on public.bot_conversations (phone, created_at desc);
create index if not exists bot_conversations_client_idx
  on public.bot_conversations (client_id, created_at desc);

alter table public.bot_conversations enable row level security;

create policy "team can view conversations"
  on public.bot_conversations for select to authenticated using (true);
create policy "team can add conversations"
  on public.bot_conversations for insert to authenticated with check (true);;
