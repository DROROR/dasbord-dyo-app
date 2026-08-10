-- ============================================================
-- Rollback for 20260809141500_fix_board_access_trigger_role_check.sql
--
-- Restores the exact function body that was live immediately before
-- this corrective migration (captured from the deployed
-- 20260809140000_docs_and_board_access.sql). This reintroduces the
-- current_user bug this migration fixed — the service_role exemption
-- would stop working again — but does not touch any data, and does
-- not affect the Owner/authorized-admin path, which was never broken
-- (can_manage_permissions() does not depend on current_user).
-- ============================================================

create or replace function public.enforce_board_access_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.access is distinct from old.access
     and not public.can_manage_permissions()
     and current_user <> 'service_role'
  then
    raise exception 'only the owner or an authorized admin may change board access' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
