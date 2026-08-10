-- Phones are stored inconsistently (0549898292, +972504548843, 972-50-123...).
-- Everything the bot matches on goes through this first.
create or replace function public.norm_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or btrim(p) = '' then null
    when left(regexp_replace(p, '\D', '', 'g'), 1) = '0'
      then '972' || substr(regexp_replace(p, '\D', '', 'g'), 2)
    else regexp_replace(p, '\D', '', 'g')
  end
$$;;
