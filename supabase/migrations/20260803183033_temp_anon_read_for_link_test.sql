create policy "tmp_anon_r_notifications" on public.notifications for select to anon using (true);
create policy "tmp_anon_r_profiles"      on public.profiles      for select to anon using (true);
create policy "tmp_anon_r_clients"       on public.clients       for select to anon using (true);
create policy "tmp_anon_r_tasks"         on public.tasks         for select to anon using (true);
create policy "tmp_anon_r_boards"        on public.boards        for select to anon using (true);;
