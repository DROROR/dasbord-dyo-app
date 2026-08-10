-- Who owns a WhatsApp conversation right now: the bot, or a person.
-- While a person owns it the bot stays silent, so the two never reply at once.
create table if not exists public.conversation_state (
  phone          text primary key,
  client_id      uuid references public.clients(id),
  state          text not null default 'agent' check (state in ('agent', 'human')),
  taken_over_by  text,
  taken_over_at  timestamptz,
  last_human_at  timestamptz,
  returned_by    text,
  returned_at    timestamptz,
  updated_at     timestamptz not null default now()
);

create index if not exists conversation_state_state_idx on public.conversation_state (state, last_human_at desc);

alter table public.conversation_state enable row level security;

create policy "team can view conversation state"
  on public.conversation_state for select to authenticated using (true);
create policy "team can set conversation state"
  on public.conversation_state for insert to authenticated with check (true);
create policy "team can change conversation state"
  on public.conversation_state for update to authenticated using (true) with check (true);

-- How long a conversation stays with the person after their last message
-- before the bot may pick it up again. Configuration, not hard-coded.
alter table public.bot_config
  add column if not exists human_idle_minutes integer not null default 20;

-- Conversations can now also carry what a person said, and the handover events,
-- so the bot has the full picture when it resumes.
alter table public.bot_conversations drop constraint if exists bot_conversations_role_check;
alter table public.bot_conversations
  add constraint bot_conversations_role_check
  check (role in ('customer', 'bot', 'human', 'system'));;
