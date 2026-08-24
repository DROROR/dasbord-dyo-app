import { useState, useMemo, useEffect } from 'react'
import { AlertCircle, Ticket, User, Calendar, Clock, ChevronDown, CheckCircle2, ArrowRightLeft } from 'lucide-react'
import type { Task, Board, TimeEntry, AssigneeOption } from '../../types/work'
import { eligibleAssigneesForBoard } from '../../types/work'
import { STATUS_PILL, STATUS_LABEL, STATUS_LABEL_HE, STATUS_LEFT, resolveTaskPriority, priorityDefsForBoard } from '../../data/workConstants'
import { useWorkLang } from '../../contexts/WorkLanguageContext'
import { PriorityQuickEdit, AssigneeQuickEdit } from './TaskQuickEdit'
import { ClientBadge } from './ClientBadge'
import { MoveTaskModal } from './MoveTaskModal'
import { TaskPlatformBadges } from './TaskPlatforms'

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

function normalizedStatus(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function taskMatchesStatus(t: Task, boards: Board[], stableId: string, label: string): boolean {
  if (t.status === stableId) return true
  const status = boards.find(b => b.id === t.board)?.statuses.find(s => s.id === t.status)
  return normalizedStatus(status?.label ?? '') === normalizedStatus(label)
    || normalizedStatus(t.status).startsWith(`${normalizedStatus(stableId)}_`)
}

type TaskBadge = { label: string; cls: string }
type TaskGroup = { id: string; label: string; tasks: Task[]; boardLabel?: string }

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
      className="flex items-center gap-3 w-full px-4 py-3 bg-white hover:bg-gray-50 border-b border-gray-100 text-left transition-colors last:border-b-0 cursor-pointer"
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-gray-900">{task.title}</span>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[9px] font-mono text-gray-400 truncate">{task.id}</span>
          <TaskPlatformBadges platforms={task.platforms} />
        </div>
      </div>
      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_PILL[task.status] ?? 'bg-gray-100 text-gray-600'}`}>
        {STATUS_LABEL[task.status] ?? task.status}
      </span>
      <ClientBadge name={task.clientName} />
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 whitespace-nowrap ${badge.cls}`}>
          {badge.label}
        </span>
      )}
      <PriorityQuickEdit task={task} priorityDefs={priorityDefs} canEdit={canEdit} onSaved={onTaskSaved} />
      {task.dueDate && (
        <span className={`text-[10px] flex items-center gap-0.5 shrink-0 ${overdue ? 'text-red-500 font-semibold' : 'text-gray-500'}`}>
          <Calendar size={9} />{fmtDate(task.dueDate)}
        </span>
      )}
      {entryTotal(task.timeEntries) > 0 && (
        <span className="text-[10px] text-gray-400 flex items-center gap-0.5 shrink-0">
          <Clock size={9} />{fmtHours(entryTotal(task.timeEntries))}
        </span>
      )}
      <AssigneeQuickEdit task={task} eligible={eligibleAssignees} canEdit={canEdit} onSaved={onTaskSaved} />
      {canMove && (
        <button
          onClick={e => { e.stopPropagation(); onMoveClick(task) }}
          title="Move to another board"
          className="p-1 rounded-lg text-gray-400 hover:bg-primary/10 hover:text-primary transition-colors shrink-0"
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
  const { t: tr } = useWorkLang()
  const [open, setOpen] = useState(col.id !== 'done' && col.id !== 'archived')
  // col.label is always one of MyBoard's own fixed built-in status-group
  // headers (see MY_COLS = COLUMNS.filter(...) below) — never a specific
  // board's live, admin-renamed status label — so translating it here is
  // safe UI localization, not touching user/admin content.
  const label = tr(STATUS_LABEL_HE[col.id] ?? col.label, col.label)
  return (
    <div className={`h-full flex flex-col border-l-2 rounded-xl overflow-hidden ${STATUS_LEFT[col.id] ?? 'border-l-gray-300'} bg-white`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 w-full px-4 py-2.5 bg-gray-50/80 hover:bg-gray-100/60 transition-colors text-left border-b border-gray-100"
      >
        <ChevronDown size={13} className={`text-gray-500 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`} />
        <span className={`text-sm font-bold px-3 py-1 rounded-lg ${STATUS_PILL[col.id] ?? 'bg-gray-100 text-gray-700'}`}>
          {label}
        </span>
        <span className="text-xs font-bold text-gray-500 bg-white border border-gray-200 rounded-full px-1.5 min-w-[20px] text-center">
          {tasks.length}
        </span>
      </button>
      {open && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {tasks.length === 0 ? (
            <div className="text-[11px] text-gray-400 text-center py-4 select-none">{tr('אין משימות', 'No tasks')}</div>
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
  tasks, boards, currentUser, myProfileId, onOpenTask,
  isTechnicalSupport = false, activeProfileIds, canEditTask, allProfiles, onTaskSaved, canMoveTask,
}: {
  tasks: Task[]
  boards: Board[]
  /** Display-name fallback, used only when a task has no assigneeId yet (see isMine). */
  currentUser: string
  /** The authenticated user's profile UUID — authoritative once a task has assigneeId set. */
  myProfileId?: string
  onOpenTask: (id: string) => void
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
  const { t: tr } = useWorkLang()
  const [movingTask, setMovingTask] = useState<Task | null>(null)

  // Status routing is additive: the task always stays visible to its original
  // assignee, while the status owner receives a second view of the same task.
  const myTasks = useMemo(
    () => tasks.filter(t => isMine(t, myProfileId, currentUser)),
    [tasks, myProfileId, currentUser],
  )

  // Status responsibility outranks ordinary assignment on My Board. This
  // deliberately includes tasks also assigned directly to the viewer: if the
  // current status belongs to them, it still belongs in their prominent queue.
  const statusResponsibilityTasks = useMemo(() => tasks.filter(t => {
    if (!myProfileId) return false
    if (t.status === 'done' || t.status === 'archived') return false
    return statusOwnerIdOf(boards, t, activeProfileIds) === myProfileId
  }), [tasks, boards, myProfileId, activeProfileIds])

  const statusResponsibilityTaskIds = useMemo(
    () => new Set(statusResponsibilityTasks.map(t => t.id)),
    [statusResponsibilityTasks],
  )

  // The original assignee keeps the task, but does not see a duplicate lower
  // down when its current status is also their own responsibility.
  const regularAssignedTasks = useMemo(
    () => myTasks.filter(t => !statusResponsibilityTaskIds.has(t.id)),
    [myTasks, statusResponsibilityTaskIds],
  )

  // A collaborator sees the full parent task, not an isolated child card.
  // Main assignees/status owners take precedence so one task never appears in
  // two personal-board groups for the same employee.
  const collaborationTasks = useMemo(() => tasks.filter(t => {
    if (!myProfileId) return false
    if (isMine(t, myProfileId, currentUser)) return false
    if (statusOwnerIdOf(boards, t, activeProfileIds) === myProfileId) return false
    if (t.status === 'done' || t.status === 'archived') return false
    return (t.subtasks ?? []).some(s => s.assigneeId === myProfileId && s.status !== 'done')
  }), [tasks, boards, myProfileId, currentUser, activeProfileIds])

  const displayTasks = useMemo(() => {
    const byId = new Map<string, Task>()
    ;[...myTasks, ...statusResponsibilityTasks, ...collaborationTasks].forEach(t => byId.set(t.id, t))
    return [...byId.values()]
  }, [myTasks, statusResponsibilityTasks, collaborationTasks])

  // Badge label map for status-routed tasks
  const statusBadgeMap = useMemo(() => {
    const map = new Map<string, TaskBadge>()
    statusResponsibilityTasks.forEach(t => {
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
  }, [statusResponsibilityTasks, boards, tr])

  const collaborationBadgeMap = useMemo(() => {
    const map = new Map<string, TaskBadge>()
    collaborationTasks.forEach(t => {
      const mine = (t.subtasks ?? []).filter(s => s.assigneeId === myProfileId && s.status !== 'done')
      map.set(t.id, {
        label: mine.length === 1
          ? mine[0].title
          : tr(`${mine.length} תת־משימות שלך`, `${mine.length} assigned subtasks`),
        cls: 'bg-cyan-50 text-cyan-700 border border-cyan-100',
      })
    })
    return map
  }, [collaborationTasks, myProfileId, tr])

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
  // Personal total follows the logger UUID across every visible task, even
  // after a collaboration subtask is completed and leaves the action tiles.
  const hoursThisMonth = tasks
    .flatMap(t => t.timeEntries)
    .filter(e => e.date.startsWith(thisMonth))
    .filter(e => e.loggedById ? e.loggedById === myProfileId : e.loggedBy === currentUser)
    .reduce((sum, e) => sum + e.hours + e.minutes / 60, 0)

  const timeLoggedTasksThisMonth = tasks.filter(task =>
    task.timeEntries.some(entry =>
      entry.date.startsWith(thisMonth)
      && (entry.loggedById ? entry.loggedById === myProfileId : entry.loggedBy === currentUser),
    ),
  )

  const statusResponsibilityGroups: TaskGroup[] = boards.flatMap(board =>
    board.statuses
      .filter(status => !!myProfileId && !!status.ownerId && status.ownerId === myProfileId && (!activeProfileIds || activeProfileIds.has(status.ownerId)))
      .map(status => ({
        id: `responsibility:${board.id}:${status.id}`,
        label: status.label,
        boardLabel: board.name,
        tasks: statusResponsibilityTasks.filter(t => t.board === board.id && t.status === status.id),
      }))
      .filter(group => group.tasks.length > 0),
  )

  // A task assigned to me but currently sitting in somebody else's owned
  // status is information to track, not work waiting for me. Pending reviews
  // remain tracking statuses even on boards where no owner was configured.
  const pendingCodeTasks = regularAssignedTasks.filter(t => taskMatchesStatus(t, boards, 'pending_code_review', 'Pending Code Review'))
  const pendingUxTasks = regularAssignedTasks.filter(t => taskMatchesStatus(t, boards, 'pending_ux_review', 'Pending UI/UX Review'))
  const delegatedTrackingTasks = regularAssignedTasks.filter(t => {
    const ownerId = statusOwnerIdOf(boards, t, activeProfileIds)
    return !!ownerId && ownerId !== myProfileId
  })
  const trackingTaskIds = new Set([
    ...pendingCodeTasks,
    ...pendingUxTasks,
    ...delegatedTrackingTasks,
  ].map(t => t.id))
  const actionEligibleTasks = regularAssignedTasks.filter(t => !trackingTaskIds.has(t.id))

  const actionGroups: TaskGroup[] = [
    { id: 'in_progress', label: tr('בתהליך', 'In Progress'), tasks: actionEligibleTasks.filter(t => taskMatchesStatus(t, boards, 'in_progress', 'In Progress')) },
    { id: 'fixing', label: tr('תיקונים / סבב', 'Fixing / Round'), tasks: actionEligibleTasks.filter(t => taskMatchesStatus(t, boards, 'fixing', 'Fixing / Round')) },
    { id: 'to_deploy', label: 'To Deploy', tasks: actionEligibleTasks.filter(t => taskMatchesStatus(t, boards, 'to_deploy', 'To Deploy')) },
    { id: 'collaboration', label: tr('משימות שיתופיות', 'Collaboration Tasks'), tasks: collaborationTasks },
    { id: 'not_started', label: tr('טרם התחיל', 'Not Started'), tasks: actionEligibleTasks.filter(t => taskMatchesStatus(t, boards, 'not_started', 'Not Started')) },
  ].filter(group => group.tasks.length > 0)

  const delegatedTrackingGroups: TaskGroup[] = boards.flatMap(board =>
    board.statuses.map(status => ({
      id: `tracking:${board.id}:${status.id}`,
      label: status.label,
      boardLabel: board.name,
      tasks: delegatedTrackingTasks.filter(t =>
        t.board === board.id
        && t.status === status.id
        && !pendingCodeTasks.some(reviewTask => reviewTask.id === t.id)
        && !pendingUxTasks.some(reviewTask => reviewTask.id === t.id),
      ),
    })).filter(group => group.tasks.length > 0),
  )

  const trackingGroups: TaskGroup[] = [
    { id: 'pending_code_review', label: tr('ממתין לבדיקת קוד', 'Pending Code Review'), tasks: pendingCodeTasks },
    { id: 'pending_ux_review', label: tr('ממתין לבדיקת UI/UX', 'Pending UI/UX Review'), tasks: pendingUxTasks },
    ...delegatedTrackingGroups,
  ].filter(group => group.tasks.length > 0)

  const summaryGroups: TaskGroup[] = [
    { id: 'summary:my-tasks', label: tr('המשימות שלי', 'My Tasks'), tasks: displayTasks },
    { id: 'summary:overdue', label: tr('משימות באיחור', 'Overdue Tasks'), tasks: overdueTasks },
    { id: 'summary:working-time', label: tr('משימות עם זמן עבודה החודש', 'Tasks worked on this month'), tasks: timeLoggedTasksThisMonth },
  ]
  const allGroups = [...statusResponsibilityGroups, ...actionGroups, ...trackingGroups]
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const selectedGroup = [...summaryGroups, ...allGroups].find(g => g.id === selectedGroupId) ?? allGroups[0] ?? summaryGroups[0]
  const activeGroupId = selectedGroup?.id ?? ''

  function assignedBadge(task: Task): TaskBadge {
    if (task.status === 'done')
      return { label: tr('ממתין לסגירה', 'Pending closure'), cls: 'bg-orange-100 text-orange-700 border border-orange-100' }
    return { label: tr('משויך אליך', 'Assigned to you'), cls: 'bg-blue-50 text-blue-600 border border-blue-100' }
  }

  const hasAnyTasks = displayTasks.length > 0

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
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

      {/* Real personal metrics stay first; alerts and the responsive
          task workspace follow in a stable dashboard hierarchy. */}
      <div className="grid grid-cols-1 gap-3 shrink-0 order-first sm:grid-cols-3">
        {([
          { id: 'summary:my-tasks', label: tr('המשימות שלי', 'My Tasks'),   value: displayTasks.length, sub: tr('משויכות אליך', 'assigned to you'), cls: 'text-primary', bg: 'bg-gradient-to-br from-primary/10 to-white border-primary/20' },
          { id: 'summary:overdue', label: tr('באיחור', 'Overdue'),          value: overdueTasks.length, sub: tr('עבר תאריך היעד', 'past due date'), cls: overdueTasks.length > 0 ? 'text-red-600' : 'text-gray-400', bg: overdueTasks.length > 0 ? 'bg-gradient-to-br from-red-50 to-white border-red-200' : 'bg-gradient-to-br from-gray-50 to-white border-gray-200' },
          { id: 'summary:working-time', label: tr('זמן העבודה שלי', 'My Working Time'), value: hoursThisMonth, sub: tr('סה״כ שעות החודש', 'Total hours this month'), cls: 'text-secondary-dark', bg: 'bg-gradient-to-br from-secondary/15 to-white border-secondary/30', isHours: true },
        ] as const).map(({ id, label, value, sub, cls, bg, isHours }) => (
          <button type="button" key={id} onClick={() => setSelectedGroupId(id)} className={'relative overflow-hidden border rounded-2xl px-4 py-3.5 text-left shadow-[0_4px_18px_rgba(31,50,114,0.06)] transition-all hover:-translate-y-0.5 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 ' + (activeGroupId === id ? 'ring-2 ring-primary/25 border-primary/40 ' : '') + (bg ?? 'bg-white border-gray-100')}>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-2xl font-bold ${cls}`}>{isHours ? fmtHours(value as number) : value}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>
          </button>
        ))}
      </div>

      {/* Personal board status dashboard */}
      {!hasAnyTasks ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
            <User size={26} className="text-gray-400" />
          </div>
          <p className="text-sm font-semibold text-gray-500">{tr('אין משימות המשויכות אליך', 'No tasks assigned to you')}</p>
        </div>
      ) : (
        <div className="grid flex-1 min-h-0 gap-4 overflow-y-auto pb-3 xl:grid-cols-12 xl:overflow-hidden">
          <aside className="flex min-h-0 flex-col gap-3 xl:order-2 xl:col-span-5 xl:overflow-hidden">
      {/* Alerts */}
      {(pendingClose.length > 0 || overdueTasks.length > 0 || unclaimed.length > 0) && (
        <div className="flex min-h-0 flex-[1.55] basis-0 flex-col gap-2 overflow-y-auto rounded-xl border border-gray-200/70 bg-white p-3">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{tr('התראות', 'Alerts')}</p>

          {/* Urgent work and support tickets are always the first actionable
              items on the personal board. */}
          {unclaimed.map(t => {
            const urgent = !unclaimedSupportBoard.has(t.board)
            return (
              <button key={t.id} onClick={() => onOpenTask(t.id)}
                className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 overflow-hidden rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-left transition-colors hover:bg-orange-100"
              >
                {urgent
                  ? <AlertCircle size={14} className="text-red-500 shrink-0" />
                  : <Ticket      size={14} className="text-orange-500 shrink-0" />}
                <span className="min-w-0 truncate text-sm font-semibold text-orange-900">{t.title}</span>
                {urgent && (
                  <span className="row-start-2 col-start-3 text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded font-bold shrink-0">
                    {resolveTaskPriority(t, boards)?.label ?? tr('דחוף', 'Urgent')}
                  </span>
                )}
                <span className="col-start-3 row-start-1 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold shrink-0">{tr('לא נתבע', 'UNCLAIMED')}</span>
                <span className="col-span-2 col-start-1 row-start-2 flex min-w-0 items-center gap-2 overflow-hidden text-[10px] font-mono text-orange-600"><span className="truncate">{t.id}</span><ClientBadge name={t.clientName} /></span>
              </button>
            )
          })}

          {pendingClose.map(t => (
            <button key={t.id} onClick={() => onOpenTask(t.id)}
              className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 overflow-hidden rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-left transition-colors hover:bg-orange-100"
            >
              <CheckCircle2 size={14} className="text-orange-500 shrink-0" />
              <span className="min-w-0 truncate text-sm font-semibold text-orange-900">{t.title}</span>
              <span className="text-[9px] bg-orange-200 text-orange-800 px-1.5 py-0.5 rounded font-bold shrink-0">
                {tr('ממתין לסגירה', 'Pending closure')}
              </span>
              <span className="col-span-2 col-start-1 row-start-2 flex min-w-0 items-center gap-2 overflow-hidden text-[10px] font-mono text-orange-600"><span className="truncate">{t.id}</span><ClientBadge name={t.clientName} /></span>
            </button>
          ))}

          {overdueTasks.map(t => (
            <button key={t.id} onClick={() => onOpenTask(t.id)}
              className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 overflow-hidden rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-left transition-colors hover:bg-red-100"
            >
              <AlertCircle size={14} className="text-red-500 shrink-0" />
              <span className="min-w-0 truncate text-sm font-semibold text-red-900">{t.title}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${STATUS_PILL[t.status]}`}>
                {tr(STATUS_LABEL_HE[t.status] ?? STATUS_LABEL[t.status], STATUS_LABEL[t.status])}
              </span>
              <span className="col-span-2 col-start-1 row-start-2 flex min-w-0 items-center gap-2 overflow-hidden text-[10px] text-red-700"><span className="truncate font-mono">{t.id}</span><ClientBadge name={t.clientName} /><span className="shrink-0">{tr('עד', 'Due')} {fmtDate(t.dueDate!)}</span></span>
            </button>
          ))}

        </div>
      )}
          <div className="flex min-h-0 flex-1 basis-0 flex-col gap-3 overflow-y-auto rounded-xl border border-gray-200/70 bg-white p-3">
          {pendingClose.length === 0 && overdueTasks.length === 0 && unclaimed.length === 0 && statusResponsibilityGroups.length === 0 && actionGroups.length === 0 && trackingGroups.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-green-100 bg-green-50/70 px-4 py-8 text-center">
              <CheckCircle2 size={20} className="mb-2 text-green-600" />
              <p className="text-xs font-semibold text-green-800">{tr('הכל מעודכן', 'Everything is up to date')}</p>
              <p className="mt-0.5 text-[10px] text-green-700/60">{tr('אין התראות או פעולות ממתינות', 'No alerts or pending actions')}</p>
            </div>
          )}
          {statusResponsibilityGroups.length > 0 && (
            <section className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 via-white to-purple-50 p-3">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-bold text-primary">{tr('התורים באחריותך', 'Your Status Queues')}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {tr('המשימות האלה ממתינות עכשיו לטיפול שלך', 'These tasks are waiting for your action now')}
                  </p>
                </div>
                <span className="min-w-9 h-9 px-2 rounded-xl bg-primary text-white flex items-center justify-center text-base font-bold">
                  {statusResponsibilityTasks.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {statusResponsibilityGroups.map(group => {
                  const selected = activeGroupId === group.id
                  return (
                    <button
                      key={group.id}
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${selected ? 'border-primary bg-white ring-2 ring-primary/15' : 'border-primary/20 bg-white/80 hover:border-primary/50'}`}
                    >
                      <span className={`min-w-10 h-10 px-2 rounded-xl flex items-center justify-center text-xl font-bold ${selected ? 'bg-primary text-white' : 'bg-primary/10 text-primary'}`}>
                        {group.tasks.length}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-gray-800 truncate">{group.label}</span>
                        <span className="block text-[10px] text-gray-500 truncate mt-0.5">{group.boardLabel}</span>
                        <span className="block text-[10px] font-semibold text-primary mt-1">{tr('נדרש הטיפול שלך', 'Needs your action')}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {actionGroups.length > 0 && (
            <section className="flex flex-col gap-2 rounded-xl border border-gray-200/70 bg-white p-3">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{tr('נדרש טיפול', 'Needs Action')}</p>
              <div className="grid grid-cols-2 gap-2">
                {actionGroups.map(group => {
                  const selected = activeGroupId === group.id
                  return (
                    <button
                      key={group.id}
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-all ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary/10' : 'border-gray-100 bg-white hover:border-primary/30 hover:bg-gray-50'}`}
                    >
                      <span className={`text-xs font-semibold truncate ${selected ? 'text-primary' : 'text-gray-600'}`}>{group.label}</span>
                      <span className={`min-w-6 h-6 px-1.5 rounded-full flex items-center justify-center text-xs font-bold ${selected ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500'}`}>{group.tasks.length}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {trackingGroups.length > 0 && (
            <section className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{tr('משימות בבדיקה', 'Under Review')}</p>
              <div className="grid grid-cols-1 gap-2">
                {trackingGroups.map(group => {
                  const selected = activeGroupId === group.id
                  return (
                    <button
                      key={group.id}
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-all ${selected ? 'border-purple-300 bg-white' : 'border-gray-100 bg-white/70 hover:border-purple-200'}`}
                    >
                      <span className={`text-xs font-semibold truncate ${selected ? 'text-purple-700' : 'text-gray-500'}`}>{group.label}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        {group.boardLabel && <span className="hidden sm:inline text-[9px] text-gray-500 max-w-28 truncate">{group.boardLabel}</span>}
                        <span className="min-w-6 h-6 px-1.5 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">{group.tasks.length}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          </div>
          </aside>
          <main className="min-h-[260px] rounded-2xl border border-gray-200/70 bg-white shadow-[0_4px_18px_rgba(31,50,114,0.06)] xl:order-1 xl:col-span-7 xl:min-h-0 xl:overflow-hidden">
          {selectedGroup && (
            <MyStatusSection
              key={selectedGroup.id}
              col={{ id: selectedGroup.id, label: selectedGroup.label }}
              tasks={selectedGroup.tasks}
              boards={boards}
              onCardClick={onOpenTask}
              getBadge={task => collaborationBadgeMap.get(task.id) ?? statusBadgeMap.get(task.id) ?? assignedBadge(task)}
              canEditTask={canEditTask}
              eligibleAssigneesFor={eligibleAssigneesFor}
              onTaskSaved={onTaskSaved}
              canMoveTask={canMoveTask}
              onMoveClick={setMovingTask}
            />
          )}
          </main>
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
