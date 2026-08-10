create policy "tmp6_r_state"    on public.conversation_state for select to anon using (true);
create policy "tmp6_u_state"    on public.conversation_state for update to anon using (true) with check (true);
create policy "tmp6_i_convs"    on public.bot_conversations   for insert to anon with check (true);
create policy "tmp6_r_cfg"      on public.bot_config          for select to anon using (true);
create policy "tmp6_r_clients"  on public.clients             for select to anon using (true);
create policy "tmp6_r_tasks"    on public.tasks               for select to anon using (true);
create policy "tmp6_r_profiles" on public.profiles            for select to anon using (true);
create policy "tmp6_r_notifs"   on public.notifications       for select to anon using (true);
create policy "tmp6_r_pending"  on public.pending_whatsapp_messages for select to anon using (true);;
