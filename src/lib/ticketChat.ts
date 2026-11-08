import type { Task } from '../types/work'

/**
 * The Firestore ticket a planner task is wired to, when it is wired to one.
 *
 * Two shapes exist in production: tasks created by the support webhook carry
 * ticket_id/app_id columns, while older ones only ever got the "Ticket ID:" /
 * "App ID:" lines the edge function writes into the description. Both are
 * resolved here so the board sees exactly the same thread the task modal does.
 */
export type TicketLink = { ticketId: string; appId: string }

/** Characters that would break the comma/slash-joined keys below. */
const UNSAFE_ID = /[,/]/

export function ticketLinkOf(task: Pick<Task, 'ticketId' | 'appId' | 'description'>): TicketLink | null {
  const direct = task.ticketId && task.appId
    ? { ticketId: task.ticketId, appId: task.appId }
    : null
  const fallback = (() => {
    if (direct) return null
    const desc = task.description ?? ''
    const ticketMatch = desc.match(/Ticket ID:\s*(\S+)/)
    const appMatch    = desc.match(/App ID:\s*(\S+)/)
    return ticketMatch && appMatch ? { ticketId: ticketMatch[1], appId: appMatch[1] } : null
  })()
  const link = direct ?? fallback
  if (!link) return null
  // A description-scraped id is whatever text followed the label, so it is
  // checked before it is used as part of a map key.
  if (UNSAFE_ID.test(link.ticketId) || UNSAFE_ID.test(link.appId)) return null
  return link
}

/** The key both the proxy's reply and every lookup here agree on. */
export function ticketKey(appId: string, ticketId: string) {
  return `${appId}/${ticketId}`
}

/** What /api/claude/get-ticket-message-states reports for one ticket. */
export type AdminChatState = {
  total: number
  dyoCount: number
  adminCount: number
  lastSender: 'dyo' | 'admin' | null
  lastAt: number | null
}

/**
 * - `none`     — the thread exists but nobody has written in it
 * - `awaiting` — the last word is ours, so the admin has not answered it yet
 * - `replied`  — the admin wrote last, so there is an answer waiting for us
 *
 * Deliberately keyed off the LAST message rather than "does an admin message
 * exist": a thread that went us → admin → us is waiting on the admin again.
 */
export type AdminReplyStatus = 'none' | 'awaiting' | 'replied'

export function adminReplyStatusOf(state: AdminChatState | undefined): AdminReplyStatus | undefined {
  if (!state) return undefined
  if (state.total === 0) return 'none'
  return state.lastSender === 'dyo' ? 'awaiting' : 'replied'
}

/** The ticket links of a task list, de-duplicated, as one stable string. */
export function ticketLinksKeyOf(tasks: Pick<Task, 'ticketId' | 'appId' | 'description'>[]) {
  const keys = new Set<string>()
  tasks.forEach(task => {
    const link = ticketLinkOf(task)
    if (link) keys.add(ticketKey(link.appId, link.ticketId))
  })
  return Array.from(keys).sort().join(',')
}

export function ticketLinksFromKey(key: string): { app_id: string; ticket_id: string }[] {
  if (!key) return []
  return key.split(',').map(entry => {
    const at = entry.indexOf('/')
    return { app_id: entry.slice(0, at), ticket_id: entry.slice(at + 1) }
  }).filter(t => t.app_id && t.ticket_id)
}
