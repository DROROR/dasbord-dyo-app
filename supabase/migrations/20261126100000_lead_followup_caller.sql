-- The daily follow-up reminder is for whoever makes the sales calls, not for
-- everyone who can edit leads (admins get that by default). Set by hand:
--   update public.profiles set handles_lead_followups = true where email = '...';
alter table public.profiles
  add column if not exists handles_lead_followups boolean not null default false;

update public.profiles
set handles_lead_followups = true
where email = 'neufeld1994@gmail.com';
