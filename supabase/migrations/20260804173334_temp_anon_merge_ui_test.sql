create policy "tmp7_r_dupes"    on public.clients         for select to anon using (true);
create policy "tmp7_r_billing"  on public.billing_records for select to anon using (true);
create policy "tmp7_r_contacts" on public.client_contacts for select to anon using (true);
create policy "tmp7_r_profiles" on public.profiles        for select to anon using (true);;
