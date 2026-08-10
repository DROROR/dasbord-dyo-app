create policy "tmp_anon_read_profiles" on public.profiles for select to anon using (true);
create policy "tmp_anon_read_clients" on public.clients for select to anon using (true);
create policy "tmp_anon_read_tasks" on public.tasks for select to anon using (true);;
