
create table if not exists public.bot_config (
  bot         text primary key,
  base_prompt text not null default '',
  model       text not null default 'gpt-4o-mini',
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists public.bot_training (
  id         uuid primary key default gen_random_uuid(),
  bot        text not null,
  kind       text not null default 'rule',
  situation  text,
  content    text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists bot_training_bot_idx on public.bot_training (bot, active);

insert into public.bot_config (bot) values ('support'), ('sales')
on conflict (bot) do nothing;
;
