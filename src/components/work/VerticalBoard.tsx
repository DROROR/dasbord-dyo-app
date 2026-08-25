import { useState, useMemo } from 'react'
import { Search, X, Calendar, Clock, ChevronDown, Plus, ArrowRightLeft } from 'lucide-react'
import type { Task, Board, BoardStatus, AssigneeOption, PriorityDef } from '../../types/work'
import { DEFAULT_BOARD_STATUSES, priorityDefsForBoard } from '../../data/workConstants'
import { PriorityQuickEdit, AssigneeQuickEdit } from './TaskQuickEdit'
import { ClientBadge } from './ClientBadge'
import { MoveTaskModal } from './MoveTaskModal'
import { TaskPlatformBadges } from './TaskPlatforms'
import { useWorkLang } from '../../contexts/WorkLanguageContext'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
function fmtCreatedAt(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtHours(h: number) {
  if (h === 0) return '0h'
  const hrs = Math.floor(h)
  const min = Math.round((h - hrs) * 60)
  return min > 0 ? `${hrs}h ${min}m` : `${hrs}h`
}
function entryTotal(entries: import('../types/work').TimeEntry[]) {
  return entries.reduce((s, e) => s + e.hours + e.minutes / 60, 0)
}
function isOverdue(due?: string) {
  return !!due && new Date(due) < new Date()
}

// A stable identity for grouping/filtering by client even for legacy
// tasks that only ever got a clientName snapshot with no clientId —
// namespaced so a real client UUID can never collide with a raw name
// string used as the fallback key.
function clientFilterKey(t: Task): string | null {
  if (t.clientId) return `id:${t.clientId}`
  if (t.clientName) return `name:${t.clientName}`
  return null
}

const NO_CLIENT = '__none__'

// ─── TaskCard ─────────────────────────────────────────────────────────────────

function TaskCard({
  task, priorityDefs, statusDef, onClick, canEdit, eligibleAssignees, onTaskSaved, canMove, onMoveClick,
}: {
  task: Task
  /** This task's OWN board's priorities — never a cross-board merged map. */
  priorityDefs: PriorityDef[]
  statusDef?: BoardStatus
  onClick: () => void
  /** Whether the current user may update this task under the server's RLS policy — gates the quick-edit controls only; read-only users still see the badges. */
  canEdit: boolean
  eligibleAssignees: AssigneeOption[]
  onTaskSaved: (updated: Task) => void
  /** Mirrors "tasks: delete"'s formula (work:'full' AND board:'full' on this task's current board) — same bar move_task_to_board() itself requires for the source board. */
  canMove: boolean
  onMoveClick: (task: Task) => void
}) {
  const overdue   = isOverdue(task.dueDate)
  const unclaimed = task.board === 'support' && task.claimed === false

  return (
    // A div, not a button: the priority/assignee quick-edit controls
    // below are themselves real <button>s, and nesting interactive
    // buttons inside a button is invalid HTML with inconsistent click
    // behavior across browsers. role="button" + onKeyDown keeps the
    // whole card keyboard-activatable exactly like before.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      style={{ padding: '12px 14px', minHeight: '80px' }}
      className="flex flex-col gap-2 w-full bg-white hover:bg-gray-50/80 border border-gray-100 rounded-lg text-left transition-colors shadow-sm hover:shadow hover:border-gray-200 cursor-pointer"
    >
      {/* Row 1 — title + badges */}
      <div className="flex items-start gap-2 w-full min-w-0">
        <span className="flex-1 text-[14px] font-medium text-gray-800 leading-snug min-w-0 text-left">
          {task.title}
        </span>
        {unclaimed && (
          <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold animate-pulse shrink-0">
            UNCLAIMED
          </span>
        )}
        {canMove && (
          <button
            onClick={e => { e.stopPropagation(); onMoveClick(task) }}
            title="Move to another board"
            className="p-1 rounded-lg text-gray-400 hover:bg-primary/10 hover:text-primary transition-colors shrink-0"
          >
            <ArrowRightLeft size={13} />
          </button>
        )}
        <ClientBadge name={task.clientName} />
      </div>

      <TaskPlatformBadges platforms={task.platforms} />

      {/* Row 2 — status + priority (quick-edit), then id + meta + assignee (quick-edit) */}
      <div className="flex items-center gap-2 w-full flex-wrap">
        {statusDef && (
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg shrink-0 ${statusDef.pillCls}`}>
            {statusDef.label}
          </span>
        )}
        <PriorityQuickEdit task={task} priorityDefs={priorityDefs} canEdit={canEdit} onSaved={onTaskSaved} />
        <span className="text-[10px] font-mono text-gray-400 shrink-0">{task.id}</span>
        <div className="flex-1" />
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-gray-500" title="Task creation date and time">
          <Clock size={9} /> Created {fmtCreatedAt(task.createdAt)}
        </span>
        {task.dueDate && (
          <span className={`text-[10px] flex items-center gap-0.5 shrink-0 ${overdue ? 'text-red-500 font-semibold' : 'text-gray-500'}`}>
            <Calendar size={9} />
            {fmtDate(task.dueDate)}
          </span>
        )}
        {entryTotal(task.timeEntries) > 0 && (
          <span className="text-[10px] text-gray-400 flex items-center gap-0.5 shrink-0">
            <Clock size={9} />
            {fmtHours(entryTotal(task.timeEntries))}
          </span>
        )}
        <AssigneeQuickEdit task={task} eligible={eligibleAssignees} canEdit={canEdit} onSaved={onTaskSaved} />
      </div>
    </div>
  )
}

// ─── StatusSection ────────────────────────────────────────────────────────────

function StatusSection({
  col, tasks, boards, onCardClick, onAddTask, defaultOpen, readonly, canEditTask, eligibleAssigneesFor, onTaskSaved, canMoveTask, onMoveClick,
}: {
  col: BoardStatus
  tasks: Task[]
  boards: Board[]
  onCardClick: (id: string) => void
  onAddTask: (statusId: string) => void
  defaultOpen: boolean
  readonly?: boolean
  canEditTask: (task: Task) => boolean
  eligibleAssigneesFor: (task: Task) => AssigneeOption[]
  onTaskSaved: (updated: Task) => void
  canMoveTask: (task: Task) => boolean
  onMoveClick: (task: Task) => void
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`border-l-2 rounded-lg shadow-sm ${col.leftBorderCls} bg-white`}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 w-full px-4 py-2.5 bg-gray-50/80 hover:bg-gray-100/60 transition-colors text-left border-b border-gray-100 rounded-t-lg"
      >
        <ChevronDown size={13} className={`text-gray-500 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`} />
        <span className={`text-xs font-bold px-3 py-1 rounded-full ${col.pillCls}`}>
          {col.label}
        </span>
        <span className="text-xs font-bold text-gray-500 bg-white border border-gray-200 rounded-full px-1.5 min-w-[20px] text-center">
          {tasks.length}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 p-2 pb-2" style={{ minHeight: '100px' }}>
          {tasks.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-[11px] text-gray-400 select-none py-2">
              No tasks
            </div>
          )}
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              priorityDefs={priorityDefsForBoard(boards.find(b => b.id === task.board))}
              statusDef={col}
              onClick={() => onCardClick(task.id)}
              canEdit={canEditTask(task)}
              eligibleAssignees={eligibleAssigneesFor(task)}
              onTaskSaved={onTaskSaved}
              canMove={canMoveTask(task)}
              onMoveClick={onMoveClick}
            />
          ))}
          {!readonly && (
            <button
              onClick={() => onAddTask(col.id)}
              style={{ minHeight: '40px', marginBottom: '8px' }}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-[13px] font-bold text-primary border border-primary/30 rounded-xl bg-primary/5 hover:bg-primary/10 hover:border-primary/60 transition-all mt-1"
            >
              <Plus size={14} /> Add task
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── VerticalBoard ────────────────────────────────────────────────────────────

export function VerticalBoard({
  tasks, boards, activeBoardId, onOpenTask, onAddTask, assignees, readonly,
  canEditTask, eligibleAssigneesFor, onTaskSaved, onBoardFilterChange,
  canMoveTask, profiles,
}: {
  /** Every task the caller wants considered — the internal Board filter (below) narrows this further; this is deliberately NOT pre-filtered to one board so "All Boards" has real data to show. */
  tasks: Task[]
  /** Every board the current user can access — drives the Board filter's options, per-task priority/status resolution, and (in "All Boards" mode) the deduplicated status-section union. */
  boards: Board[]
  /** The board currently selected via the outer board tabs — the Board filter starts synced to this and reports specific-board selections back via onBoardFilterChange, so the tabs and this dropdown are one coherent source of truth, never two independent filters. */
  activeBoardId: string
  onOpenTask: (id: string) => void
  onAddTask: (statusId: string) => void
  assignees: string[]
  readonly?: boolean
  /** Mirrors the server's "tasks: update" RLS policy exactly — gates quick-edit only, never a security boundary on its own. */
  canEditTask: (task: Task) => boolean
  eligibleAssigneesFor: (task: Task) => AssigneeOption[]
  onTaskSaved: (updated: Task) => void
  /** Fired only when the Board filter is set to one specific board (never for "All Boards") — lets the caller keep the outer board tabs / New Task target in sync. */
  onBoardFilterChange: (boardId: string) => void
  /** Mirrors "tasks: delete"'s formula (work:'full' AND board:'full' on the task's current board) — gates the "Move to another board" quick action and the modal's own source-side check. */
  canMoveTask: (task: Task) => boolean
  /** Active profiles + isOwner flag, used by the move modal to resolve assignee eligibility on whichever destination board is picked. */
  profiles: { id: string; name: string; isOwner: boolean }[]
}) {
  const { t: tr } = useWorkLang()
  const [movingTask, setMovingTask] = useState<Task | null>(null)
  const [search,       setSearch]       = useState('')
  const [assignee,     setAssignee]     = useState('')
  const [priority,     setPriority]     = useState('')
  const [client,       setClient]       = useState('')
  const [boardFilter,  setBoardFilter]  = useState(activeBoardId)
  const [showArchived, setShowArchived] = useState(false)

  // Keeps this dropdown in sync when the board is changed from OUTSIDE
  // (clicking one of the existing board tabs) — adjusted during render
  // (React's own recommended pattern for "reset state when a prop
  // changes", see https://react.dev/learn/you-might-not-need-an-effect)
  // rather than in a useEffect, so it can't trigger the extra
  // render-then-effect-then-render cascade a setState-in-effect would.
  // One-directional and loop-safe: picking "All Boards" never touches
  // activeBoardId (see onBoardFilterChange below), so this only ever
  // fires in response to a genuine external tab change, not its own
  // writes.
  const [prevActiveBoardId, setPrevActiveBoardId] = useState(activeBoardId)
  if (activeBoardId !== prevActiveBoardId) {
    setPrevActiveBoardId(activeBoardId)
    setBoardFilter(activeBoardId)
  }

  function changeBoardFilter(next: string) {
    setBoardFilter(next)
    if (next) onBoardFilterChange(next) // "" ("All Boards") never forces a tab/target-board change
  }

  const activeBoardObj = boardFilter ? boards.find(b => b.id === boardFilter) : undefined

  // Board-scoped priority options for the Priority filter dropdown —
  // the single active board's own list when one is selected; when
  // "All Boards" is selected, a deduplicated-by-id union across every
  // accessible board, for enumeration only (each card's own priority
  // is still always resolved from ITS OWN task's board — see
  // priorityDefs in StatusSection above — never from this union).
  const priorityFilterOptions = useMemo(() => {
    if (activeBoardObj) return priorityDefsForBoard(activeBoardObj)
    return Array.from(new Map(boards.flatMap(b => priorityDefsForBoard(b)).map(p => [p.id, p])).values())
  }, [activeBoardObj, boards])

  // Status sections: the single active board's own statuses when one
  // is selected (unchanged, exact behavior); a deduplicated-by-id
  // union across every accessible board's statuses when "All Boards"
  // is selected, so a task is never silently dropped just because its
  // status id happens to only exist on its own board's config — the
  // one disclosed tradeoff is that a status id shared by two boards
  // with different labels shows whichever board's label the union
  // happened to keep, informational only, same accepted tradeoff as
  // the priority-filter union above.
  const statuses = useMemo(() => {
    if (activeBoardObj) return activeBoardObj.statuses ?? DEFAULT_BOARD_STATUSES
    return Array.from(new Map(boards.flatMap(b => b.statuses ?? []).map(s => [s.id, s])).values())
  }, [activeBoardObj, boards])

  // Client filter options — derived only from the tasks already loaded
  // (RLS-filtered) into this page, per the explicit instruction not to
  // fetch or expose clients the user can't otherwise see via their
  // accessible tasks.
  const clientOptions = useMemo(() => {
    const map = new Map<string, string>()
    tasks.forEach(t => {
      const key = clientFilterKey(t)
      if (key && t.clientName) map.set(key, t.clientName)
    })
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [tasks])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return tasks.filter(t => {
      if (!showArchived && t.status === 'archived') return false
      if (boardFilter && t.board !== boardFilter) return false
      if (q && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false
      if (assignee && t.assignee !== assignee) return false
      if (priority && t.priority !== priority) return false
      if (client) {
        const key = clientFilterKey(t)
        if (client === NO_CLIENT ? key !== null : key !== client) return false
      }
      return true
    })
  }, [tasks, search, assignee, priority, client, boardFilter, showArchived])

  const visibleStatuses = statuses
    .filter(s => showArchived ? true : s.id !== 'archived')
    .sort((a, b) => a.order - b.order)

  const anyFilterActive = search || assignee || priority || client || boardFilter

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full pl-9 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition placeholder:text-gray-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-500">
              <X size={12} />
            </button>
          )}
        </div>
        <select
          value={boardFilter}
          onChange={e => changeBoardFilter(e.target.value)}
          title={tr('בורד', 'Board')}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition"
        >
          <option value="">{tr('כל הבורדים', 'All Boards')}</option>
          {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select
          value={assignee}
          onChange={e => setAssignee(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition"
        >
          <option value="">All assignees</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={priority}
          onChange={e => setPriority(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition"
        >
          <option value="">All priorities</option>
          {priorityFilterOptions.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <select
          value={client}
          onChange={e => setClient(e.target.value)}
          title={tr('לקוח', 'Client')}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition"
        >
          <option value="">{tr('כל הלקוחות', 'All Clients')}</option>
          <option value={NO_CLIENT}>{tr('ללא לקוח', 'No Client')}</option>
          {/* Client names are stored data — never translated. */}
          {clientOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
        <button
          onClick={() => setShowArchived(s => !s)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showArchived ? 'bg-gray-200 text-gray-700 border-gray-300' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
        >
          {showArchived ? 'Hide Archived' : 'Show Archived'}
        </button>
        {anyFilterActive && (
          <button onClick={() => { setSearch(''); setAssignee(''); setPriority(''); setClient(''); changeBoardFilter('') }} className="flex items-center gap-1 text-sm text-gray-500 hover:text-primary transition-colors">
            <X size={12} /> Clear
          </button>
        )}
        <div className="flex-1" />
        <span className="text-xs text-gray-500 shrink-0">{filtered.length} task{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Vertical sections */}
      <div className="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0 pb-6">
        {visibleStatuses.map(col => (
          <StatusSection
            key={col.id}
            col={col}
            tasks={filtered.filter(t => t.status === col.id)}
            boards={boards}
            onCardClick={onOpenTask}
            onAddTask={onAddTask}
            defaultOpen={col.id !== 'done' && col.id !== 'archived'}
            // "Add task" always creates on one specific target board
            // (see addTaskWithStatus in Work.tsx) — in "All Boards"
            // mode a status column can be a union across boards with
            // genuinely different status configs, so there is no safe
            // single board to create into from here. Hidden in that
            // case regardless of the caller's own readonly value,
            // never just disabled-looking.
            readonly={readonly || !boardFilter}
            canEditTask={canEditTask}
            eligibleAssigneesFor={eligibleAssigneesFor}
            onTaskSaved={onTaskSaved}
            canMoveTask={canMoveTask}
            onMoveClick={setMovingTask}
          />
        ))}
      </div>

      {movingTask && (
        <MoveTaskModal
          task={movingTask}
          sourceBoardName={boards.find(b => b.id === movingTask.board)?.name ?? movingTask.board}
          // canMoveTask only inspects task.board (see its definition in
          // Work.tsx) — probing it with the candidate board substituted
          // in reproduces the exact same work:'full' AND board:'full'
          // formula per destination board without a second prop.
          eligibleBoards={boards.filter(b => b.id !== movingTask.board && canMoveTask({ ...movingTask, board: b.id }))}
          profiles={profiles}
          onClose={() => setMovingTask(null)}
          onMoved={updated => { onTaskSaved(updated); setMovingTask(null) }}
        />
      )}
    </div>
  )
}
