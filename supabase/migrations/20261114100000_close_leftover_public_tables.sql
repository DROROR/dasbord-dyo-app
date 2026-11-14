-- Closes what is left over from an older, unrelated app that once shared this
-- database: four empty mxb_* tables and three functions written for a table
-- that no longer exists.
--
-- The planner reads and writes none of them. Two of the tables still carried a
-- policy of plain "true", so anybody holding the public browser key could
-- write rows into them, and the functions could be called without signing in.
-- Nothing is dropped and no row is touched (the tables are empty): the browser
-- roles simply lose their access, the same way
-- 20260930120000_lock_unused_public_tables.sql closed the others.

revoke all on table public.mxb_credit_transactions   from anon, authenticated;
revoke all on table public.mxb_exchange_interactions from anon, authenticated;
revoke all on table public.mxb_exchange_replies      from anon, authenticated;
revoke all on table public.mxb_member_messages       from anon, authenticated;

revoke execute on function public.get_member_by_email(text)             from public, anon, authenticated;
revoke execute on function public.get_member_by_activation_token(text)  from public, anon, authenticated;
revoke execute on function public.update_member_password(uuid, text)    from public, anon, authenticated;
