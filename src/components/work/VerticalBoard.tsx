import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Calendar, Clock, ChevronDown, Plus, ArrowRightLeft, SlidersHorizontal } from 'lucide-react'
import type { Task, Board, BoardStatus, AssigneeOption, PriorityDef } from '../../types/work'
import { DEFAULT_BOARD_STATUSES, priorityDefsForBoard, ticketKindOf, type TicketKind } from '../../data/workConstants'
import { PriorityQuickEdit, AssigneeQuickEdit } from './TaskQuickEdit'
import { ClientBadge } from './ClientBadge'
import { MoveTaskModal } from './MoveTaskModal'
import { TaskPlatformBadges } from './TaskPlatforms'
import { useWorkLang } from '../../contexts/WorkLanguageContext'
import { ticketLinkOf, ticketKey, adminReplyStatusOf, type AdminChatState, type AdminReplyStatus } from '../../lib/ticketChat'

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
  adminReplyStatus,
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
  /** Where this task's admin thread stands, when it has one and the state is known. Undefined renders no badge at all, which is what an unlinked task — or a ticket the proxy could not read — gets. */
  adminReplyStatus?: AdminReplyStatus
}) {
  const overdue         = isOverdue(task.dueDate)
  const isSupport       = task.board === 'support'
  const unclaimed       = isSupport && task.claimed === false && task.status !== 'done' && task.status !== 'archived'

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
      // A support ticket gets no outline of its own: the pale violet border
      // read as a stray light ring around the card rather than as a label,
      // and the SUPPORT TICKET badge in the title row already says what it
      // is. Every card now carries the same border on every board.
      className="flex flex-col gap-2 w-full bg-white hover:bg-gray-50/80 border border-gray-100 hover:border-gray-200 rounded-lg text-left transition-colors shadow-sm hover:shadow cursor-pointer"
    >
      {/* Row 1 — title + badges */}
      <div className="flex items-start gap-2 w-full min-w-0">
        <span className="flex-1 text-[14px] font-medium text-gray-800 leading-snug min-w-0 text-left">
          {task.title}
        </span>
        {isSupport && (
          <span className="text-[9px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-bold shrink-0">
            SUPPORT TICKET
          </span>
        )}
        {unclaimed && (
          <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold animate-pulse shrink-0">
            UNCLAIMED
          </span>
        )}
        {/* Whether the admin has answered the message we sent — on the card so
            the thread does not have to be opened to find out. A thread with no
            messages in it gets no badge; there is nothing to be waiting for. */}
        {adminReplyStatus === 'awaiting' && (
          <span
            title="We messaged the admin and they have not answered yet"
            className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold shrink-0"
          >
            AWAITING ADMIN
          </span>
        )}
        {adminReplyStatus === 'replied' && (
          <span
            title="The admin answered — their message is the latest in the thread"
            className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold shrink-0"
          >
            ADMIN REPLIED
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
  adminReplyStatusFor,
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
  adminReplyStatusFor: (task: Task) => AdminReplyStatus | undefined
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
        <span className={`text-xs font-bold px-3 py-1 rounded-md ${col.pillCls}`}>
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
              adminReplyStatus={adminReplyStatusFor(task)}
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
  canMoveTask, profiles, search, onSearchChange, ticketKind, onTicketKindChange,
  subBoardTabs = [], onSubBoardChange, adminChatStates = {}, filterSlot,
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
  search: string
  onSearchChange: (value: string) => void
  /**
   * Which of the Support Tickets board's two chips is selected. Undefined
   * whenever that board is not the selected tab, which is what keeps every
   * other board — and this filter — exactly as it was.
   */
  ticketKind?: TicketKind
  /** Selects the other chip. Passed only alongside ticketKind, so a board without chips never renders them. */
  onTicketKindChange?: (kind: TicketKind) => void
  /**
   * The selected top-level board's own tab followed by its sub-boards, already
   * resolved and counted by the caller. Empty for a board with no sub-boards,
   * which is every board until somebody files one under another — then this row
   * renders exactly as it does today.
   */
  subBoardTabs?: { id: string; name: string; count: number }[]
  /** Selects a sub-board (or the parent's own tab); the id is a real board id. */
  onSubBoardChange?: (boardId: string) => void
  /**
   * Where each linked ticket's admin thread stands, keyed by
   * `${appId}/${ticketId}`. Fetched once by the page and passed down; an empty
   * map (nothing fetched yet, or the fetch failed) simply means no badges and
   * an Admin-reply filter that matches nothing, never a wrong answer.
   */
  adminChatStates?: Record<string, AdminChatState>
  /**
   * Where to render the Filters button: an element the page keeps at the end
   * of the board-tabs row. Without one (any other caller) the button falls
   * back to its own row exactly as before.
   */
  filterSlot?: HTMLElement | null
}) {
  const { t: tr } = useWorkLang()
  const [movingTask, setMovingTask] = useState<Task | null>(null)
  const [assignee,     setAssignee]     = useState('')
  const [priority,     setPriority]     = useState('')
  const [client,       setClient]       = useState('')
  // '' is "don't narrow by the admin thread at all" — the default, so every
  // board looks exactly as it did before anybody touches this.
  const [adminReply,   setAdminReply]   = useState<'' | AdminReplyStatus>('')
  // How the cards sit inside each status column. 'default' leaves them in the
  // order they arrive (newest first), exactly as before; 'client' puts one
  // client's cards together, which is what the support board wants when the
  // same app has filed several tickets and the Client filter would only show
  // one app at a time.
  const [sort,         setSort]         = useState<'default' | 'client'>('default')
  // Starts on the board the outer tabs have selected, not on '' ("All
  // Boards"): the sync below only fires when activeBoardId CHANGES, so an
  // empty initial value meant a fresh load showed every board's tasks under
  // whichever board tab was highlighted, until the user switched boards and
  // came back. Picking "All Boards" from the dropdown still works as before.
  const [boardFilter,  setBoardFilter]  = useState(activeBoardId)
  const [showArchived, setShowArchived] = useState(true)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const filterMenuRef = useRef<HTMLDivElement>(null)

  // Closes on a click anywhere outside and on Escape. Bound only while the
  // menu is open, so a board with the menu shut carries no global listeners.
  useEffect(() => {
    if (!filterMenuOpen) return
    function onPointerDown(event: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) setFilterMenuOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setFilterMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [filterMenuOpen])

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

    // In All Boards mode, preserve the current board's configured labels for
    // duplicate stable ids (for example development's critical priority is named
    // "Urgent"). Other boards still contribute ids that are not present
    // there; only display precedence changes, never task data.
    const merged = new Map(boards.flatMap(b => priorityDefsForBoard(b)).map(p => [p.id, p]))
    const preferredBoard = boards.find(board => board.id === activeBoardId)
    priorityDefsForBoard(preferredBoard).forEach(priority => merged.set(priority.id, priority))
    return Array.from(merged.values())
  }, [activeBoardId, activeBoardObj, boards])

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

  // One place that turns a task into its thread state, used by both the
  // filter below and the badge on the card.
  const adminReplyStatusFor = useMemo(() => (task: Task) => {
    const link = ticketLinkOf(task)
    if (!link) return undefined
    return adminReplyStatusOf(adminChatStates[ticketKey(link.appId, link.ticketId)])
  }, [adminChatStates])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return tasks.filter(t => {
      if (!showArchived && t.status === 'archived') return false
      if (boardFilter && t.board !== boardFilter) return false
      // Keyed off the task's own board, NOT boardFilter: that state starts
      // empty ("All Boards") and is only synced from activeBoardId when the
      // board tab actually changes, so on a fresh load — or right after a
      // deploy — it was still '' while the Support board was on screen, and
      // the chips did nothing until the user switched boards and came back.
      // The caller only passes ticketKind while the Support board is the
      // selected tab, which is also the only time the chips are on screen to
      // explain the narrowed list.
      if (ticketKind && t.board === 'support' && ticketKindOf(t) !== ticketKind) return false
      // Only tasks wired to a real ticket thread can answer this one, so a
      // task without one drops out of all three choices rather than piling up
      // under "no messages yet".
      if (adminReply && adminReplyStatusFor(t) !== adminReply) return false
      if (q && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false
      if (assignee && t.assignee !== assignee) return false
      if (priority && t.priority !== priority) return false
      if (client) {
        const key = clientFilterKey(t)
        if (client === NO_CLIENT ? key !== null : key !== client) return false
      }
      return true
    })
  }, [tasks, search, assignee, priority, client, boardFilter, showArchived, ticketKind, adminReply, adminReplyStatusFor])

  // Sorted, never narrowed: every card the filters above left through is still
  // shown, only its place in its own column changes. A card with no client at
  // all sinks below the named ones instead of sorting under an empty string,
  // and two cards of the same client fall back to their titles so the order is
  // stable from one render to the next.
  const ordered = useMemo(() => {
    if (sort !== 'client') return filtered
    return [...filtered].sort((a, b) => {
      const left  = a.clientName ?? ''
      const right = b.clientName ?? ''
      if (!left !== !right) return left ? -1 : 1
      return left.localeCompare(right) || a.title.localeCompare(b.title)
    })
  }, [filtered, sort])

  const visibleStatuses = statuses
    .filter(s => showArchived ? true : s.id !== 'archived')
    .sort((a, b) => a.order - b.order)

  const anyFilterActive = !!(search || assignee || priority || client || boardFilter || adminReply || !showArchived || sort !== 'default')
  // Only the ones the menu itself owns — the search box lives in the page's
  // own tab bar, so counting it here would show a badge for something this
  // menu cannot clear from view.
  const activeFilterCount = [assignee, priority, client, boardFilter, adminReply].filter(Boolean).length
    + (showArchived ? 0 : 1)
    + (sort === 'default' ? 0 : 1)

  function clearFilters() {
    onSearchChange(''); setAssignee(''); setPriority(''); setClient(''); setAdminReply(''); setSort('default'); setShowArchived(true); changeBoardFilter('')
  }

  // The Support board's two chips, rendered in this same row rather than in a
  // strip of their own above it — one row for everything that narrows what the
  // columns below show, chips at the start and the filter menu at the end.
  const ticketKinds = [
    {
      id: 'support' as TicketKind,
      label: tr('כרטיסי תמיכה', 'Support Tickets'),
      hint: tr('תקלות ובקשות תמיכה שהגיעו מהלקוחות', 'Customer support issues reported from the app'),
    },
    {
      id: 'development' as TicketKind,
      label: tr('בקשות פיתוח', 'Development Requests'),
      hint: tr('שיפורים ובקשות פיתוח, כולל UI/UX', 'Improvements and development requests, including UI/UX'),
    },
  ]
  const ticketKindCount = (kind: TicketKind) => tasks.filter(t =>
    t.board === 'support' && t.status !== 'done' && t.status !== 'archived' && ticketKindOf(t) === kind,
  ).length
  const activeTicketKind = ticketKind ? ticketKinds.find(k => k.id === ticketKind) : undefined
  // Whether the row below the board tabs has anything of its own to show.
  const chipsRow = (!!onSubBoardChange && subBoardTabs.length > 0) || !!(ticketKind && onTicketKindChange)

  // How many tasks each admin-thread choice would leave — shown in the option
  // itself so the state of the queue is readable without picking one. Counted
  // over the board's own tasks, archived ones left out, and deliberately NOT
  // narrowed by the other filters, which is how the ticket chips count too.
  const adminReplyCount = (status: AdminReplyStatus) => tasks.filter(t =>
    t.status !== 'archived' && (!boardFilter || t.board === boardFilter) && adminReplyStatusFor(t) === status,
  ).length
  const adminReplyOptions: { id: AdminReplyStatus; label: string }[] = [
    { id: 'awaiting', label: tr('ממתין לתשובת האדמין', 'Waiting for admin reply') },
    { id: 'replied',  label: tr('האדמין השיב',          'Admin replied') },
    { id: 'none',     label: tr('אין הודעות בשרשור',     'No messages yet') },
  ]

  const filterControl = (
    <div className="relative shrink-0" ref={filterMenuRef}>
      <button
        onClick={() => setFilterMenuOpen(o => !o)}
        className={`flex ${filterSlot ? 'h-7' : 'h-8'} items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${filterMenuOpen || activeFilterCount > 0 ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
      >
        <SlidersHorizontal size={13} />
        {tr('סינון', 'Filters')}
        {activeFilterCount > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-white">{activeFilterCount}</span>
        )}
        <ChevronDown size={12} className={`transition-transform ${filterMenuOpen ? 'rotate-180' : ''}`} />
      </button>

      {filterMenuOpen && (
        <div className="absolute end-0 top-full z-40 mt-2 w-72 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{tr('סינון משימות', 'Filter tasks')}</p>
            <button onClick={() => setFilterMenuOpen(false)} className="p-1 text-gray-400 transition-colors hover:text-gray-600"><X size={13} /></button>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{tr('בורד', 'Board')}</span>
              <select
                value={boardFilter}
                onChange={e => changeBoardFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
              >
                <option value="">{tr('כל הבורדים', 'All Boards')}</option>
                {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{tr('אחראי', 'Assignee')}</span>
              <select
                value={assignee}
                onChange={e => setAssignee(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
              >
                <option value="">All assignees</option>
                {assignees.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{tr('עדיפות', 'Priority')}</span>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
              >
                <option value="">All priorities</option>
                {priorityFilterOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{tr('לקוח', 'Client')}</span>
              <select
                value={client}
                onChange={e => setClient(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
              >
                <option value="">{tr('כל הלקוחות', 'All Clients')}</option>
                <option value={NO_CLIENT}>{tr('ללא לקוח', 'No Client')}</option>
                {/* Client names are stored data — never translated. */}
                {clientOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
              </select>
            </label>

            {/* Asked for so a ticket we wrote to the admin about can be
                told apart from one they already answered, without opening
                each task to look at its chat. */}
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{tr('תשובת אדמין', 'Admin reply')}</span>
              <select
                value={adminReply}
                onChange={e => setAdminReply(e.target.value as '' | AdminReplyStatus)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
              >
                <option value="">{tr('הכל', 'All tasks')}</option>
                {adminReplyOptions.map(option => (
                  <option key={option.id} value={option.id}>{option.label} ({adminReplyCount(option.id)})</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{tr('מיון', 'Sort by')}</span>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as 'default' | 'client')}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
              >
                <option value="default">{tr('ברירת מחדל (חדשים קודם)', 'Default (newest first)')}</option>
                <option value="client">{tr('לקוח / אפליקציה (א׳–ת׳)', 'Client / App name (A–Z)')}</option>
              </select>
            </label>

            <button
              onClick={() => setShowArchived(s => !s)}
              className={`flex h-8 items-center justify-center rounded-lg border px-3 text-xs font-semibold transition-colors ${showArchived ? 'border-gray-300 bg-gray-200 text-gray-700' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'}`}
            >
              {showArchived ? 'Hide Archived' : 'Show Archived'}
            </button>

            {anyFilterActive && (
              <button onClick={clearFilters} className="flex items-center justify-center gap-1 text-xs text-gray-500 transition-colors hover:text-primary">
                <X size={12} /> Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* The chips row. It exists only when it has chips to show: with the
          Filters button lifted into the board-tabs row above (filterSlot), a
          board with no sub-boards and no ticket chips would otherwise hold an
          empty row open for nothing, which is exactly the wasted line this
          was asked to get rid of. */}
      {chipsRow && (
        <div className="flex items-center gap-2 shrink-0">
        {/* Sub-board tabs, when the selected board holds any. Same row as the
            filter menu — one row for everything that decides what the columns
            below show. A board with no sub-boards passes an empty list and
            this renders nothing at all. */}
        {onSubBoardChange && subBoardTabs.map(sub => {
          const active = activeBoardId === sub.id
          return (
            <button
              key={sub.id}
              onClick={() => onSubBoardChange(sub.id)}
              className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
            >
              {sub.name}
              <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ${active ? 'bg-primary text-white' : 'bg-gray-200 text-gray-700'}`}>{sub.count}</span>
            </button>
          )
        })}
        {ticketKind && onTicketKindChange && ticketKinds.map(kind => {
          const active = ticketKind === kind.id
          return (
            <button
              key={kind.id}
              onClick={() => onTicketKindChange(kind.id)}
              title={kind.hint}
              className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
            >
              {kind.label}
              <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ${active ? 'bg-primary text-white' : 'bg-gray-200 text-gray-700'}`}>{ticketKindCount(kind.id)}</span>
            </button>
          )
        })}
        {!filterSlot && (
          <>
            <div className="flex-1" />
            {filterControl}
          </>
        )}
        </div>
      )}

      {/* Lifted into the board-tabs row above when the page offers a slot for
          it, so the filter lives on the same line as the boards instead of
          costing a row of its own. */}
      {filterSlot && createPortal(filterControl, filterSlot)}

      {/* The line under the row: what the selected chip holds — and, when it
          holds nothing, why every column below reads "No tasks", which
          otherwise looks like the chip did not do anything — plus the count of
          what the filters above left showing. */}
      <div className={`flex shrink-0 items-center gap-2 px-0.5 ${chipsRow ? '-mt-2' : '-mt-1'}`}>
        {activeTicketKind && (
          <p className="min-w-0 text-[11px] text-gray-500">
            {activeTicketKind.hint}
            {ticketKindCount(activeTicketKind.id) === 0 && (
              <span className="text-gray-400"> · {tr('אין כרטיסים פתוחים בטאב הזה', 'no open tickets in this tab')}</span>
            )}
          </p>
        )}
        <div className="flex-1" />
        <span className="shrink-0 text-xs text-gray-500">{filtered.length} task{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Vertical sections */}
      <div className="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0 pb-6">
        {visibleStatuses.map(col => (
          <StatusSection
            key={col.id}
            col={col}
            tasks={ordered.filter(t => t.status === col.id)}
            boards={boards}
            onCardClick={onOpenTask}
            onAddTask={onAddTask}
            adminReplyStatusFor={adminReplyStatusFor}
            defaultOpen={col.id !== 'done' && col.id !== 'archived'}
            // "Add task" always creates on one specific target board
            // (see addTaskWithStatus in Work.tsx) — in "All Boards"
            // mode a status column can be a union across boards with
            // genuinely different status configs, so there is no safe
            // single board to create into from here. Hidden in that
            // case regardless of the caller's own readonly value,
            // never just disabled-looking.
            readonly={readonly || !boardFilter || col.id === 'archived'}
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
