import { useState, useMemo } from 'react'
import { Search, X, Calendar, Clock, ChevronDown, Plus } from 'lucide-react'
import { Avatar } from '../Avatar'
import type { Task, PriorityDef, BoardStatus } from '../../types/work'
import { DEFAULT_BOARD_STATUSES } from '../../data/workConstants'

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
function entryTotal(entries: import('../types/work').TimeEntry[]) {
  return entries.reduce((s, e) => s + e.hours + e.minutes / 60, 0)
}
function isOverdue(due?: string) {
  return !!due && new Date(due) < new Date()
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

function TaskCard({
  task, priorityCfg, onClick,
}: { task: Task; priorityCfg: Record<string, PriorityDef>; onClick: () => void }) {
  const p         = priorityCfg[task.priority]
  const overdue   = isOverdue(task.dueDate)
  const unclaimed = task.board === 'support' && task.claimed === false

  return (
    <button
      onClick={onClick}
      style={{ padding: '12px 14px', minHeight: '80px' }}
      className="flex flex-col gap-2 w-full bg-white hover:bg-gray-50/80 border border-gray-100 rounded-lg text-left transition-colors shadow-sm hover:shadow hover:border-gray-200"
    >
      {/* Row 1 — priority dot + title + badges */}
      <div className="flex items-start gap-2 w-full min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 mt-[3px] ${p ? p.dotCls : 'bg-gray-300'}`} />
        <span className="flex-1 text-[14px] font-medium text-gray-800 leading-snug min-w-0 text-left">
          {task.title}
        </span>
        {unclaimed && (
          <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold animate-pulse shrink-0">
            UNCLAIMED
          </span>
        )}
        {task.clientName && (
          <span className="text-[9px] bg-secondary/15 text-secondary-dark px-1.5 py-0.5 rounded font-semibold shrink-0">
            {task.clientName}
          </span>
        )}
      </div>

      {/* Row 2 — id + meta */}
      <div className="flex items-center gap-2 w-full">
        <span className="text-[10px] font-mono text-gray-300 shrink-0">{task.id}</span>
        <div className="flex-1" />
        {p && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${p.textCls} ${p.bgCls} ${p.borderCls}`}>
            {p.label}
          </span>
        )}
        {task.dueDate && (
          <span className={`text-[10px] flex items-center gap-0.5 shrink-0 ${overdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
            <Calendar size={9} />
            {fmtDate(task.dueDate)}
          </span>
        )}
        {entryTotal(task.timeEntries) > 0 && (
          <span className="text-[10px] text-gray-300 flex items-center gap-0.5 shrink-0">
            <Clock size={9} />
            {fmtHours(entryTotal(task.timeEntries))}
          </span>
        )}
        <Avatar name={task.assignee} size="xs" />
      </div>
    </button>
  )
}

// ─── StatusSection ────────────────────────────────────────────────────────────

function StatusSection({
  col, tasks, priorityCfg, onCardClick, onAddTask, defaultOpen, readonly,
}: {
  col: BoardStatus
  tasks: Task[]
  priorityCfg: Record<string, PriorityDef>
  onCardClick: (id: string) => void
  onAddTask: (statusId: string) => void
  defaultOpen: boolean
  readonly?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`border-l-2 rounded-lg shadow-sm ${col.leftBorderCls} bg-white`}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 w-full px-4 py-2.5 bg-gray-50/80 hover:bg-gray-100/60 transition-colors text-left border-b border-gray-100 rounded-t-lg"
      >
        <ChevronDown size={13} className={`text-gray-400 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`} />
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${col.pillCls}`}>
          {col.label}
        </span>
        <span className="text-xs font-bold text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 min-w-[20px] text-center">
          {tasks.length}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 p-2 pb-2" style={{ minHeight: '100px' }}>
          {tasks.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-[11px] text-gray-300 select-none py-2">
              No tasks
            </div>
          )}
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              priorityCfg={priorityCfg}
              onClick={() => onCardClick(task.id)}
            />
          ))}
          {!readonly && (
            <button
              onClick={() => onAddTask(col.id)}
              style={{ minHeight: '40px', marginBottom: '8px' }}
              className="flex items-center justify-center gap-1.5 w-full px-4 py-2 text-[13px] text-gray-400 border border-dashed border-gray-200 rounded-lg bg-transparent hover:text-primary hover:bg-primary/5 hover:border-primary/40 transition-colors mt-1"
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
  tasks, priorityCfg, onOpenTask, onStatusChange, onAddTask, assignees, boardStatuses, readonly,
}: {
  tasks: Task[]
  priorityCfg: Record<string, PriorityDef>
  onOpenTask: (id: string) => void
  onStatusChange: (id: string, status: string) => void
  onAddTask: (statusId: string) => void
  assignees: string[]
  boardStatuses?: BoardStatus[]
  readonly?: boolean
}) {
  const [search,   setSearch]   = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const statuses = boardStatuses ?? DEFAULT_BOARD_STATUSES

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return tasks.filter(t => {
      if (!showArchived && t.status === 'archived') return false
      if (q && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false
      if (assignee && t.assignee !== assignee) return false
      if (priority && t.priority !== priority) return false
      return true
    })
  }, [tasks, search, assignee, priority, showArchived])

  const visibleStatuses = statuses
    .filter(s => showArchived ? true : s.id !== 'archived')
    .sort((a, b) => a.order - b.order)

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full pl-9 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition placeholder:text-gray-300"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={12} />
            </button>
          )}
        </div>
        <select
          value={assignee}
          onChange={e => setAssignee(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition"
        >
          <option value="">All assignees</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={priority}
          onChange={e => setPriority(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition"
        >
          <option value="">All priorities</option>
          {Object.values(priorityCfg).map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <button
          onClick={() => setShowArchived(s => !s)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showArchived ? 'bg-gray-200 text-gray-700 border-gray-300' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}
        >
          {showArchived ? 'Hide Archived' : 'Show Archived'}
        </button>
        {(search || assignee || priority) && (
          <button onClick={() => { setSearch(''); setAssignee(''); setPriority('') }} className="flex items-center gap-1 text-sm text-gray-400 hover:text-primary transition-colors">
            <X size={12} /> Clear
          </button>
        )}
        <div className="flex-1" />
        <span className="text-xs text-gray-400 shrink-0">{filtered.length} task{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Vertical sections */}
      <div className="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0 pb-6">
        {visibleStatuses.map(col => (
          <StatusSection
            key={col.id}
            col={col}
            tasks={filtered.filter(t => t.status === col.id)}
            priorityCfg={priorityCfg}
            onCardClick={onOpenTask}
            onAddTask={onAddTask}
            defaultOpen={col.id !== 'done' && col.id !== 'archived'}
            readonly={readonly}
          />
        ))}
      </div>
    </div>
  )
}
