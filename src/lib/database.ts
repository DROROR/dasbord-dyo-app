import { supabase } from './supabase'
import type { Task, TimeEntry, StatusHistoryEntry, TaskComment, Attachment, Board, BoardStatus, PriorityDef, AccessLevel, AppNotification, NotificationType, WorkDoc, DocAccessLevel } from '../types/work'
import { INITIAL_BOARDS, DEFAULT_PRIORITY_DEFS } from '../data/workConstants'

// ── DB Row Types (mirror schema exactly) ────────────────────────────────────────

export interface DbClient {
  id: string
  name: string
  business_name: string
  email: string | null
  phone: string | null
  package: 'solo_pro' | 'master_class' | 'community_master'
  joined_at: string | null
  status: 'active' | 'pending' | 'on_hold' | 'expired' | 'cancelled'
  trial_days: number
  notes: string | null
  otp_price: number | null
  user_threshold: number | null
  block_price: number | null
  created_at: string
  // joined via select('*, client_contacts(*)')
  client_contacts?: DbContact[]
  // joined via select('*, billing_records(*)')
  billing_records?: DbBillingRecord[]
}

export interface DbContact {
  id: string
  client_id: string
  name: string
  phone: string
  role: 'owner' | 'app_manager' | 'content_manager' | 'other'
  receives_payments: boolean
  receives_updates: boolean
  created_at: string
}

export interface DbBillingRecord {
  id: string
  client_id: string
  month: number
  year: number
  otp_count: number
  user_count: number
  package_price: number
  otp_cost: number
  block_cost: number
  variable_total: number
  cc_status: 'paid' | 'failed' | null
  variable_status: 'paid' | 'unpaid' | 'pending'
  created_at: string
  amount_paid: number | null
  payment_date: string | null
}

export interface DbLead {
  id: string
  name: string
  phone: string
  source: 'facebook' | 'instagram' | null
  status: 'new' | 'meeting' | 'producing' | 'followup' | 'irrelevant'
  lead_type: 'has_course' | 'producing' | null
  follow_up_date: string | null
  follow_up_note: string | null
  follow_up_tone: string | null
  created_at: string
}

export interface DbMessage {
  id: string
  recipient_id: string
  recipient_type: 'client' | 'lead'
  phone: string
  message_text: string | null
  template_key: string | null
  media_url: string | null
  status: 'sent' | 'read' | 'failed'
  sent_at: string
  channel: 'service' | 'sales' | null
}

export interface DbAgentLog {
  id: string
  agent_id: string
  agent_name: string
  status: 'success' | 'error' | 'running'
  result_summary: string | null
  run_at: string
}

// ── CLIENTS ─────────────────────────────────────────────────────────────────────

// ─── Profiles (real team members) ──────────────────────────────────────────────
// The team list is whoever has registered in the panel — never a hardcoded list.

export interface DbProfile {
  id: string
  name: string
  email: string
  role: 'admin' | 'staff'
  permissions: Record<string, unknown>
  is_technical_support: boolean
  is_owner: boolean
  created_at: string
}

export async function getProfiles(): Promise<DbProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return data as DbProfile[]
}

// Role/permissions/is_technical_support are no longer writable from the
// client at all (see migration 001's column-privilege lockdown) — that
// write path is now exclusively the update-member-permissions Edge
// Function, called directly from src/pages/Permissions.tsx.

export async function getClients(): Promise<DbClient[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*, client_contacts(*)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as DbClient[]
}

export async function getClient(id: string): Promise<DbClient | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*, client_contacts(*), billing_records(*)')
    .eq('id', id)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data as DbClient
}

export async function createClient(
  data: Omit<DbClient, 'id' | 'created_at' | 'client_contacts' | 'billing_records'>
): Promise<DbClient> {
  const { data: created, error } = await supabase
    .from('clients')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return created as DbClient
}

export async function updateClient(
  id: string,
  data: Partial<Omit<DbClient, 'id' | 'created_at' | 'client_contacts' | 'billing_records'>>
): Promise<DbClient> {
  const { data: updated, error } = await supabase
    .from('clients')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return updated as DbClient
}

// Replaces all contacts for a client atomically (delete + insert)
export async function updateClientContacts(
  clientId: string,
  contacts: Omit<DbContact, 'id' | 'client_id' | 'created_at'>[]
): Promise<DbContact[]> {
  const { error: deleteError } = await supabase
    .from('client_contacts')
    .delete()
    .eq('client_id', clientId)
  if (deleteError) throw deleteError

  if (contacts.length === 0) return []

  const { data, error } = await supabase
    .from('client_contacts')
    .insert(contacts.map(c => ({ ...c, client_id: clientId })))
    .select()
  if (error) throw error
  return data as DbContact[]
}

// ── BILLING ─────────────────────────────────────────────────────────────────────

export async function getBillingRecords(clientId?: string): Promise<DbBillingRecord[]> {
  let query = supabase
    .from('billing_records')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
  if (clientId) query = query.eq('client_id', clientId)
  const { data, error } = await query
  if (error) throw error
  return data as DbBillingRecord[]
}

export async function createBillingRecord(
  data: Omit<DbBillingRecord, 'id' | 'created_at'>
): Promise<DbBillingRecord> {
  const { data: created, error } = await supabase
    .from('billing_records')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return created as DbBillingRecord
}

export async function updateBillingStatus(
  id: string,
  field: 'cc_status' | 'variable_status',
  status: DbBillingRecord['cc_status'] | DbBillingRecord['variable_status']
): Promise<void> {
  const { error } = await supabase
    .from('billing_records')
    .update({ [field]: status })
    .eq('id', id)
  if (error) throw error
}

// ── LEADS ───────────────────────────────────────────────────────────────────────

export async function getLeads(): Promise<DbLead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .neq('status', 'irrelevant')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as DbLead[]
}

export async function getLead(id: string): Promise<DbLead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data as DbLead
}

export async function createLead(
  data: Omit<DbLead, 'id' | 'created_at'>
): Promise<DbLead> {
  const { data: created, error } = await supabase
    .from('leads')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return created as DbLead
}

export async function updateLead(
  id: string,
  data: Partial<Omit<DbLead, 'id' | 'created_at'>>
): Promise<DbLead> {
  const { data: updated, error } = await supabase
    .from('leads')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return updated as DbLead
}

export async function archiveLead(id: string): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ status: 'irrelevant' })
    .eq('id', id)
  if (error) throw error
}

// ── MESSAGES ────────────────────────────────────────────────────────────────────

export async function getMessages(
  recipientId: string,
  recipientType: 'client' | 'lead'
): Promise<DbMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('recipient_id', recipientId)
    .eq('recipient_type', recipientType)
    .order('sent_at', { ascending: true })
  if (error) throw error
  return data as DbMessage[]
}

export async function createMessage(
  data: Omit<DbMessage, 'id'>
): Promise<DbMessage> {
  const { data: created, error } = await supabase
    .from('messages')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return created as DbMessage
}

// ── AGENT LOGS ──────────────────────────────────────────────────────────────────

export async function getAgentLogs(agentId?: string): Promise<DbAgentLog[]> {
  let query = supabase
    .from('agent_logs')
    .select('*')
    .order('run_at', { ascending: false })
  if (agentId) query = query.eq('agent_id', agentId)
  const { data, error } = await query
  if (error) throw error
  return data as DbAgentLog[]
}

// Returns the most recent log entry per agent, keyed by agent_id
export async function getLatestAgentStatus(): Promise<Record<string, DbAgentLog>> {
  const { data, error } = await supabase
    .from('agent_logs')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(200)
  if (error) throw error

  const latest: Record<string, DbAgentLog> = {}
  for (const log of data as DbAgentLog[]) {
    if (!(log.agent_id in latest)) {
      latest[log.agent_id] = log
    }
  }
  return latest
}

// ── BILLING WITH CLIENT JOIN ─────────────────────────────────────────────────────

export interface DbBillingWithClient extends DbBillingRecord {
  clients: {
    name: string
    business_name: string
    package: DbClient['package']
    otp_price: number | null
    user_threshold: number | null
    block_price: number | null
  } | null
}

export async function getBillingWithClients(clientId?: string): Promise<DbBillingWithClient[]> {
  let query = supabase
    .from('billing_records')
    .select('*, clients(name, business_name, package, otp_price, user_threshold, block_price)')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
  if (clientId) query = query.eq('client_id', clientId)
  const { data, error } = await query
  if (error) throw error
  return data as DbBillingWithClient[]
}

// ── MESSAGES (ALL) ───────────────────────────────────────────────────────────────

export async function getAllMessages(limit = 100): Promise<DbMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as DbMessage[]
}

export async function createMessages(messages: Omit<DbMessage, 'id'>[]): Promise<void> {
  if (messages.length === 0) return
  const { error } = await supabase.from('messages').insert(messages)
  if (error) throw error
}

// ── CLIENT NAME MAP ───────────────────────────────────────────────────────────────

export async function getClientNameMap(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('clients').select('id, name')
  if (error) throw error
  return Object.fromEntries((data ?? []).map(c => [c.id as string, c.name as string]))
}

// ── MESSAGE TEMPLATES ─────────────────────────────────────────────────────────

export interface DbMessageTemplate {
  id: string
  name: string
  body: string
  tag?: string
  channel: 'service' | 'sales'
  media_url?: string | null
  created_at: string
}

export async function getMessageTemplates(): Promise<DbMessageTemplate[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, name, body, channel, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as DbMessageTemplate[]
}

export async function updateMessageTemplate(
  id: string,
  body: string
): Promise<{ data: unknown; error: unknown }> {
  const { data, error } = await supabase
    .from('message_templates')
    .update({ body })
    .eq('id', id)
  return { data, error }
}

// ── BOT TRAINING ──────────────────────────────────────────────────────────────

export interface DbBotConfig {
  bot: string
  base_prompt: string      // Knowledge: facts, FAQ, solutions
  behavior_prompt: string  // Behavior: tone, escalation, ticket rules
  model: string
  active: boolean
  updated_at: string
}

export interface DbBotTraining {
  id: string
  bot: string
  kind: 'rule' | 'example' | 'avoid'
  situation: string | null
  content: string
  active: boolean
  created_at: string
}

export async function getBotConfig(bot: string): Promise<DbBotConfig | null> {
  const { data, error } = await supabase
    .from('bot_config')
    .select('*')
    .eq('bot', bot)
    .single()
  if (error) return null
  return data as DbBotConfig
}

export async function updateBotConfig(
  bot: string,
  updates: Partial<Pick<DbBotConfig, 'base_prompt' | 'behavior_prompt' | 'model' | 'active'>>
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from('bot_config')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('bot', bot)
  return { error }
}

export async function getBotTraining(bot: string): Promise<DbBotTraining[]> {
  const { data, error } = await supabase
    .from('bot_training')
    .select('*')
    .eq('bot', bot)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as DbBotTraining[]
}

export async function addBotTraining(
  row: Omit<DbBotTraining, 'id' | 'created_at'>
): Promise<{ error: unknown }> {
  const { error } = await supabase.from('bot_training').insert(row)
  return { error }
}

export async function updateBotTraining(
  id: string,
  updates: Partial<Omit<DbBotTraining, 'id' | 'created_at'>>
): Promise<{ error: unknown }> {
  const { error } = await supabase.from('bot_training').update(updates).eq('id', id)
  return { error }
}

export async function deleteBotTraining(id: string): Promise<{ error: unknown }> {
  const { error } = await supabase.from('bot_training').delete().eq('id', id)
  return { error }
}

// ── SEQUENCES ─────────────────────────────────────────────────────────────────

export interface DbSequence {
  id: string
  seq_key: string
  label: string
  description: string
  channel: 'service' | 'sales'
  is_active: boolean
  created_at: string
}

export interface DbSequenceStep {
  id: string
  sequence_id: string
  step_order: number
  day: number
  message: string
  media_url: string | null
  created_at: string
}

export interface DbSequenceWithSteps extends DbSequence {
  steps: DbSequenceStep[]
}

export async function getSequences(): Promise<DbSequenceWithSteps[]> {
  const { data, error } = await supabase
    .from('sequences')
    .select('*, sequence_steps(*)')
    .order('seq_key', { ascending: true })
  if (error) throw error
  return (data as (DbSequence & { sequence_steps: DbSequenceStep[] })[]).map(row => ({
    ...row,
    steps: (row.sequence_steps ?? []).sort((a, b) => a.step_order - b.step_order),
  }))
}

export async function updateSequence(
  id: string,
  updates: Partial<Pick<DbSequence, 'label' | 'description' | 'channel' | 'is_active'>>
): Promise<void> {
  const { error } = await supabase
    .from('sequences')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function updateSequenceStep(
  id: string,
  updates: Partial<Pick<DbSequenceStep, 'message' | 'day' | 'step_order' | 'media_url'>>
): Promise<void> {
  const { error } = await supabase
    .from('sequence_steps')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function createSequenceStep(
  step: Omit<DbSequenceStep, 'id' | 'created_at'>
): Promise<DbSequenceStep> {
  const { data, error } = await supabase
    .from('sequence_steps')
    .insert(step)
    .select()
    .single()
  if (error) throw error
  return data as DbSequenceStep
}

export async function deleteSequenceStep(id: string): Promise<void> {
  const { error } = await supabase
    .from('sequence_steps')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── DASHBOARD STATS ───────────────────────────────────────────────────────────────

const PACKAGE_PRICES: Record<string, number> = {
  solo_pro: 140, master_class: 235, community_master: 370,
}

export interface DashboardStats {
  activeClients: number
  monthlyRevenue: number
  openLeads: number
  unpaidBilling: number
  inactiveClients: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [clientsRes, leadsRes, billingRes, inactiveRes] = await Promise.all([
    supabase.from('clients').select('package').eq('status', 'active'),
    supabase.from('leads').select('id', { count: 'exact', head: true }).neq('status', 'irrelevant'),
    supabase.from('billing_records').select('id', { count: 'exact', head: true }).neq('variable_status', 'paid'),
    supabase.from('clients').select('id', { count: 'exact', head: true }).in('status', ['on_hold', 'expired', 'cancelled']),
  ])
  if (clientsRes.error) throw clientsRes.error
  if (leadsRes.error) throw leadsRes.error
  if (billingRes.error) throw billingRes.error
  if (inactiveRes.error) throw inactiveRes.error

  const clients = clientsRes.data ?? []
  return {
    activeClients:   clients.length,
    monthlyRevenue:  clients.reduce((s, c) => s + (PACKAGE_PRICES[c.package as string] ?? 0), 0),
    openLeads:       leadsRes.count ?? 0,
    unpaidBilling:   billingRes.count ?? 0,
    inactiveClients: inactiveRes.count ?? 0,
  }
}

// ── TASKS ────────────────────────────────────────────────────────────────────────

interface DbTask {
  id: string
  title: string
  description: string | null
  board: string
  status: string
  priority: string | null
  assignee: string | null
  client_id: string | null
  client_name: string | null
  start_date: string | null
  due_date: string | null
  time_estimate: number | null
  time_entries: TimeEntry[]
  status_history: StatusHistoryEntry[]
  comments: TaskComment[]
  attachments: Attachment[]
  created_by: string | null
  created_at: string
  updated_at: string
  done_at: string | null
  whatsapp_pending: boolean | null
  claimed: boolean | null
  claimed_by: string | null
  code_reviewer: string | null
  ux_reviewer: string | null
  requires_app_update: boolean | null
  source_task_id: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function dbToTask(db: DbTask): Task {
  return {
    id:              db.id,
    title:           db.title,
    description:     db.description ?? '',
    assignee:        db.assignee ?? '',
    board:           db.board,
    priority:        db.priority ?? 'medium',
    status:          db.status,
    clientId:        db.client_id ?? undefined,
    clientName:      db.client_name ?? undefined,
    startDate:       db.start_date ?? undefined,
    dueDate:         db.due_date ?? undefined,
    timeEstimate:    db.time_estimate ?? undefined,
    timeEntries:     db.time_entries ?? [],
    statusHistory:   db.status_history ?? [],
    attachments:     db.attachments ?? [],
    comments:        db.comments ?? [],
    createdAt:       db.created_at,
    doneAt:          db.done_at ?? undefined,
    whatsappPending: db.whatsapp_pending ?? undefined,
    claimed:         db.claimed ?? undefined,
    claimedBy:       db.claimed_by ?? undefined,
    codeReviewer:    db.code_reviewer ?? undefined,
    uxReviewer:      db.ux_reviewer ?? undefined,
    requiresAppUpdate: db.requires_app_update ?? undefined,
    sourceTaskId:    db.source_task_id ?? undefined,
  }
}

function taskToRow(t: Partial<Task>): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  if (t.title          !== undefined) r.title            = t.title
  if (t.description    !== undefined) r.description      = t.description
  if (t.board          !== undefined) r.board            = t.board
  if (t.status         !== undefined) r.status           = t.status
  if (t.priority       !== undefined) r.priority         = t.priority
  if (t.assignee       !== undefined) r.assignee         = t.assignee || null
  if (t.clientId       !== undefined) r.client_id        = (t.clientId && UUID_RE.test(t.clientId)) ? t.clientId : null
  if (t.clientName     !== undefined) r.client_name      = t.clientName || null
  if (t.startDate      !== undefined) r.start_date       = t.startDate || null
  if (t.dueDate        !== undefined) r.due_date         = t.dueDate || null
  if (t.timeEstimate   !== undefined) r.time_estimate    = t.timeEstimate
  if (t.timeEntries    !== undefined) r.time_entries     = t.timeEntries
  if (t.statusHistory  !== undefined) r.status_history   = t.statusHistory
  if (t.attachments    !== undefined) r.attachments      = t.attachments
  if (t.comments       !== undefined) r.comments         = t.comments
  if (t.doneAt         !== undefined) r.done_at          = t.doneAt || null
  if (t.whatsappPending !== undefined) r.whatsapp_pending = t.whatsappPending
  if (t.claimed        !== undefined) r.claimed          = t.claimed
  if (t.claimedBy      !== undefined) r.claimed_by       = t.claimedBy || null
  if (t.codeReviewer   !== undefined) r.code_reviewer    = t.codeReviewer || null
  if (t.uxReviewer     !== undefined) r.ux_reviewer      = t.uxReviewer || null
  if (t.requiresAppUpdate !== undefined) r.requires_app_update = t.requiresAppUpdate
  if (t.sourceTaskId   !== undefined) r.source_task_id   = t.sourceTaskId || null
  return r
}

export async function getTasks(board?: string): Promise<Task[]> {
  let q = supabase.from('tasks').select('*').order('created_at', { ascending: false })
  if (board) q = q.eq('board', board)
  const { data, error } = await q
  if (error) throw error
  return (data as DbTask[]).map(dbToTask)
}

export async function createTask(task: Omit<Task, 'id'>): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert(taskToRow(task as Partial<Task>))
    .select()
    .single()
  if (error) throw error
  return dbToTask(data as DbTask)
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ ...taskToRow(updates), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return dbToTask(data as DbTask)
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

// Comment-adding goes through add_task_comment() (an atomic,
// SECURITY DEFINER RPC — see 20260809140000_docs_and_board_access.sql)
// instead of updateTask(): it's the only write path a board-level
// 'comment' user has (the ordinary "tasks: update" RLS policy is
// 'full'-only), it derives author/timestamp server-side rather than
// trusting the caller, and its single atomic UPDATE (comments = comments
// || new_comment, row-locked) means two people commenting at the same
// moment can't silently clobber one another the way a client-side
// read-merge-write against the full task row could.
export async function addTaskComment(taskId: string, text: string, mentions: string[]): Promise<TaskComment[]> {
  const { data, error } = await supabase.rpc('add_task_comment', {
    task_id: taskId, comment_text: text, mentions,
  })
  if (error) throw error
  return data as TaskComment[]
}

// ── BOARDS ──────────────────────────────────────────────────────────────────
interface DbBoard {
  id: string
  name: string
  is_default: boolean
  access: Record<string, AccessLevel>
  statuses: BoardStatus[]
  priorities: PriorityDef[] | null
  created_at: string
}

function dbToBoard(b: DbBoard): Board {
  return {
    id:        b.id,
    name:      b.name,
    isDefault: b.is_default,
    access:    b.access ?? {},
    statuses:  b.statuses ?? [],
    // Boards created before priorities were saved fall back to the defaults.
    priorities: (b.priorities && b.priorities.length > 0)
      ? b.priorities
      : DEFAULT_PRIORITY_DEFS,
    createdAt: b.created_at,
  }
}

function boardToRow(b: Board): Record<string, unknown> {
  return {
    id:         b.id,
    name:       b.name,
    is_default: b.isDefault,
    access:     b.access,
    statuses:   b.statuses,
    priorities: b.priorities,
    created_at: b.createdAt,
  }
}

// Load all boards. On the very first run the table is empty, so seed it with the
// built-in boards so nothing is lost and every user shares the same starting set.
export async function getBoards(): Promise<Board[]> {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = data as DbBoard[]
  if (rows.length === 0) {
    // Seed the built-in boards once. If the write is not permitted (e.g. no auth
    // session), fall back to the built-ins so the UI still works.
    const { error: seedErr } = await supabase
      .from('boards')
      .upsert(INITIAL_BOARDS.map(boardToRow), { onConflict: 'id', ignoreDuplicates: true })
    if (seedErr) console.warn('Board seed skipped, using built-ins:', seedErr.message)
    return INITIAL_BOARDS
  }
  return rows.map(dbToBoard)
}

export async function createBoard(board: Board): Promise<Board> {
  const { data, error } = await supabase
    .from('boards')
    .insert(boardToRow(board))
    .select()
    .single()
  if (error) throw error
  return dbToBoard(data as DbBoard)
}

// access is no longer client-writable (column privileges revoked in
// 20260809140000_docs_and_board_access.sql) — only name/statuses/priorities
// go through this ordinary update. Per-board access changes go through
// setResourceAccess() below, which calls the update-resource-access
// Edge Function instead. The payload here must name ONLY those three
// granted columns: Postgres checks UPDATE privilege for every column
// that appears in the SET list, even ones whose value isn't changing,
// so including id/is_default/created_at (not granted) would fail the
// whole statement, not just silently ignore them.
export async function updateBoard(board: Board): Promise<Board> {
  const { data, error } = await supabase
    .from('boards')
    .update({ name: board.name, statuses: board.statuses, priorities: board.priorities })
    .eq('id', board.id)
    .select()
    .single()
  if (error) throw error
  return dbToBoard(data as DbBoard)
}

export async function deleteBoard(id: string): Promise<void> {
  const { error } = await supabase.from('boards').delete().eq('id', id)
  if (error) throw error
}

// ── RESOURCE ACCESS (work_docs / boards) ─────────────────────────────────────
// The only read/write path for the `access` column on either table —
// both are locked against direct client UPDATE, and reading the full
// ACL (not just "do I have access") is also routed through this
// Edge Function so viewing access settings requires the same
// can_manage_permissions() check as changing them.

async function invokeResourceAccess(body: Record<string, unknown>): Promise<{ access: Record<string, string> }> {
  const { data, error } = await supabase.functions.invoke('update-resource-access', { body })
  if (error || !data?.access) {
    let msg = 'הפעולה נכשלה'
    const ctx = (error as { context?: Response } | null)?.context
    if (ctx) {
      try { msg = (await ctx.json())?.error ?? msg } catch { /* ignore */ }
    }
    throw new Error(data?.error ?? msg)
  }
  return data as { access: Record<string, string> }
}

export async function getResourceAccess(table: 'work_docs' | 'boards', resourceId: string): Promise<Record<string, string>> {
  const { access } = await invokeResourceAccess({ table, resourceId, action: 'read' })
  return access
}

export async function setResourceAccess(
  table: 'work_docs' | 'boards', resourceId: string, profileId: string, level: string,
): Promise<Record<string, string>> {
  const { access } = await invokeResourceAccess({ table, resourceId, profileId, level })
  return access
}

// ── WORK DOCS ─────────────────────────────────────────────────────────────────
// access is deliberately excluded from the row shape here — RLS already
// filters which docs a user gets back, and the raw ACL map is only ever
// fetched on demand (via getResourceAccess) for the Access panel, gated
// separately by can_manage_permissions() inside the Edge Function.
interface DbWorkDoc {
  id: string
  title: string
  content: string
  created_by: string | null
  updated_at: string
  my_doc_access_level: DocAccessLevel
}

const WORK_DOC_COLUMNS = 'id, title, content, created_by, updated_at, my_doc_access_level'

function dbToWorkDoc(d: DbWorkDoc, profileNames: Record<string, string>): WorkDoc & { myLevel: DocAccessLevel } {
  return {
    id: d.id,
    title: d.title,
    content: d.content,
    createdBy: (d.created_by && profileNames[d.created_by]) || 'Unknown',
    updatedAt: d.updated_at,
    myLevel: d.my_doc_access_level,
  }
}

export async function getWorkDocs(profileNames: Record<string, string>): Promise<(WorkDoc & { myLevel: DocAccessLevel })[]> {
  const { data, error } = await supabase
    .from('work_docs')
    .select(WORK_DOC_COLUMNS)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data as unknown as DbWorkDoc[]).map(d => dbToWorkDoc(d, profileNames))
}

// created_by/access are set server-side by the set_work_doc_creator_access
// trigger — the client's job is only title/content.
export async function createWorkDoc(title: string, content: string, profileNames: Record<string, string>): Promise<WorkDoc & { myLevel: DocAccessLevel }> {
  const { data, error } = await supabase
    .from('work_docs')
    .insert({ title, content })
    .select(WORK_DOC_COLUMNS)
    .single()
  if (error) throw error
  return dbToWorkDoc(data as unknown as DbWorkDoc, profileNames)
}

export async function updateWorkDoc(id: string, title: string, content: string, profileNames: Record<string, string>): Promise<WorkDoc & { myLevel: DocAccessLevel }> {
  const { data, error } = await supabase
    .from('work_docs')
    .update({ title, content, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(WORK_DOC_COLUMNS)
    .single()
  if (error) throw error
  return dbToWorkDoc(data as unknown as DbWorkDoc, profileNames)
}

export async function deleteWorkDoc(id: string): Promise<void> {
  const { error } = await supabase.from('work_docs').delete().eq('id', id)
  if (error) throw error
}

// ─── Customer messages waiting to be sent ─────────────────────────────────────
// Written when a support ticket is finished. Never sent automatically — someone
// reviews, edits if needed, and sends.

export interface DbPendingMessage {
  id: string
  task_id: string | null
  task_title: string | null
  client_id: string | null
  client_name: string | null
  app_name: string | null
  phone: string | null
  summary: string | null
  message: string
  requires_app_update: boolean
  status: 'pending' | 'waiting' | 'sent'
  created_by: string | null
  created_at: string
  sent_at: string | null
  sent_by: string | null
}

const TICKET_DONE_WEBHOOK =
  'https://primary-production-2bdeb.up.railway.app/webhook/dyo-ticket-done-message'

/**
 * Asks the message writer for a customer-safe update. Falls back to the
 * approved wording if it cannot be reached, so a ticket can always be closed.
 */
export async function generateCustomerMessage(input: {
  clientName: string
  appName: string
  taskTitle: string
  requiresAppUpdate: boolean
}): Promise<{ summary: string; message: string }> {
  const fallback = input.requiresAppUpdate
    ? `שלום ${input.clientName},\n\nרצינו לעדכן שהתקלה בנושא ${input.taskTitle} טופלה.\n\nכדי שהתיקון יופיע אצלך באפליקציה נדרש עדכון גרסה. העדכון בהכנה ונעדכן אותך ברגע שהגרסה החדשה תהיה זמינה.`
    : `שלום ${input.clientName},\n\nרצינו לעדכן שהתקלה בנושא ${input.taskTitle} טופלה.\n\nהתיקון כבר הוחל ואין צורך בעדכון אפליקציה. נשמח שתבדקו שהכל עובד כשורה.`

  try {
    const res = await fetch(TICKET_DONE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: input.clientName,
        app_name: input.appName,
        task_title: input.taskTitle,
        requires_app_update: input.requiresAppUpdate,
      }),
    })
    if (!res.ok) throw new Error(`writer returned ${res.status}`)
    const data = await res.json() as { summary?: string; message?: string }
    return { summary: data.summary ?? input.taskTitle, message: data.message ?? fallback }
  } catch (err) {
    console.warn('Message writer unavailable, using standard wording:', err)
    return { summary: input.taskTitle, message: fallback }
  }
}

export async function getPendingMessages(): Promise<DbPendingMessage[]> {
  const { data, error } = await supabase
    .from('pending_whatsapp_messages')
    .select('*')
    .neq('status', 'sent')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as DbPendingMessage[]
}

export async function createPendingMessage(
  row: Omit<DbPendingMessage, 'id' | 'created_at' | 'sent_at' | 'sent_by'>,
): Promise<DbPendingMessage> {
  const { data, error } = await supabase
    .from('pending_whatsapp_messages')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data as DbPendingMessage
}

export async function updatePendingMessage(
  id: string,
  updates: Partial<Pick<DbPendingMessage, 'message' | 'status'>>,
): Promise<void> {
  const { error } = await supabase.from('pending_whatsapp_messages').update(updates).eq('id', id)
  if (error) throw error
}

/** Marks it sent and files a copy in the customer's conversation history. */
export async function markMessageSent(msg: DbPendingMessage, sentBy: string): Promise<void> {
  const { error } = await supabase
    .from('pending_whatsapp_messages')
    .update({ status: 'sent', sent_at: new Date().toISOString(), sent_by: sentBy })
    .eq('id', msg.id)
  if (error) throw error

  if (msg.phone) {
    const { error: convErr } = await supabase.from('bot_conversations').insert({
      phone: msg.phone,
      client_id: msg.client_id,
      role: 'bot',
      message: msg.message,
      action: 'ticket_resolved',
    })
    if (convErr) console.warn('Could not file message in conversation history:', convErr.message)
  }
}

// ─── Merging duplicate customers ──────────────────────────────────────────────
// The shop can send the same customer more than once. Nothing here is
// automatic: a person reviews the records and chooses which one to keep.

export interface DuplicateClient {
  id: string
  name: string
  business_name: string
  email: string | null
  phone: string | null
  status: string
  package: string
  joined_at: string | null
  created_at: string
  woo_customer_id: string | null
  dup_key: string
  billing_count: number
  task_count: number
  contact_count: number
}

export interface DuplicateGroup {
  key: string
  clients: DuplicateClient[]
  billing: DbBillingRecord[]
  /** Months covered by more than one of these records — needs a decision. */
  clashingPeriods: { month: number; year: number; records: DbBillingRecord[] }[]
}

export async function findDuplicateClients(): Promise<DuplicateGroup[]> {
  const { data, error } = await supabase.from('duplicate_clients').select('*')
  if (error) throw error
  const rows = data as DuplicateClient[]
  if (rows.length === 0) return []

  const { data: billingRows, error: bErr } = await supabase
    .from('billing_records')
    .select('*')
    .in('client_id', rows.map(r => r.id))
  if (bErr) throw bErr
  const billing = (billingRows ?? []) as DbBillingRecord[]

  const byKey = new Map<string, DuplicateClient[]>()
  rows.forEach(r => {
    const list = byKey.get(r.dup_key) ?? []
    list.push(r)
    byKey.set(r.dup_key, list)
  })

  return Array.from(byKey.entries()).map(([key, clients]) => {
    const ids = new Set(clients.map(c => c.id))
    const groupBilling = billing.filter(b => ids.has(b.client_id))

    // Two records billing the same month is the one thing a person must
    // resolve, because keeping both would charge the customer twice.
    const periods = new Map<string, DbBillingRecord[]>()
    groupBilling.forEach(b => {
      const k = `${b.year}-${b.month}`
      periods.set(k, [...(periods.get(k) ?? []), b])
    })
    const clashingPeriods = Array.from(periods.values())
      .filter(list => list.length > 1)
      .map(list => ({ month: list[0].month, year: list[0].year, records: list }))

    return { key, clients, billing: groupBilling, clashingPeriods }
  })
}

/**
 * Joins the chosen records into one. `dropBillingIds` are the billing rows the
 * person decided to discard where two records covered the same month.
 */
export async function mergeClients(
  keepId: string,
  removeIds: string[],
  dropBillingIds: string[] = [],
): Promise<void> {
  const { error } = await supabase.rpc('merge_clients', {
    keep_id: keepId,
    remove_ids: removeIds,
    drop_billing_ids: dropBillingIds,
  })
  if (error) throw error
}

// ─── Who owns a conversation ──────────────────────────────────────────────────
// While a team member is handling a chat the bot stays quiet, so the two never
// reply at the same time. Ownership returns to the bot when someone hands it
// back, or after the idle time set in Bot Training.

export interface DbConversationState {
  phone: string
  client_id: string | null
  state: 'agent' | 'human'
  taken_over_by: string | null
  taken_over_at: string | null
  last_human_at: string | null
  returned_by: string | null
  returned_at: string | null
  updated_at: string
}

export interface HumanHeldConversation extends DbConversationState {
  client_name: string | null
  /** Minutes since the person last did anything on this conversation. */
  quiet_minutes: number
  idle_limit: number
}

export async function getHumanHeldConversations(): Promise<HumanHeldConversation[]> {
  const [{ data, error }, cfg] = await Promise.all([
    supabase.from('conversation_state').select('*').eq('state', 'human'),
    getBotConfig('support'),
  ])
  if (error) throw error

  const rows = data as DbConversationState[]
  if (rows.length === 0) return []

  const idleLimit = (cfg as { human_idle_minutes?: number } | null)?.human_idle_minutes ?? 20

  // Attach the customer name so the list is readable.
  const ids = rows.map(r => r.client_id).filter(Boolean) as string[]
  const names: Record<string, string> = {}
  if (ids.length > 0) {
    const { data: clientRows } = await supabase.from('clients').select('id, name').in('id', ids)
    ;(clientRows ?? []).forEach((c: { id: string; name: string }) => { names[c.id] = c.name })
  }

  return rows.map(r => {
    const since = r.last_human_at ?? r.taken_over_at
    return {
      ...r,
      client_name: r.client_id ? (names[r.client_id] ?? null) : null,
      quiet_minutes: since ? Math.floor((Date.now() - new Date(since).getTime()) / 60000) : 0,
      idle_limit: idleLimit,
    }
  })
}

/** Hands the conversation to a person; the bot goes quiet. */
export async function takeOverConversation(phone: string, by: string, clientId?: string | null): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase.from('conversation_state').upsert({
    phone,
    client_id: clientId ?? null,
    state: 'human',
    taken_over_by: by,
    taken_over_at: now,
    last_human_at: now,
    updated_at: now,
  }, { onConflict: 'phone' })
  if (error) throw error
  await recordHandover(phone, clientId ?? null, `${by} took over the conversation`)
}

/** Gives the conversation back to the bot. */
export async function returnConversationToBot(phone: string, by: string, clientId?: string | null): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('conversation_state')
    .update({ state: 'agent', returned_by: by, returned_at: now, updated_at: now })
    .eq('phone', phone)
  if (error) throw error
  await recordHandover(phone, clientId ?? null, `${by} handed the conversation back to the bot`)
}

/** Handovers are written into the conversation so the history explains itself. */
async function recordHandover(phone: string, clientId: string | null, message: string) {
  const { error } = await supabase.from('bot_conversations').insert({
    phone, client_id: clientId, role: 'system', message, action: 'handover',
  })
  if (error) console.warn('Could not record the handover:', error.message)
}

// ─── Notifications ────────────────────────────────────────────────────────────
// Persisted so that alerts raised outside the browser (n8n support-bot
// escalations, auto-created tickets) reach the management interface.

interface DbNotification {
  id: string
  type: string
  message: string
  recipient: string | null
  severity: string
  read: boolean
  task_id: string | null
  task_title: string | null
  client_id: string | null
  client_name: string | null
  phone: string | null
  wa_details: { clientName: string; message: string } | null
  dedupe_key: string | null
  created_at: string
}

function dbToNotification(n: DbNotification): AppNotification {
  return {
    id: n.id,
    type: n.type as NotificationType,
    message: n.message,
    taskId: n.task_id ?? undefined,
    taskTitle: n.task_title ?? undefined,
    clientId: n.client_id ?? undefined,
    clientName: n.client_name ?? undefined,
    phone: n.phone ?? undefined,
    timestamp: n.created_at,
    read: n.read,
    severity: (n.severity === 'high' ? 'high' : 'normal'),
    waDetails: n.wa_details ?? undefined,
  }
}

export async function getNotifications(limit = 100): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as DbNotification[]).map(dbToNotification)
}

export async function createNotification(n: {
  type: string
  message: string
  taskId?: string
  taskTitle?: string
  severity?: 'normal' | 'high'
  waDetails?: { clientName: string; message: string }
  dedupeKey?: string
}): Promise<AppNotification | null> {
  const row = {
    type: n.type,
    message: n.message,
    task_id: n.taskId ?? null,
    task_title: n.taskTitle ?? null,
    severity: n.severity ?? 'normal',
    wa_details: n.waDetails ?? null,
    dedupe_key: n.dedupeKey ?? null,
  }
  // Recurring scan alerts carry a dedupe_key so a repeated page load does not
  // create the same alert again; the unique index makes the retry a no-op.
  const { data, error } = n.dedupeKey
    ? await supabase
        .from('notifications')
        .upsert(row, { onConflict: 'dedupe_key', ignoreDuplicates: true })
        .select()
        .maybeSingle()
    : await supabase.from('notifications').insert(row).select().single()
  if (error) throw error
  return data ? dbToNotification(data as DbNotification) : null
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id)
  if (error) throw error
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('read', false)
  if (error) throw error
}
