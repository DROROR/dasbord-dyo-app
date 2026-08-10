
create policy "temp anon read bot_config" on public.bot_config for select to anon using (true);
create policy "temp anon read bot_training" on public.bot_training for select to anon using (true);
;
