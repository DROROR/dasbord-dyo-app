
alter table public.bot_config enable row level security;
alter table public.bot_training enable row level security;

create policy "authenticated full access bot_config"
  on public.bot_config for all to authenticated
  using (true) with check (true);

create policy "authenticated full access bot_training"
  on public.bot_training for all to authenticated
  using (true) with check (true);
;
