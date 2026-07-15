import { supabase } from './supabase'
import type { Task, TimeEntry, StatusHistoryEntry, TaskComment, Attachment } from '../types/work'

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
