-- Include the client's age so the resolver below can break ties.
create or replace view public.client_phone_directory as
select
  c.id            as client_id,
  c.name          as client_name,
  c.business_name as app_name,
  c.package::text as package,
  c.status::text  as status,
  null::text      as contact_name,
  'owner'::text   as contact_role,
  c.phone         as phone_raw,
  public.norm_phone(c.phone) as phone,
  c.created_at    as client_created_at
from public.clients c
where c.phone is not null and btrim(c.phone) <> ''

union all

select
  c.id, c.name, c.business_name, c.package::text, c.status::text,
  cc.name, cc.role::text, cc.phone,
  public.norm_phone(cc.phone), c.created_at
from public.client_contacts cc
join public.clients c on c.id = cc.client_id
where cc.phone is not null and btrim(cc.phone) <> '';

-- The customer records contain duplicates (same person entered more than
-- once). The bot must always land on the same client for a given number, so
-- prefer an active record, then the original one.
create or replace view public.client_for_phone as
select distinct on (phone)
  phone, client_id, client_name, app_name, package, status, contact_name, contact_role, phone_raw
from public.client_phone_directory
order by phone,
         (status = 'active') desc,
         client_created_at asc,
         client_id asc;;
