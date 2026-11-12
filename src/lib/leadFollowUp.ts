import { supabase } from './supabase'
import { addLeadHistory } from './leadHistory'
import type { DbLead, DbLeadHistory, DbLeadPipelineStatus, DbLeadSequenceProgress } from './database'

/**
 * Follow-up tasks for leads.
 *
 * A chain used to be nothing but WhatsApp messages on a timer. This adds the
 * part a person does — the phone calls — as tasks that stay open until
 * somebody says what happened. Nothing here marks a call as made on its own:
 * a task leaves "open" only through completeFollowUpTask, rescheduleFollowUpTask
 * or cancelFollowUpTask, each of which is a button somebody pressed.
 *
 * Everything is dormant until a task exists. A lead that was never put on a
 * chain from the lead dialog has no rows here and behaves exactly as before.
 */

/**
 * The day of each call, counted from the day the lead joined the chain.
 * server/lead-sequence-worker.mjs carries the same list — it holds a WhatsApp
 * step back until the calls that come before it have been confirmed
 * unanswered — so the two must be changed together.
 */
export const FOLLOW_UP_CALL_DAYS = [0, 1, 3, 8]

export type FollowUpOutcome =
  | 'no_answer' | 'interested_later' | 'not_ready' | 'meeting' | 'not_relevant' | 'customer'

export const FOLLOW_UP_OUTCOMES: Array<{ value: FollowUpOutcome; he: string; en: string }> = [
  { value: 'no_answer',        he: 'אין מענה',               en: 'No Answer' },
  { value: 'interested_later', he: 'מעוניין — לחזור בהמשך',   en: 'Interested – Follow Up Later' },
  { value: 'not_ready',        he: 'עדיין לא מוכן',           en: 'Not Ready Yet' },
  { value: 'meeting',          he: 'נקבעה פגישה',             en: 'Meeting Scheduled' },
  { value: 'not_relevant',     he: 'לא רלוונטי',              en: 'Not Relevant' },
  { value: 'customer',         he: 'לקוח',                    en: 'Customer' },
]

export function outcomeLabel(outcome: FollowUpOutcome): { he: string; en: string } {
  return FOLLOW_UP_OUTCOMES.find(item => item.value === outcome) ?? { he: outcome, en: outcome }
}

/** Outcomes that need a date before they can be saved. */
export function outcomeNeedsDate(outcome: FollowUpOutcome): boolean {
  return outcome === 'interested_later' || outcome === 'not_ready' || outcome === 'meeting'
}

export interface DbLeadFollowUpTask {
  id: string
  lead_id: string
  progress_id: string | null
  step_no: number | null
  due_at: string
  status: 'open' | 'done' | 'cancelled'
  outcome: FollowUpOutcome | null
  note: string | null
  completed_at: string | null
  completed_by: string | null
  created_at: string
  updated_at: string
}

export type FollowUpTaskLead = Pick<DbLead, 'id' | 'name' | 'phone' | 'pipeline_status_id' | 'status'>
export type FollowUpTaskWithLead = DbLeadFollowUpTask & { lead: FollowUpTaskLead | null }

/** Fired after any change, so the reminder and the leads board both refetch. */
export const FOLLOW_UP_CHANGED_EVENT = 'leads:followUpChanged'
function announceChange() {
  window.dispatchEvent(new CustomEvent(FOLLOW_UP_CHANGED_EVENT))
}

const DAY_MS = 86_400_000

// ── Reads ────────────────────────────────────────────────────────────────────

/** Every task of every lead. The table is small: a handful of rows per lead. */
export async function getFollowUpTasks(): Promise<DbLeadFollowUpTask[]> {
  const { data, error } = await supabase
    .from('lead_followup_tasks')
    .select('*')
    .order('due_at', { ascending: true })
    .limit(5000)
  if (error) throw error
  return (data ?? []) as DbLeadFollowUpTask[]
}

/** Open tasks with the lead they belong to — what the daily reminder shows. */
export async function getOpenFollowUpTasks(): Promise<FollowUpTaskWithLead[]> {
  const { data, error } = await supabase
    .from('lead_followup_tasks')
    .select('*, lead:leads(id,name,phone,pipeline_status_id,status)')
    .eq('status', 'open')
    .order('due_at', { ascending: true })
    .limit(500)
  if (error) throw error
  return (data ?? []) as FollowUpTaskWithLead[]
}

// ── When a task counts as due ────────────────────────────────────────────────

function endOfToday(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
}
function startOfToday(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

/** Due today or earlier. */
export function isTaskDue(task: Pick<DbLeadFollowUpTask, 'status' | 'due_at'>, now = new Date()): boolean {
  return task.status === 'open' && new Date(task.due_at).getTime() < endOfToday(now)
}
/** Was due on an earlier day and is still open. */
export function isTaskOverdue(task: Pick<DbLeadFollowUpTask, 'status' | 'due_at'>, now = new Date()): boolean {
  return task.status === 'open' && new Date(task.due_at).getTime() < startOfToday(now)
}

// ── Writes ───────────────────────────────────────────────────────────────────

async function insertTask(row: { lead_id: string; progress_id: string | null; step_no: number | null; due_at: string }): Promise<DbLeadFollowUpTask> {
  const { data, error } = await supabase.from('lead_followup_tasks').insert(row).select().single()
  if (error) throw error
  return data as DbLeadFollowUpTask
}

async function patchTask(id: string, patch: Partial<DbLeadFollowUpTask>, onlyIfOpen = true): Promise<DbLeadFollowUpTask | null> {
  let query = supabase.from('lead_followup_tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  // Two people can have the same reminder open. Whoever acts second finds the
  // task already closed and changes nothing, instead of closing it twice and
  // scheduling the next call twice.
  if (onlyIfOpen) query = query.eq('status', 'open')
  const { data, error } = await query.select()
  if (error) throw error
  return ((data ?? [])[0] as DbLeadFollowUpTask | undefined) ?? null
}

async function patchProgress(id: string, patch: Partial<DbLeadSequenceProgress>): Promise<DbLeadSequenceProgress> {
  const { data, error } = await supabase
    .from('lead_sequence_progress')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as DbLeadSequenceProgress
}

async function cancelOpenTasksOf(progressId: string): Promise<void> {
  const { error } = await supabase
    .from('lead_followup_tasks')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('progress_id', progressId)
    .eq('status', 'open')
  if (error) throw error
}

/**
 * Puts a lead on the chain: the chain's own row, plus the first call, due now.
 *
 * A lead has one row per chain for good (the table says so), so a lead that
 * was on it before is restarted on that same row rather than given a second.
 */
export async function startFollowUp(leadId: string, sequenceId: string, existing?: DbLeadSequenceProgress): Promise<{ progress: DbLeadSequenceProgress; task: DbLeadFollowUpTask }> {
  const now = new Date().toISOString()
  let progress: DbLeadSequenceProgress
  if (existing) {
    await cancelOpenTasksOf(existing.id)
    progress = await patchProgress(existing.id, { status: 'active', started_at: now, last_day_sent: -1 })
  } else {
    const { data, error } = await supabase
      .from('lead_sequence_progress')
      .insert({ lead_id: leadId, sequence_id: sequenceId, status: 'active', last_day_sent: -1 })
      .select()
      .single()
    if (error) throw error
    progress = data as DbLeadSequenceProgress
  }
  const task = await insertTask({ lead_id: leadId, progress_id: progress.id, step_no: 1, due_at: now })
  announceChange()
  return { progress, task }
}

/** Holds the chain: no WhatsApp goes out and its calls stop being asked for. */
export async function pauseFollowUp(progressId: string): Promise<DbLeadSequenceProgress> {
  const paused = await patchProgress(progressId, { status: 'paused' })
  announceChange()
  return paused
}

/**
 * Picks the chain up where it was left. The start date is pushed forward by
 * however long it was held, and so are its open calls, so a chain paused for
 * a week does not come back with a week of messages owed all at once.
 */
export async function resumeFollowUp(progress: DbLeadSequenceProgress): Promise<DbLeadSequenceProgress> {
  const heldFor = Math.max(0, Date.now() - new Date(progress.updated_at).getTime())
  const resumed = await patchProgress(progress.id, {
    status: 'active',
    started_at: new Date(new Date(progress.started_at).getTime() + heldFor).toISOString(),
  })
  const { data: open, error } = await supabase
    .from('lead_followup_tasks').select('*').eq('progress_id', progress.id).eq('status', 'open')
  if (error) throw error
  for (const task of (open ?? []) as DbLeadFollowUpTask[]) {
    await patchTask(task.id, { due_at: new Date(new Date(task.due_at).getTime() + heldFor).toISOString() })
  }
  announceChange()
  return resumed
}

/** Ends the chain for this lead and withdraws the calls it was still asking for. */
export async function stopFollowUp(progressId: string): Promise<DbLeadSequenceProgress> {
  const stopped = await patchProgress(progressId, { status: 'stopped' })
  // The table is only there once the follow-up migration has been applied;
  // stopping a chain must work either way.
  await cancelOpenTasksOf(progressId).catch(() => {})
  announceChange()
  return stopped
}

/** A call on a date somebody chose, outside any chain. */
export async function createCallback(leadId: string, dueAt: string): Promise<DbLeadFollowUpTask> {
  const task = await insertTask({ lead_id: leadId, progress_id: null, step_no: null, due_at: dueAt })
  announceChange()
  return task
}

export async function rescheduleFollowUpTask(taskId: string, dueAt: string): Promise<DbLeadFollowUpTask | null> {
  const task = await patchTask(taskId, { due_at: dueAt })
  announceChange()
  return task
}

export async function cancelFollowUpTask(taskId: string): Promise<DbLeadFollowUpTask | null> {
  const task = await patchTask(taskId, { status: 'cancelled' })
  announceChange()
  return task
}

/** When the next call of a chain falls, given when this one was actually made. */
export function nextCallDueAt(startedAt: string, nextStepNo: number, completedAt = new Date()): Date {
  const planned = new Date(startedAt).getTime() + FOLLOW_UP_CALL_DAYS[nextStepNo - 1] * DAY_MS
  // A call made late does not put the next one on the same day or in the
  // past: there is always at least a day between two attempts.
  return new Date(Math.max(planned, completedAt.getTime() + DAY_MS))
}

/** Columns a lead may be carried out of by an outcome — never one a person chose on purpose. */
function mayMoveOnOutcome(from: DbLeadPipelineStatus | undefined): boolean {
  if (!from) return true
  if (from.is_archived) return false
  const legacy = (from.legacy_status ?? '').trim()
  if (legacy === 'new' || legacy === 'followup') return true
  const names = [from.label_en.trim().toLowerCase(), from.label_he.trim().toLowerCase()]
  return names.some(name => ['cold call', 'no answer', 'no-answer', 'אין מענה', 'ללא מענה'].includes(name))
}

export interface CompleteTaskInput {
  task: DbLeadFollowUpTask
  outcome: FollowUpOutcome
  /** The chain the task belongs to, when it belongs to one. */
  progress?: DbLeadSequenceProgress
  statuses: DbLeadPipelineStatus[]
  lead: Pick<DbLead, 'id' | 'pipeline_status_id'>
  /** The callback date, or the meeting's date and time. */
  date?: string
  userId?: string | null
  lang: 'he' | 'en'
  /** The unanswered attempt is already in the history (the button in the lead dialog wrote it). */
  historyAlreadyRecorded?: boolean
}

export interface CompleteTaskResult {
  task: DbLeadFollowUpTask | null
  history?: DbLeadHistory
  nextTask?: DbLeadFollowUpTask
  leadPatch?: Partial<DbLead>
  progress?: DbLeadSequenceProgress
}

/**
 * Records what happened on a call and schedules whatever follows from it.
 *
 * The task is closed FIRST and only if it is still open; everything after that
 * runs only for whoever actually closed it. That is what stops two people with
 * the same reminder open from both logging the call and both scheduling the
 * next one.
 */
export async function completeFollowUpTask(input: CompleteTaskInput): Promise<CompleteTaskResult> {
  const { task, outcome, progress, statuses, lead, date, userId, lang } = input
  const now = new Date()
  const label = outcomeLabel(outcome)

  const closed = await patchTask(task.id, {
    status: 'done',
    outcome,
    completed_at: now.toISOString(),
    completed_by: userId ?? null,
  })
  if (!closed) { announceChange(); return { task: null } }

  const result: CompleteTaskResult = { task: closed }
  const inChain = !!progress && progress.status !== 'stopped' && progress.status !== 'done' && task.progress_id === progress.id
  const currentStatus = statuses.find(status => status.id === lead.pipeline_status_id)

  if (outcome === 'no_answer') {
    if (!input.historyAlreadyRecorded) result.history = await addLeadHistory({ lead_id: task.lead_id, kind: 'no_answer' })
    if (inChain && task.step_no !== null && task.step_no < FOLLOW_UP_CALL_DAYS.length) {
      result.nextTask = await insertTask({
        lead_id: task.lead_id,
        progress_id: progress!.id,
        step_no: task.step_no + 1,
        due_at: nextCallDueAt(progress!.started_at, task.step_no + 1, now).toISOString(),
      })
    } else if (task.progress_id === null) {
      // A callback nobody picked up is tried again tomorrow rather than dropped.
      result.nextTask = await insertTask({ lead_id: task.lead_id, progress_id: null, step_no: null, due_at: new Date(now.getTime() + DAY_MS).toISOString() })
    }
    announceChange()
    return result
  }

  // Every other outcome means a person got through, so the chain for people
  // who cannot be reached is over.
  const dateText = date ? new Date(date).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''
  const body = lang === 'he'
    ? `תוצאה: ${label.he}${dateText ? ` · ${outcome === 'meeting' ? 'פגישה' : 'לחזור'} ${dateText}` : ''}`
    : `Outcome: ${label.en}${dateText ? ` · ${outcome === 'meeting' ? 'meeting' : 'call back'} ${dateText}` : ''}`
  result.history = await addLeadHistory({ lead_id: task.lead_id, kind: outcome === 'not_relevant' ? 'note' : 'completed_call', body })

  if (inChain) {
    result.progress = await patchProgress(progress!.id, { status: 'stopped' })
    await cancelOpenTasksOf(progress!.id)
  }

  const updateLead = async (patch: Partial<DbLead>) => {
    const { data, error } = await supabase.from('leads').update(patch).eq('id', task.lead_id).select().single()
    if (error) throw error
    result.leadPatch = data as DbLead
  }

  if ((outcome === 'interested_later' || outcome === 'not_ready') && date) {
    result.nextTask = await insertTask({ lead_id: task.lead_id, progress_id: null, step_no: null, due_at: new Date(date).toISOString() })
    const followUp = statuses.find(status => status.legacy_status === 'followup')
    if (followUp && followUp.id !== lead.pipeline_status_id && mayMoveOnOutcome(currentStatus)) {
      await updateLead({ pipeline_status_id: followUp.id, status: 'followup', status_updated_at: now.toISOString() })
    }
  } else if (outcome === 'meeting' && date) {
    const meeting = statuses.find(status => status.legacy_status === 'meeting')
    await updateLead({
      due_at: new Date(date).toISOString(),
      ...(meeting ? { pipeline_status_id: meeting.id, status: 'meeting' as const, status_updated_at: now.toISOString() } : {}),
    })
  } else if (outcome === 'not_relevant') {
    const archived = statuses.find(status => status.is_archived)
    if (archived && archived.id !== lead.pipeline_status_id) {
      await updateLead({ pipeline_status_id: archived.id, status: 'irrelevant', status_updated_at: now.toISOString() })
    }
  }

  announceChange()
  return result
}
