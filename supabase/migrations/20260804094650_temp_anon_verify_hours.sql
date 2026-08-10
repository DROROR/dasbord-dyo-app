create policy "tmp5_r_tasks"    on public.tasks    for select to anon using (true);
create policy "tmp5_r_boards"   on public.boards   for select to anon using (true);
create policy "tmp5_r_clients"  on public.clients  for select to anon using (true);
create policy "tmp5_r_profiles" on public.profiles for select to anon using (true);
create policy "tmp5_r_notifs"   on public.notifications for select to anon using (true);
create policy "tmp5_r_pending"  on public.pending_whatsapp_messages for select to anon using (true);;
