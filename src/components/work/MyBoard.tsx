import { useState, useMemo, useEffect } from 'react'
import { AlertCircle, Ticket, User, Calendar, Clock, ChevronDown, CheckCircle2, ArrowRightLeft } from 'lucide-react'
import type { Task, Board, TimeEntry, AssigneeOption } from '../../types/work'
import { eligibleAssigneesForBoard } from '../../types/work'
import { COLUMNS, STATUS_PILL, STATUS_LABEL, STATUS_LABEL_HE, STATUS_LEFT, resolveTaskPriority, priorityDefsForBoard } from '../../data/workConstants'
import { useLang } from '../../contexts/LanguageContext'
import { PriorityQuickEdit, AssigneeQuickEdit } from './TaskQuickEdit'
import { ClientBadge } from './ClientBadge'
import { MoveTaskModal } from './MoveTaskModal'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
function fmtHours(h: number) {
  if (h === 0) return '0h'
  const hrs = Math.floor(h)
  const min = Math.round((h - hrs) * 60)
  return min > 0 ? `${hrs}h ${min}m` : `${hrs}h`
}
function isOverdue(due?: string) {
  return !!due && new Date(due) < new Date()
}
function entryTotal(entries: TimeEntry[]) {
  return entries.reduce((s, e) => s + e.hours + e.minutes / 60, 0)
}
function entriesThisMonth(entries: TimeEntry[]) {
  const ym = new Date().toISOString().slice(0, 7)
  return entries.filter(e => e.date.startsWith(ym)).reduce((s, e) => s + e.hours + e.minutes / 60, 0)
}
// activeProfileIds is optional (undefined means "not checked, trust the
// stored ownerId as-is") so callers that don't have an active-profile list
// handy don't have to fabricate one — but Work.tsx always passes it, and
// whenever it's present an inactive owner is treated exactly like no
// owner at all: the task stays with (or returns to) its original
// assignee rather than routing toward someone who can no longer act on
// it. The authoritative, permanent fix is the server-side
// clear_status_ownership_on_deactivation trigger, which strips ownerId
// the moment a profile deactivates; this is the same-render defensive
// mirror of that for the window before this session's boards state has
// picked that change up.
function statusOwnerIdOf(boards: Board[], t: Task, activeProfileIds?: Set<string>): string | undefined {
  const board = boards.find(b => b.id === t.board)
  const ownerId = board?.statuses.find(s => s.id === t.status)?.ownerId
  if (ownerId && activeProfileIds && !activeProfileIds.has(ownerId)) return undefined
  return ownerId
}
// assigneeId is authoritative once set. Pre-migration, tasks.assignee_id
// doesn't exist on the live DB yet, so it comes back undefined for every
// task (not just genuinely-unassigned ones) — falling back to the legacy
// display-name field in that case keeps "my tasks" working exactly as it
// always did until the migration backfills real UUIDs. Safe to keep
// permanently: once assignee_id is populated, real unassigned tasks have
// assigneeId === null (not undefined) and an assignee name that won't
// happen to equal the viewer's own name, so this never causes a
// post-migration false match.
function isMine(t: Task, myProfileId: string | undefined, currentUser: string): boolean {
  if (t.assigneeId) return t.assigneeId === myProfileId
  return !!currentUser && t.assignee === currentUser
}

type TaskBadge = { label: string; cls: string }

// ─── CompactTaskRow ───────────────────────────────────────────────────────────

function CompactTaskRow({
  task, boards, onClick, badge, canEdit, eligibleAssignees, onTaskSaved, canMove, onMoveClick,
}: {
  task: Task
  boards: Board[]
  onClick: () => void
  badge?: TaskBadge
  /** Whether the current user may update this task under the server's RLS policy — gates quick-edit only. */
  canEdit: boolean
  eligibleAssignees: AssigneeOption[]
  onTaskSaved: (updated: Task) => void
  canMove: boolean
  onMoveClick: (task: Task) => void
}) {
  const priorityDefs = priorityDefsForBoard(boards.find(b => b.id === task.board))
  const overdue = isOverdue(task.dueDate)
  return (
    // A div, not a button — PriorityQuickEdit/AssigneeQuickEdit render
    // real <button>s, which can't validly nest inside another button.
    // role="button" + onKeyDown keeps the row keyboard-activatable.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className="flex items-center gap-3 w-full px-4 py-2.5 bg-white hover:bg-gray-50 border-b border-gray-50 text-left transition-colors last:border-b-0 cursor-pointer"
    >
      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_PILL[task.status] ?? 'bg-gray-100 text-gray-600'}`}>
        {STATUS_LABEL[task.status] ?? task.status}
      </span>
      <span className="text-[10px] font-mono text-gray-300 shrink-0 w-16 truncate">{task.id}</span>
      <span className="flex-1 text-sm text-gray-800 truncate min-w-0">{task.title}</span>
      <ClientBadge name={task.clientName} />
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 whitespace-nowrap ${badge.cls}`}>
          {badge.label}
        </span>
      )}
      <PriorityQuickEdit task={task} priorityDefs={priorityDefs} canEdit={canEdit} onSaved={onTaskSaved} />
      {task.dueDate && (
        <span className={`text-[10px] flex items-center gap-0.5 shrink-0 ${overdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
          <Calendar size={9} />{fmtDate(task.dueDate)}
        </span>
      )}
      {entryTotal(task.timeEntries) > 0 && (
        <span className="text-[10px] text-gray-300 flex items-center gap-0.5 shrink-0">
          <Clock size={9} />{fmtHours(entryTotal(task.timeEntries))}
        </span>
      )}
      <AssigneeQuickEdit task={task} eligible={eligibleAssignees} canEdit={canEdit} onSaved={onTaskSaved} />
      {canMove && (
        <button
          onClick={e => { e.stopPropagation(); onMoveClick(task) }}
          title="Move to another board"
          className="p-1 rounded-lg text-gray-300 hover:bg-primary/10 hover:text-primary transition-colors shrink-0"
        >
          <ArrowRightLeft size={12} />
        </button>
      )}
    </div>
  )
}

// ─── MyStatusSection ──────────────────────────────────────────────────────────

function MyStatusSection({
  col, tasks, boards, onCardClick, getBadge, canEditTask, eligibleAssigneesFor, onTaskSaved, canMoveTask, onMoveClick,
}: {
  col: { id: string; label: string }
  tasks: Task[]
  boards: Board[]
  onCardClick: (id: string) => void
  getBadge?: (task: Task) => TaskBadge | undefined
  canEditTask: (task: Task) => boolean
  eligibleAssigneesFor: (task: Task) => AssigneeOption[]
  onTaskSaved: (updated: Task) => void
  canMoveTask: (task: Task) => boolean
  onMoveClick: (task: Task) => void
}) {
  const { t: tr } = useLang()
  const [open, setOpen] = useState(col.id !== 'done' && col.id !== 'archived')
  // col.label is always one of MyBoard's own fixed built-in status-group
  // headers (see MY_COLS = COLUMNS.filter(...) below) — never a specific
  // board's live, admin-renamed status label — so translating it here is
  // safe UI localization, not touching user/admin content.
  const label = tr(STATUS_LABEL_HE[col.id] ?? col.label, col.label)
  return (
    <div className={`border-l-2 rounded-lg overflow-hidden shadow-sm ${STATUS_LEFT[col.id] ?? 'border-l-gray-300'} bg-white`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 w-full px-4 py-2.5 bg-gray-50/80 hover:bg-gray-100/60 transition-colors text-left border-b border-gray-100"
      >
        <ChevronDown size={13} className={`text-gray-400 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`} />
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_PILL[col.id] ?? 'bg-gray-100 text-gray-600'}`}>
          {label}
        </span>
        <span className="text-xs font-bold text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 min-w-[20px] text-center">
          {tasks.length}
        </span>
      </button>
      {open && (
        <div>
          {tasks.length === 0 ? (
            <div className="text-[11px] text-gray-300 text-center py-4 select-none">{tr('אין משימות', 'No tasks')}</div>
          ) : (
            tasks.map(task => (
              <CompactTaskRow
                key={task.id}
                task={task}
                boards={boards}
                onClick={() => onCardClick(task.id)}
                badge={getBadge?.(task)}
                canEdit={canEditTask(task)}
                eligibleAssignees={eligibleAssigneesFor(task)}
                onTaskSaved={onTaskSaved}
                canMove={canMoveTask(task)}
                onMoveClick={onMoveClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── MyBoard ──────────────────────────────────────────────────────────────────

export function MyBoard({
  tasks, boards, currentUser, myProfileId, onOpenTask, onStatusChange,
  isTechnicalSupport = false, activeProfileIds, canEditTask, allProfiles, onTaskSaved, canMoveTask,
}: {
  tasks: Task[]
  boards: Board[]
  /** Display-name fallback, used only when a task has no assigneeId yet (see isMine). */
  currentUser: string
  /** The authenticated user's profile UUID — authoritative once a task has assigneeId set. */
  myProfileId?: string
  onOpenTask: (id: string) => void
  onStatusChange: (id: string, status: string) => void
  isTechnicalSupport?: boolean
  /** Active profile UUIDs — an inactive status owner is treated as no owner at all (see statusOwnerIdOf). */
  activeProfileIds?: Set<string>
  /** Mirrors the server's "tasks: update" RLS policy exactly — gates quick-edit only, never a security boundary on its own. */
  canEditTask: (task: Task) => boolean
  /** Active profiles (Owner included), used to compute each task's board-scoped assignee eligibility. */
  allProfiles: { id: string; name: string; isOwner: boolean }[]
  onTaskSaved: (updated: Task) => void
  /** Mirrors "tasks: delete"'s formula (work:'full' AND board:'full' on the task's current board) — gates the "Move to another board" quick action. */
  canMoveTask: (task: Task) => boolean
}) {
  const { t: tr } = useLang()
  const [movingTask, setMovingTask] = useState<Task | null>(null)

  // Tasks assigned to me — EXCEPT one currently routed away to someone
  // else's queue by status ownership (it comes back automatically once
  // the task leaves that status; assigneeId itself is never touched).
  const myTasks = useMemo(() => tasks.filter(t => {
    if (!isMine(t, myProfileId, currentUser)) return false
    const ownerId = statusOwnerIdOf(boards, t, activeProfileIds)
    return !ownerId || ownerId === myProfileId
  }), [tasks, boards, myProfileId, currentUser, activeProfileIds])

  // Tasks currently routed to me by status ownership, not directly
  // assigned to me — folded into the same per-status grouping as
  // myTasks below (no separate "Review Queue" section anymore), with
  // a badge explaining why they're here.
  const statusOwnedTasks = useMemo(() => tasks.filter(t => {
    if (isMine(t, myProfileId, currentUser)) return false
    if (t.status === 'done' || t.status === 'archived') return false
    return statusOwnerIdOf(boards, t, activeProfileIds) === myProfileId
  }), [tasks, boards, myProfileId, currentUser, activeProfileIds])

  const displayTasks = useMemo(() => [...myTasks, ...statusOwnedTasks], [myTasks, statusOwnedTasks])

  // Badge label map for status-routed tasks
  const statusBadgeMap = useMemo(() => {
    const map = new Map<string, TaskBadge>()
    statusOwnedTasks.forEach(t => {
      const board     = boards.find(b => b.id === t.board)
      const statusDef = board?.statuses.find(s => s.id === t.status)
      map.set(t.id, {
        // "Routed by status" is a fixed UI label; statusDef?.label is the
        // board's own live, admin-editable status name — left untranslated.
        label: `${tr('בגלל סטטוס', 'Routed by status')}: ${statusDef?.label ?? t.status}`,
        cls: 'bg-purple-50 text-purple-700 border border-purple-100',
      })
    })
    return map
  }, [statusOwnedTasks, boards, tr])

  const [activeTimer, setActiveTimer] = useState<{ taskId: string; taskTitle: string } | null>(null)

  useEffect(() => {
    function check() {
      try {
        const stored = localStorage.getItem('activeTimer')
        if (stored) {
          const { taskId, taskTitle } = JSON.parse(stored)
          setActiveTimer({ taskId, taskTitle })
        } else {
          setActiveTimer(null)
        }
      } catch { setActiveTimer(null) }
    }
    check()
    const interval = setInterval(check, 2000)
    return () => clearInterval(interval)
  }, [])

  const inProgress   = displayTasks.filter(t => t.status === 'in_progress')
  const overdueTasks = displayTasks.filter(t => isOverdue(t.dueDate) && t.status !== 'done' && t.status !== 'archived')
  const pendingClose = displayTasks.filter(t => t.status === 'done')

  // Shared support queue — eligibility is now fully configurable
  // (board.allTasksToSupportQueue / priority.showInSupportQueue), not
  // a hardcoded board id or a priority-label regex. Visible only to
  // active technical-support staff (server-side RLS already enforces
  // this independently — see is_technical_support_staff() /
  // "tasks: view" in 20260810101000_rls_rpc_identity_and_queue.sql —
  // this client-side gate is UX only).
  const isOpen = (t: Task) => t.status !== 'done' && t.status !== 'archived'
  const isQueueEligible = (t: Task) => {
    if (t.claimed || t.assignee) return false
    const board = boards.find(b => b.id === t.board)
    if (board?.allTasksToSupportQueue) return true
    return !!resolveTaskPriority(t, boards)?.showInSupportQueue
  }

  // Memoized per active board id — cheap to recompute per task but no
  // reason to redo the filter/map work for every card sharing a board.
  const eligibleAssigneesByBoard = useMemo(() => {
    const map = new Map<string, AssigneeOption[]>()
    boards.forEach(b => map.set(b.id, eligibleAssigneesForBoard(b, allProfiles)))
    return map
  }, [boards, allProfiles])
  const eligibleAssigneesFor = (task: Task): AssigneeOption[] => eligibleAssigneesByBoard.get(task.board) ?? []

  const unclaimed = isTechnicalSupport
    ? tasks.filter(t => isOpen(t) && isQueueEligible(t))
    : []
  const unclaimedSupportBoard = new Set(
    boards.filter(b => b.allTasksToSupportQueue).map(b => b.id),
  )
  const thisMonth = new Date().toISOString().slice(0, 7)
  const hoursThisMonth = displayTasks
    .flatMap(t => t.timeEntries)
    .filter(e => e.date.startsWith(thisMonth))
    .reduce((sum, e) => sum + e.hours + e.minutes / 60, 0)

  const MY_COLS = COLUMNS.filter(c => c.id !== 'archived')

  function assignedBadge(task: Task): TaskBadge {
    if (task.status === 'done')
      return { label: tr('ממתין לסגירה', 'Pending closure'), cls: 'bg-orange-100 text-orange-700 border border-orange-100' }
    return { label: tr('משויך אליך', 'Assigned to you'), cls: 'bg-blue-50 text-blue-600 border border-blue-100' }
  }

  const hasAnyTasks = displayTasks.length > 0

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
        {([
          { label: tr('המשימות שלי', 'My Tasks'),   value: displayTasks.length, sub: tr('משויכות אליך', 'assigned to you'), cls: 'text-primary' },
          { label: tr('באיחור', 'Overdue'),          value: overdueTasks.length, sub: tr('עבר תאריך היעד', 'past due date'), cls: overdueTasks.length > 0 ? 'text-red-600' : 'text-gray-300', bg: overdueTasks.length > 0 ? 'bg-red-50 border-red-200' : undefined },
          { label: tr('החודש', 'This Month'),        value: hoursThisMonth,      sub: tr('שעות שנרשמו', 'hours logged'),     cls: 'text-primary', isHours: true },
        ] as const).map(({ label, value, sub, cls, bg, isHours }) => (
          <div key={label} className={`border rounded-xl p-4 shadow-sm ${bg ?? 'bg-white border-gray-100'}`}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-2xl font-bold ${cls}`}>{isHours ? fmtHours(value as number) : value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Active timer banner */}
      {activeTimer && (
        <button
          onClick={() => onOpenTask(activeTimer.taskId)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-xl text-sm font-medium text-primary hover:bg-primary/20 transition-colors animate-pulse shrink-0 text-right"
        >
          <Clock size={14} className="shrink-0 animate-none" />
          <span>{tr('שעון פעיל', 'Active timer')}: {activeTimer.taskTitle}</span>
        </button>
      )}

      {/* Alerts */}
      {(pendingClose.length > 0 || overdueTasks.length > 0 || unclaimed.length > 0) && (
        <div className="flex flex-col gap-2 shrink-0">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{tr('התראות', 'Alerts')}</p>

          {pendingClose.map(t => (
            <button key={t.id} onClick={() => onOpenTask(t.id)}
              className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5 hover:bg-orange-100 transition-colors text-left w-full"
            >
              <CheckCircle2 size={14} className="text-orange-500 shrink-0" />
              <span className="text-[10px] font-mono text-orange-400 shrink-0">{t.id}</span>
              <span className="text-sm font-medium text-orange-800 flex-1 truncate">{t.title}</span>
              <ClientBadge name={t.clientName} />
              <span className="text-[9px] bg-orange-200 text-orange-800 px-1.5 py-0.5 rounded font-bold shrink-0">
                {tr('ממתין לסגירה', 'Pending closure')}
              </span>
            </button>
          ))}

          {overdueTasks.map(t => (
            <button key={t.id} onClick={() => onOpenTask(t.id)}
              className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 hover:bg-red-100 transition-colors text-left w-full"
            >
              <AlertCircle size={14} className="text-red-500 shrink-0" />
              <span className="text-[10px] font-mono text-red-400 shrink-0">{t.id}</span>
              <span className="text-sm font-medium text-red-800 flex-1 truncate">{t.title}</span>
              <ClientBadge name={t.clientName} />
              <span className="text-[10px] text-red-500 shrink-0">{tr('עד', 'Due')} {fmtDate(t.dueDate!)}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${STATUS_PILL[t.status]}`}>
                {tr(STATUS_LABEL_HE[t.status] ?? STATUS_LABEL[t.status], STATUS_LABEL[t.status])}
              </span>
            </button>
          ))}

          {unclaimed.map(t => {
            const urgent = !unclaimedSupportBoard.has(t.board)
            return (
              <button key={t.id} onClick={() => onOpenTask(t.id)}
                className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5 hover:bg-orange-100 transition-colors text-left w-full"
              >
                {urgent
                  ? <AlertCircle size={14} className="text-red-500 shrink-0" />
                  : <Ticket      size={14} className="text-orange-500 shrink-0" />}
                <span className="text-[10px] font-mono text-orange-400 shrink-0">{t.id}</span>
                <span className="text-sm font-medium text-orange-800 flex-1 truncate">{t.title}</span>
                <ClientBadge name={t.clientName} />
                {urgent && (
                  <span className="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded font-bold shrink-0">
                    {resolveTaskPriority(t, boards)?.label ?? tr('דחוף', 'Urgent')}
                  </span>
                )}
                <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold animate-pulse shrink-0">{tr('לא נתבע', 'UNCLAIMED')}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Board */}
      {!hasAnyTasks ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
            <User size={26} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-500">{tr('אין משימות המשויכות אליך', 'No tasks assigned to you')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto pb-4">

          {/* Assigned + status-routed tasks, grouped by status. A task
              routed to you by status ownership sits in the same
              grouping as your own assigned tasks — not a separate
              queue — with a badge explaining why it's here. */}
          {displayTasks.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">{tr('המשימות שלי', 'My Tasks')}</p>
              {MY_COLS.map(col => {
                const colTasks = displayTasks.filter(t => t.status === col.id)
                if (colTasks.length === 0) return null
                return (
                  <MyStatusSection
                    key={col.id}
                    col={col}
                    tasks={colTasks}
                    boards={boards}
                    onCardClick={onOpenTask}
                    getBadge={task => statusBadgeMap.get(task.id) ?? assignedBadge(task)}
                    canEditTask={canEditTask}
                    eligibleAssigneesFor={eligibleAssigneesFor}
                    onTaskSaved={onTaskSaved}
                    canMoveTask={canMoveTask}
                    onMoveClick={setMovingTask}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {movingTask && (
        <MoveTaskModal
          task={movingTask}
          sourceBoardName={boards.find(b => b.id === movingTask.board)?.name ?? movingTask.board}
          eligibleBoards={boards.filter(b => b.id !== movingTask.board && canMoveTask({ ...movingTask, board: b.id }))}
          profiles={allProfiles}
          onClose={() => setMovingTask(null)}
          onMoved={updated => { onTaskSaved(updated); setMovingTask(null) }}
        />
      )}
    </div>
  )
}
