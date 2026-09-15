import { supabase } from './supabase'
import type { DbLead, DbLeadHistory, DbLeadPipelineStatus, LeadStatusColor } from './database'

export async function getAllLeads(): Promise<DbLead[]> {
  const all: DbLead[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("leads").select("*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, from + 999)
    if (error) throw error
    all.push(...(data as DbLead[]))
    if (!data || data.length < 1000) break
  }
  return all
}

export async function getLeadHistory(): Promise<DbLeadHistory[]> {
  const all: DbLeadHistory[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("lead_history").select("*").order("occurred_at", { ascending: true }).order("recorded_at", { ascending: true }).order("id", { ascending: true }).range(from, from + 999)
    if (error) throw error
    all.push(...(data as DbLeadHistory[]))
    if (!data || data.length < 1000) break
  }
  return all
}

export async function addLeadHistory(input: {
  lead_id: string
  kind: DbLeadHistory['kind']
  body?: string
  occurred_at?: string
}): Promise<DbLeadHistory> {
  const { data, error } = await supabase.from('lead_history').insert(input).select().single()
  if (error) throw error
  return data as DbLeadHistory
}

export async function updateLeadPipelineStatus(id: string, patch: Partial<Pick<DbLeadPipelineStatus, 'label_he' | 'label_en' | 'color' | 'position'>>): Promise<DbLeadPipelineStatus> {
  const { data, error } = await supabase.from('lead_pipeline_statuses').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as DbLeadPipelineStatus
}

export type LeadHistoryKind = DbLeadHistory['kind']
export type StatusColor = LeadStatusColor
