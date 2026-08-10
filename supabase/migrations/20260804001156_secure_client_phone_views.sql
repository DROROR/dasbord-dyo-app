-- Without this a view runs as its owner and ignores the caller's row-level
-- security on clients. security_invoker keeps the caller's permissions.
alter view public.client_phone_directory set (security_invoker = true);
alter view public.client_for_phone      set (security_invoker = true);

grant select on public.client_phone_directory to authenticated;
grant select on public.client_for_phone      to authenticated;;
