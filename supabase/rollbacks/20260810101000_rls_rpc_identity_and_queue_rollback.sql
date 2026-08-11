-- ============================================================
-- Rollback for 20260810101000_rls_rpc_identity_and_queue.sql
--
-- SECURITY REGRESSION IF APPLIED, documented rather than hidden:
--  - Restoring "admin can update any profile" / "admin can delete
--    profiles" to their is_admin()-based form re-opens the gap where
--    ANY role='admin' user (not only one explicitly granted
--    can_manage_permissions()) can update/delete other profiles'
--    name column via a direct API call. Narrow in practice (column
--    grants still limit this to `name`), but real.
--  - Removing the is_active check from has_permission() /
--    can_manage_permissions() / has_board_access() / has_doc_access()
--    means a deactivated user's still-unexpired access token becomes
--    fully usable again for every permission this app checks, until
--    it naturally expires — deactivation would no longer reliably
--    block an already-logged-in session, only new sign-ins (via the
--    Auth ban, which is untouched by this rollback either way).
--  - Restoring "authenticated can view profiles" to `using (true)`
--    means a deactivated user's still-valid token can once again read
--    the entire profiles table (every name/email/role/permissions/
--    is_owner/is_technical_support) directly, independent of the
--    point above.
--  - Restoring enforce_profile_role_rules to its pre-migration body
--    removes the DB-level block on deactivating the owner — only
--    deactivate-member's own application-level `is_owner` check would
--    still guard that.
--  - Dropping the two "derive_*_from_text" compatibility triggers
--    re-opens the old-frontend compatibility gap described in this
--    migration's Part G/H: an old-frontend edit that only changes a
--    display-name field (assignee/claimed_by/status owner) on an
--    already-UUID-linked row will again leave the UUID silently stale
--    and pointed at the wrong person.
--  - Dropping clear_status_ownership_on_deactivation means a
--    deactivated status owner's ownerId is no longer auto-cleared —
--    a routed task can again sit orphaned (hidden from the original
--    assignee, unreachable by the now-locked-out former owner).
-- Do not run this rollback while any profile has is_active=false or
-- while the legacy is_admin()-based behavior is unacceptable, without
-- accounting for all regressions above first.
-- ============================================================

-- ── restore the four gate functions to their pre-migration bodies ──
create or replace function public.has_permission(module text, min_level text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and ( p.is_owner
            or public.permission_rank(coalesce(p.permissions ->> module, 'none'))
               >= public.permission_rank(min_level) )
  );
$$;

create or replace function public.can_manage_permissions()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and ( p.is_owner
            or (p.role = 'admin' and public.permission_rank(p.permissions ->> 'permissions') = 3) )
  );
$$;

create or replace function public.has_board_access(board_id_in text, min_level text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner)
    or exists (
      select 1 from public.boards b
      where b.id = board_id_in
        and board_access_rank(coalesce(b.access ->> auth.uid()::text, 'none')) >= board_access_rank(min_level)
    );
$$;

create or replace function public.has_doc_access(doc_id uuid, min_level text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner)
    or exists (
      select 1 from public.work_docs d
      where d.id = doc_id
        and permission_rank(coalesce(d.access ->> auth.uid()::text, 'none')) >= permission_rank(min_level)
    );
$$;

-- ── restore the legacy profiles policies (see regression note above) ──
drop policy if exists "authorized admin can update any profile" on public.profiles;
create policy "admin can update any profile" on public.profiles for update
  using (is_admin());

drop policy if exists "authorized admin can delete profiles" on public.profiles;
create policy "admin can delete profiles" on public.profiles for delete
  using (is_admin());

-- ── restore "authenticated can view profiles" to its pre-migration form ──
drop policy if exists "authenticated can view profiles" on public.profiles;
create policy "authenticated can view profiles" on public.profiles for select
  to authenticated
  using (true);

drop function if exists public.caller_is_active();

-- ── restore enforce_profile_role_rules to its pre-migration (20260809120000) body ──
create or replace function public.enforce_profile_role_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_owner then
      raise exception 'owner profile cannot be deleted';
    end if;
    return old;
  end if;

  if new.is_owner is distinct from old.is_owner then
    raise exception 'is_owner cannot be changed directly (see migration 001 comment for the escape hatch)';
  end if;

  if old.is_owner and (new.role is distinct from old.role or new.permissions is distinct from old.permissions) then
    raise exception 'owner role/permissions are immutable';
  end if;

  return new;
end;
$$;

-- ── restore "tasks: view" to its pre-migration (Migration A) form ──
drop policy if exists "tasks: view" on public.tasks;
create policy "tasks: view" on public.tasks for select
  using (has_permission('work', 'view') and has_board_access(board, 'view'));

-- ── restore enforce_board_access_rules to its pre-migration body ──
create or replace function public.enforce_board_access_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.access is distinct from old.access
     and not public.can_manage_permissions()
     and coalesce(auth.role(), '') <> 'service_role'
  then
    raise exception 'only the owner or an authorized admin may change board access' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ── drop the compatibility/cascade triggers and their functions ──
drop trigger if exists trg_derive_task_identity_from_text on public.tasks;
drop function if exists public.derive_task_identity_from_text();

drop trigger if exists trg_derive_status_owner_from_text on public.boards;
drop function if exists public.derive_status_owner_from_text();

drop trigger if exists trg_clear_status_ownership_on_deactivation on public.profiles;
drop function if exists public.clear_status_ownership_on_deactivation();

-- ── drop the new functions ──────────────────────────────────────
drop function if exists public.claim_task(uuid);
drop function if exists public.status_owner_of(text, text);
drop function if exists public.task_eligible_for_support_queue(uuid);
drop function if exists public.is_technical_support_staff();

-- No data is touched by this rollback — only function bodies,
-- triggers, and policy definitions.
