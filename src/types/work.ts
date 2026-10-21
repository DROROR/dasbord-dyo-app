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

// Mirrors board_access_rank() in
// supabase/migrations/20260809140000_docs_and_board_access.sql — for
// client-side UI gating only (e.g. whether to show/enable the comment
// box). The server-side RPC re-checks this independently; this copy
// existing is not itself a security boundary.
const BOARD_ACCESS_RANK: Record<AccessLevel, number> = { none: 0, view: 1, comment: 2, full: 3 }
export function boardAccessRank(lvl: AccessLevel | string | undefined): number {
  return lvl != null && lvl in BOARD_ACCESS_RANK ? BOARD_ACCESS_RANK[lvl as AccessLevel] : 0
}

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
  /** Display-name snapshot — kept as a fallback/history value, no longer authoritative. */
  loggedBy: string
  /** Authoritative: the profile UUID who logged this entry. Absent on entries created before this field existed and never resolved to a unique profile name. */
  loggedById?: string
  /** Optional child-work item this entry was logged against. */
  subtaskId?: string
  note?: string
  isLocked: boolean  // true = created by timer stop, false = manual entry
  createdAt: string
}

export type TaskSubtaskStatus = 'not_started' | 'in_progress' | 'done'

export interface TaskSubtask {
  id: string
  taskId: string
  title: string
  description?: string
  status: TaskSubtaskStatus
  assigneeId?: string
  /** Display snapshot only; assigneeId is authoritative. */
  assigneeName: string
  createdBy?: string
  comments: TaskComment[]
  createdAt: string
  updatedAt: string
}

export interface StatusHistoryEntry {
  status: string
  timestamp: string
  changedBy: string
}

export interface TaskComment {
  id: string
  author: string
  /** Authoritative creator UUID. Legacy comments created before author-aware deletion do not have it. */
  authorId?: string
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
  /** Display-name snapshot — kept as a fallback, no longer authoritative. */
  owner?: string
  /** Authoritative: the profile UUID responsible for tasks in this status. */
  ownerId?: string
}

// ─── Main entities ────────────────────────────────────────────────────────────

export type TaskPlatform = 'admin' | 'website' | 'mobile_app' | 'super_admin'

/**
 * What the admin's ticket wizard collected, stored as sent (snake_case keys,
 * matching the payload and the `tasks.ticket_details` column) so there is one
 * spelling of each field across the admin app, the edge function and here.
 */
export interface TicketDetails {
  /** 'technical' → Support Tickets tab, 'general' → Development Requests tab. */
  category?: string
  /** admin | app | web — which part of the product the issue is in. */
  system_area?: string
  /** On an admin ticket: users, lessons, reports, subscriptions, forms, settings, other. */
  admin_tab?: string
  /** On an app ticket: general, or user for one specific person. */
  app_scope?: string
  /** On an app ticket: lesson, daily_focus, forms, feed, profile, other. */
  app_screen?: string
  /** On a web ticket: login, player, checkout, catalog, other. */
  web_component?: string
  /** Only for the lesson player. */
  lesson_id?: string
  /** Only when the ticket is about one specific user. */
  user_phone?: string
  device_info?: string
  page_url?: string
  /** Anything the admin starts sending later still arrives and is displayed. */
  [key: string]: string | undefined
}

export interface Task {
  id: string
  title: string
  description: string
  /** Display-name snapshot — kept as a fallback/history value, no longer authoritative. */
  assignee: string
  /** Authoritative: the profile UUID a task is assigned to. */
  assigneeId?: string
  board: BoardId
  priority: Priority
  status: string
  platforms?: TaskPlatform[]
  clientId?: string
  clientName?: string
  dueDate?: string
  startDate?: string
  timeEstimate?: number
  timeEntries: TimeEntry[]
  statusHistory: StatusHistoryEntry[]
  attachments: Attachment[]
  comments: TaskComment[]
  subtasks?: TaskSubtask[]
  createdAt: string
  /** Immutable UUID stamped by the database when the task is created. */
  createdById?: string
  doneAt?: string
  whatsappPending?: boolean
  claimed?: boolean
  /** Display-name snapshot — kept as a fallback/history value, no longer authoritative. */
  claimedBy?: string
  /** Authoritative: the profile UUID who claimed this task. */
  claimedById?: string
  codeReviewer?: string
  uxReviewer?: string
  /** Answered when a support ticket is closed: does the fix need a release? */
  requiresAppUpdate?: boolean
  /** On an app-update task, the support ticket that caused it. */
  sourceTaskId?: string
  /** Firebase ticket ID — populated for support board tasks created via the edge function. */
  ticketId?: string
  /** Firebase app ID — populated for support board tasks created via the edge function. */
  appId?: string
  /**
   * The ticket wizard's own fields, exactly as the admin app sent them —
   * written only by the create-support-ticket edge function, never from here.
   * Every key is optional: the admin asks for a field only when the chosen
   * system area calls for it (no `adminTab` on an app ticket, no `lessonId`
   * outside the lesson player), and it owns the vocabulary, so this stays a
   * loose string map rather than a union that a new option there would break.
   */
  ticketDetails?: TicketDetails
  /** True once the developer marks the fix as deployed to the admin's app. */
  deployedToAdmin?: boolean
  /** Release note written by the developer when marking as deployed. */
  updateMessage?: string
  /** Machine-translated English version of the title (set when original is Hebrew). */
  titleEn?: string
  /** Machine-translated English version of the description (set when original is Hebrew). */
  descriptionEn?: string
}

export type DocAccessLevel = 'none' | 'view' | 'full'

export interface WorkDoc {
  id: string
  title: string
  content: string
  /** profile UUID of the creator, resolved to a display name for "Created by" text via the profiles list. */
  createdBy: string
  updatedAt: string
  /** null/undefined = lives at the Documentation root, not inside any folder. */
  folderId?: string | null
  /** profile UUID -> access level. Populated only when explicitly fetched via update-resource-access; omitted from the regular doc list/fetch. */
  access?: Record<string, DocAccessLevel>
  /** A chosen emoji shown instead of the default icon; null/undefined = default. */
  icon?: string | null
}

export interface WorkDocFolder {
  id: string
  name: string
  /** null = a root-level folder; folders nest to any depth, capped server-side (enforce_folder_depth). */
  parentId: string | null
  createdBy: string
  updatedAt: string
  /** The caller's own effective level on this folder (owner/active bypass -> 'full'). */
  myLevel: DocAccessLevel
  /** A chosen emoji shown instead of the default icon; null/undefined = default. */
  icon?: string | null
}

export interface Board {
  id: string
  name: string
  isDefault: boolean
  access: Record<string, AccessLevel>
  statuses: BoardStatus[]
  priorities: PriorityDef[]
  createdAt: string
  /** When true, every eligible unclaimed task on this board enters the shared support queue regardless of priority. */
  allTasksToSupportQueue?: boolean
}

export interface AssigneeOption { id: string; name: string }

// Client-side mirror of the validate_task_assignee() DB trigger
// (see the assignee-validation migration): the Owner is always
// eligible regardless of board access; any other profile needs
// explicit board access above 'none'; an inactive profile is never
// eligible since `profiles` here is expected to already be filtered
// to is_active by the caller. Not itself a security boundary — the
// trigger is authoritative.
export function eligibleAssigneesForBoard(
  board: Board | undefined,
  profiles: { id: string; name: string; isOwner: boolean }[],
): AssigneeOption[] {
  return profiles
    .filter(p => p.isOwner || boardAccessRank(board?.access[p.id]) > boardAccessRank('none'))
    .map(p => ({ id: p.id, name: p.name }))
}

export interface PriorityDef {
  id: string
  label: string
  textCls: string
  bgCls: string
  dotCls: string
  borderCls: string
  /** When true, an unclaimed task with this priority enters the shared support queue. */
  showInSupportQueue?: boolean
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
  | 'support_escalation'
  | 'task_assigned'
  | 'subtask_assigned'
  | 'task_status_changed'
  | 'ticket_reply'

export interface AppNotification {
  id: string
  type: NotificationType
  message: string
  taskId?: string
  taskTitle?: string
  recipientId?: string
  subtaskId?: string
  clientId?: string
  clientName?: string
  phone?: string
  timestamp: string
  read: boolean
  severity: 'normal' | 'high'
  waDetails?: { clientName: string; message: string }
}

// ─── Work Report ──────────────────────────────────────────────────────────────
// Shapes returned by the get_work_report() RPC — see
// supabase/migrations/20260810110000_work_report.sql. Never fetched via a
// plain table select; always through that one narrow, access-checked RPC.
// One event per real status transition (task_status_events) — a
// completion is just an ordinary event whose toStatusId is 'done', not a
// separate concept.

export interface WorkReportEvent {
  taskId: string
  title: string
  board: string
  /** Null only for a task's very first status, recorded on creation. */
  fromStatusId: string | null
  fromStatusLabel: string | null
  toStatusId: string
  toStatusLabel: string
  changedAt: string
  /** The task's claimed_by_id AT THE MOMENT of this transition — display only, never used to reattribute who performed it. */
  claimedById: string | null
}

export interface WorkReportTimeEntryRef {
  taskId: string
  title: string
  board: string
  hours: number
}

export interface WorkReportEmployee {
  id: string
  name: string
  /** Distinct tasks with at least one transition this employee performed on the selected date. */
  tasksProgressed: number
  /** Distinct support-board (id 'support') tasks this employee progressed on the selected date. */
  ticketsHandled: number
  hoursWorked: number
  /** Every transition this employee performed on the selected date, chronological. */
  events: WorkReportEvent[]
  timeEntries: WorkReportTimeEntryRef[]
}

export interface WorkReportStatusBreakdownEntry {
  statusId: string
  /** The actual configured label at the time of the most recent transition into this status today — never inferred/translated. */
  statusLabel: string
  /** Raw event count into this status today — NOT deduplicated by task, unlike the team/employee "progressed" counts. */
  count: number
}

export interface WorkReport {
  reportDate: string
  reportStart?: string
  reportEnd?: string
  timezone: string
  team: {
    /** Distinct tasks with at least one transition anywhere on the selected date. */
    tasksProgressed: number
    /** Distinct support-board tasks with at least one transition on the selected date. */
    ticketsHandled: number
    /** Secondary metric: distinct tasks that reached 'done' on the selected date. */
    tasksCompleted: number
    hoursWorked: number
  }
  statusBreakdown: WorkReportStatusBreakdownEntry[]
  /** Transitions with no authenticated actor (service-role/automation) — never attributed to an employee. */
  systemActivity: WorkReportEvent[]
  employees: WorkReportEmployee[]
}
