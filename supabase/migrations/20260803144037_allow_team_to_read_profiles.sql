-- The team list (assignees, board access, reviewers) must be readable by every
-- signed-in user, otherwise staff see only themselves and cannot assign work.
create policy "team can view profiles"
  on public.profiles for select
  to authenticated using (true);;
