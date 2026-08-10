-- One client may be contacted from several numbers (owner, app manager,
-- content manager). This resolves any of them back to the same client.
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
  public.norm_phone(c.phone) as phone
from public.clients c
where c.phone is not null and btrim(c.phone) <> ''

union all

select
  c.id,
  c.name,
  c.business_name,
  c.package::text,
  c.status::text,
  cc.name,
  cc.role::text,
  cc.phone,
  public.norm_phone(cc.phone)
from public.client_contacts cc
join public.clients c on c.id = cc.client_id
where cc.phone is not null and btrim(cc.phone) <> '';;
