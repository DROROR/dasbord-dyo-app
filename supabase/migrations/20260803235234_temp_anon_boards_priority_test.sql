create policy "tmp3_r_boards"  on public.boards  for select to anon using (true);
create policy "tmp3_u_boards"  on public.boards  for update to anon using (true) with check (true);
create policy "tmp3_r_tasks"   on public.tasks   for select to anon using (true);
create policy "tmp3_r_profiles" on public.profiles for select to anon using (true);
create policy "tmp3_r_clients" on public.clients for select to anon using (true);
create policy "tmp3_r_notifs"  on public.notifications for select to anon using (true);;
