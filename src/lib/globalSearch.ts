// The header search box, across the whole app.
//
// One query fans out to the tables the person can actually reach: leads, tasks,
// documents, clients and meditations. Nothing is pre-indexed — these are plain
// ILIKE lookups with a small limit each, which is what the data sizes here call
// for. RLS does the real filtering, so a result can only ever be a row the
// caller is already allowed to read; the `allow` check on top of it is just so
// results never point at a page the person cannot open.

import { supabase } from './supabase'

export type SearchKind = 'lead' | 'task' | 'doc' | 'client' | 'meditation'

export interface SearchHit {
  kind: SearchKind
  id: string
  title: string
  /** The second line: phone, board, folder — whatever tells two hits apart. */
  subtitle: string
  /** Page id to navigate to, as used by App's navigate(). */
  page: string
}

const PER_KIND = 5

/**
 * PostgREST's or() takes a comma-separated filter list, so a comma, bracket or
 * percent sign in the term would be read as syntax. They are dropped rather
 * than escaped — none of them is worth searching for here.
 */
function safeTerm(term: string): string {
  return term.trim().replace(/[,()%*\\"']/g, ' ').replace(/\s+/g, ' ').trim()
}

function orFilter(columns: string[], term: string): string {
  return columns.map(column => `${column}.ilike.%${term}%`).join(',')
}

export async function searchEverything(
  rawTerm: string,
  allow: (page: string) => boolean,
): Promise<SearchHit[]> {
  const term = safeTerm(rawTerm)
  if (term.length < 2) return []

  const lookups: Promise<SearchHit[]>[] = []

  if (allow('leads')) {
    lookups.push((async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, name, client_name, phone, email, campaign_name')
        .or(orFilter(['name', 'client_name', 'phone', 'email', 'campaign_name'], term))
        .limit(PER_KIND)
      if (error) throw error
      return (data ?? []).map(row => ({
        kind: 'lead' as const,
        id: row.id as string,
        title: (row.name as string) || (row.client_name as string) || '—',
        subtitle: [row.phone, row.email, row.campaign_name].filter(Boolean).join(' · '),
        page: 'leads',
      }))
    })())
  }

  if (allow('work')) {
    lookups.push((async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, description, board, status, client_name')
        .or(orFilter(['title', 'description', 'client_name'], term))
        .limit(PER_KIND)
      if (error) throw error
      return (data ?? []).map(row => ({
        kind: 'task' as const,
        id: row.id as string,
        title: (row.title as string) || '—',
        subtitle: [row.board, row.status, row.client_name].filter(Boolean).join(' · '),
        page: 'work',
      }))
    })())

    // Documents are searched by their body as well — that is where most of what
    // people look for actually lives.
    lookups.push((async () => {
      const { data, error } = await supabase
        .from('work_docs')
        .select('id, title, content')
        .or(orFilter(['title', 'content'], term))
        .limit(PER_KIND)
      if (error) throw error
      return (data ?? []).map(row => ({
        kind: 'doc' as const,
        id: row.id as string,
        title: (row.title as string) || '—',
        subtitle: snippet(String(row.content ?? ''), term),
        page: 'work',
      }))
    })())
  }

  if (allow('clients')) {
    lookups.push((async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, business_name, email, phone')
        .or(orFilter(['name', 'business_name', 'email', 'phone'], term))
        .limit(PER_KIND)
      if (error) throw error
      return (data ?? []).map(row => ({
        kind: 'client' as const,
        id: row.id as string,
        title: (row.name as string) || (row.business_name as string) || '—',
        subtitle: [row.business_name, row.phone, row.email].filter(Boolean).join(' · '),
        page: 'clients',
      }))
    })())
  }

  if (allow('meditations')) {
    lookups.push((async () => {
      const { data, error } = await supabase
        .from('meditations')
        .select('id, title, description, category')
        .or(orFilter(['title', 'description', 'category'], term))
        .limit(PER_KIND)
      if (error) throw error
      return (data ?? []).map(row => ({
        kind: 'meditation' as const,
        id: row.id as string,
        title: (row.title as string) || '—',
        subtitle: [row.category, row.description].filter(Boolean).join(' · '),
        page: 'meditations',
      }))
    })())
  }

  // One slow or failing table must not empty the whole result list.
  const settled = await Promise.allSettled(lookups)
  return settled.flatMap(result => {
    if (result.status === 'fulfilled') return result.value
    console.warn('A search lookup failed:', result.reason)
    return []
  })
}

/** Plain-text window around the match, so a document hit shows why it matched. */
function snippet(html: string, term: string): string {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  const at = text.toLowerCase().indexOf(term.toLowerCase())
  if (at === -1) return text.slice(0, 90)
  const from = Math.max(0, at - 30)
  return `${from > 0 ? '…' : ''}${text.slice(from, from + 100)}${text.length > from + 100 ? '…' : ''}`
}
