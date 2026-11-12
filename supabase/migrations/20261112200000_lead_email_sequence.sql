-- Follow-up emails for leads on the unresponsive-leads chain, sent from the
-- client's own sales mailbox.
--
-- Purely additive: three new tables. No existing table, row or policy is
-- touched by this file.

-- The emails themselves: which day, what subject, what text. Written by the
-- marketing side from the WhatsApp > Templates screen.
create table if not exists public.lead_email_steps (
  id          uuid primary key default gen_random_uuid(),
  day         integer not null check (day between 0 and 730),
  subject     text not null default '',
  body        text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row per lead per email, written BEFORE the email is sent. The unique
-- pair is what makes it impossible to send the same email to the same lead
-- twice, whatever restarts or however many copies of the worker run.
create table if not exists public.lead_email_log (
  id        uuid primary key default gen_random_uuid(),
  lead_id   uuid not null references public.leads(id) on delete cascade,
  -- restrict, not cascade: an email that has gone out cannot have its record
  -- erased by deleting the step. Switch the step off instead.
  step_id   uuid not null references public.lead_email_steps(id) on delete restrict,
  email     text not null,
  status    text not null check (status in ('sent', 'failed', 'skipped')),
  error     text,
  sent_at   timestamptz not null default now(),
  unique (lead_id, step_id)
);
create index if not exists lead_email_log_lead_idx on public.lead_email_log (lead_id, sent_at desc);

-- Addresses that asked not to be written to again. Keyed by the address in
-- lower case, so it holds for every lead that carries that address.
create table if not exists public.lead_email_unsubscribes (
  email            text primary key check (email = lower(email)),
  unsubscribed_at  timestamptz not null default now()
);

alter table public.lead_email_steps        enable row level security;
alter table public.lead_email_log          enable row level security;
alter table public.lead_email_unsubscribes enable row level security;

-- Steps are edited where the WhatsApp chains are, under the same permission.
drop policy if exists "lead_email_steps: view"   on public.lead_email_steps;
drop policy if exists "lead_email_steps: insert" on public.lead_email_steps;
drop policy if exists "lead_email_steps: update" on public.lead_email_steps;
drop policy if exists "lead_email_steps: delete" on public.lead_email_steps;
create policy "lead_email_steps: view" on public.lead_email_steps for select
  using (public.has_permission('whatsapp', 'view') or public.has_permission('leads', 'view'));
create policy "lead_email_steps: insert" on public.lead_email_steps for insert
  with check (public.has_permission('whatsapp', 'full'));
create policy "lead_email_steps: update" on public.lead_email_steps for update
  using (public.has_permission('whatsapp', 'full'))
  with check (public.has_permission('whatsapp', 'full'));
create policy "lead_email_steps: delete" on public.lead_email_steps for delete
  using (public.has_permission('whatsapp', 'full'));

-- The log and the unsubscribe list are written only by the server. People
-- with access to leads or WhatsApp may read them; nobody edits them by hand.
drop policy if exists "lead_email_log: view" on public.lead_email_log;
create policy "lead_email_log: view" on public.lead_email_log for select
  using (public.has_permission('whatsapp', 'view') or public.has_permission('leads', 'view'));
drop policy if exists "lead_email_unsubscribes: view" on public.lead_email_unsubscribes;
create policy "lead_email_unsubscribes: view" on public.lead_email_unsubscribes for select
  using (public.has_permission('whatsapp', 'view') or public.has_permission('leads', 'view'));
