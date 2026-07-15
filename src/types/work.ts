// ─── Enums / union types ──────────────────────────────────────────────────────

export type TaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'fixing'
  | 'pending_code_review'
  | 'pending_ux_review'
  | 'done'
  | 'archived'

export type Priority = string
export type BoardId  = string
export type AccessLevel = 'none' | 'view' | 'comment' | 'full'

// ─── Sub-shapes ───────────────────────────────────────────────────────────────

export interface Developer {
  id: string
  name: string
  email: string
  role: string
}

export interface TimeEntry {
  id: string
  date: string       // YYYY-MM-DD
  hours: number
  minutes: number
  loggedBy: string
  note?: string
  isLocked: boolean  // true = created by timer stop, false = manual entry
  createdAt: string
}

export interface StatusHistoryEntry {
  status: string
  timestamp: string
  changedBy: string
}

export interface TaskComment {
  id: string
  author: string
  text: string
  timestamp: string
  mentions: string[]
}

export interface Attachment {
  id: string
  type: 'url' | 'file'
  name: string
  url: string
}

export interface BoardStatus {
  id: string
  label: string
  pillCls: string
  leftBorderCls: string
  canDelete: boolean
  order: number
  owner?: string
}

// ─── Main entities ────────────────────────────────────────────────────────────

export interface Task {
  id: string
  title: string
  description: string
  assignee: string
  board: BoardId
  priority: Priority
  status: string
  clientId?: string
  clientName?: string
  dueDate?: string
  startDate?: string
  timeEstimate?: number
  timeEntries: TimeEntry[]
  statusHistory: StatusHistoryEntry[]
  attachments: Attachment[]
  comments: TaskComment[]
  createdAt: string
  doneAt?: string
  whatsappPending?: boolean
  claimed?: boolean
  claimedBy?: string
  codeReviewer?: string
  uxReviewer?: string
}

export interface WorkDoc {
  id: string
  title: string
  content: string
  createdBy: string
  updatedAt: string
  access: Record<string, 'none' | 'view' | 'comment' | 'edit'>
}

export interface Board {
  id: string
  name: string
  isDefault: boolean
  access: Record<string, AccessLevel>
  statuses: BoardStatus[]
  createdAt: string
}

export interface PriorityDef {
  id: string
  label: string
  textCls: string
  bgCls: string
  dotCls: string
  borderCls: string
}

export type NotificationType =
  | 'support_opened'
  | 'code_review'
  | 'ux_review'
  | 'fixing'
  | 'review_stale'
  | 'ticket_unclaimed'
  | 'ticket_stale'
  | 'wa_pending'
  | 'status_owner_assigned'
  | 'task_done_return'

export interface AppNotification {
  id: string
  type: NotificationType
  message: string
  taskId?: string
  taskTitle?: string
  timestamp: string
  read: boolean
  severity: 'normal' | 'high'
  waDetails?: { clientName: string; message: string }
}
