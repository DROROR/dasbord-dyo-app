-- Urgent/shared-queue work is actionable by every active team member who
-- holds Work edit permission. The legacy helper name is retained because
-- the task-view policy, atomic claim RPC, and assignee validation trigger
-- already call it; changing its narrow implementation updates all three
-- authorization paths together without weakening ordinary board access.
create or replace function public.is_technical_support_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('work', 'edit');
$$;

revoke execute on function public.is_technical_support_staff() from public;
grant execute on function public.is_technical_support_staff() to authenticated;

comment on function public.is_technical_support_staff() is
  'Legacy shared-queue eligibility helper: true for active users with Work edit permission.';
