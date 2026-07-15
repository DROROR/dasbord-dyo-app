import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { Avatar } from '../Avatar'
import type { Task, Board, PriorityDef } from '../../types/work'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date); d.setDate(d.getDate() + days); return d
}
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}
function toIso(d: Date) { return d.toISOString().slice(0, 10) }

// ─── Assignee colors ──────────────────────────────────────────────────────────

const PALETTE = [
  { bg: '#3b82f6', light: '#dbeafe', text: '#1e40af' },
  { bg: '#8b5cf6', light: '#ede9fe', text: '#5b21b6' },
  { bg: '#10b981', light: '#d1fae5', text: '#065f46' },
  { bg: '#f97316', light: '#ffedd5', text: '#9a3412' },
  { bg: '#ec4899', light: '#fce7f3', text: '#9d174d' },
  { bg: '#14b8a6', light: '#ccfbf1', text: '#0f766e' },
  { bg: '#f43f5e', light: '#ffe4e6', text: '#9f1239' },
  { bg: '#6366f1', light: '#e0e7ff', text: '#3730a3' },
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface DragState {
  taskId: string
  startX: number
  origStart?: string
  origDue?: string
  deltaDays: number
}

// ─── BoardFilter dropdown ─────────────────────────────────────────────────────

function BoardFilterDropdown({
  boards, hiddenBoards, onToggle, onSelectAll, onDeselectAll,
}: {
  boards: Board[]
  hiddenBoards: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const visibleCount = boards.length - hiddenBoards.size
  const label = hiddenBoards.size === 0
    ? 'כל הבורדים'
    : `${visibleCount}/${boards.length} בורדים`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(s => !s)}
        className={`flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 bg-white transition-colors focus:outline-none ${hiddenBoards.size > 0 ? 'border-primary text-primary font-semibold' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
      >
        {label}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-30 bg-white border border-gray-200 rounded-xl shadow-lg p-3 min-w-52">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <button onClick={() => { onSelectAll(); }} className="text-xs text-primary font-semibold hover:underline">בחר הכל</button>
            <button onClick={() => { onDeselectAll(); }} className="text-xs text-gray-400 font-semibold hover:underline">בטל הכל</button>
          </div>
          <div className="flex flex-col gap-1">
            {boards.map(b => {
              const checked = !hiddenBoards.has(b.id)
              return (
                <label key={b.id} className="flex items-center gap-2.5 py-1 px-1 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <div
                    onClick={() => onToggle(b.id)}
                    className={`w-4 h-4 rounded flex items-center justify-center border transition-colors cursor-pointer ${checked ? 'bg-primary border-primary' : 'border-gray-300 bg-white'}`}
                  >
                    {checked && <Check size={10} className="text-white" />}
                  </div>
                  <span className="text-xs text-gray-700 flex-1">{b.name}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── GanttTab ─────────────────────────────────────────────────────────────────

export function GanttTab({
  tasks, boards, assignees, priorityCfg, onOpenTask, onUpdateTask,
}: {
  tasks: Task[]
  boards: Board[]
  assignees: string[]
  priorityCfg: Record<string, PriorityDef>
  onOpenTask: (id: string) => void
  onUpdateTask: (t: Task) => void
}) {
  const [viewMode,       setViewMode]       = useState<'week' | 'month'>('week')
  const [hiddenBoards,   setHiddenBoards]   = useState<Set<string>>(new Set())
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [drag,           setDrag]           = useState<DragState | null>(null)

  // Keep hiddenBoards in sync when boards list changes (add newly added boards as visible)
  useEffect(() => {
    setHiddenBoards(prev => {
      const boardIds = new Set(boards.map(b => b.id))
      const next = new Set([...prev].filter(id => boardIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [boards])

  const dayWidth  = viewMode === 'week' ? 80 : 30
  const totalDays = viewMode === 'week' ? 42 : 90

  const colorMap = useMemo(() => {
    return Object.fromEntries(assignees.map((a, i) => [a, PALETTE[i % PALETTE.length]]))
  }, [assignees])

  const viewStart = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); return d
  }, [])

  const totalWidth = totalDays * dayWidth

  const days = useMemo(() =>
    Array.from({ length: totalDays }, (_, i) => addDays(viewStart, i)),
    [viewStart, totalDays]
  )

  const months = useMemo(() => {
    const result: { label: string; startDay: number; span: number }[] = []
    let cur = { label: '', startDay: 0, span: 0 }
    days.forEach((d, i) => {
      const lbl = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
      if (lbl !== cur.label) { if (cur.label) result.push(cur); cur = { label: lbl, startDay: i, span: 1 } }
      else cur.span++
    })
    if (cur.label) result.push(cur)
    return result
  }, [days])

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const todayOffset = daysBetween(viewStart, today) * dayWidth

  const filtered = useMemo(() => tasks.filter(t => {
    if (t.status === 'archived') return false
    if (hiddenBoards.size > 0 && hiddenBoards.has(t.board)) return false
    if (filterAssignee && t.assignee !== filterAssignee) return false
    if (filterPriority && t.priority !== filterPriority) return false
    return true
  }), [tasks, hiddenBoards, filterAssignee, filterPriority])

  const scheduled   = filtered.filter(t => t.dueDate)
  const unscheduled = filtered.filter(t => !t.dueDate)

  function barGeometry(t: Task): { left: number; width: number; isPoint: boolean } {
    const delta = drag?.taskId === t.id ? drag.deltaDays : 0
    const dueD = new Date(t.dueDate!)

    if (t.startDate) {
      const startD = addDays(new Date(t.startDate), delta)
      const endD   = addDays(dueD, delta)
      const left   = daysBetween(viewStart, startD) * dayWidth
      const width  = Math.max(dayWidth, daysBetween(startD, endD) * dayWidth)
      return { left, width, isPoint: false }
    } else {
      const left = daysBetween(viewStart, addDays(dueD, delta)) * dayWidth + dayWidth / 2 - 10
      return { left, width: 20, isPoint: true }
    }
  }

  const onBarPointerDown = useCallback((e: React.PointerEvent, task: Task) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ taskId: task.id, startX: e.clientX, origStart: task.startDate, origDue: task.dueDate, deltaDays: 0 })
  }, [])

  const onBarPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return
    const rawDelta = (e.clientX - drag.startX) / dayWidth
    setDrag(prev => prev ? { ...prev, deltaDays: Math.round(rawDelta) } : null)
  }, [drag, dayWidth])

  const onBarPointerUp = useCallback((e: React.PointerEvent, task: Task) => {
    if (!drag || drag.deltaDays === 0) { setDrag(null); return }
    const updated = { ...task }
    if (drag.origDue)   updated.dueDate   = toIso(addDays(new Date(drag.origDue),   drag.deltaDays))
    if (drag.origStart) updated.startDate = toIso(addDays(new Date(drag.origStart), drag.deltaDays))
    onUpdateTask(updated)
    setDrag(null)
  }, [drag, onUpdateTask])

  const ROW_H = 44

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">

      {/* Filter + toggle bar */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
          <button onClick={() => setViewMode('week')}  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${viewMode === 'week'  ? 'bg-primary text-white' : 'bg-white text-gray-500 hover:text-gray-700'}`}>שבוע</button>
          <button onClick={() => setViewMode('month')} className={`px-3 py-1.5 text-xs font-semibold transition-colors ${viewMode === 'month' ? 'bg-primary text-white' : 'bg-white text-gray-500 hover:text-gray-700'}`}>חודש</button>
        </div>

        {/* Multi-board checkbox filter */}
        <BoardFilterDropdown
          boards={boards}
          hiddenBoards={hiddenBoards}
          onToggle={id => setHiddenBoards(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })}
          onSelectAll={() => setHiddenBoards(new Set())}
          onDeselectAll={() => setHiddenBoards(new Set(boards.map(b => b.id)))}
        />

        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-primary">
          <option value="">כל המשתמשים</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-primary">
          <option value="">כל העדיפויות</option>
          {Object.values(priorityCfg).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <div className="flex-1" />
        {/* Assignee legend */}
        <div className="flex items-center gap-2 flex-wrap">
          {assignees.map(a => {
            const c = colorMap[a]
            return (
              <span key={a} className="flex items-center gap-1 text-[10px] font-medium" style={{ color: c.text }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.bg }} />
                {a}
              </span>
            )
          })}
        </div>
        <span className="text-xs text-gray-400 shrink-0">{scheduled.length} מתוזמן · {unscheduled.length} ללא תאריך</span>
      </div>

      {/* Gantt grid */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-gray-200 bg-white">
        <div style={{ minWidth: 280 + totalWidth }}>

          {/* Header row 1 — months */}
          <div className="flex sticky top-0 z-20 bg-white border-b border-gray-200">
            <div className="sticky left-0 z-30 bg-gray-50 border-r border-gray-200 flex items-center px-4 shrink-0" style={{ width: 280, height: 28 }}>
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">משימה</span>
            </div>
            <div className="flex" style={{ minWidth: totalWidth }}>
              {months.map(m => (
                <div key={m.label + m.startDay} style={{ width: m.span * dayWidth }} className="flex items-center justify-center border-r border-gray-100 h-7">
                  <span className="text-[10px] font-semibold text-gray-500">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Header row 2 — days */}
          <div className="flex sticky top-7 z-20 bg-white border-b border-gray-200">
            <div className="sticky left-0 z-30 bg-gray-50 border-r border-gray-200 shrink-0" style={{ width: 280, height: 24 }} />
            <div className="flex" style={{ minWidth: totalWidth }}>
              {days.map((d, i) => {
                const isToday = d.toDateString() === today.toDateString()
                const isSun   = d.getDay() === 0
                return (
                  <div key={i} style={{ width: dayWidth }} className={`flex items-center justify-center border-r border-gray-50 h-6 ${isSun ? 'bg-gray-50' : ''}`}>
                    <span className={`text-[9px] font-mono ${isToday ? 'text-primary font-bold' : 'text-gray-300'}`}>
                      {viewMode === 'week' ? d.getDate() : (d.getDate() % 5 === 1 ? d.getDate() : '')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Scheduled task rows */}
          {scheduled.map(task => {
            const p       = priorityCfg[task.priority]
            const color   = colorMap[task.assignee] ?? PALETTE[0]
            const { left: bl, width: bw, isPoint } = barGeometry(task)
            const isDue   = new Date(task.dueDate!) < today
            const isDrag  = drag?.taskId === task.id

            return (
              <div key={task.id} className="flex border-b border-gray-50 hover:bg-gray-50/50 group" style={{ height: ROW_H }}>
                <div className="sticky left-0 z-10 bg-white group-hover:bg-gray-50/50 border-r border-gray-100 flex items-center gap-2 px-3 shrink-0" style={{ width: 280, minWidth: 280 }}>
                  {p && <span className={`w-2 h-2 rounded-full shrink-0 ${p.dotCls}`} />}
                  <button onClick={() => onOpenTask(task.id)} className="flex-1 text-xs text-gray-800 truncate hover:text-primary transition-colors text-left font-medium">{task.title}</button>
                  <Avatar name={task.assignee} size="xs" />
                </div>

                <div
                  className="relative flex-1"
                  style={{ minWidth: totalWidth, height: ROW_H }}
                  onPointerMove={isDrag ? onBarPointerMove : undefined}
                  onPointerUp={isDrag ? e => onBarPointerUp(e, task) : undefined}
                >
                  {days.map((d, i) => d.getDay() === 0 ? (
                    <div key={i} className="absolute top-0 bottom-0 bg-gray-50/80" style={{ left: i * dayWidth, width: dayWidth }} />
                  ) : null)}

                  {todayOffset >= 0 && todayOffset <= totalWidth && (
                    <div className="absolute top-0 bottom-0 w-0.5 z-10 pointer-events-none" style={{ left: todayOffset, backgroundColor: '#6366f1', opacity: 0.3 }} />
                  )}

                  {bl < totalWidth && bl + bw > 0 && (
                    isPoint ? (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 cursor-pointer hover:scale-125 transition-transform z-10"
                        style={{ left: Math.max(0, bl), width: bw }}
                        onClick={() => onOpenTask(task.id)}
                        title={`Due: ${task.dueDate}`}
                      >
                        <div
                          className="w-4 h-4 rotate-45 mx-auto rounded-sm shadow-sm"
                          style={{ backgroundColor: isDue ? '#ef4444' : color.bg, opacity: isDrag ? 0.6 : 1 }}
                        />
                      </div>
                    ) : (
                      <div
                        className="absolute top-2.5 rounded-md cursor-grab active:cursor-grabbing select-none transition-opacity"
                        style={{
                          left: Math.max(0, bl),
                          width: Math.min(bw, totalWidth - Math.max(0, bl)),
                          height: ROW_H - 20,
                          backgroundColor: color.bg,
                          opacity: isDue ? 0.6 : isDrag ? 0.75 : 1,
                          boxShadow: isDrag ? '0 4px 12px rgba(0,0,0,0.2)' : undefined,
                          outline: isDue ? '2px solid #ef4444' : undefined,
                        }}
                        onPointerDown={e => onBarPointerDown(e, task)}
                        onClick={() => !drag && onOpenTask(task.id)}
                      >
                        <span className="px-2 text-[9px] font-semibold truncate block leading-[24px]" style={{ color: '#fff' }}>{task.title}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )
          })}

          {/* Unscheduled section */}
          {unscheduled.length > 0 && (
            <>
              <div className="flex border-b border-dashed border-gray-200 bg-gray-50/40">
                <div className="sticky left-0 z-10 bg-gray-50/80 border-r border-gray-100 px-4 py-2 shrink-0" style={{ width: 280, minWidth: 280 }}>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">לא מתוזמן ({unscheduled.length})</span>
                </div>
                <div style={{ minWidth: totalWidth }} />
              </div>
              {unscheduled.map(task => {
                const p     = priorityCfg[task.priority]
                const color = colorMap[task.assignee] ?? PALETTE[0]
                return (
                  <div key={task.id} className="flex border-b border-gray-50 hover:bg-gray-50/50 group" style={{ height: ROW_H }}>
                    <div className="sticky left-0 z-10 bg-white group-hover:bg-gray-50/50 border-r border-gray-100 flex items-center gap-2 px-3 shrink-0" style={{ width: 280, minWidth: 280 }}>
                      {p && <span className={`w-2 h-2 rounded-full shrink-0 ${p.dotCls}`} />}
                      <button onClick={() => onOpenTask(task.id)} className="flex-1 text-xs text-gray-500 truncate hover:text-primary transition-colors text-left">{task.title}</button>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color.bg }} />
                      <Avatar name={task.assignee} size="xs" />
                    </div>
                    <div className="flex-1 flex items-center px-4" style={{ minWidth: totalWidth }}>
                      <span className="text-[10px] text-gray-300 italic">פתח את המשימה כדי לקבוע תאריך יעד</span>
                    </div>
                  </div>
                )
              })}
            </>
          )}

        </div>
      </div>
    </div>
  )
}
