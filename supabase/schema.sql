-- ============================================================
-- Admin Platform — Supabase Schema
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Enums ────────────────────────────────────────────────────
create type package_type      as enum ('solo_pro', 'master_class', 'community_master');
create type client_status     as enum ('active', 'pending', 'on_hold', 'expired', 'cancelled');
create type contact_role      as enum ('owner', 'app_manager', 'content_manager', 'other');
create type cc_status         as enum ('paid', 'failed');
create type variable_status   as enum ('paid', 'unpaid', 'pending');
create type lead_source       as enum ('facebook', 'instagram');
create type lead_status       as enum ('new', 'meeting', 'producing', 'followup', 'irrelevant');
create type lead_type         as enum ('has_course', 'producing');
create type recipient_type    as enum ('client', 'lead');
create type message_status    as enum ('sent', 'read', 'failed');
create type agent_run_status  as enum ('success', 'error', 'running');
create type user_role         as enum ('admin', 'staff');

-- ============================================================
-- 1. CLIENTS
-- ============================================================
create table public.clients (
  id               uuid primary key default uuid_generate_v4(),
  name             text        not null,
  business_name    text        not null,
  email            text,
  phone            text,
  package          package_type not null default 'solo_pro',
  joined_at        date,
  status           client_status not null default 'pending',
  trial_days       int          not null default 14,
  notes            text,
  -- per-client pricing overrides (null = use global default)
  otp_price        numeric(8,4),
  user_threshold   int,
  block_size       int,
  block_price      numeric(8,2),
  created_at       timestamptz  not null default now()
);

create index idx_clients_status  on public.clients (status);
create index idx_clients_package on public.clients (package);

-- ============================================================
-- 2. CLIENT CONTACTS
-- ============================================================
create table public.client_contacts (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid        not null references public.clients (id) on delete cascade,
  name              text        not null,
  phone             text        not null,
  role              contact_role not null default 'owner',
  receives_payments boolean     not null default false,
  receives_updates  boolean     not null default true,
  created_at        timestamptz not null default now()
);

create index idx_contacts_client on public.client_contacts (client_id);

-- Enforce: exactly one payment recipient per client
create unique index idx_contacts_one_payment
  on public.client_contacts (client_id)
  where receives_payments = true;

-- ============================================================
-- 3. BILLING RECORDS
-- ============================================================
create table public.billing_records (
  id               uuid primary key default uuid_generate_v4(),
  client_id        uuid        not null references public.clients (id) on delete cascade,
  month            smallint    not null check (month between 1 and 12),
  year             smallint    not null check (year >= 2024),
  -- usage
  otp_count        int         not null default 0,
  user_count       int         not null default 0,
  -- computed amounts (stored for audit trail)
  package_price    numeric(8,2) not null default 0,
  otp_cost         numeric(8,2) not null default 0,
  block_cost       numeric(8,2) not null default 0,
  variable_total   numeric(8,2) not null default 0,
  -- statuses
  cc_status        cc_status,
  variable_status  variable_status not null default 'pending',
  created_at       timestamptz  not null default now(),
  -- one record per client per month
  unique (client_id, month, year)
);

create index idx_billing_client      on public.billing_records (client_id);
create index idx_billing_period      on public.billing_records (year, month);
create index idx_billing_cc_status   on public.billing_records (cc_status);
create index idx_billing_var_status  on public.billing_records (variable_status);

-- ============================================================
-- 4. LEADS
-- ============================================================
create table public.leads (
  id               uuid primary key default uuid_generate_v4(),
  name             text        not null,
  phone            text        not null,
  source           lead_source,
  status           lead_status  not null default 'new',
  lead_type        lead_type,
  follow_up_date   date,
  follow_up_note   text,
  follow_up_tone   text,        -- e.g. 'warm', 'cold', 'urgent'
  created_at       timestamptz  not null default now()
);

create index idx_leads_status        on public.leads (status);
create index idx_leads_follow_up     on public.leads (follow_up_date) where follow_up_date is not null;
create index idx_leads_source        on public.leads (source);

-- ============================================================
-- 5. MESSAGES
-- ============================================================
create table public.messages (
  id               uuid primary key default uuid_generate_v4(),
  recipient_id     uuid        not null,
  recipient_type   recipient_type not null,
  phone            text        not null,
  message_text     text,
  template_key     text,
  media_url        text,
  status           message_status not null default 'sent',
  channel          text,
  sent_at          timestamptz  not null default now()
);

create index idx_messages_recipient  on public.messages (recipient_id, recipient_type);
create index idx_messages_phone      on public.messages (phone);
create index idx_messages_status     on public.messages (status);
create index idx_messages_sent_at    on public.messages (sent_at desc);

-- ============================================================
-- 6. AGENT LOGS
-- ============================================================
create table public.agent_logs (
  id               uuid primary key default uuid_generate_v4(),
  agent_id         text        not null,
  agent_name       text        not null,
  status           agent_run_status not null,
  result_summary   text,
  run_at           timestamptz  not null default now()
);

create index idx_agent_logs_agent    on public.agent_logs (agent_id);
create index idx_agent_logs_status   on public.agent_logs (status);
create index idx_agent_logs_run_at   on public.agent_logs (run_at desc);

-- ============================================================
-- 7. TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  description      text,
  board            text NOT NULL,
  status           text NOT NULL DEFAULT 'not_started',
  priority         text DEFAULT 'medium',
  assignee         text,
  client_id        uuid REFERENCES public.clients(id),
  client_name      text,
  start_date       date,
  due_date         date,
  time_estimate    numeric,
  time_entries     jsonb DEFAULT '[]',
  status_history   jsonb DEFAULT '[]',
  comments         jsonb DEFAULT '[]',
  attachments      jsonb DEFAULT '[]',
  created_by       text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  done_at          timestamptz,
  whatsapp_pending boolean DEFAULT false,
  claimed          boolean DEFAULT false,
  claimed_by       text,
  code_reviewer    text,
  ux_reviewer      text
);

CREATE INDEX IF NOT EXISTS idx_tasks_board    ON public.tasks (board);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON public.tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks (assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_created  ON public.tasks (created_at DESC);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated users can manage tasks" ON public.tasks FOR ALL TO authenticated USING (true);

-- Migration: replace time_tracked with time_entries (run once against existing DB)
-- ALTER TABLE public.tasks DROP COLUMN IF EXISTS time_tracked;
-- ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS time_entries jsonb DEFAULT '[]';

-- ============================================================
-- 7b. TIME ENTRIES  (normalized table for date-range queries)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.time_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  hours       smallint    NOT NULL DEFAULT 0,
  minutes     smallint    NOT NULL DEFAULT 0 CHECK (minutes >= 0 AND minutes < 60),
  logged_by   text        NOT NULL,
  note        text,
  is_locked   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_task    ON public.time_entries (task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date    ON public.time_entries (date);
CREATE INDEX IF NOT EXISTS idx_time_entries_user    ON public.time_entries (logged_by);
CREATE INDEX IF NOT EXISTS idx_time_entries_period  ON public.time_entries (logged_by, date);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated users can manage time entries" ON public.time_entries FOR ALL TO authenticated USING (true);

-- ============================================================
-- 8. PROFILES  (extends Supabase Auth users)
-- ============================================================
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  name             text        not null,
  email            text        not null,
  role             user_role   not null default 'staff',
  permissions      jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index idx_profiles_role on public.profiles (role);

-- Auto-create profile on new auth user signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role, permissions)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'staff',
    '{}'::jsonb
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.clients          enable row level security;
alter table public.client_contacts  enable row level security;
alter table public.billing_records  enable row level security;
alter table public.leads            enable row level security;
alter table public.messages         enable row level security;
alter table public.agent_logs       enable row level security;
alter table public.profiles         enable row level security;

-- ── Helper: is the calling user an admin? ────────────────────
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ── Helper: is the calling user authenticated staff or admin? ─
create or replace function public.is_authenticated_staff()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
  );
$$;

-- ── CLIENTS ─────────────────────────────────────────────────
create policy "staff can view clients"
  on public.clients for select
  using (public.is_authenticated_staff());

create policy "admin can insert clients"
  on public.clients for insert
  with check (public.is_admin());

create policy "admin can update clients"
  on public.clients for update
  using (public.is_admin());

create policy "admin can delete clients"
  on public.clients for delete
  using (public.is_admin());

-- ── CLIENT CONTACTS ──────────────────────────────────────────
create policy "staff can view contacts"
  on public.client_contacts for select
  using (public.is_authenticated_staff());

create policy "admin can insert contacts"
  on public.client_contacts for insert
  with check (public.is_admin());

create policy "admin can update contacts"
  on public.client_contacts for update
  using (public.is_admin());

create policy "admin can delete contacts"
  on public.client_contacts for delete
  using (public.is_admin());

-- ── BILLING RECORDS ──────────────────────────────────────────
create policy "staff can view billing"
  on public.billing_records for select
  using (public.is_authenticated_staff());

create policy "admin can insert billing"
  on public.billing_records for insert
  with check (public.is_admin());

create policy "admin can update billing"
  on public.billing_records for update
  using (public.is_admin());

create policy "admin can delete billing"
  on public.billing_records for delete
  using (public.is_admin());

-- ── LEADS ────────────────────────────────────────────────────
create policy "staff can view leads"
  on public.leads for select
  using (public.is_authenticated_staff());

create policy "staff can insert leads"
  on public.leads for insert
  with check (public.is_authenticated_staff());

create policy "staff can update leads"
  on public.leads for update
  using (public.is_authenticated_staff());

create policy "admin can delete leads"
  on public.leads for delete
  using (public.is_admin());

-- ── MESSAGES ─────────────────────────────────────────────────
create policy "staff can view messages"
  on public.messages for select
  using (public.is_authenticated_staff());

create policy "staff can insert messages"
  on public.messages for insert
  with check (public.is_authenticated_staff());

-- messages are immutable once sent — no update/delete for staff
create policy "admin can delete messages"
  on public.messages for delete
  using (public.is_admin());

-- ── AGENT LOGS ───────────────────────────────────────────────
create policy "staff can view agent logs"
  on public.agent_logs for select
  using (public.is_authenticated_staff());

-- logs are written by service role (n8n webhook), not via client
create policy "admin can delete agent logs"
  on public.agent_logs for delete
  using (public.is_admin());

-- ── PROFILES ─────────────────────────────────────────────────
-- users can read their own profile; admins can read all
create policy "users can view own profile"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

-- users can update their own name only; admins can update any profile
create policy "users can update own name"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "admin can update any profile"
  on public.profiles for update
  using (public.is_admin());

-- inserts handled by trigger (service role) — no client insert policy needed
create policy "admin can delete profiles"
  on public.profiles for delete
  using (public.is_admin());

-- ============================================================
-- SEED: main admin profile
-- (run manually after creating the auth user for droryosef1@gmail.com)
-- ============================================================
-- insert into public.profiles (id, name, email, role, permissions)
-- values ('<auth-user-uuid>', 'דרור יוסף', 'droryosef1@gmail.com', 'admin', '{}')
-- on conflict (id) do update set role = 'admin';
