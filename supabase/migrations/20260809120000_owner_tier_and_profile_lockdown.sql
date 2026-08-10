-- ============================================================
-- 001: Owner tier + profiles lockdown
--
-- Closes a live self-privilege-escalation bug: the existing
-- "users can update own name" RLS policy restricts ROWS
-- (auth.uid() = id) but not COLUMNS, so any staff user could set
-- their own role/permissions to admin/full via the anon-key client.
--
-- Introduces a 3rd tier ("owner") identified by profiles.is_owner,
-- NOT a new user_role enum value (ALTER TYPE ... ADD VALUE cannot be
-- used in the same transaction it's created in, which would force
-- this into two migrations; a boolean column is purely additive,
-- has no blast radius on existing role='admin' checks, and is
-- trivially reversible).
-- ============================================================

-- ── 1. Columns ────────────────────────────────────────────────
-- is_technical_support already exists live (confirmed via Step 0
-- audit) but was missing from this file — added defensively with
-- IF NOT EXISTS so this migration is safe to run regardless.
alter table public.profiles
  add column if not exists is_technical_support boolean not null default false;

alter table public.profiles
  add column if not exists is_owner boolean not null default false;

-- ── 2. Single-owner invariant ────────────────────────────────
create unique index if not exists profiles_single_owner
  on public.profiles ((1))
  where is_owner;

alter table public.profiles
  add constraint profiles_owner_is_admin check (not is_owner or role = 'admin') not valid;
alter table public.profiles
  validate constraint profiles_owner_is_admin;

-- ── 3. One-time owner promotion ──────────────────────────────
-- UUID resolved and explicitly confirmed by the account holder in
-- conversation (not matched by email inside this migration) —
-- see Step 0 audit: droryosef1@gmail.com = 9119ab55-b733-49b9-ad82-3e6e0f3f932e.
-- Fails loudly rather than silently leaving the system without an
-- owner if the row is ever missing (e.g. re-run against a different DB).
do $$
begin
  update public.profiles
     set is_owner = true, role = 'admin'
   where id = '9119ab55-b733-49b9-ad82-3e6e0f3f932e'::uuid;
  if not found then
    raise exception 'owner promotion failed: profile 9119ab55-b733-49b9-ad82-3e6e0f3f932e not found';
  end if;
end $$;

-- ── 4. Real default for profiles.permissions ─────────────────
-- Column default AND explicit inserts (handle_new_user below, and
-- create-member's own insert) both set this — belt-and-suspenders
-- so no insert path can ever land a profile with an empty grant.
alter table public.profiles
  alter column permissions
  set default '{"dashboard":"view","clients":"view","billing":"none","whatsapp":"none","leads":"view","agents":"none","work":"edit","pricing":"none","permissions":"none"}'::jsonb;

-- ── 5. Backfill existing rows — MERGE, never overwrite ────────
-- Confirmed via live read-only query before writing this: permissions
-- is NOT uniformly '{}' today. At least one staff row already has a
-- deliberately customized grant (dashboard/clients set to 'none',
-- diverging from the client-side default) — almost certainly set by
-- an admin through the Permissions UI, even though nothing enforced
-- it server-side until now. A blind `set permissions = <default>`
-- would have silently erased that admin's decision. Using jsonb `||`
-- instead: existing keys always win, only genuinely MISSING keys are
-- filled from the role default. For rows that are already fully
-- populated (several are) this is a no-op; for droryosef1@gmail.com
-- specifically (permissions = '{}' today) this fills in the full
-- grant, though it's moot for them either way since is_owner bypasses
-- has_permission()/can_manage_permissions() regardless of what's
-- stored here.
update public.profiles
   set permissions = '{"dashboard":"view","clients":"full","billing":"full","whatsapp":"full","leads":"full","agents":"full","work":"full","pricing":"full","permissions":"full"}'::jsonb || permissions
 where role = 'admin';

update public.profiles
   set permissions = '{"dashboard":"view","clients":"view","billing":"none","whatsapp":"none","leads":"view","agents":"none","work":"edit","pricing":"none","permissions":"none"}'::jsonb || permissions
 where role = 'staff';

-- ── 6. New-user trigger: explicit grant, not just the column default ─
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role, permissions)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'staff',
    '{"dashboard":"view","clients":"view","billing":"none","whatsapp":"none","leads":"view","agents":"none","work":"edit","pricing":"none","permissions":"none"}'::jsonb
  );
  return new;
end;
$$;

-- ── 7. Close the self-escalation hole: column-level privileges ──
-- RLS restricts which ROWS a query can touch; it cannot restrict
-- which COLUMNS within an allowed row. Table-level UPDATE grants
-- to authenticated/anon are Supabase's default and make the "own
-- name only" policy's name a lie today (nothing stops role/
-- permissions from being sent in the same UPDATE). Fix at the
-- privilege layer, which PostgREST/Postgres enforce before RLS is
-- even evaluated: role/permissions/is_owner become impossible to
-- update from the browser, full stop, for every role. All role/
-- permission writes move to a service-role Edge Function.
revoke update on public.profiles from authenticated, anon;
grant update (name) on public.profiles to authenticated;

-- ── 8. permission_rank(): pure lookup, no table access ───────
-- Returns NULL (not a numeric default) for any unrecognized level
-- string. This makes has_permission() fail closed symmetrically:
-- an unrecognized STORED permission value can never satisfy any
-- requirement (NULL >= anything is not true), and an unrecognized
-- REQUIRED level can never be satisfied either (anything >= NULL
-- is not true) — there is no fallback path that accidentally
-- becomes permissive.
create or replace function public.permission_rank(lvl text)
returns int language sql immutable as $$
  select case lvl
    when 'full' then 3
    when 'edit' then 2
    when 'send' then 2   -- whatsapp's name for the 'edit' tier
    when 'view' then 1
    when 'none' then 0
    else null
  end;
$$;

-- ── 9. has_permission(): the single source of truth for RLS ──
create or replace function public.has_permission(module text, min_level text default 'view')
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and ( p.is_owner
            or public.permission_rank(coalesce(p.permissions ->> module, 'none'))
               >= public.permission_rank(min_level) )
  );
$$;

-- ── 10. can_manage_permissions(): who may reach the Permissions page ──
-- Deliberately does NOT give role='admin' a free pass — under the
-- new model an admin only gets this if the owner explicitly
-- granted permissions.permissions = 'full'.
create or replace function public.can_manage_permissions()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and ( p.is_owner
            or (p.role = 'admin' and public.permission_rank(p.permissions ->> 'permissions') = 3) )
  );
$$;

-- ── 11. Hardening: explicit search_path + execute grants ─────
-- is_admin()/is_authenticated_staff() already had search_path set;
-- apply the same to the new functions, and explicitly limit who
-- can even call them (auth.uid() is NULL for anon regardless, but
-- this removes the reliance on that side effect).
revoke execute on function public.has_permission(text, text) from public;
grant  execute on function public.has_permission(text, text) to authenticated;

revoke execute on function public.can_manage_permissions() from public;
grant  execute on function public.can_manage_permissions() to authenticated;

-- ── 12. Owner-row immutability trigger ────────────────────────
-- Runs regardless of caller privilege (including service-role,
-- unlike RLS/GRANTs which service-role bypasses) — the last line
-- of defence against a bug in the update-member-permissions Edge
-- Function or a manual SQL Editor mistake.
--
-- Blocked always, on any row: changing is_owner itself (covers
-- both accidental self-promotion and accidental demotion of the
-- real owner). Blocked only when the row IS the owner: changing
-- role/permissions, or deleting the row. Everything else — name,
-- email, is_technical_support — remains freely editable, including
-- for the owner's own row (e.g. they can still rename themselves).
--
-- Intentional escape hatch for a real ownership transfer:
--   alter table public.profiles disable trigger trg_enforce_profile_role_rules;
--   -- make the change --
--   alter table public.profiles enable trigger trg_enforce_profile_role_rules;
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

drop trigger if exists trg_enforce_profile_role_rules on public.profiles;
create trigger trg_enforce_profile_role_rules
  before update or delete on public.profiles
  for each row execute function public.enforce_profile_role_rules();
