-- ============================================================
-- ROLLBACK for 002_has_permission_and_rls.sql
--
-- NOT part of the forward migration sequence — never picked up by
-- `supabase db push`. Run manually only if 002 needs to be reverted:
--   supabase db query --linked --file supabase/migrations/002_down_rollback.sql
--
-- Restores the EXACT policies that were live in production immediately
-- before 002 (captured verbatim via a read-only `pg_policies` query
-- during the Step 0 audit — not reconstructed from schema.sql, which
-- was already known to be stale). Every policy name, role list, USING
-- and WITH CHECK clause below is a direct copy of what was actually
-- running, not an approximation.
--
-- Does NOT touch migration 001 (profiles.is_owner, the column-privilege
-- lockdown, has_permission()/can_manage_permissions(), the owner
-- immutability trigger) — that migration's rollback is documented in
-- its own file. Rolling back only 002 while keeping 001 is safe: the
-- has_permission()-based policies simply stop being used, is_admin()/
-- is_authenticated_staff() (never dropped by either migration) take
-- back over immediately.
-- ============================================================

-- ── profiles: restore the two original SELECT policies ────────
drop policy if exists "authenticated can view profiles" on public.profiles;

create policy "team can view profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can view own profile"
  on public.profiles for select
  using ((auth.uid() = id) or is_admin());

-- ── clients ──────────────────────────────────────────────────
drop policy if exists "clients: view"   on public.clients;
drop policy if exists "clients: insert" on public.clients;
drop policy if exists "clients: update" on public.clients;
drop policy if exists "clients: delete" on public.clients;

create policy "staff can view clients"   on public.clients for select using (is_authenticated_staff());
create policy "admin can insert clients" on public.clients for insert with check (is_admin());
create policy "admin can update clients" on public.clients for update using (is_admin());
create policy "admin can delete clients" on public.clients for delete using (is_admin());

-- ── client_contacts ──────────────────────────────────────────
drop policy if exists "client_contacts: view"   on public.client_contacts;
drop policy if exists "client_contacts: insert" on public.client_contacts;
drop policy if exists "client_contacts: update" on public.client_contacts;
drop policy if exists "client_contacts: delete" on public.client_contacts;

create policy "staff can view contacts"   on public.client_contacts for select using (is_authenticated_staff());
create policy "admin can insert contacts" on public.client_contacts for insert with check (is_admin());
create policy "admin can update contacts" on public.client_contacts for update using (is_admin());
create policy "admin can delete contacts" on public.client_contacts for delete using (is_admin());

-- ── billing_records ──────────────────────────────────────────
drop policy if exists "billing: view"   on public.billing_records;
drop policy if exists "billing: insert" on public.billing_records;
drop policy if exists "billing: update" on public.billing_records;
drop policy if exists "billing: delete" on public.billing_records;

create policy "staff can view billing"   on public.billing_records for select using (is_authenticated_staff());
create policy "admin can insert billing" on public.billing_records for insert with check (is_admin());
create policy "admin can update billing" on public.billing_records for update using (is_admin());
create policy "admin can delete billing" on public.billing_records for delete using (is_admin());

-- ── leads ────────────────────────────────────────────────────
drop policy if exists "leads: view"   on public.leads;
drop policy if exists "leads: insert" on public.leads;
drop policy if exists "leads: update" on public.leads;
drop policy if exists "leads: delete" on public.leads;

create policy "staff can view leads"   on public.leads for select using (is_authenticated_staff());
create policy "staff can insert leads" on public.leads for insert with check (is_authenticated_staff());
create policy "staff can update leads" on public.leads for update using (is_authenticated_staff());
create policy "admin can delete leads" on public.leads for delete using (is_admin());

-- ── messages (no update policy existed originally either) ─────
drop policy if exists "messages: view"   on public.messages;
drop policy if exists "messages: insert" on public.messages;
drop policy if exists "messages: delete" on public.messages;

create policy "staff can view messages"   on public.messages for select using (is_authenticated_staff());
create policy "staff can insert messages" on public.messages for insert with check (is_authenticated_staff());
create policy "admin can delete messages" on public.messages for delete using (is_admin());

-- ── agent_logs ───────────────────────────────────────────────
drop policy if exists "agent_logs: view"   on public.agent_logs;
drop policy if exists "agent_logs: delete" on public.agent_logs;

create policy "staff can view agent logs" on public.agent_logs for select using (is_authenticated_staff());
create policy "admin can delete agent logs" on public.agent_logs for delete using (is_admin());

-- ── tasks (was a single ALL policy, USING true, no explicit WITH CHECK) ──
drop policy if exists "tasks: view"   on public.tasks;
drop policy if exists "tasks: insert" on public.tasks;
drop policy if exists "tasks: update" on public.tasks;
drop policy if exists "tasks: delete" on public.tasks;

create policy "authenticated users can manage tasks"
  on public.tasks for all
  to authenticated
  using (true);

-- ── boards ───────────────────────────────────────────────────
drop policy if exists "boards: view"   on public.boards;
drop policy if exists "boards: insert" on public.boards;
drop policy if exists "boards: update" on public.boards;
drop policy if exists "boards: delete" on public.boards;

create policy "authenticated full access"
  on public.boards for all
  to authenticated
  using (true) with check (true);

-- ── bot_config ───────────────────────────────────────────────
drop policy if exists "bot_config: view"   on public.bot_config;
drop policy if exists "bot_config: insert" on public.bot_config;
drop policy if exists "bot_config: update" on public.bot_config;
drop policy if exists "bot_config: delete" on public.bot_config;

create policy "authenticated full access bot_config"
  on public.bot_config for all
  to authenticated
  using (true) with check (true);

-- ── bot_training ─────────────────────────────────────────────
drop policy if exists "bot_training: view"   on public.bot_training;
drop policy if exists "bot_training: insert" on public.bot_training;
drop policy if exists "bot_training: update" on public.bot_training;
drop policy if exists "bot_training: delete" on public.bot_training;

create policy "authenticated full access bot_training"
  on public.bot_training for all
  to authenticated
  using (true) with check (true);

-- ── message_templates ────────────────────────────────────────
drop policy if exists "message_templates: view"   on public.message_templates;
drop policy if exists "message_templates: insert" on public.message_templates;
drop policy if exists "message_templates: update" on public.message_templates;
drop policy if exists "message_templates: delete" on public.message_templates;

create policy "authenticated full access templates"
  on public.message_templates for all
  to authenticated
  using (true) with check (true);

-- ── sequences ────────────────────────────────────────────────
drop policy if exists "sequences: view"   on public.sequences;
drop policy if exists "sequences: insert" on public.sequences;
drop policy if exists "sequences: update" on public.sequences;
drop policy if exists "sequences: delete" on public.sequences;

create policy "authenticated full access sequences"
  on public.sequences for all
  to authenticated
  using (true) with check (true);

-- ── sequence_steps ───────────────────────────────────────────
drop policy if exists "sequence_steps: view"   on public.sequence_steps;
drop policy if exists "sequence_steps: insert" on public.sequence_steps;
drop policy if exists "sequence_steps: update" on public.sequence_steps;
drop policy if exists "sequence_steps: delete" on public.sequence_steps;

create policy "authenticated full access sequence_steps"
  on public.sequence_steps for all
  to authenticated
  using (true) with check (true);

-- ── pending_whatsapp_messages ────────────────────────────────
drop policy if exists "pending_whatsapp_messages: view"   on public.pending_whatsapp_messages;
drop policy if exists "pending_whatsapp_messages: insert" on public.pending_whatsapp_messages;
drop policy if exists "pending_whatsapp_messages: update" on public.pending_whatsapp_messages;
drop policy if exists "pending_whatsapp_messages: delete" on public.pending_whatsapp_messages;

create policy "team can add pending messages"    on public.pending_whatsapp_messages for insert to authenticated with check (true);
create policy "team can view pending messages"   on public.pending_whatsapp_messages for select to authenticated using (true);
create policy "team can update pending messages" on public.pending_whatsapp_messages for update to authenticated using (true) with check (true);
create policy "team can delete pending messages" on public.pending_whatsapp_messages for delete to authenticated using (true);

-- ── conversation_state (no delete policy existed originally) ──
drop policy if exists "conversation_state: view"   on public.conversation_state;
drop policy if exists "conversation_state: insert" on public.conversation_state;
drop policy if exists "conversation_state: update" on public.conversation_state;

create policy "team can set conversation state"    on public.conversation_state for insert to authenticated with check (true);
create policy "team can view conversation state"   on public.conversation_state for select to authenticated using (true);
create policy "team can change conversation state" on public.conversation_state for update to authenticated using (true) with check (true);

-- ── bot_conversations (no update/delete policy existed originally) ──
drop policy if exists "bot_conversations: view"   on public.bot_conversations;
drop policy if exists "bot_conversations: insert" on public.bot_conversations;

create policy "team can add conversations"  on public.bot_conversations for insert to authenticated with check (true);
create policy "team can view conversations" on public.bot_conversations for select to authenticated using (true);

-- ── lead_sequence_progress ───────────────────────────────────
drop policy if exists "lead_sequence_progress: view"   on public.lead_sequence_progress;
drop policy if exists "lead_sequence_progress: insert" on public.lead_sequence_progress;
drop policy if exists "lead_sequence_progress: update" on public.lead_sequence_progress;
drop policy if exists "lead_sequence_progress: delete" on public.lead_sequence_progress;

create policy "team can manage sequence progress" on public.lead_sequence_progress for all to authenticated using (true) with check (true);
create policy "team can view sequence progress"   on public.lead_sequence_progress for select to authenticated using (true);

-- notifications: 002 never touched this table, nothing to roll back.
