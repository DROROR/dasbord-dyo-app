import { useState, useMemo, useEffect } from 'react'
import { AlertCircle, Ticket, User, Calendar, Clock, ChevronDown, CheckCircle2 } from 'lucide-react'
import { Avatar } from '../Avatar'
import type { Task, PriorityDef, Board, TimeEntry } from '../../types/work'
import { COLUMNS, STATUS_PILL, STATUS_LABEL, STATUS_LEFT } from '../../data/workConstants'

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

type TaskBadge = { label: string; cls: string }

// ─── CompactTaskRow ───────────────────────────────────────────────────────────

function CompactTaskRow({
  task, priorityCfg, onClick, badge,
}: {
  task: Task
  priorityCfg: Record<string, PriorityDef>
  onClick: () => void
  badge?: TaskBadge
}) {
  const p       = priorityCfg[task.priority]
  const overdue = isOverdue(task.dueDate)
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-2.5 bg-white hover:bg-gray-50 border-b border-gray-50 text-left transition-colors last:border-b-0"
    >
      {p
        ? <span className={`w-2 h-2 rounded-full shrink-0 ${p.dotCls}`} />
        : <span className="w-2 h-2 rounded-full shrink-0 bg-gray-300" />
      }
      <span className="text-[10px] font-mono text-gray-300 shrink-0 w-16 truncate">{task.id}</span>
      <span className="flex-1 text-sm text-gray-800 truncate min-w-0">{task.title}</span>
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 whitespace-nowrap ${badge.cls}`}>
          {badge.label}
        </span>
      )}
      <Avatar name={task.assignee} size="xs" />
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
    </button>
  )
}

// ─── MyStatusSection ──────────────────────────────────────────────────────────

function MyStatusSection({
  col, tasks, priorityCfg, onCardClick, getBadge,
}: {
  col: { id: string; label: string }
  tasks: Task[]
  priorityCfg: Record<string, PriorityDef>
  onCardClick: (id: string) => void
  getBadge?: (task: Task) => TaskBadge | undefined
}) {
  const [open, setOpen] = useState(col.id !== 'done' && col.id !== 'archived')
  return (
    <div className={`border-l-2 rounded-lg overflow-hidden shadow-sm ${STATUS_LEFT[col.id] ?? 'border-l-gray-300'} bg-white`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 w-full px-4 py-2.5 bg-gray-50/80 hover:bg-gray-100/60 transition-colors text-left border-b border-gray-100"
      >
        <ChevronDown size={13} className={`text-gray-400 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`} />
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_PILL[col.id] ?? 'bg-gray-100 text-gray-600'}`}>
          {col.label}
        </span>
        <span className="text-xs font-bold text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 min-w-[20px] text-center">
          {tasks.length}
        </span>
      </button>
      {open && (
        <div>
          {tasks.length === 0 ? (
            <div className="text-[11px] text-gray-300 text-center py-4 select-none">No tasks</div>
          ) : (
            tasks.map(task => (
              <CompactTaskRow
                key={task.id}
                task={task}
                priorityCfg={priorityCfg}
                onClick={() => onCardClick(task.id)}
                badge={getBadge?.(task)}
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
  tasks, boards, currentUser, priorityCfg, onOpenTask, onStatusChange,
}: {
  tasks: Task[]
  boards: Board[]
  currentUser: string
  priorityCfg: Record<string, PriorityDef>
  onOpenTask: (id: string) => void
  onStatusChange: (id: string, status: string) => void
}) {
  // Tasks directly assigned to me
  const myTasks = useMemo(
    () => tasks.filter(t => t.assignee === currentUser),
    [tasks, currentUser],
  )

  // Tasks in a status I own, not directly assigned to me
  const statusOwnedTasks = useMemo(() => tasks.filter(t => {
    if (t.assignee === currentUser) return false
    if (t.status === 'done' || t.status === 'archived') return false
    const board     = boards.find(b => b.id === t.board)
    const statusDef = board?.statuses.find(s => s.id === t.status)
    return statusDef?.owner === currentUser
  }), [tasks, boards, currentUser])

  // Badge label map for status-owned tasks
  const statusBadgeMap = useMemo(() => {
    const map = new Map<string, TaskBadge>()
    statusOwnedTasks.forEach(t => {
      const board     = boards.find(b => b.id === t.board)
      const statusDef = board?.statuses.find(s => s.id === t.status)
      map.set(t.id, {
        label: `בגלל סטטוס: ${statusDef?.label ?? t.status}`,
        cls: 'bg-purple-50 text-purple-700 border border-purple-100',
      })
    })
    return map
  }, [statusOwnedTasks, boards])

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

  const inProgress   = myTasks.filter(t => t.status === 'in_progress')
  const overdueTasks = myTasks.filter(t => isOverdue(t.dueDate) && t.status !== 'done' && t.status !== 'archived')
  const pendingClose = myTasks.filter(t => t.status === 'done')
  const unclaimed    = tasks.filter(t => t.board === 'support' && t.claimed === false)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const hoursThisMonth = myTasks
    .flatMap(t => t.timeEntries)
    .filter(e => e.date.startsWith(thisMonth))
    .reduce((sum, e) => sum + e.hours + e.minutes / 60, 0)

  const MY_COLS = COLUMNS.filter(c => c.id !== 'archived')

  function assignedBadge(task: Task): TaskBadge {
    if (task.status === 'done')
      return { label: 'ממתין לסגירה', cls: 'bg-orange-100 text-orange-700 border border-orange-100' }
    return { label: 'משויך אליך', cls: 'bg-blue-50 text-blue-600 border border-blue-100' }
  }

  const hasAnyTasks = myTasks.length > 0 || statusOwnedTasks.length > 0

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        {([
          { label: 'My Tasks',     value: myTasks.length,          sub: 'assigned to you',     cls: 'text-primary' },
          { label: 'Review Queue', value: statusOwnedTasks.length, sub: 'pending your review',  cls: 'text-purple-600', bg: statusOwnedTasks.length > 0 ? 'bg-purple-50 border-purple-200' : undefined },
          { label: 'Overdue',      value: overdueTasks.length,     sub: 'past due date',        cls: overdueTasks.length > 0 ? 'text-red-600' : 'text-gray-300', bg: overdueTasks.length > 0 ? 'bg-red-50 border-red-200' : undefined },
          { label: 'This Month',   value: hoursThisMonth,          sub: 'hours logged',         cls: 'text-primary', isHours: true },
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
          <span>שעון פעיל: {activeTimer.taskTitle}</span>
        </button>
      )}

      {/* Alerts */}
      {(pendingClose.length > 0 || overdueTasks.length > 0 || unclaimed.length > 0) && (
        <div className="flex flex-col gap-2 shrink-0">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Alerts</p>

          {pendingClose.map(t => (
            <button key={t.id} onClick={() => onOpenTask(t.id)}
              className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5 hover:bg-orange-100 transition-colors text-left w-full"
            >
              <CheckCircle2 size={14} className="text-orange-500 shrink-0" />
              <span className="text-[10px] font-mono text-orange-400 shrink-0">{t.id}</span>
              <span className="text-sm font-medium text-orange-800 flex-1 truncate">{t.title}</span>
              <span className="text-[9px] bg-orange-200 text-orange-800 px-1.5 py-0.5 rounded font-bold shrink-0">
                ממתין לסגירה
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
              <span className="text-[10px] text-red-500 shrink-0">Due {fmtDate(t.dueDate!)}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${STATUS_PILL[t.status]}`}>
                {STATUS_LABEL[t.status]}
              </span>
            </button>
          ))}

          {unclaimed.map(t => (
            <button key={t.id} onClick={() => onOpenTask(t.id)}
              className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5 hover:bg-orange-100 transition-colors text-left w-full"
            >
              <Ticket size={14} className="text-orange-500 shrink-0" />
              <span className="text-[10px] font-mono text-orange-400 shrink-0">{t.id}</span>
              <span className="text-sm font-medium text-orange-800 flex-1 truncate">{t.title}</span>
              <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold animate-pulse shrink-0">UNCLAIMED</span>
            </button>
          ))}
        </div>
      )}

      {/* Board */}
      {!hasAnyTasks ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
            <User size={26} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-500">No tasks assigned to you</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto pb-4">

          {/* Review queue — status-owned tasks */}
          {statusOwnedTasks.length > 0 && (
            <div className="flex flex-col gap-2 shrink-0">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                תור הבדיקה שלי
              </p>
              <div className="rounded-lg border border-purple-100 bg-white shadow-sm overflow-hidden">
                {statusOwnedTasks.map(task => (
                  <CompactTaskRow
                    key={task.id}
                    task={task}
                    priorityCfg={priorityCfg}
                    onClick={() => onOpenTask(task.id)}
                    badge={statusBadgeMap.get(task.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Assigned tasks grouped by status */}
          {myTasks.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">המשימות שלי</p>
              {MY_COLS.map(col => {
                const colTasks = myTasks.filter(t => t.status === col.id)
                if (colTasks.length === 0) return null
                return (
                  <MyStatusSection
                    key={col.id}
                    col={col}
                    tasks={colTasks}
                    priorityCfg={priorityCfg}
                    onCardClick={onOpenTask}
                    getBadge={assignedBadge}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
