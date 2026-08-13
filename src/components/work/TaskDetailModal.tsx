import { useState, useRef, useEffect } from 'react'
import {
  X, Check, Copy, Clock, ChevronDown,
  Send, Paperclip, Link2, Play, Square, AlertCircle,
  Lock, Pencil, Loader2, Trash2, ArrowRightLeft,
} from 'lucide-react'
import { Avatar } from '../Avatar'
import { useNotifications } from '../../contexts/NotificationContext'
import { useTimer } from '../../contexts/TimerContext'
import { useLang } from '../../contexts/LanguageContext'
import type { Task, TimeEntry, PriorityDef, StatusHistoryEntry, TaskComment, Attachment, BoardStatus, AssigneeOption, Board } from '../../types/work'
import { DEFAULT_BOARD_STATUSES, STATUS_PILL, STATUS_LABEL } from '../../data/workConstants'
import { addTaskComment, claimTask, deleteTask, getTaskBoardMoves, type TaskBoardMove } from '../../lib/database'
import { MoveTaskModal } from './MoveTaskModal'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
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
function isOverdue(due?: string) { return !!due && new Date(due) < new Date() }
function newId() { return Math.random().toString(36).slice(2, 10) }

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
}) {
  const { addNotification } = useNotifications()
  const { t: tr } = useLang()

  const [title,     setTitle]     = useState(task.title)
  const [editTitle, setEditTitle] = useState(false)
  const [desc,      setDesc]      = useState(task.description)
  const statuses = boardStatuses ?? DEFAULT_BOARD_STATUSES
  const [status,    setStatus]    = useState(task.status)
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

  const [newComment,   setNewComment]   = useState('')
  const [mentionQuery, setMentionQuery] = useState('')
  const [showMention,  setShowMention]  = useState(false)
  const [commentSaving, setCommentSaving] = useState(false)
  const [commentError,  setCommentError]  = useState<string | null>(null)
  const [claiming,      setClaiming]      = useState(false)
  const [claimError,    setClaimError]    = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting,          setDeleting]          = useState(false)
  const [deleteError,       setDeleteError]       = useState<string | null>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)

  const [attachUrl,  setAttachUrl]  = useState('')
  const [attachName, setAttachName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const [showHistory,  setShowHistory]  = useState(false)
  const [copied,       setCopied]       = useState(false)

  const [showMoveModal, setShowMoveModal] = useState(false)
  const [showMoveHistory, setShowMoveHistory] = useState(false)
  const [moveHistory, setMoveHistory] = useState<TaskBoardMove[] | null>(null)
  const [moveHistoryError, setMoveHistoryError] = useState<string | null>(null)

  const taskRef = useRef(task)
  useEffect(() => { taskRef.current = task }, [task])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // When the floating widget stops this task's timer, sync the new entry into local state
  useEffect(() => {
    function onTimerSaved(e: Event) {
      const { taskId, entry } = (e as CustomEvent).detail
      if (taskId !== task.id) return
      setTimeEntries(prev => prev.some(x => x.id === entry.id) ? prev : [...prev, entry])
    }
    window.addEventListener('timerEntrySaved', onTimerSaved)
    return () => window.removeEventListener('timerEntrySaved', onTimerSaved)
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
      if (reviewer) addNotification({ type: 'code_review', message: `${reviewer}: new code review for "${taskRef.current.title}"`, taskId: task.id, taskTitle: task.title })
    }
    if (newStatus === 'pending_ux_review') {
      const reviewer = uxRev || taskRef.current.uxReviewer || ''
      patch.uxReviewer = reviewer
      if (reviewer) addNotification({ type: 'ux_review', message: `${reviewer}: new UX review for "${taskRef.current.title}"`, taskId: task.id, taskTitle: task.title })
    }
    if (newStatus === 'fixing') {
      addNotification({ type: 'fixing', message: `${taskRef.current.assignee}: "${taskRef.current.title}" sent back for fixes`, taskId: task.id, taskTitle: task.title })
    }
    if (task.board === 'support' && newStatus === 'not_started') {
      addNotification({ type: 'support_opened', message: `New support ticket: ${taskRef.current.title}`, taskId: task.id, taskTitle: task.title, severity: 'high' })
    }
    save(patch)
  }

  function startTimer() {
    if (readonly) return
    timerCtx.start(task.id, task.title, currentUser, currentUserId)
  }
  function stopTimer() {
    const result = timerCtx.stop()
    if (result.discarded) {
      setStopMsg('פחות מדקה — לא נרשם')
      setTimeout(() => setStopMsg(null), 3000)
      return
    }
    if (result.entry) {
      const updated = [...timeEntries, result.entry]
      setTimeEntries(updated)
      save({ timeEntries: updated })
    }
  }
  function addManualEntry() {
    const h = parseInt(manualHours) || 0; const m = parseInt(manualMins) || 0
    if (h === 0 && m === 0) return
    const entry: TimeEntry = {
      id: newId(),
      date: manualDate || new Date().toISOString().slice(0, 10),
      hours: h, minutes: m,
      loggedBy: currentUser,
      loggedById: currentUserId,
      note: manualNote.trim() || undefined,
      isLocked: false,
      createdAt: new Date().toISOString(),
    }
    const updated = [...timeEntries, entry]
    setTimeEntries(updated); save({ timeEntries: updated })
    setManualHours(''); setManualMins(''); setManualNote('')
  }
  function deleteEntry(id: string) {
    const updated = timeEntries.filter(e => e.id !== id)
    setTimeEntries(updated); save({ timeEntries: updated })
  }
  function startEdit(entry: TimeEntry) {
    setEditingId(entry.id)
    setEditH(entry.hours.toString())
    setEditM(entry.minutes.toString())
    setEditNote(entry.note ?? '')
  }
  function saveEdit(id: string) {
    const h = parseInt(editH) || 0; const m = parseInt(editM) || 0
    const updated = timeEntries.map(e => e.id !== id ? e : { ...e, hours: h, minutes: m, note: editNote.trim() || undefined })
    setTimeEntries(updated); save({ timeEntries: updated }); setEditingId(null)
  }
  function cancelEdit() { setEditingId(null) }

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

  function addUrlAttachment() {
    if (!attachUrl.trim()) return
    const att: Attachment = { id: newId(), type: 'url', name: attachName.trim() || attachUrl.trim(), url: attachUrl.trim() }
    const updated = [...attachments, att]; setAttachments(updated); setAttachUrl(''); setAttachName(''); save({ attachments: updated })
  }
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const att: Attachment = { id: newId(), type: 'file', name: file.name, url: URL.createObjectURL(file) }
    const updated = [...attachments, att]; setAttachments(updated); save({ attachments: updated }); e.target.value = ''
  }
  function removeAttachment(id: string) {
    const updated = attachments.filter(a => a.id !== id); setAttachments(updated); save({ attachments: updated })
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

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-6 py-4 border-b border-gray-100 shrink-0">
          <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-1 rounded-lg whitespace-nowrap shrink-0">{boardLabel}</span>
          <span className="text-[10px] text-gray-400 font-mono shrink-0">{task.id}</span>
          <div className="flex-1 min-w-0">
            {editTitle ? (
              <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={saveTitle}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitle(task.title); setEditTitle(false) } }}
                className="w-full text-sm font-semibold text-gray-900 border-b-2 border-primary focus:outline-none bg-transparent py-0 leading-snug"
              />
            ) : (
              <button onClick={() => !readonly && setEditTitle(true)} disabled={readonly} className="text-sm font-semibold text-gray-900 hover:text-primary transition-colors text-left leading-snug line-clamp-1 w-full disabled:hover:text-gray-900 disabled:cursor-default" title={readonly ? undefined : 'Click to edit'}>{title}</button>
            )}
          </div>
          {openTicketsForClient > 0 && (
            <span
              className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded-lg whitespace-nowrap shrink-0"
              title="Other support tickets still open for this client"
            >
              ללקוח הזה {openTicketsForClient} קריאות תמיכה פתוחות נוספות
            </span>
          )}
          <button onClick={copyLink} title="Copy task link" className={`p-1.5 rounded-lg transition-colors shrink-0 ${copied ? 'bg-green-100 text-green-600' : 'text-gray-400 hover:bg-gray-100 hover:text-primary'}`}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          {canMoveBoard && (
            <button
              onClick={() => setShowMoveModal(true)}
              title={tr('העבר ללוח אחר', 'Move to another board')}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-primary/10 hover:text-primary transition-colors shrink-0"
            >
              <ArrowRightLeft size={15} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              title={tr('מחק משימה', 'Delete task')}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0"
            >
              <Trash2 size={15} />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0"><X size={15} /></button>
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

        {/* Closing a support ticket — cannot be skipped */}
        {doneFlow && (
          <div className="absolute inset-0 z-20 bg-black/40 flex items-center justify-center p-6" dir="rtl">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
              {doneFlow.step === 'appUpdate' ? (
                <>
                  <p className="text-sm font-bold text-gray-800">
                    האם התיקון דורש עדכון גרסה כדי שהלקוח יקבל אותו?
                  </p>
                  <p className="text-xs text-gray-400 leading-relaxed">
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
                  <button onClick={() => setDoneFlow(null)} className="text-xs text-gray-400 hover:text-gray-600 self-start">
                    ביטול
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-gray-800">
                    ללקוח הזה יש עוד {openTicketsForClient} קריאות תמיכה פתוחות.
                  </p>
                  <p className="text-xs text-gray-400 leading-relaxed">
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
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left */}
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5 flex flex-col gap-6">

            {/* Description */}
            <section>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Description</p>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={saveDesc} rows={6}
                placeholder="Add a description..." disabled={readonly}
                className="w-full text-sm text-gray-700 border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition placeholder:text-gray-300 leading-relaxed disabled:bg-gray-50 disabled:text-gray-500"
              />
            </section>

            {/* Comments */}
            <section>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Comments {comments.length > 0 && <span className="normal-case font-normal">({comments.length})</span>}</p>
              {comments.length > 0 && (
                <div className="space-y-4 mb-4">
                  {comments.map(c => (
                    <div key={c.id} className="flex gap-3">
                      <Avatar name={c.author} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-800">{c.author}</span>
                          <span className="text-[10px] text-gray-400">{fmtDateTime(c.timestamp)}</span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                          {c.text.split(/(@\w+)/g).map((part, i) =>
                            part.startsWith('@') ? <span key={i} className="text-primary font-semibold">{part}</span> : <span key={i}>{part}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-3 items-start">
                <Avatar name={currentUser} />
                <div className="flex-1 relative">
                  <textarea ref={commentRef} value={newComment} onChange={e => handleCommentInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitComment(); if (e.key === 'Escape') { setNewComment(''); setShowMention(false) } }}
                    rows={2} placeholder={canComment ? 'Add a comment... (type @ to mention)' : 'You do not have permission to comment on this board'}
                    disabled={!canComment}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition placeholder:text-gray-300 disabled:bg-gray-50 disabled:text-gray-400"
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
                    <span className="text-[10px] text-gray-300">⌘+Enter to submit</span>
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
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Attachments</p>
              {attachments.length > 0 && (
                <div className="space-y-2 mb-3">
                  {attachments.map(a => {
                    const isImage = a.url.startsWith('data:image/')
                    if (isImage) {
                      return (
                        <div key={a.id} className="flex flex-col gap-1.5 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 group">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 truncate flex-1">{a.name}</span>
                            <button onClick={() => removeAttachment(a.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0"><X size={11} /></button>
                          </div>
                          <img
                            src={a.url}
                            alt={a.name}
                            style={{ maxHeight: '120px' }}
                            className="rounded-lg object-contain cursor-pointer border border-gray-200 hover:opacity-80 transition-opacity self-start"
                            onClick={() => window.open(a.url, '_blank')}
                            title="לחץ לצפייה מלאה"
                          />
                        </div>
                      )
                    }
                    return (
                      <div key={a.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 group">
                        <Paperclip size={12} className="text-gray-400 shrink-0" />
                        <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex-1 truncate">{a.name}</a>
                        <span className="text-[9px] text-gray-300 uppercase font-semibold shrink-0">{a.type}</span>
                        <button onClick={() => removeAttachment(a.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0"><X size={11} /></button>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="flex gap-2 mb-2">
                <input value={attachName} onChange={e => setAttachName(e.target.value)} placeholder="Label" className="w-24 shrink-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition placeholder:text-gray-300" />
                <input value={attachUrl} onChange={e => setAttachUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addUrlAttachment() }} placeholder="https://..." className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition placeholder:text-gray-300" />
                <button onClick={addUrlAttachment} disabled={!attachUrl.trim()} className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs rounded-lg transition-colors disabled:opacity-40 shrink-0"><Link2 size={11} /> Add</button>
              </div>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary transition-colors">
                <Paperclip size={12} /> Upload file
              </button>
            </section>
          </div>

          {/* Right sidebar */}
          <div className="shrink-0 border-l border-gray-100 overflow-y-auto px-5 py-5 flex flex-col gap-4" style={{ width: '272px' }}>

            {/* Status */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Status</p>
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
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Assignee</p>
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
            </div>

            {/* Client link */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Client link</p>
              <select value={clientId} onChange={e => { setClientId(e.target.value); save({ clientId: e.target.value || undefined, clientName: clients.find(c => c.id === e.target.value)?.name }) }} className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition bg-white">
                <option value="">No client linked</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Priority */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Priority</p>
              <div className="grid grid-cols-2 gap-1">
                {priorityDefs.map(cfg => {
                  const active = priority === cfg.id
                  return (
                    <button key={cfg.id} onClick={() => { setPriority(cfg.id); save({ priority: cfg.id }) }}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all border ${active ? `${cfg.textCls} ${cfg.bgCls} ${cfg.borderCls} shadow-sm` : 'text-gray-400 bg-white border-gray-200 hover:border-gray-300'}`}
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
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Start date</p>
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); save({ startDate: e.target.value || undefined }) }} className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition bg-white" />
            </div>

            {/* Due date */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Due date</p>
              <input type="date" value={dueDate} onChange={e => { setDueDate(e.target.value); save({ dueDate: e.target.value || undefined }) }} className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition bg-white" />
            </div>

            {/* Time estimate */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Time estimate (h)</p>
              <input type="number" min="0" step="0.5" value={timeEst} onChange={e => setTimeEst(e.target.value)}
                onBlur={() => { const h = parseFloat(timeEst); if (!isNaN(h)) save({ timeEstimate: h }) }}
                placeholder="e.g. 8" className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition bg-white placeholder:text-gray-300"
              />
            </div>

            {/* Time tracker */}
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 flex flex-col gap-2.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Time tracker</p>

              {/* Total + progress */}
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold text-primary font-mono">{fmtHours(totalTracked)}</span>
                {historyEst > 0 && <span className="text-[10px] text-gray-400">/ {fmtHours(historyEst)} est.</span>}
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
              <button
                onClick={isThisTaskRunning ? stopTimer : startTimer}
                disabled={readonly && !isThisTaskRunning}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 ${isThisTaskRunning ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-primary text-white hover:bg-primary/90'}`}
              >
                {isThisTaskRunning ? <><Square size={12} /> Stop</> : <><Play size={12} /> Start</>}
              </button>

              {/* Manual entry form */}
              <div className="pt-2 border-t border-gray-200 flex flex-col gap-1.5">
                <input
                  type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                  className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary bg-white"
                />
                <div className="flex gap-1.5">
                  <input
                    type="number" min="0" max="23" placeholder="h" value={manualHours}
                    onChange={e => setManualHours(e.target.value)}
                    className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary bg-white text-center placeholder:text-gray-300"
                  />
                  <input
                    type="number" min="0" max="59" placeholder="m" value={manualMins}
                    onChange={e => setManualMins(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addManualEntry() }}
                    className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary bg-white text-center placeholder:text-gray-300"
                  />
                  <button
                    onClick={addManualEntry}
                    disabled={(!manualHours && !manualMins) || (parseInt(manualHours) === 0 && parseInt(manualMins) === 0)}
                    className="flex-1 px-2 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs rounded-lg transition-colors disabled:opacity-40 font-semibold"
                  >
                    Add
                  </button>
                </div>
                <input
                  placeholder="Note (optional)" value={manualNote}
                  onChange={e => setManualNote(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary bg-white placeholder:text-gray-300"
                />
              </div>

              {/* Entry list */}
              {timeEntries.length > 0 && (
                <div className="pt-2 border-t border-gray-200 flex flex-col gap-1 max-h-52 overflow-y-auto">
                  {[...timeEntries].reverse().map(entry => (
                    editingId === entry.id ? (
                      <div key={entry.id} className="flex items-center gap-1 text-[10px] py-0.5">
                        <span className="text-gray-400 font-mono shrink-0 w-9">{entry.date.slice(5)}</span>
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
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(entry.id); if (e.key === 'Escape') cancelEdit() }}
                          className="flex-1 min-w-0 text-[10px] border border-primary/40 rounded px-1 py-0.5 bg-white focus:outline-none focus:border-primary"
                          placeholder="note"
                        />
                        <button onClick={() => saveEdit(entry.id)} className="text-green-500 hover:text-green-600 shrink-0 p-0.5"><Check size={10} /></button>
                        <button onClick={cancelEdit} className="text-gray-300 hover:text-gray-500 shrink-0 p-0.5"><X size={10} /></button>
                      </div>
                    ) : (
                      <div key={entry.id} className="flex items-center gap-1.5 text-[10px] group py-0.5">
                        {entry.isLocked
                          ? <Lock size={9} className="text-gray-300 shrink-0" />
                          : <div className="w-[9px] shrink-0" />
                        }
                        <span className="text-gray-400 font-mono shrink-0 w-9">{entry.date.slice(5)}</span>
                        <Avatar name={entry.loggedBy} size="xs" />
                        <span className="text-gray-700 font-semibold shrink-0">
                          {fmtHours(entry.hours + entry.minutes / 60)}
                        </span>
                        {entry.note
                          ? <span className="text-gray-400 truncate flex-1 min-w-0">{entry.note}</span>
                          : <div className="flex-1" />
                        }
                        <button
                          onClick={() => startEdit(entry)}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-primary transition-all shrink-0 p-0.5"
                        >
                          <Pencil size={9} />
                        </button>
                        <button
                          onClick={() => deleteEntry(entry.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0 p-0.5"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    )
                  ))}
                </div>
              )}
            </div>

            {/* Code reviewer */}
            {status === 'pending_code_review' && (
              <div className="border border-purple-200 bg-purple-50 rounded-xl p-3">
                <p className="text-[10px] font-semibold text-purple-600 uppercase tracking-wider mb-1.5">Code Reviewer</p>
                <select value={codeRev} onChange={e => { setCodeRev(e.target.value); save({ codeReviewer: e.target.value || undefined }) }} className="w-full text-sm text-gray-700 border border-purple-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-200 transition bg-white">
                  <option value="">Select reviewer...</option>
                  {assignees.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            )}

            {/* UX reviewer */}
            {status === 'pending_ux_review' && (
              <div className="border border-pink-200 bg-pink-50 rounded-xl p-3">
                <p className="text-[10px] font-semibold text-pink-600 uppercase tracking-wider mb-1.5">UI/UX Reviewer</p>
                <select value={uxRev} onChange={e => { setUxRev(e.target.value); save({ uxReviewer: e.target.value || undefined }) }} className="w-full text-sm text-gray-700 border border-pink-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-pink-200 transition bg-white">
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
            <span className="text-gray-400 font-normal">({history.length} entries)</span>
            <ChevronDown size={13} className={`ml-auto transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
          {showHistory && (
            <div className="overflow-auto max-h-40 border-t border-gray-50">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white border-b border-gray-100">
                  <tr>
                    <th className="text-left font-semibold text-gray-400 px-6 py-2">Status</th>
                    <th className="text-left font-semibold text-gray-400 px-3 py-2">Date</th>
                    <th className="text-left font-semibold text-gray-400 px-3 py-2">Time</th>
                    <th className="text-left font-semibold text-gray-400 px-3 py-2 pr-6">Changed by</th>
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
            {moveHistory && <span className="text-gray-400 font-normal">({moveHistory.length})</span>}
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
                <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                  <Loader2 size={12} className="animate-spin" /> {tr('טוען...', 'Loading...')}
                </div>
              )}
              {moveHistory?.length === 0 && (
                <p className="text-xs text-gray-400 py-2">{tr('המשימה מעולם לא הועברה בין לוחות.', 'This task has never been moved between boards.')}</p>
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
