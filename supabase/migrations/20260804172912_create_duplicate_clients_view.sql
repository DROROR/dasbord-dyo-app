-- Customers that appear more than once. Matched on the WooCommerce customer
-- id first, falling back to email, since that is how the shop identifies them.
create or replace view public.duplicate_clients as
with keyed as (
  select c.*,
         coalesce(nullif(btrim(c.woo_customer_id), ''), 'email:' || lower(btrim(c.email))) as dup_key
  from public.clients c
  where coalesce(nullif(btrim(c.woo_customer_id), ''), nullif(btrim(c.email), '')) is not null
),
groups as (
  select dup_key from keyed group by dup_key having count(*) > 1
)
select k.id, k.name, k.business_name, k.email, k.phone, k.status::text as status,
       k.package::text as package, k.joined_at, k.created_at, k.woo_customer_id,
       k.dup_key,
       (select count(*) from public.billing_records b where b.client_id = k.id) as billing_count,
       (select count(*) from public.tasks t          where t.client_id = k.id) as task_count,
       (select count(*) from public.client_contacts cc where cc.client_id = k.id) as contact_count
from keyed k
join groups g on g.dup_key = k.dup_key
order by k.dup_key, k.created_at;

alter view public.duplicate_clients set (security_invoker = true);
grant select on public.duplicate_clients to authenticated;;
