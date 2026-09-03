import { useState, useRef, useEffect } from 'react'
import {
  X, Check, Copy, Clock, ChevronDown,
  Send, Paperclip, Link2, Play, Square, AlertCircle,
  Lock, Pencil, Loader2, Trash2, ArrowRightLeft, Plus, ListChecks, UserMinus,
} from 'lucide-react'
import { Avatar } from '../Avatar'
import { useNotifications } from '../../contexts/NotificationContext'
import { useTimer, TIMER_ENTRY_SAVED_EVENT, type TimerEntrySavedDetail } from '../../contexts/TimerContext'
import { useWorkLang } from '../../contexts/WorkLanguageContext'
import type { Task, TaskPlatform, TaskSubtask, TaskSubtaskStatus, TimeEntry, PriorityDef, StatusHistoryEntry, TaskComment, Attachment, BoardStatus, AssigneeOption, Board } from '../../types/work'
import { DEFAULT_BOARD_STATUSES, STATUS_PILL, STATUS_LABEL } from '../../data/workConstants'
import {
  addSubtaskComment, addTaskComment, addTaskTimeEntry, claimTask, createTaskSubtask, deleteTaskComment,
  deleteTask, deleteTaskSubtask, getTaskBoardMoves, updateTaskSubtask,
  updateTaskTimeEntry, handoffTaskAssignment,
  type TaskBoardMove,
} from '../../lib/database'
import { MoveTaskModal } from './MoveTaskModal'
import { TaskPlatformPicker } from './TaskPlatforms'
import { supabase } from '../../lib/supabase'

const TASK_ATTACHMENTS_BUCKET = 'task-attachments'
const TASK_ATTACHMENT_PREFIX = 'storage:task-attachments:'

function taskAttachmentPath(url: string) {
  return url.startsWith(TASK_ATTACHMENT_PREFIX) ? url.slice(TASK_ATTACHMENT_PREFIX.length) : null
}

function isImageAttachment(attachment: Attachment) {
  return attachment.url.startsWith('data:image/') || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(attachment.name)
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtHours(h: number) {
  if (h === 0) return '0h'
  const hrs = Math.floor(h); const min = Math.round((h - hrs) * 60)
  return min > 0 ? `${hrs}h ${min}m` : `${hrs}h`
}
function fmtTimer(s: number) {
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60
  return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':')
}
function newId() { return Math.random().toString(36).slice(2, 10) }

function commentParts(text: string) {
  return text.split(/(https?:\/\/[^\s<>]+|www\.[^\s<>]+|@\w+)/gi).map((part, index) => {
    if (/^https?:\/\//i.test(part) || /^www\./i.test(part)) {
      const href = /^www\./i.test(part) ? `https://${part}` : part
      return (
        <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
          {part}
        </a>
      )
    }
    if (part.startsWith('@')) return <span key={index} className="font-semibold text-primary">{part}</span>
    return <span key={index}>{part}</span>
  })
}

/** What the developer answered when closing a support ticket. */
export interface TicketDoneAnswers {
  requiresAppUpdate: boolean
  /** now = write the customer message, wait = write it but hold, none = skip */
  messageChoice: 'now' | 'wait' | 'none'
}

export function TaskDetailModal({
  task, onClose, onUpdate, onDeleted, currentUser, currentUserId, priorityDefs, eligibleAssignees, clients, assignees, boardLabel, boardStatuses,
  openTicketsForClient = 0, onTicketDone, readonly = false, canComment = false, canDelete = false,
  isTechnicalSupport = false, boardAllTasksToSupportQueue = false,
  canMoveBoard = false, eligibleMoveBoards = [], profiles = [], onMoved,
  canManageSubtasks = false, canLogTime = false, canEditWork = false, onSubtasksChanged, onTimeEntriesChanged,
}: {
  task: Task
  onClose: () => void
  onUpdate: (t: Task) => void
  /** Called only after the DELETE has been confirmed by the server — never optimistic. Caller is responsible for removing the task from its own list and closing the modal. */
  onDeleted?: (id: string) => void
  currentUser: string
  /** The authenticated user's profile UUID — stamped onto any new time entry (timer or manual) as loggedById. */
  currentUserId?: string
  /** This task's OWN board's priorities — never a cross-board merged map. */
  priorityDefs: PriorityDef[]
  /** Active profiles + Owner + non-owner profiles with explicit access above 'none' on this task's board — the assignee picker's authoritative option list, by UUID. */
  eligibleAssignees: AssigneeOption[]
  clients: { id: string; name: string }[]
  /** Display names only — used for the code/UX reviewer pickers and @mention autocomplete, neither of which has a UUID column to store against. */
  assignees: string[]
  boardLabel: string
  boardStatuses?: BoardStatus[]
  /** Other tickets still open for this task's client, excluding this one. */
  openTicketsForClient?: number
  onTicketDone?: (task: Task, answers: TicketDoneAnswers) => void
  /** Gates every field except comments — title, status, assignee, dates, etc. */
  readonly?: boolean
  /** Independent of `readonly`: a board-level 'comment' user can add
   *  comments (via the dedicated add_task_comment RPC) even though
   *  they're readonly for everything else. Defaults to false so any
   *  caller that hasn't been updated to compute it explicitly fails
   *  closed, not open. */
  canComment?: boolean
  /** Gates the Delete Task action — owner, or a non-owner with BOTH
   *  work:'full' AND board:'full' on this task's current board (matches
   *  the "tasks: delete" RLS policy exactly). Defaults to false so any
   *  caller that hasn't been updated to compute it fails closed. The
   *  server-side policy is authoritative; this is UX only. */
  canDelete?: boolean
  /** Gates the Claim button — only active technical-support staff may claim a shared-queue task. The server-side claim_task() RPC re-checks this independently. */
  isTechnicalSupport?: boolean
  /** Whether the task's board sends every task to the shared queue regardless of priority. */
  boardAllTasksToSupportQueue?: boolean
  /** Mirrors the server's own has_permission('work','full') AND has_board_access(board,'full') check on the CURRENT board — same formula as canDelete. Server-side move_task_to_board() re-validates both source and destination independently. */
  canMoveBoard?: boolean
  /** Boards the caller has 'full' access to, excluding this task's current board — never a board the caller (or the server) would reject as a destination. */
  eligibleMoveBoards?: Board[]
  /** Active profiles + isOwner flag, used to resolve assignee eligibility on whichever destination board is picked. */
  profiles?: { id: string; name: string; isOwner: boolean }[]
  /** Called only after move_task_to_board() returns the server-confirmed row. */
  onMoved?: (t: Task) => void
  /** Full-board editors can create/reassign/delete child work items. */
  canManageSubtasks?: boolean
  /** Main assignees and subtask participants may log their own time without editing the whole task. */
  canLogTime?: boolean
  /** Mirrors has_permission('work','edit') — independent of board access or current assignment on THIS task. Lets a caller edit a time entry they logged themselves even after being unassigned or handed off, as long as they can still open the task at all (existing view/collaborator access) and hold this baseline Work permission. Defaults to false so any caller that hasn't been updated to compute it fails closed. */
  canEditWork?: boolean
  onSubtasksChanged?: (taskId: string, subtasks: TaskSubtask[]) => void
  onTimeEntriesChanged?: (taskId: string, entries: TimeEntry[]) => void
}) {
  const { addNotification } = useNotifications()
  const { t: tr } = useWorkLang()

  const [title,     setTitle]     = useState(task.title)
  const [editTitle, setEditTitle] = useState(false)
  const [desc,      setDesc]      = useState(task.description)
  const statuses = boardStatuses ?? DEFAULT_BOARD_STATUSES
  const [status,    setStatus]    = useState(task.status)
  const [platforms, setPlatforms] = useState<TaskPlatform[]>(task.platforms ?? [])
  const [assignee,  setAssignee]  = useState(task.assignee)
  const [clientId,  setClientId]  = useState(task.clientId ?? '')
  const [priority,  setPriority]  = useState(task.priority)
  const [startDate, setStartDate] = useState(task.startDate ?? '')
  const [dueDate,   setDueDate]   = useState(task.dueDate ?? '')
  const [timeEst,   setTimeEst]   = useState(task.timeEstimate?.toString() ?? '')
  const [codeRev,   setCodeRev]   = useState(task.codeReviewer ?? '')
  const [uxRev,     setUxRev]     = useState(task.uxReviewer ?? '')

  const [history,     setHistory]     = useState<StatusHistoryEntry[]>(task.statusHistory)
  const [comments,    setComments]    = useState<TaskComment[]>(task.comments)
  const [attachments, setAttachments] = useState<Attachment[]>(task.attachments)
  const [subtasks,    setSubtasks]    = useState<TaskSubtask[]>(task.subtasks ?? [])

  const [newComment,   setNewComment]   = useState('')
  const [mentionQuery, setMentionQuery] = useState('')
  const [showMention,  setShowMention]  = useState(false)
  const [commentSaving, setCommentSaving] = useState(false)
  const [commentError,  setCommentError]  = useState<string | null>(null)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [commentDeleteError, setCommentDeleteError] = useState<string | null>(null)
  const [claiming,      setClaiming]      = useState(false)
  const [claimError,    setClaimError]    = useState<string | null>(null)
  const [handoffTarget, setHandoffTarget] = useState('')
  const [handoffSaving, setHandoffSaving] = useState(false)
  const [handoffError,  setHandoffError]  = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting,          setDeleting]          = useState(false)
  const [deleteError,       setDeleteError]       = useState<string | null>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)

  const [attachUrl,  setAttachUrl]  = useState('')
  const [attachName, setAttachName] = useState('')
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({})
  const [attachmentUploading, setAttachmentUploading] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    const stored = attachments.filter(a => taskAttachmentPath(a.url))
    if (stored.length === 0) return

    void Promise.all(stored.map(async attachment => {
      const path = taskAttachmentPath(attachment.url)
      if (!path) return null
      const { data, error } = await supabase.storage.from(TASK_ATTACHMENTS_BUCKET).createSignedUrl(path, 60 * 60)
      if (error) throw error
      return [attachment.id, data.signedUrl] as const
    })).then(entries => {
      if (!cancelled) setAttachmentUrls(prev => ({ ...prev, ...Object.fromEntries(entries.filter(Boolean) as (readonly [string, string])[]) }))
    }).catch(error => {
      console.error('Failed to load task attachment:', error)
      if (!cancelled) setAttachmentError('An attachment could not be loaded. Please try again.')
    })

    return () => { cancelled = true }
  }, [attachments])

  const timerCtx = useTimer()
  const isThisTaskRunning = timerCtx.timerState?.taskId === task.id
  const sessionSec        = isThisTaskRunning ? timerCtx.elapsed : 0

  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>(task.timeEntries ?? [])
  const [stopMsg,     setStopMsg]     = useState<string | null>(null)
  const [manualDate,  setManualDate]  = useState(new Date().toISOString().slice(0, 10))
  const [manualHours, setManualHours] = useState('')
  const [manualMins,  setManualMins]  = useState('')
  const [manualNote,  setManualNote]  = useState('')
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editH,       setEditH]       = useState('')
  const [editM,       setEditM]       = useState('')
  const [editNote,    setEditNote]    = useState('')
  const [timeSaving,  setTimeSaving]  = useState(false)
  const [timeError,   setTimeError]   = useState<string | null>(null)
  const [timeSubtaskId, setTimeSubtaskId] = useState('')

  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [newSubtaskDescription, setNewSubtaskDescription] = useState('')
  const [newSubtaskAssignee, setNewSubtaskAssignee] = useState('')
  const [subtaskSaving, setSubtaskSaving] = useState(false)
  const [subtaskError, setSubtaskError] = useState<string | null>(null)
  const [previewSubtaskId, setPreviewSubtaskId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    const linkedSubtaskId = params.get('subtask')
    return params.get('task') === task.id && linkedSubtaskId && (task.subtasks ?? []).some(subtask => subtask.id === linkedSubtaskId)
      ? linkedSubtaskId
      : null
  })
  const [subtaskLinkCopied, setSubtaskLinkCopied] = useState(false)
  const [newSubtaskComment, setNewSubtaskComment] = useState('')
  const [subtaskCommentSaving, setSubtaskCommentSaving] = useState(false)
  const [subtaskCommentError, setSubtaskCommentError] = useState<string | null>(null)

  const [showHistory,  setShowHistory]  = useState(false)
  const [copied,       setCopied]       = useState(false)

  const [showMoveModal, setShowMoveModal] = useState(false)
  const [showMoveHistory, setShowMoveHistory] = useState(false)
  const [moveHistory, setMoveHistory] = useState<TaskBoardMove[] | null>(null)
  const [moveHistoryError, setMoveHistoryError] = useState<string | null>(null)

  const taskRef = useRef(task)
  const previewSubtask = subtasks.find(subtask => subtask.id === previewSubtaskId) ?? null
  useEffect(() => { taskRef.current = task }, [task])

  function openSubtask(id: string) {
    const url = new URL(window.location.href)
    url.searchParams.set("task", task.id)
    url.searchParams.set("subtask", id)
    window.history.replaceState(window.history.state, "", url)
    setPreviewSubtaskId(id)
    setSubtaskLinkCopied(false)
  }

  function closeSubtask() {
    const url = new URL(window.location.href)
    url.searchParams.delete("subtask")
    window.history.replaceState(window.history.state, "", url)
    setPreviewSubtaskId(null)
    setSubtaskLinkCopied(false)
  }

  function copySubtaskLink() {
    if (!previewSubtask) return
    const url = new URL(window.location.href)
    url.searchParams.set("task", task.id)
    url.searchParams.set("subtask", previewSubtask.id)
    void navigator.clipboard.writeText(url.toString())
    setSubtaskLinkCopied(true)
    window.setTimeout(() => setSubtaskLinkCopied(false), 2000)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (previewSubtaskId) {
        const url = new URL(window.location.href)
        url.searchParams.delete('subtask')
        window.history.replaceState(window.history.state, '', url)
        setPreviewSubtaskId(null)
      }
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, previewSubtaskId])

  // When the floating widget stops this task's timer (persistence now
  // happens inside TimerContext.stop() itself), sync the confirmed,
  // server-returned array into local state — never the client-guessed
  // single entry, so this never shows an unconfirmed optimistic row.
  useEffect(() => {
    function onTimerSaved(e: Event) {
      const { taskId, entries } = (e as CustomEvent<TimerEntrySavedDetail>).detail
      if (taskId !== task.id) return
      setTimeEntries(entries)
      onTimeEntriesChanged?.(task.id, entries)
    }
    window.addEventListener(TIMER_ENTRY_SAVED_EVENT, onTimerSaved)
    return () => window.removeEventListener(TIMER_ENTRY_SAVED_EVENT, onTimerSaved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  // Every persistence path in this modal funnels through save() (title,
  // description, status, assignee, client, priority, dates, time entries,
  // comments, attachments, claiming a ticket) — gating it here is the real
  // protection, not just hiding individual controls.
  function save(patch: Partial<Task>) { if (!readonly) onUpdate({ ...taskRef.current, ...patch }) }

  function saveTitle() { setEditTitle(false); if (!readonly && title !== taskRef.current.title) save({ title }) }
  function saveDesc()  { if (!readonly && desc !== taskRef.current.description) save({ description: desc }) }

  const profileNamesById = Object.fromEntries(profiles.map(p => [p.id, p.name]))
  function toggleMoveHistory() {
    const next = !showMoveHistory
    setShowMoveHistory(next)
    if (next && moveHistory === null) {
      getTaskBoardMoves(task.id, profileNamesById)
        .then(setMoveHistory)
        .catch((err: Error) => setMoveHistoryError(err.message))
    }
  }

  function handleStatusChange(newStatus: string) {
    if (readonly) return
    // Closing a support ticket has to be answered first, so it goes through
    // the dialog rather than changing straight away.
    if (newStatus === 'done' && task.board === 'support') {
      setDoneFlow({ step: 'appUpdate', requiresAppUpdate: null })
      return
    }
    applyStatusChange(newStatus)
  }

  function applyStatusChange(newStatus: string, extra: Partial<Task> = {}) {
    const now = new Date().toISOString()
    const entry: StatusHistoryEntry = { status: newStatus, timestamp: now, changedBy: currentUser }
    const newHistory = [...history, entry]
    setHistory(newHistory); setStatus(newStatus)
    const patch: Partial<Task> = { status: newStatus, statusHistory: newHistory, ...extra }

    if (newStatus === 'done') patch.doneAt = now
    if (newStatus === 'pending_code_review') {
      const reviewer = codeRev || taskRef.current.codeReviewer || ''
      patch.codeReviewer = reviewer
      const reviewerId = profiles.find(p => p.name === reviewer)?.id
      const statusOwnerId = statuses.find(s => s.id === newStatus)?.ownerId
      if (reviewerId && reviewerId !== statusOwnerId) addNotification({ type: 'code_review', message: `${reviewer}: new code review for "${taskRef.current.title}"`, taskId: task.id, taskTitle: task.title, recipientId: reviewerId })
    }
    if (newStatus === 'pending_ux_review') {
      const reviewer = uxRev || taskRef.current.uxReviewer || ''
      patch.uxReviewer = reviewer
      const reviewerId = profiles.find(p => p.name === reviewer)?.id
      const statusOwnerId = statuses.find(s => s.id === newStatus)?.ownerId
      if (reviewerId && reviewerId !== statusOwnerId) addNotification({ type: 'ux_review', message: `${reviewer}: new UX review for "${taskRef.current.title}"`, taskId: task.id, taskTitle: task.title, recipientId: reviewerId })
    }
    if (newStatus === 'fixing') {
      if (taskRef.current.assigneeId) addNotification({ type: 'fixing', message: `${taskRef.current.assignee}: "${taskRef.current.title}" sent back for fixes`, taskId: task.id, taskTitle: task.title, recipientId: taskRef.current.assigneeId })
    }
    if (task.board === 'support' && newStatus === 'not_started') {
      addNotification({ type: 'support_opened', message: `New support ticket: ${taskRef.current.title}`, taskId: task.id, taskTitle: task.title, severity: 'high' })
    }
    save(patch)
  }

  function startTimer() {
    if (!canLogTime) return
    timerCtx.start(task.id, task.title, currentUser, currentUserId)
  }
  async function stopTimer() {
    if (!canLogTime || timeSaving) return
    setTimeSaving(true)
    setTimeError(null)
    // TimerContext.stop() does the actual RPC call and only clears the
    // running timer once it's confirmed saved — this modal no longer
    // persists it a second time. On success it also dispatches
    // TIMER_ENTRY_SAVED_EVENT, which the listener above picks up to
    // refresh timeEntries with the server-confirmed array.
    const result = await timerCtx.stop({ subtaskId: timeSubtaskId || undefined })
    setTimeSaving(false)
    if (result.discarded) {
      setStopMsg('פחות מדקה — לא נרשם')
      setTimeout(() => setStopMsg(null), 3000)
      return
    }
    if (result.error) {
      setTimeError(result.error)
    }
  }
  async function addManualEntry() {
    if (!canLogTime || timeSaving) return
    const h = parseInt(manualHours) || 0; const m = parseInt(manualMins) || 0
    if (h === 0 && m === 0) return
    const entry: TimeEntry = {
      id: newId(),
      date: manualDate || new Date().toISOString().slice(0, 10),
      hours: h, minutes: m,
      loggedBy: currentUser,
      loggedById: currentUserId,
      subtaskId: timeSubtaskId || undefined,
      note: manualNote.trim() || undefined,
      isLocked: false,
      createdAt: new Date().toISOString(),
    }
    setTimeSaving(true)
    setTimeError(null)
    try {
      const updated = await addTaskTimeEntry(task.id, entry)
      setTimeEntries(updated)
      onTimeEntriesChanged?.(task.id, updated)
      setManualHours(''); setManualMins(''); setManualNote('')
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : tr('שמירת הזמן נכשלה', 'Failed to save time'))
    } finally {
      setTimeSaving(false)
    }
  }
  // Full board editors only — deleting stays on the existing generic
  // save() path (still gated by the "tasks: update" RLS policy, which
  // requires board-full access), never exposed to a plain logger of
  // their own entry. There is deliberately no employee-facing delete RPC.
  function deleteEntry(id: string) {
    if (readonly) return
    const updated = timeEntries.filter(e => e.id !== id)
    setTimeEntries(updated); save({ timeEntries: updated })
  }
  // A full board editor may edit any entry. Anyone else may only edit
  // an entry whose loggedById is their own — deliberately NOT gated on
  // canLogTime (current assignment) or !readonly (current board
  // access): ownership of a historical entry must survive being
  // unassigned or handed off (see handoff_task_assignment()). The only
  // remaining client-side gates are canEditWork (mirrors
  // has_permission('work','edit')) and simply having the task open at
  // all, which already required the existing view/collaborator access
  // rules to have loaded it. Mirrors update_task_time_entry()'s
  // server-side authorization exactly; a legacy entry with no
  // loggedById can never be "claimed" by name.
  function canEditTimeEntry(entry: TimeEntry) {
    return !readonly || (canEditWork && !!entry.loggedById && entry.loggedById === currentUserId)
  }
  function startEdit(entry: TimeEntry) {
    if (!canEditTimeEntry(entry)) return
    setEditingId(entry.id)
    setEditH(entry.hours.toString())
    setEditM(entry.minutes.toString())
    setEditNote(entry.note ?? '')
  }
  async function saveEdit(id: string) {
    if (timeSaving) return
    const h = parseInt(editH) || 0; const m = parseInt(editM) || 0
    if (h === 0 && m === 0) {
      setTimeError(tr('משך זמן לא תקין', 'Invalid duration'))
      return
    }
    setTimeSaving(true)
    setTimeError(null)
    try {
      const updated = await updateTaskTimeEntry(task.id, id, h, m, editNote.trim() || undefined)
      setTimeEntries(updated)
      onTimeEntriesChanged?.(task.id, updated)
      setEditingId(null)
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : tr('שמירת השינוי נכשלה', 'Failed to save the change'))
    } finally {
      setTimeSaving(false)
    }
  }
  function cancelEdit() { setEditingId(null) }

  function publishSubtasks(updated: TaskSubtask[]) {
    setSubtasks(updated)
    onSubtasksChanged?.(task.id, updated)
  }

  async function addSubtask() {
    if (!canManageSubtasks || subtaskSaving || !newSubtaskTitle.trim() || !newSubtaskAssignee) return
    setSubtaskSaving(true)
    setSubtaskError(null)
    try {
      const created = await createTaskSubtask({
        taskId: task.id,
        title: newSubtaskTitle.trim(),
        description: newSubtaskDescription.trim() || undefined,
        assigneeId: newSubtaskAssignee,
      })
      publishSubtasks([...subtasks, created])
      setNewSubtaskTitle('')
      setNewSubtaskDescription('')
      setNewSubtaskAssignee('')
    } catch (err) {
      setSubtaskError(err instanceof Error ? err.message : tr('יצירת תת־המשימה נכשלה', 'Failed to create subtask'))
    } finally {
      setSubtaskSaving(false)
    }
  }

  async function changeSubtask(subtask: TaskSubtask, patch: Partial<TaskSubtask>) {
    const candidate = { ...subtask, ...patch }
    const participantCanChangeStatus = subtask.assigneeId === currentUserId && Object.keys(patch).every(k => k === 'status')
    if ((!canManageSubtasks && !participantCanChangeStatus) || subtaskSaving) return
    setSubtaskSaving(true)
    setSubtaskError(null)
    try {
      const saved = await updateTaskSubtask(candidate)
      publishSubtasks(subtasks.map(s => s.id === saved.id ? saved : s))
    } catch (err) {
      setSubtaskError(err instanceof Error ? err.message : tr('עדכון תת־המשימה נכשל', 'Failed to update subtask'))
    } finally {
      setSubtaskSaving(false)
    }
  }

  async function removeSubtask(id: string) {
    if (!canManageSubtasks || subtaskSaving) return
    setSubtaskSaving(true)
    setSubtaskError(null)
    try {
      await deleteTaskSubtask(id)
      publishSubtasks(subtasks.filter(s => s.id !== id))
    } catch (err) {
      setSubtaskError(err instanceof Error ? err.message : tr('מחיקת תת־המשימה נכשלה', 'Failed to delete subtask'))
    } finally {
      setSubtaskSaving(false)
    }
  }

  async function submitSubtaskComment() {
    if (!previewSubtask || subtaskCommentSaving || !newSubtaskComment.trim()) return
    const canAddComment = canComment || previewSubtask.assigneeId === currentUserId
    if (!canAddComment) return
    const text = newSubtaskComment.trim()
    const mentions = Array.from(text.matchAll(/@(\w+)/g)).map(match => match[1])
    setSubtaskCommentSaving(true)
    setSubtaskCommentError(null)
    try {
      const updatedComments = await addSubtaskComment(previewSubtask.id, text, mentions)
      publishSubtasks(subtasks.map(subtask =>
        subtask.id === previewSubtask.id ? { ...subtask, comments: updatedComments } : subtask,
      ))
      setNewSubtaskComment('')
    } catch (err) {
      setSubtaskCommentError(err instanceof Error ? err.message : tr('הוספת התגובה נכשלה', 'Failed to add comment'))
    } finally {
      setSubtaskCommentSaving(false)
    }
  }

  function handleCommentInput(val: string) {
    setNewComment(val)
    const match = val.match(/@(\w*)$/)
    if (match) { setMentionQuery(match[1]); setShowMention(true) }
    else        { setShowMention(false); setMentionQuery('') }
  }
  function insertMention(name: string) {
    setNewComment(newComment.replace(/@\w*$/, `@${name} `))
    setShowMention(false); commentRef.current?.focus()
  }
  // Independent of save()/readonly — a board-level 'comment' user can
  // reach this even though every other field stays locked. Goes
  // through the add_task_comment RPC (atomic append, server-derived
  // author/timestamp) rather than save(), not just re-sending the
  // whole task: see database.ts's addTaskComment for why. Local
  // `comments` state is only updated from the server's authoritative
  // response — never optimistically — so a failure never shows a
  // comment that wasn't actually saved.
  async function submitComment() {
    if (!canComment || commentSaving || !newComment.trim()) return
    const mentions = Array.from(newComment.matchAll(/@(\w+)/g)).map(m => m[1])
    const text = newComment.trim()
    setCommentSaving(true)
    setCommentError(null)
    try {
      const updated = await addTaskComment(task.id, text, mentions)
      setComments(updated)
      setNewComment('')
      setShowMention(false)
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'הוספת התגובה נכשלה')
    } finally {
      setCommentSaving(false)
    }
  }

  async function removeComment(commentId: string) {
    if (!currentUserId || deletingCommentId) return
    setDeletingCommentId(commentId)
    setCommentDeleteError(null)
    try {
      const updated = await deleteTaskComment(task.id, commentId)
      setComments(updated)
      save({ comments: updated })
    } catch (err) {
      setCommentDeleteError(err instanceof Error ? err.message : tr('מחיקת התגובה נכשלה', 'Failed to delete comment'))
    } finally {
      setDeletingCommentId(null)
    }
  }

  function addUrlAttachment() {
    if (!attachUrl.trim()) return
    const att: Attachment = { id: newId(), type: 'url', name: attachName.trim() || attachUrl.trim(), url: attachUrl.trim() }
    const updated = [...attachments, att]; setAttachments(updated); setAttachUrl(''); setAttachName(''); save({ attachments: updated })
  }
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    if (file.size > 20 * 1024 * 1024) {
      setAttachmentError('File is too large. Maximum size is 20 MB.')
      return
    }
    setAttachmentUploading(true)
    setAttachmentError(null)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment'
    const path = `${task.id}/${crypto.randomUUID()}-${safeName}`
    try {
      const { error } = await supabase.storage.from(TASK_ATTACHMENTS_BUCKET).upload(path, file, {
        cacheControl: '3600',
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
      if (error) throw error
      const { data, error: signedUrlError } = await supabase.storage.from(TASK_ATTACHMENTS_BUCKET).createSignedUrl(path, 60 * 60)
      if (signedUrlError) throw signedUrlError
      const att: Attachment = { id: newId(), type: 'file', name: file.name, url: `${TASK_ATTACHMENT_PREFIX}${path}` }
      const updated = [...attachments, att]
      setAttachmentUrls(prev => ({ ...prev, [att.id]: data.signedUrl }))
      setAttachments(updated)
      save({ attachments: updated })
    } catch (error) {
      console.error('Task attachment upload failed:', error)
      setAttachmentError(error instanceof Error ? error.message : 'File upload failed. Please try again.')
    } finally {
      setAttachmentUploading(false)
    }
  }
  function removeAttachment(id: string) {
    const removed = attachments.find(a => a.id === id)
    const updated = attachments.filter(a => a.id !== id); setAttachments(updated); save({ attachments: updated })
    const path = removed ? taskAttachmentPath(removed.url) : null
    if (path) void supabase.storage.from(TASK_ATTACHMENTS_BUCKET).remove([path]).then(({ error }) => {
      if (error) console.error('Task attachment cleanup failed:', error)
    })
  }

  // Closing a support ticket: ask whether a release is needed, then whether to
  // write the customer update now.
  const [doneFlow, setDoneFlow] = useState<
    { step: 'appUpdate' | 'message'; requiresAppUpdate: boolean | null } | null
  >(null)

  function finishTicket(requiresAppUpdate: boolean, messageChoice: TicketDoneAnswers['messageChoice']) {
    setDoneFlow(null)
    applyStatusChange('done', { requiresAppUpdate })
    onTicketDone?.(taskRef.current, { requiresAppUpdate, messageChoice })
  }

  function answerAppUpdate(requiresAppUpdate: boolean) {
    // Only ask the second question when the customer has other tickets still
    // open — that is the case where the team may want to hold the update.
    if (openTicketsForClient > 0) {
      setDoneFlow({ step: 'message', requiresAppUpdate })
      return
    }
    finishTicket(requiresAppUpdate, 'now')
  }

  // Shared-queue eligibility mirrors task_eligible_for_support_queue()
  // server-side — configurable per board/priority, not a hardcoded
  // board id or priority-label regex.
  const isQueueEligible = boardAllTasksToSupportQueue || !!priorityDefs.find(p => p.id === priority)?.showInSupportQueue
  const isUnclaimed =
    !task.claimed &&
    status !== 'done' && status !== 'archived' &&
    isQueueEligible && !assignee

  // Atomic, server-side — see claim_task() in
  // 20260810101000_rls_rpc_identity_and_queue.sql. No optimistic
  // update: local state only changes after the RPC confirms, and a
  // losing concurrent claim shows a visible error instead of silently
  // overwriting the winner.
  async function claimTicket() {
    if (readonly || !isTechnicalSupport || claiming) return
    setClaiming(true)
    setClaimError(null)
    try {
      const updated = await claimTask(task.id)
      onUpdate(updated)
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : tr('התביעה נכשלה — ייתכן שמישהו אחר כבר לקח את המשימה', 'Claim failed — someone else may have already taken this task'))
    } finally {
      setClaiming(false)
    }
  }

  // Only the current main assignee may reach this — see
  // handoff_task_assignment() in
  // 20260816090000_time_entry_edit_and_assignee_handoff.sql, which
  // re-checks that server-side regardless of what this component
  // renders. newAssigneeId null means self-unassign (leave
  // Unassigned); a non-null id transfers directly, immediately, no
  // accept/decline step. Never touches any field but assigneeId — the
  // existing assignment-notification trigger fires normally for a
  // transfer and is skipped by its own null-check for an unassign.
  async function handoffAssignment(newAssigneeId: string | null) {
    if (handoffSaving || task.assigneeId !== currentUserId) return
    setHandoffSaving(true)
    setHandoffError(null)
    try {
      const updated = await handoffTaskAssignment(task.id, newAssigneeId)
      onUpdate(updated)
      setHandoffTarget('')
    } catch (err) {
      setHandoffError(err instanceof Error ? err.message : tr('העברת המשימה נכשלה', 'Handoff failed'))
    } finally {
      setHandoffSaving(false)
    }
  }

  // Non-optimistic by design, matching claimTicket() above: the task
  // only disappears from the caller's list once the DELETE has actually
  // been confirmed by the server (the "tasks: delete" RLS policy is the
  // real, authoritative check — canDelete is UX only). A failure shows a
  // visible error here rather than silently doing nothing.
  async function confirmDelete() {
    if (!canDelete || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteTask(task.id)
      onDeleted?.(task.id)
    } catch (err) {
      setDeleting(false)
      setDeleteError(err instanceof Error ? err.message : tr('מחיקת המשימה נכשלה', 'Failed to delete task'))
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}?task=${task.id}`).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const p            = priorityDefs.find(pd => pd.id === priority)
  const savedTotal   = timeEntries.reduce((s, e) => s + e.hours + e.minutes / 60, 0)
  const totalTracked = savedTotal + sessionSec / 3600
  const mentionNames = assignees.filter(a => a.toLowerCase().startsWith(mentionQuery.toLowerCase()))
  const historyEst   = task.timeEstimate ?? 0
  const myOpenSubtasks = subtasks.filter(s => s.assigneeId === currentUserId && s.status !== 'done')

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6" onClick={onClose}>
      <div className="task-editor relative bg-white rounded-3xl shadow-2xl ring-1 ring-black/5 w-full max-w-6xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-end gap-3 px-5 sm:px-6 py-4 border-b border-gray-100 bg-white/95 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="mb-1 flex min-w-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              <span className="shrink-0">Task title</span>
              <span className="h-3 w-px shrink-0 bg-gray-200" aria-hidden="true" />
              <span className="truncate font-mono font-normal normal-case tracking-normal text-gray-500" title={task.id}>ID {task.id}</span>
            </div>
            {editTitle ? (
              <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={saveTitle}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitle(task.title); setEditTitle(false) } }}
                className="task-title-input h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-base font-bold leading-snug text-gray-950 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
              />
            ) : (
              <button onClick={() => !readonly && setEditTitle(true)} disabled={readonly} className="task-title-input flex h-9 w-full items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-left text-base font-bold leading-snug text-gray-950 transition-colors hover:border-primary hover:text-primary disabled:cursor-default disabled:hover:border-gray-300 disabled:hover:text-gray-900" title={readonly ? undefined : 'Click to edit'}><span className="truncate">{title}</span></button>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="max-w-[320px] truncate text-[10px] font-semibold text-gray-500" title={boardLabel}>{boardLabel}</span>
            <div className="flex items-center gap-2">
              {openTicketsForClient > 0 && (
                <span
                  className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded-lg whitespace-nowrap shrink-0"
                  title="Other support tickets still open for this client"
                >
                  ללקוח הזה {openTicketsForClient} קריאות תמיכה פתוחות נוספות
                </span>
              )}
              <button onClick={copyLink} title="Copy task link" className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white transition-colors shrink-0 ${copied ? 'bg-green-100 text-green-600' : 'text-gray-500 hover:bg-gray-100 hover:text-primary'}`}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
              {canMoveBoard && (
                <button
                  onClick={() => setShowMoveModal(true)}
                  title={tr('העבר ללוח אחר', 'Move to another board')}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-primary/30 hover:bg-primary/10 hover:text-primary transition-colors shrink-0"
                >
                  <ArrowRightLeft size={15} />
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  title={tr('מחק משימה', 'Delete task')}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0"
                >
                  <Trash2 size={15} />
                </button>
              )}
              <button onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors shrink-0"><X size={15} /></button>
            </div>
          </div>
        </div>

        {showMoveModal && (
          <MoveTaskModal
            task={task}
            sourceBoardName={boardLabel}
            eligibleBoards={eligibleMoveBoards}
            profiles={profiles}
            onClose={() => setShowMoveModal(false)}
            onMoved={updated => { onMoved?.(updated); setShowMoveModal(false) }}
          />
        )}

        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => !deleting && setShowDeleteConfirm(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start gap-2 text-red-600">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <p className="text-sm font-semibold leading-relaxed">
                  {tr('האם למחוק את המשימה? לא ניתן לבטל פעולה זו.', 'Delete this task? This action cannot be undone.')}
                </p>
              </div>
              {deleteError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{deleteError}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40">
                  {tr('ביטול', 'Cancel')}
                </button>
                <button
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  {deleting ? tr('מוחק...', 'Deleting...') : tr('מחק', 'Delete')}
                </button>
              </div>
            </div>
          </div>
        )}

        {previewSubtask && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={closeSubtask}>
            <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="flex shrink-0 items-start gap-3 border-b border-gray-100 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{tr('תת־משימה', 'Subtask')}</p>
                  <input
                    key={previewSubtask.id + "-title"}
                    defaultValue={previewSubtask.title}
                    disabled={!canManageSubtasks || subtaskSaving}
                    onBlur={event => {
                      const nextTitle = event.currentTarget.value.trim()
                      if (nextTitle && nextTitle !== previewSubtask.title) void changeSubtask(previewSubtask, { title: nextTitle })
                    }}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-base font-bold text-gray-900 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:border-transparent disabled:px-0"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={copySubtaskLink} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900" aria-label={tr('העתק קישור לתת־משימה', 'Copy subtask link')}>
                    {subtaskLinkCopied ? <Check size={14} /> : <Link2 size={14} />}
                    {subtaskLinkCopied ? tr('הועתק', 'Copied') : tr('שתף', 'Share')}
                  </button>
                  <button type="button" onClick={closeSubtask} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800" aria-label={tr('סגור', 'Close')}>
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">{tr('תיאור', 'Description')}</p>
                  <textarea
                    key={previewSubtask.id}
                    defaultValue={previewSubtask.description ?? ""}
                    disabled={!canManageSubtasks || subtaskSaving}
                    onBlur={event => {
                      const nextDescription = event.currentTarget.value.trim()
                      if (nextDescription !== (previewSubtask.description ?? "")) void changeSubtask(previewSubtask, { description: nextDescription })
                    }}
                    placeholder={tr("לא נוסף תיאור.", "No description added.")}
                    rows={6}
                    className="min-h-32 w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm leading-relaxed text-gray-700 outline-none transition-colors focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10 disabled:resize-none disabled:border-gray-100"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{tr('אחראי', 'Assignee')}</p>
                    <div className="flex items-center gap-2">
                      <Avatar name={previewSubtask.assigneeName || tr('לא משויך', 'Unassigned')} size="xs" />
                      <span className="truncate text-sm font-medium text-gray-700">{previewSubtask.assigneeName || tr('לא משויך', 'Unassigned')}</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">{tr('סטטוס', 'Status')}</p>
                    <select
                      value={previewSubtask.status}
                      disabled={subtaskSaving || (!canManageSubtasks && previewSubtask.assigneeId !== currentUserId)}
                      onChange={event => void changeSubtask(previewSubtask, { status: event.target.value as TaskSubtaskStatus })}
                      className={`h-9 w-full rounded-lg border border-gray-200 px-3 text-xs font-bold outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-default ${STATUS_PILL[previewSubtask.status] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      <option value="not_started">{tr('טרם התחיל', 'Not Started')}</option>
                      <option value="in_progress">{tr('בתהליך', 'In Progress')}</option>
                      <option value="done">{tr('הושלם', 'Done')}</option>
                    </select>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <div className="mb-3 flex items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-900">{tr('תגובות', 'Comments')}</p>
                    {previewSubtask.comments.length > 0 && <span className="text-[10px] text-gray-500">({previewSubtask.comments.length})</span>}
                  </div>
                  {previewSubtask.comments.length > 0 && (
                    <div className="mb-4 space-y-3">
                      {previewSubtask.comments.map(comment => (
                        <div key={comment.id} className="flex gap-2.5">
                          <Avatar name={comment.author} size="xs" />
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-baseline gap-2">
                              <span className="text-xs font-semibold text-gray-800">{comment.author}</span>
                              <span className="text-[10px] text-gray-400">{fmtDateTime(comment.timestamp)}</span>
                            </div>
                            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">{commentParts(comment.text)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-start gap-2.5">
                    <Avatar name={currentUser} size="xs" />
                    <div className="min-w-0 flex-1">
                      <textarea
                        value={newSubtaskComment}
                        onChange={event => setNewSubtaskComment(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submitSubtaskComment() }}
                        disabled={!(canComment || previewSubtask.assigneeId === currentUserId) || subtaskCommentSaving}
                        rows={2}
                        placeholder={tr('הוסף תגובה או קישור...', 'Add a comment or link...')}
                        className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:bg-gray-50"
                      />
                      <div className="mt-1.5 flex items-center justify-between gap-3">
                        <span className="text-[10px] text-gray-400">⌘+Enter</span>
                        <button type="button" onClick={() => void submitSubtaskComment()} disabled={!newSubtaskComment.trim() || !(canComment || previewSubtask.assigneeId === currentUserId) || subtaskCommentSaving} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40">
                          {subtaskCommentSaving ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                          {subtaskCommentSaving ? tr('שולח...', 'Sending...') : tr('תגובה', 'Comment')}
                        </button>
                      </div>
                      {subtaskCommentError && <p className="mt-1.5 text-xs text-red-500">{subtaskCommentError}</p>}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 pt-3 text-[10px] text-gray-500">
                  <span>{tr('נוצר', 'Created')}: {fmtDateTime(previewSubtask.createdAt)}</span>
                  <span>{tr('עודכן', 'Updated')}: {fmtDateTime(previewSubtask.updatedAt)}</span>
                  <span className="truncate font-mono" title={previewSubtask.id}>ID {previewSubtask.id}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Closing a support ticket — cannot be skipped */}
        {doneFlow && (
          <div className="absolute inset-0 z-20 bg-black/40 flex items-center justify-center p-6" dir="rtl">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
              {doneFlow.step === 'appUpdate' ? (
                <>
                  <p className="text-sm font-bold text-gray-800">
                    האם התיקון דורש עדכון גרסה כדי שהלקוח יקבל אותו?
                  </p>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    חובה לבחור כדי לסגור את הקריאה. אם נדרש עדכון, תיפתח אוטומטית משימה בלוח "Apps to update".
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => answerAppUpdate(true)}
                      className="w-full px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm font-semibold hover:bg-amber-100 transition-colors text-right"
                    >
                      כן, נדרש עדכון גרסה
                    </button>
                    <button
                      onClick={() => answerAppUpdate(false)}
                      className="w-full px-4 py-3 rounded-xl border border-green-200 bg-green-50 text-green-800 text-sm font-semibold hover:bg-green-100 transition-colors text-right"
                    >
                      לא, התיקון כבר פעיל
                    </button>
                  </div>
                  <button onClick={() => setDoneFlow(null)} className="text-xs text-gray-500 hover:text-gray-600 self-start">
                    ביטול
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-gray-800">
                    ללקוח הזה יש עוד {openTicketsForClient} קריאות תמיכה פתוחות.
                  </p>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    אפשר להכין את ההודעה ללקוח עכשיו, או להמתין עד שהקריאות האחרות יסתיימו ולשלוח עדכון אחד.
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => finishTicket(doneFlow.requiresAppUpdate === true, 'now')}
                      className="w-full px-4 py-3 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors text-right"
                    >
                      הכן את ההודעה עכשיו
                    </button>
                    <button
                      onClick={() => finishTicket(doneFlow.requiresAppUpdate === true, 'wait')}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors text-right"
                    >
                      הכן אבל סמן כממתין לקריאות הנוספות
                    </button>
                    <button
                      onClick={() => finishTicket(doneFlow.requiresAppUpdate === true, 'none')}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-500 text-sm hover:bg-gray-50 transition-colors text-right"
                    >
                      אל תכין הודעה עכשיו
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Unclaimed banner — shared support queue, board/priority-configurable */}
        {isUnclaimed && (
          <div className="flex flex-col gap-2 px-6 py-3 bg-red-50 border-b border-red-100 shrink-0">
            <div className="flex items-center gap-3">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-sm text-red-800 flex-1">
                {boardAllTasksToSupportQueue
                  ? tr('הכרטיס הזה לא נתבע — היה הראשון לקחת אותו.', 'This support ticket is unclaimed — be the first to take it.')
                  : tr(`המשימה הזו (${p?.label ?? 'דחוף'}) לא נתבעה — היה הראשון לקחת אותה.`, `This ${(p?.label ?? 'urgent').toLowerCase()} task is unclaimed — be the first to take it.`)}
              </p>
              {!readonly && isTechnicalSupport && (
                <button
                  onClick={() => void claimTicket()}
                  disabled={claiming}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
                >
                  {claiming && <Loader2 size={11} className="animate-spin" />}
                  {claiming
                    ? tr('לוקח...', 'Taking...')
                    : boardAllTasksToSupportQueue ? tr('קח כרטיס זה', 'Take this ticket') : tr('קח משימה זו', 'Take this task')}
                </button>
              )}
            </div>
            {claimError && (
              <p className="text-xs text-red-600 flex items-center gap-1.5">
                <AlertCircle size={11} /> {claimError}
              </p>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
          {/* Left */}
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5 flex flex-col gap-6">

            {/* Description */}
            <section>
              <div className="mb-2 flex min-w-0 items-center gap-3">
                <p className="text-xs font-bold text-gray-900 uppercase tracking-wide">Description</p>
              </div>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={saveDesc} rows={6}
                placeholder="Add a description..." disabled={readonly}
                className="w-full text-sm text-gray-700 border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition placeholder:text-gray-400 leading-relaxed disabled:bg-gray-50 disabled:text-gray-500"
              />
            </section>

            {/* Subtasks — the parent task remains the item shown on My Board. */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <ListChecks size={14} className="text-primary" />
                <p className="text-xs font-bold text-gray-900 uppercase tracking-wide">
                  {tr('תת־משימות', 'Subtasks')}
                </p>
                {subtasks.length > 0 && (
                  <span className="text-[10px] font-bold text-gray-500 bg-gray-100 rounded-full px-1.5">{subtasks.length}</span>
                )}
              </div>

              {subtasks.length > 0 && (
                <div className="flex flex-col gap-2 mb-3">
                  {subtasks.map(subtask => {
                    const isMine = subtask.assigneeId === currentUserId
                    const canChangeStatus = canManageSubtasks || isMine
                    return (
                      <div
                        key={subtask.id}
                        className={`grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_150px_135px_auto] items-center gap-2 rounded-xl border px-3 py-2 ${isMine ? 'border-cyan-200 bg-cyan-50/50' : 'border-gray-100 bg-gray-50/60'}`}
                      >
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => openSubtask(subtask.id)}
                            title={tr('פתח תת־משימה', 'Open subtask')}
                            className={`block max-w-full truncate text-left text-sm transition-colors hover:text-primary hover:underline ${subtask.status === 'done' ? 'line-through text-gray-500' : 'font-medium text-gray-700'}`}
                          >
                            {subtask.title}
                          </button>
                          {isMine && <p className="text-[9px] text-cyan-700 mt-0.5">{tr('מוקצה לך', 'Assigned to you')}</p>}
                        </div>
                        <select
                          value={subtask.assigneeId ?? ''}
                          disabled={!canManageSubtasks || subtaskSaving}
                          onChange={e => {
                            const selected = eligibleAssignees.find(a => a.id === e.target.value)
                            void changeSubtask(subtask, { assigneeId: selected?.id, assigneeName: selected?.name ?? '' })
                          }}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:bg-gray-100 disabled:text-gray-500 min-w-0"
                        >
                          <option value="">{tr('לא משויך', 'Unassigned')}</option>
                          {eligibleAssignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        <select
                          value={subtask.status}
                          disabled={!canChangeStatus || subtaskSaving}
                          onChange={e => void changeSubtask(subtask, { status: e.target.value as TaskSubtaskStatus })}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:bg-gray-100 disabled:text-gray-500"
                        >
                          <option value="not_started">Not Started</option>
                          <option value="in_progress">In Progress</option>
                          <option value="done">Done</option>
                        </select>
                        {canManageSubtasks ? (
                          <button
                            onClick={() => void removeSubtask(subtask.id)}
                            disabled={subtaskSaving}
                            title={tr('מחק תת־משימה', 'Delete subtask')}
                            className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                          >
                            <Trash2 size={12} />
                          </button>
                        ) : <span />}
                      </div>
                    )
                  })}
                </div>
              )}

              {canManageSubtasks && (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
                    <input
                      value={newSubtaskTitle}
                      onChange={e => setNewSubtaskTitle(e.target.value)}
                      placeholder={tr('כותרת תת־המשימה', 'Subtask title')}
                      className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                    />
                    <select
                      value={newSubtaskAssignee}
                      onChange={e => setNewSubtaskAssignee(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-primary"
                    >
                      <option value="">{tr('בחירת משתתף', 'Choose participant')}</option>
                      {eligibleAssignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <button
                      onClick={() => void addSubtask()}
                      disabled={subtaskSaving || !newSubtaskTitle.trim() || !newSubtaskAssignee}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-40"
                    >
                      {subtaskSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      {tr('הוסף', 'Add')}
                    </button>
                  </div>
                  <textarea
                    value={newSubtaskDescription}
                    onChange={e => setNewSubtaskDescription(e.target.value)}
                    rows={2}
                    placeholder={tr('תיאור תת־המשימה (אופציונלי)', 'Subtask description (optional)')}
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:border-primary focus:outline-none"
                  />
                </div>
              )}
              {subtaskError && <p className="text-xs text-red-500 mt-2">{subtaskError}</p>}
            </section>

            {/* Comments */}
            <section>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">Comments {comments.length > 0 && <span className="normal-case font-normal">({comments.length})</span>}</p>
              {comments.length > 0 && (
                <div className="space-y-4 mb-4">
                  {comments.map(c => (
                    <div key={c.id} className="flex gap-3">
                      <Avatar name={c.author} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-800">{c.author}</span>
                          <span className="text-[10px] text-gray-500">{fmtDateTime(c.timestamp)}</span>
                          {c.authorId === currentUserId && (
                            <button
                              type="button"
                              onClick={() => void removeComment(c.id)}
                              disabled={deletingCommentId !== null}
                              title={tr('מחק תגובה', 'Delete comment')}
                              className="ml-auto inline-flex items-center justify-center rounded-md p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                            >
                              {deletingCommentId === c.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                          {commentParts(c.text)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {commentDeleteError && <p className="mb-3 text-xs text-red-500">{commentDeleteError}</p>}
              <div className="flex gap-3 items-start">
                <Avatar name={currentUser} />
                <div className="flex-1 relative">
                  <textarea ref={commentRef} value={newComment} onChange={e => handleCommentInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitComment(); if (e.key === 'Escape') { setNewComment(''); setShowMention(false) } }}
                    rows={2} placeholder={canComment ? 'Add a comment... (type @ to mention)' : 'You do not have permission to comment on this board'}
                    disabled={!canComment}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition placeholder:text-gray-400 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                  {showMention && mentionNames.length > 0 && (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden min-w-[140px]">
                      {mentionNames.map(name => (
                        <button key={name} onMouseDown={e => { e.preventDefault(); insertMention(name) }} className="flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-50 text-sm text-gray-700 transition-colors text-left">
                          <Avatar name={name} size="xs" />{name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[10px] text-gray-400">⌘+Enter to submit</span>
                    <button onClick={() => void submitComment()} disabled={!newComment.trim() || !canComment || commentSaving} className="flex items-center gap-1.5 px-3 py-1 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      <Send size={10} /> {commentSaving ? 'Sending...' : 'Comment'}
                    </button>
                  </div>
                  {commentError && (
                    <p className="flex items-center gap-1.5 text-xs text-red-500 mt-1.5">
                      <AlertCircle size={11} /> {commentError}
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* Attachments */}
            <section>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">Attachments</p>
              {attachments.length > 0 && (
                <div className="space-y-2 mb-3">
                  {attachments.map(a => {
                    const storedPath = taskAttachmentPath(a.url)
                    const resolvedUrl = storedPath ? attachmentUrls[a.id] : a.url
                    const brokenLegacyUpload = a.url.startsWith('blob:')
                    const isImage = isImageAttachment(a)
                    if (isImage) {
                      return (
                        <div key={a.id} className="flex flex-col gap-1.5 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 group">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 truncate flex-1">{a.name}</span>
                            {!readonly && <button onClick={() => removeAttachment(a.id)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all shrink-0"><X size={11} /></button>}
                          </div>
                          {brokenLegacyUpload ? (
                            <p className="text-xs text-red-500">This older upload was temporary and is no longer available. Please upload the original file again.</p>
                          ) : resolvedUrl ? (
                            <a href={resolvedUrl} target="_blank" rel="noreferrer" className="self-start" title="Open full image">
                              <img
                                src={resolvedUrl}
                                alt={a.name}
                                style={{ maxHeight: '120px' }}
                                className="rounded-lg object-contain cursor-pointer border border-gray-200 hover:opacity-80 transition-opacity"
                              />
                            </a>
                          ) : (
                            <span className="flex items-center gap-1.5 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> Loading image…</span>
                          )}
                        </div>
                      )
                    }
                    return (
                      <div key={a.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 group">
                        <Paperclip size={12} className="text-gray-500 shrink-0" />
                        {brokenLegacyUpload ? (
                          <span className="text-xs text-red-500 flex-1 truncate">{a.name} — re-upload required</span>
                        ) : resolvedUrl ? (
                          <a href={resolvedUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex-1 truncate">{a.name}</a>
                        ) : (
                          <span className="text-xs text-gray-400 flex-1 truncate">Loading {a.name}…</span>
                        )}
                        <span className="text-[9px] text-gray-400 uppercase font-semibold shrink-0">{a.type}</span>
                        {!readonly && <button onClick={() => removeAttachment(a.id)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all shrink-0"><X size={11} /></button>}
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="flex gap-2 mb-2">
                <input value={attachName} onChange={e => setAttachName(e.target.value)} disabled={readonly} placeholder="Label" className="w-24 shrink-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition placeholder:text-gray-400 disabled:bg-gray-50" />
                <input value={attachUrl} onChange={e => setAttachUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addUrlAttachment() }} disabled={readonly} placeholder="https://..." className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition placeholder:text-gray-400 disabled:bg-gray-50" />
                <button onClick={addUrlAttachment} disabled={readonly || !attachUrl.trim()} className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs rounded-lg transition-colors disabled:opacity-40 shrink-0"><Link2 size={11} /> Add</button>
              </div>
              <input ref={fileInputRef} type="file" disabled={readonly || attachmentUploading} className="hidden" onChange={handleFileSelect} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={readonly || attachmentUploading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {attachmentUploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
                {attachmentUploading ? 'Uploading attachment…' : 'Upload attachment'}
              </button>
              <p className="mt-1.5 text-center text-[10px] text-gray-400">Images and files up to 20 MB</p>
              {attachmentError && <p className="mt-1.5 text-xs text-red-500">{attachmentError}</p>}
            </section>
          </div>

          {/* Right sidebar */}
          <div className="w-full lg:w-[384px] shrink-0 border-t lg:border-t-0 lg:border-l border-gray-100 bg-gray-50/40 overflow-visible lg:overflow-y-auto px-5 py-5 flex flex-col gap-4">

            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1.5">Platform</p>
              <TaskPlatformPicker value={platforms} disabled={readonly} onChange={next => {
                setPlatforms(next)
                save({ platforms: next })
              }} />
              <p className="mt-1.5 text-[10px] text-gray-400">Select one or more products.</p>
            </div>

            {/* Status */}
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1.5">Status</p>
              <div className={`relative rounded-lg ${STATUS_PILL[status] ?? 'bg-gray-100 text-gray-600'}`}>
                <select value={status} onChange={e => handleStatusChange(e.target.value)} disabled={readonly} className="w-full text-xs font-semibold px-3 py-2 bg-transparent border-0 focus:outline-none appearance-none cursor-pointer pr-7 disabled:cursor-default">
                  {statuses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
              </div>
            </div>

            {/* Assignee — authoritative by profile UUID; the display-name
                field is saved alongside it purely for history/snapshot
                display, never used to identify who's assigned. */}
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1.5">Assignee</p>
              <div className="flex items-center gap-2">
                <Avatar name={assignee} />
                <select
                  value={task.assigneeId ?? ''}
                  disabled={readonly}
                  onChange={e => {
                    const opt = eligibleAssignees.find(a => a.id === e.target.value)
                    setAssignee(opt?.name ?? '')
                    save({ assigneeId: opt?.id ?? '', assignee: opt?.name ?? '' })
                  }}
                  className="flex-1 text-sm text-gray-700 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition bg-white disabled:bg-gray-50 disabled:text-gray-500"
                >
                  <option value="">Unassigned</option>
                  {eligibleAssignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>

              {/* Restricted handoff — visible only to the current main
                  assignee when they don't already have the full editor
                  dropdown above (that already covers this and more).
                  Cannot touch any field but assigneeId. */}
              {readonly && task.assigneeId === currentUserId && (
                <div className="mt-2 pt-2 border-t border-gray-100 flex flex-col gap-1.5">
                  <p className="text-[9px] text-gray-500">
                    {tr('המשימה משויכת אליך — ניתן להעביר אותה ישירות', 'This task is assigned to you — you may hand it off directly')}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={handoffTarget}
                      disabled={handoffSaving}
                      onChange={e => setHandoffTarget(e.target.value)}
                      className="flex-1 text-xs text-gray-700 border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:bg-gray-50 min-w-0"
                    >
                      <option value="">{tr('בחר עובד להעברה...', 'Select someone to transfer to...')}</option>
                      {eligibleAssignees.filter(a => a.id !== currentUserId).map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => void handoffAssignment(handoffTarget)}
                      disabled={handoffSaving || !handoffTarget}
                      className="flex items-center gap-1 px-2 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 shrink-0"
                    >
                      {handoffSaving ? <Loader2 size={11} className="animate-spin" /> : <ArrowRightLeft size={11} />}
                      {tr('העבר', 'Transfer')}
                    </button>
                  </div>
                  <button
                    onClick={() => void handoffAssignment(null)}
                    disabled={handoffSaving}
                    className="flex items-center justify-center gap-1 px-2 py-1.5 border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
                  >
                    <UserMinus size={11} />
                    {tr('הסר אותי מהמשימה', 'Remove myself from this task')}
                  </button>
                  {handoffError && (
                    <p className="flex items-center gap-1 text-[10px] text-red-500 font-medium">
                      <AlertCircle size={10} className="shrink-0" /> {handoffError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Client link */}
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1.5">Client link</p>
              <select value={clientId} disabled={readonly} onChange={e => { setClientId(e.target.value); save({ clientId: e.target.value || undefined, clientName: clients.find(c => c.id === e.target.value)?.name }) }} className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition bg-white disabled:bg-gray-50">
                <option value="">No client linked</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Priority */}
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1.5">Priority</p>
              <div className="grid grid-cols-2 gap-1">
                {priorityDefs.map(cfg => {
                  const active = priority === cfg.id
                  return (
                    <button key={cfg.id} onClick={() => { setPriority(cfg.id); save({ priority: cfg.id }) }} disabled={readonly}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all border disabled:cursor-default ${active ? `${cfg.textCls} ${cfg.bgCls} ${cfg.borderCls} shadow-sm` : 'text-gray-500 bg-white border-gray-200 hover:border-gray-300'}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? cfg.dotCls : 'bg-gray-300'}`} />
                      {cfg.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Start date */}
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1.5">Start date</p>
              <input type="date" value={startDate} disabled={readonly} onChange={e => { setStartDate(e.target.value); save({ startDate: e.target.value || undefined }) }} className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition bg-white disabled:bg-gray-50" />
            </div>

            {/* Due date */}
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1.5">Due date</p>
              <input type="date" value={dueDate} disabled={readonly} onChange={e => { setDueDate(e.target.value); save({ dueDate: e.target.value || undefined }) }} className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition bg-white disabled:bg-gray-50" />
            </div>

            {/* Time estimate */}
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1.5">Time estimate (h)</p>
              <input type="number" min="0" step="0.5" value={timeEst} onChange={e => setTimeEst(e.target.value)} disabled={readonly}
                onBlur={() => { const h = parseFloat(timeEst); if (!isNaN(h)) save({ timeEstimate: h }) }}
                placeholder="e.g. 8" className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition bg-white placeholder:text-gray-400 disabled:bg-gray-50"
              />
            </div>

            {/* Time tracker */}
            <div className="bg-gradient-to-b from-primary/[0.06] to-white rounded-2xl p-4 border border-primary/15 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"><Clock size={14} /></span><div><p className="text-xs font-bold text-gray-800">Time tracker</p><p className="text-[10px] text-gray-500">Track or add work manually</p></div></div></div>

              {/* Total + progress */}
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold text-primary font-mono">{fmtHours(totalTracked)}</span>
                {historyEst > 0 && <span className="text-[10px] text-gray-500">/ {fmtHours(historyEst)} est.</span>}
              </div>
              {historyEst > 0 && (
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden -mt-1.5">
                  <div className={`h-full rounded-full transition-all ${totalTracked > historyEst ? 'bg-red-400' : 'bg-primary'}`} style={{ width: `${Math.min(100, (totalTracked / historyEst) * 100)}%` }} />
                </div>
              )}

              {/* Timer display / discard message */}
              {isThisTaskRunning && (
                <p className="text-center text-sm font-mono text-primary font-bold tabular-nums animate-pulse -mb-1">
                  {fmtTimer(sessionSec)}
                </p>
              )}
              {stopMsg && (
                <p className="text-center text-[11px] text-orange-500 font-medium -mb-1">
                  {stopMsg}
                </p>
              )}
              {timeError && (
                <p className="text-center text-[11px] text-red-500 font-medium -mb-1">{timeError}</p>
              )}
              <button
                onClick={isThisTaskRunning ? () => void stopTimer() : startTimer}
                disabled={!canLogTime || timeSaving}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all disabled:opacity-40 disabled:shadow-none ${isThisTaskRunning ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-primary text-white hover:bg-primary/90'}`}
              >
                {timeSaving ? <Loader2 size={12} className="animate-spin" /> : isThisTaskRunning ? <><Square size={12} /> Stop</> : <><Play size={12} /> Start</>}
              </button>

              {/* Manual entry form */}
              <div className="mt-1 rounded-xl border border-gray-200 bg-white p-3 flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-900">Manual entry</p>
                {myOpenSubtasks.length > 0 && (
                  <select
                    value={timeSubtaskId}
                    onChange={e => setTimeSubtaskId(e.target.value)}
                    disabled={!canLogTime || timeSaving}
                    className="w-full text-[11px] border border-cyan-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-cyan-400 bg-white"
                  >
                    <option value="">{tr('זמן כללי למשימה', 'General task time')}</option>
                    {myOpenSubtasks.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                )}
                <input
                  type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                  disabled={!canLogTime || timeSaving}
                  className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary bg-white"
                />
                <div className="flex gap-1.5">
                  <input
                    type="number" min="0" max="23" placeholder="h" value={manualHours}
                    onChange={e => setManualHours(e.target.value)}
                    disabled={!canLogTime || timeSaving}
                    className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary bg-white text-center placeholder:text-gray-400"
                  />
                  <input
                    type="number" min="0" max="59" placeholder="m" value={manualMins}
                    onChange={e => setManualMins(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void addManualEntry() }}
                    disabled={!canLogTime || timeSaving}
                    className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary bg-white text-center placeholder:text-gray-400"
                  />
                  <button
                    onClick={() => void addManualEntry()}
                    disabled={!canLogTime || timeSaving || ((!manualHours && !manualMins) || (parseInt(manualHours) === 0 && parseInt(manualMins) === 0))}
                    className="flex-1 px-3 py-1.5 bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 text-xs rounded-lg transition-colors disabled:opacity-40 font-bold"
                  >
                    Add
                  </button>
                </div>
                <input
                  placeholder="Note (optional)" value={manualNote}
                  onChange={e => setManualNote(e.target.value)}
                  disabled={!canLogTime || timeSaving}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary bg-white placeholder:text-gray-400"
                />
              </div>

              {/* Entry list */}
              {timeEntries.length > 0 && (
                <div className="mt-1 pt-3 border-t border-primary/10 flex flex-col gap-2 max-h-56 overflow-y-auto pr-0.5">
                  <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-gray-900">Time entries</p><span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">{timeEntries.length}</span></div>
                  {[...timeEntries].reverse().map(entry => (
                    editingId === entry.id ? (
                      <div key={entry.id} className="grid min-w-0 grid-cols-[auto_auto_2.25rem_2.25rem] items-center gap-1.5 rounded-xl border border-primary/20 bg-white p-2 text-[10px] shadow-sm">
                        <span className="text-gray-500 font-mono shrink-0 w-9">{entry.date.slice(5)}</span>
                        <Avatar name={entry.loggedBy} size="xs" />
                        <input
                          type="number" min="0" value={editH} onChange={e => setEditH(e.target.value)}
                          className="w-9 text-[10px] border border-primary/40 rounded px-1 py-0.5 bg-white text-center focus:outline-none focus:border-primary"
                          placeholder="h"
                        />
                        <input
                          type="number" min="0" max="59" value={editM} onChange={e => setEditM(e.target.value)}
                          className="w-9 text-[10px] border border-primary/40 rounded px-1 py-0.5 bg-white text-center focus:outline-none focus:border-primary"
                          placeholder="m"
                        />
                        <input
                          value={editNote} onChange={e => setEditNote(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void saveEdit(entry.id); if (e.key === 'Escape') cancelEdit() }}
                          disabled={timeSaving}
                          className="col-span-4 min-w-0 w-full text-[10px] border border-primary/40 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-primary disabled:bg-gray-50"
                          placeholder="note"
                        />
                        <button onClick={() => void saveEdit(entry.id)} disabled={timeSaving} className="col-span-2 flex min-w-0 items-center justify-center gap-1 rounded-lg bg-green-600 px-2 py-1.5 font-semibold text-white hover:bg-green-700 disabled:opacity-40">
                          {timeSaving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}<span>Save</span>
                        </button>
                        <button onClick={cancelEdit} disabled={timeSaving} className="col-span-2 flex min-w-0 items-center justify-center gap-1 rounded-lg bg-gray-100 px-2 py-1.5 font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-40"><X size={10} /><span>Cancel</span></button>
                      </div>
                    ) : (
                      <div key={entry.id} className="group grid min-w-0 grid-cols-[auto_auto_auto_auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border border-gray-100 bg-white p-2 text-[10px] transition-all hover:border-primary/20 hover:shadow-sm">
                        {entry.isLocked
                          ? <Lock size={9} className="text-gray-400 shrink-0" />
                          : <div className="w-[9px] shrink-0" />
                        }
                        <span className="text-gray-500 font-mono shrink-0 w-9">{entry.date.slice(5)}</span>
                        <Avatar name={entry.loggedBy} size="xs" />
                        <span className="text-gray-700 font-semibold shrink-0">
                          {fmtHours(entry.hours + entry.minutes / 60)}
                        </span>
                        {entry.note
                          ? <span className="text-gray-500 truncate flex-1 min-w-0">{entry.note}</span>
                          : <div className="flex-1" />
                        }
                        {canEditTimeEntry(entry) && (
                          <button
                            onClick={() => startEdit(entry)}
                            className="flex shrink-0 items-center gap-1 rounded-lg border border-primary/40 bg-white px-2.5 py-1.5 font-bold text-primary transition-colors hover:border-primary hover:bg-primary/10"
                          >
                            <Pencil size={10} /><span>Edit</span>
                          </button>
                        )}
                        {!readonly && (
                          <button
                            onClick={() => deleteEntry(entry.id)}
                            className="flex shrink-0 items-center justify-center rounded-lg border border-red-300 bg-white p-1.5 text-red-600 transition-colors hover:border-red-500 hover:bg-red-50"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    )
                  ))}
                </div>
              )}
            </div>

            {/* Code reviewer */}
            {status === 'pending_code_review' && (
              <div className="border border-purple-200 bg-purple-50 rounded-xl p-3">
                <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1.5">Code Reviewer</p>
                <select value={codeRev} disabled={readonly} onChange={e => { setCodeRev(e.target.value); save({ codeReviewer: e.target.value || undefined }) }} className="w-full text-sm text-gray-700 border border-purple-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-200 transition bg-white disabled:bg-purple-50">
                  <option value="">Select reviewer...</option>
                  {assignees.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            )}

            {/* UX reviewer */}
            {status === 'pending_ux_review' && (
              <div className="border border-pink-200 bg-pink-50 rounded-xl p-3">
                <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1.5">UI/UX Reviewer</p>
                <select value={uxRev} disabled={readonly} onChange={e => { setUxRev(e.target.value); save({ uxReviewer: e.target.value || undefined }) }} className="w-full text-sm text-gray-700 border border-pink-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-pink-200 transition bg-white disabled:bg-pink-50">
                  <option value="">Select reviewer...</option>
                  {assignees.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Status history */}
        <div className="border-t border-gray-100 shrink-0">
          <button onClick={() => setShowHistory(h => !h)} className="flex items-center gap-2 w-full px-6 py-3 text-xs font-semibold text-gray-500 hover:text-primary hover:bg-gray-50 transition-colors">
            <Clock size={13} />
            Status History
            <span className="text-gray-500 font-normal">({history.length} entries)</span>
            <ChevronDown size={13} className={`ml-auto transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
          {showHistory && (
            <div className="overflow-auto max-h-40 border-t border-gray-50">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white border-b border-gray-100">
                  <tr>
                    <th className="text-left font-semibold text-gray-500 px-6 py-2">Status</th>
                    <th className="text-left font-semibold text-gray-500 px-3 py-2">Date</th>
                    <th className="text-left font-semibold text-gray-500 px-3 py-2">Time</th>
                    <th className="text-left font-semibold text-gray-500 px-3 py-2 pr-6">Changed by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[...history].reverse().map((entry, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-6 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_PILL[entry.status]}`}>{STATUS_LABEL[entry.status]}</span></td>
                      <td className="px-3 py-2 text-gray-500">{new Date(entry.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono">{new Date(entry.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-3 py-2 pr-6 text-gray-500">{entry.changedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Board move history — durable, from task_board_moves, survives
            later board/status/priority renames or deletions (snapshots,
            not live joins) and later task deletion (no FK on task_id). */}
        <div className="border-t border-gray-100 shrink-0">
          <button onClick={toggleMoveHistory} className="flex items-center gap-2 w-full px-6 py-3 text-xs font-semibold text-gray-500 hover:text-primary hover:bg-gray-50 transition-colors">
            <ArrowRightLeft size={13} />
            {tr('היסטוריית העברות בין לוחות', 'Board Move History')}
            {moveHistory && <span className="text-gray-500 font-normal">({moveHistory.length})</span>}
            <ChevronDown size={13} className={`ml-auto transition-transform ${showMoveHistory ? 'rotate-180' : ''}`} />
          </button>
          {showMoveHistory && (
            <div className="overflow-auto max-h-40 border-t border-gray-50 px-6 py-2">
              {moveHistoryError && (
                <div className="flex items-center gap-2 text-xs text-red-500 py-2">
                  <AlertCircle size={13} /> {moveHistoryError}
                </div>
              )}
              {moveHistory === null && !moveHistoryError && (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                  <Loader2 size={12} className="animate-spin" /> {tr('טוען...', 'Loading...')}
                </div>
              )}
              {moveHistory?.length === 0 && (
                <p className="text-xs text-gray-500 py-2">{tr('המשימה מעולם לא הועברה בין לוחות.', 'This task has never been moved between boards.')}</p>
              )}
              {moveHistory && moveHistory.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {moveHistory.map(m => (
                    <li key={m.id} className="text-xs text-gray-600">
                      <span className="font-semibold">{m.sourceBoardName}</span> → <span className="font-semibold text-primary">{m.destBoardName}</span>
                      {' · '}{new Date(m.movedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{m.movedByName ?? tr('מערכת', 'System')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
