-- Which of the support board's two tabs a ticket shows under, when a human
-- has decided it by hand.
--
-- The tabs are derived from the ticket's category (`general` → Development
-- Requests, everything else → Support Tickets), which the admin app sends and
-- which `tasks.ticket_details` stores read-only — the create-support-ticket
-- edge function is its only writer, so re-classifying a ticket could not be
-- expressed there without the dashboard overwriting what the admin sent.
--
-- This column is the dashboard's own, and holds nothing but that manual
-- decision: null means "no decision, keep deriving it from the category",
-- which is every ticket that exists today. The Owner moving a ticket between
-- the two tabs sets it; nothing else ever writes it.
alter table public.tasks
  add column if not exists ticket_kind text;

alter table public.tasks drop constraint if exists tasks_ticket_kind_check;
alter table public.tasks add constraint tasks_ticket_kind_check
  check (ticket_kind is null or ticket_kind in ('support', 'development'));

comment on column public.tasks.ticket_kind is
  'Manual override for which support-board tab a ticket shows under: support | development, or null to derive it from ticket_details.category. Dashboard-owned; the create-support-ticket edge function never writes it.';
