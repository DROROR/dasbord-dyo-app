-- Email template: a single editable row that the admin fills in from the
-- "Email Format" page. The AI agent fetches this via the get-email-template
-- Edge Function and merges {{email}} / {{password}} before sending the
-- welcome email to a new vendor who just paid on WooCommerce.
--
-- Only one row ever exists (id = 1). Upsert on the page always targets
-- that row, so there is no insert path — only update.

create table if not exists public.email_template (
  id            int primary key default 1 check (id = 1),  -- enforces singleton
  subject       text not null default 'Welcome to DYO — Your Login Details',
  header        text not null default 'Welcome aboard!',
  body_above    text not null default 'Here are your login details to access the platform:',
  body_below    text not null default 'If you have any questions, feel free to reach out to us.',
  footer        text not null default 'The DYO Team',
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null
);

-- Seed the single row so the page always has something to show on first load.
insert into public.email_template (id) values (1) on conflict (id) do nothing;

-- Stamp updated_at automatically on every save.
create or replace function public.stamp_email_template_updated()
returns trigger language plpgsql security definer as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_stamp_email_template on public.email_template;
create trigger trg_stamp_email_template
  before update on public.email_template
  for each row execute function public.stamp_email_template_updated();

alter table public.email_template enable row level security;

-- Any active authenticated user may read the template (the Edge Function
-- also exposes it publicly for the AI agent, but staff previewing the
-- email format page need direct read access too).
drop policy if exists "email_template: view" on public.email_template;
create policy "email_template: view"
  on public.email_template for select
  using (caller_is_active());

-- Admins (role = 'admin') or users explicitly granted email_format:full may update.
drop policy if exists "email_template: edit" on public.email_template;
create policy "email_template: edit"
  on public.email_template for update
  using (
    has_permission('email_format', 'full')
    OR (
      caller_is_active()
      AND (select role from public.profiles where id = auth.uid()) = 'admin'
    )
  )
  with check (
    has_permission('email_format', 'full')
    OR (
      caller_is_active()
      AND (select role from public.profiles where id = auth.uid()) = 'admin'
    )
  );
