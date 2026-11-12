import { supabase } from './supabase'

/**
 * The follow-up emails sent to leads on the unresponsive-leads chain.
 *
 * This file only reads and writes the texts. Sending is the server's job
 * (server/lead-emails.mjs): the mailbox password never reaches a browser.
 */

export interface DbLeadEmailStep {
  id: string
  /** Days after the lead joined the chain. */
  day: number
  subject: string
  body: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface LeadEmailCounts {
  sent: number
  failed: number
  skipped: number
}

export async function getLeadEmailSteps(): Promise<DbLeadEmailStep[]> {
  const { data, error } = await supabase.from('lead_email_steps').select('*').order('day', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DbLeadEmailStep[]
}

export async function createLeadEmailStep(day: number): Promise<DbLeadEmailStep> {
  // A new email starts switched off: an empty or half-written one is never sent.
  const { data, error } = await supabase.from('lead_email_steps').insert({ day, subject: '', body: '', is_active: false }).select().single()
  if (error) throw error
  return data as DbLeadEmailStep
}

export async function updateLeadEmailStep(id: string, patch: Partial<Pick<DbLeadEmailStep, 'day' | 'subject' | 'body' | 'is_active'>>): Promise<DbLeadEmailStep> {
  const { data, error } = await supabase.from('lead_email_steps').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data as DbLeadEmailStep
}

export async function deleteLeadEmailStep(id: string): Promise<void> {
  const { error } = await supabase.from('lead_email_steps').delete().eq('id', id)
  if (error) throw error
}

/** How many leads each email has gone to, by email. */
export async function getLeadEmailCounts(): Promise<Record<string, LeadEmailCounts>> {
  const { data, error } = await supabase.from('lead_email_log').select('step_id,status').limit(10000)
  if (error) throw error
  const counts: Record<string, LeadEmailCounts> = {}
  for (const row of (data ?? []) as Array<{ step_id: string; status: keyof LeadEmailCounts }>) {
    counts[row.step_id] ??= { sent: 0, failed: 0, skipped: 0 }
    if (row.status in counts[row.step_id]) counts[row.step_id][row.status] += 1
  }
  return counts
}

export async function getUnsubscribeCount(): Promise<number> {
  const { count, error } = await supabase.from('lead_email_unsubscribes').select('email', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}
