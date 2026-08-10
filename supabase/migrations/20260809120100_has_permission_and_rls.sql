-- ============================================================
-- 002: Granular RLS driven by has_permission()
--
-- Before this migration, every table's RLS (per the Step 0 live-DB
-- audit, not just schema.sql) fell into one of two buckets:
--   - clients/client_contacts/billing_records/leads/messages/
--     agent_logs: admin-or-authenticated-staff binary checks that
--     never looked at profiles.permissions at all.
--   - boards/bot_config/bot_conversations/bot_training/
--     conversation_state/lead_sequence_progress/message_templates/
--     pending_whatsapp_messages/sequence_steps/sequences/tasks:
--     USING (true) for any authenticated user, i.e. no real RLS.
--
-- Note: schema.sql also defines a normalized `time_entries` table,
-- but the Step 0 audit confirmed it does NOT exist in the live
-- database — time tracking lives entirely in tasks.time_entries
-- (jsonb) today. Nothing to migrate for a table that isn't there;
-- schema.sql is corrected separately to stop documenting it as live.
--
-- Per product decisions: (A) clients/billing/client_contacts open
-- to the granular permission instead of staying admin-only, (B)
-- SELECT is tightened to the same permission as writes, not left
-- broad. merge_clients() is SECURITY INVOKER (confirmed via Step 0
-- audit), so it is automatically bound by whatever RLS is set here
-- on clients/billing_records/client_contacts — no separate guard
-- needed inside that function.
-- ============================================================

-- ── profiles: consolidate SELECT (from 001 + already-live drift) ──
-- Step 0 found production already has a "team can view profiles"
-- policy (using true) beyond what schema.sql documented — needed
-- so staff can resolve teammate names for assignment pickers
-- (task assignee, lead follow-up owner, etc.) even with no
-- 'permissions' module access of their own. Keep that behavior,
-- drop the now-redundant narrower policy it superseded.
drop policy if exists "users can view own profile" on public.profiles;
drop policy if exists "team can view profiles" on public.profiles;
create policy "authenticated can view profiles"
  on public.profiles for select
  to authenticated
  using (true);

-- ── clients ──────────────────────────────────────────────────
drop policy if exists "staff can view clients" on public.clients;
drop policy if exists "admin can insert clients" on public.clients;
drop policy if exists "admin can update clients" on public.clients;
drop policy if exists "admin can delete clients" on public.clients;

create policy "clients: view" on public.clients for select
  using (public.has_permission('clients', 'view'));
create policy "clients: insert" on public.clients for insert
  with check (public.has_permission('clients', 'edit'));
create policy "clients: update" on public.clients for update
  using (public.has_permission('clients', 'edit'))
  with check (public.has_permission('clients', 'edit'));
create policy "clients: delete" on public.clients for delete
  using (public.has_permission('clients', 'full'));

-- ── client_contacts ──────────────────────────────────────────
drop policy if exists "staff can view contacts" on public.client_contacts;
drop policy if exists "admin can insert contacts" on public.client_contacts;
drop policy if exists "admin can update contacts" on public.client_contacts;
drop policy if exists "admin can delete contacts" on public.client_contacts;

create policy "client_contacts: view" on public.client_contacts for select
  using (public.has_permission('clients', 'view'));
create policy "client_contacts: insert" on public.client_contacts for insert
  with check (public.has_permission('clients', 'edit'));
create policy "client_contacts: update" on public.client_contacts for update
  using (public.has_permission('clients', 'edit'))
  with check (public.has_permission('clients', 'edit'));
create policy "client_contacts: delete" on public.client_contacts for delete
  using (public.has_permission('clients', 'edit'));

-- ── billing_records (module has no 'edit' tier — none/view/full only) ──
drop policy if exists "staff can view billing" on public.billing_records;
drop policy if exists "admin can insert billing" on public.billing_records;
drop policy if exists "admin can update billing" on public.billing_records;
drop policy if exists "admin can delete billing" on public.billing_records;

create policy "billing: view" on public.billing_records for select
  using (public.has_permission('billing', 'view'));
create policy "billing: insert" on public.billing_records for insert
  with check (public.has_permission('billing', 'full'));
create policy "billing: update" on public.billing_records for update
  using (public.has_permission('billing', 'full'))
  with check (public.has_permission('billing', 'full'));
create policy "billing: delete" on public.billing_records for delete
  using (public.has_permission('billing', 'full'));

-- ── leads ────────────────────────────────────────────────────
drop policy if exists "staff can view leads" on public.leads;
drop policy if exists "staff can insert leads" on public.leads;
drop policy if exists "staff can update leads" on public.leads;
drop policy if exists "admin can delete leads" on public.leads;

create policy "leads: view" on public.leads for select
  using (public.has_permission('leads', 'view'));
create policy "leads: insert" on public.leads for insert
  with check (public.has_permission('leads', 'edit'));
create policy "leads: update" on public.leads for update
  using (public.has_permission('leads', 'edit'))
  with check (public.has_permission('leads', 'edit'));
create policy "leads: delete" on public.leads for delete
  using (public.has_permission('leads', 'full'));

-- ── messages (immutable once sent — no update policy, as before) ──
drop policy if exists "staff can view messages" on public.messages;
drop policy if exists "staff can insert messages" on public.messages;
drop policy if exists "admin can delete messages" on public.messages;

create policy "messages: view" on public.messages for select
  using (public.has_permission('whatsapp', 'view'));
create policy "messages: insert" on public.messages for insert
  with check (public.has_permission('whatsapp', 'send'));
create policy "messages: delete" on public.messages for delete
  using (public.has_permission('whatsapp', 'full'));

-- ── agent_logs (writes stay service-role only, as before) ────
drop policy if exists "staff can view agent logs" on public.agent_logs;
drop policy if exists "admin can delete agent logs" on public.agent_logs;

create policy "agent_logs: view" on public.agent_logs for select
  using (public.has_permission('agents', 'view'));
create policy "agent_logs: delete" on public.agent_logs for delete
  using (public.has_permission('agents', 'full'));

-- ── tasks (was a complete RLS no-op: FOR ALL USING (true)) ────
drop policy if exists "authenticated users can manage tasks" on public.tasks;

create policy "tasks: view" on public.tasks for select
  using (public.has_permission('work', 'view'));
create policy "tasks: insert" on public.tasks for insert
  with check (public.has_permission('work', 'edit'));
create policy "tasks: update" on public.tasks for update
  using (public.has_permission('work', 'edit'))
  with check (public.has_permission('work', 'edit'));
create policy "tasks: delete" on public.tasks for delete
  using (public.has_permission('work', 'full'));

-- ── boards (board management is admin-gated in the UI today —
--    only viewing/task-editing uses 'edit'; board create/settings/
--    delete stays at 'full', matching Work.tsx's isAdmin gate) ──
drop policy if exists "authenticated full access" on public.boards;

create policy "boards: view" on public.boards for select
  using (public.has_permission('work', 'view'));
create policy "boards: insert" on public.boards for insert
  with check (public.has_permission('work', 'full'));
create policy "boards: update" on public.boards for update
  using (public.has_permission('work', 'full'))
  with check (public.has_permission('work', 'full'));
create policy "boards: delete" on public.boards for delete
  using (public.has_permission('work', 'full'));

-- ── bots module (Decision C: 'bots' page maps to 'agents') ────
drop policy if exists "authenticated full access bot_config" on public.bot_config;
create policy "bot_config: view" on public.bot_config for select
  using (public.has_permission('agents', 'view'));
create policy "bot_config: insert" on public.bot_config for insert
  with check (public.has_permission('agents', 'full'));
create policy "bot_config: update" on public.bot_config for update
  using (public.has_permission('agents', 'full'))
  with check (public.has_permission('agents', 'full'));
create policy "bot_config: delete" on public.bot_config for delete
  using (public.has_permission('agents', 'full'));

drop policy if exists "authenticated full access bot_training" on public.bot_training;
create policy "bot_training: view" on public.bot_training for select
  using (public.has_permission('agents', 'view'));
create policy "bot_training: insert" on public.bot_training for insert
  with check (public.has_permission('agents', 'full'));
create policy "bot_training: update" on public.bot_training for update
  using (public.has_permission('agents', 'full'))
  with check (public.has_permission('agents', 'full'));
create policy "bot_training: delete" on public.bot_training for delete
  using (public.has_permission('agents', 'full'));

-- ── whatsapp module: templates/sequences/pending/live-conversation state ──
drop policy if exists "authenticated full access templates" on public.message_templates;
create policy "message_templates: view" on public.message_templates for select
  using (public.has_permission('whatsapp', 'view'));
create policy "message_templates: insert" on public.message_templates for insert
  with check (public.has_permission('whatsapp', 'full'));
create policy "message_templates: update" on public.message_templates for update
  using (public.has_permission('whatsapp', 'full'))
  with check (public.has_permission('whatsapp', 'full'));
create policy "message_templates: delete" on public.message_templates for delete
  using (public.has_permission('whatsapp', 'full'));

drop policy if exists "authenticated full access sequences" on public.sequences;
create policy "sequences: view" on public.sequences for select
  using (public.has_permission('whatsapp', 'view'));
create policy "sequences: insert" on public.sequences for insert
  with check (public.has_permission('whatsapp', 'full'));
create policy "sequences: update" on public.sequences for update
  using (public.has_permission('whatsapp', 'full'))
  with check (public.has_permission('whatsapp', 'full'));
create policy "sequences: delete" on public.sequences for delete
  using (public.has_permission('whatsapp', 'full'));

drop policy if exists "authenticated full access sequence_steps" on public.sequence_steps;
create policy "sequence_steps: view" on public.sequence_steps for select
  using (public.has_permission('whatsapp', 'view'));
create policy "sequence_steps: insert" on public.sequence_steps for insert
  with check (public.has_permission('whatsapp', 'full'));
create policy "sequence_steps: update" on public.sequence_steps for update
  using (public.has_permission('whatsapp', 'full'))
  with check (public.has_permission('whatsapp', 'full'));
create policy "sequence_steps: delete" on public.sequence_steps for delete
  using (public.has_permission('whatsapp', 'full'));

drop policy if exists "team can add pending messages" on public.pending_whatsapp_messages;
drop policy if exists "team can view pending messages" on public.pending_whatsapp_messages;
drop policy if exists "team can update pending messages" on public.pending_whatsapp_messages;
drop policy if exists "team can delete pending messages" on public.pending_whatsapp_messages;
create policy "pending_whatsapp_messages: view" on public.pending_whatsapp_messages for select
  using (public.has_permission('whatsapp', 'view'));
create policy "pending_whatsapp_messages: insert" on public.pending_whatsapp_messages for insert
  with check (public.has_permission('whatsapp', 'send'));
create policy "pending_whatsapp_messages: update" on public.pending_whatsapp_messages for update
  using (public.has_permission('whatsapp', 'send'))
  with check (public.has_permission('whatsapp', 'send'));
create policy "pending_whatsapp_messages: delete" on public.pending_whatsapp_messages for delete
  using (public.has_permission('whatsapp', 'full'));

-- conversation_state / bot_conversations: live human-takeover state
-- for the WhatsApp bot. No delete policy existed before either —
-- preserved as-is (not introducing a new capability).
drop policy if exists "team can set conversation state" on public.conversation_state;
drop policy if exists "team can view conversation state" on public.conversation_state;
drop policy if exists "team can change conversation state" on public.conversation_state;
create policy "conversation_state: view" on public.conversation_state for select
  using (public.has_permission('whatsapp', 'view'));
create policy "conversation_state: insert" on public.conversation_state for insert
  with check (public.has_permission('whatsapp', 'send'));
create policy "conversation_state: update" on public.conversation_state for update
  using (public.has_permission('whatsapp', 'send'))
  with check (public.has_permission('whatsapp', 'send'));

drop policy if exists "team can add conversations" on public.bot_conversations;
drop policy if exists "team can view conversations" on public.bot_conversations;
create policy "bot_conversations: view" on public.bot_conversations for select
  using (public.has_permission('whatsapp', 'view'));
create policy "bot_conversations: insert" on public.bot_conversations for insert
  with check (public.has_permission('whatsapp', 'send'));

-- ── lead_sequence_progress: warming-sequence execution state per lead ──
drop policy if exists "team can manage sequence progress" on public.lead_sequence_progress;
drop policy if exists "team can view sequence progress" on public.lead_sequence_progress;
create policy "lead_sequence_progress: view" on public.lead_sequence_progress for select
  using (public.has_permission('leads', 'view'));
create policy "lead_sequence_progress: insert" on public.lead_sequence_progress for insert
  with check (public.has_permission('leads', 'edit'));
create policy "lead_sequence_progress: update" on public.lead_sequence_progress for update
  using (public.has_permission('leads', 'edit'))
  with check (public.has_permission('leads', 'edit'));
create policy "lead_sequence_progress: delete" on public.lead_sequence_progress for delete
  using (public.has_permission('leads', 'edit'));

-- ── notifications: intentionally NOT module-gated ─────────────
-- Cross-cutting alerts feed spanning every module, with no single
-- module it belongs to. `recipient` is a free-text display name,
-- not a uuid FK to profiles (same limitation already flagged for
-- tasks.assignee), so precise per-user row scoping isn't safely
-- expressible yet — deferred to migration 003 alongside the other
-- text-identity columns. Left exactly as today: open to any
-- authenticated user. No policy changes in this migration.

-- ============================================================
-- Rollback: see 002_down_rollback.sql (same directory) — a complete,
-- ready-to-run script restoring the exact policies captured live from
-- production during the Step 0 audit, for every table this migration
-- touches. Not auto-applied by `supabase db push`; run manually only
-- if 002 needs to be reverted.
-- ============================================================
