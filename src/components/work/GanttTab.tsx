import { useState, useMemo, useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronRight, Check, GripVertical } from 'lucide-react'
import { Avatar } from '../Avatar'
import type { Task, Board } from '../../types/work'
import { resolveTaskPriority, priorityDefsForBoard, statusesForBoard } from '../../data/workConstants'
import { useWorkLang } from '../../contexts/WorkLanguageContext'
import { ClientBadge } from './ClientBadge'

// Sentinel key for the synthetic "Unassigned" bucket in the Users
// filter — distinct from any real profile uuid, never persisted.
const UNASSIGNED_KEY = '__unassigned__'

// Resolves which Users-filter bucket a task belongs to. assigneeId is
// authoritative and always wins when present — display-name matching is
// only ever attempted when assigneeId is absent, and only to support
// legacy tasks that predate that column. A name that doesn't resolve to
// any currently known profile gets its own stable, real, selectable
// "name:<value>" bucket (distinct from Unassigned) — see legacyUserOptions
// below, which turns every such key into an actual Legacy/Inactive
// checkbox rather than a filter-invisible task.
function taskAssigneeKey(task: Task, profiles: { id: string; name: string }[]): string {
  if (task.assigneeId) return task.assigneeId
  const name = task.assignee?.trim()
  if (name) {
    const match = profiles.find(p => p.name === name)
    return match ? match.id : `name:${name}`
  }
  return UNASSIGNED_KEY
}

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id); else next.add(id)
  return next
}

// A checkbox filter's hidden-id set needs pruning whenever its own option
// list changes shape (a board is removed, a board's custom statuses
// change, a profile is deactivated) — otherwise a stale id inflates
// hidden.size and throws off the dropdown's own "3/5 selected" count.
// Adjusting state during render (comparing against a previous key held in
// state, exactly as React's own docs recommend for "adjusting state when
// a prop changes") rather than in a useEffect avoids the extra
// commit-then-effect render pass a useEffect-based version would cause
// here. Deliberately uses a second useState for the previous key, not a
// ref — reading/writing a ref during render is itself now flagged.
function loadStoredHiddenSet(storageKey: string, validIds: string[]): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(stored)) return new Set()
    const valid = new Set(validIds)
    return new Set(stored.filter((id): id is string => typeof id === 'string' && valid.has(id)))
  } catch {
    return new Set()
  }
}

function usePrunedHiddenSet(validIds: string[], storageKey: string): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [hidden, setHidden] = useState<Set<string>>(() => loadStoredHiddenSet(storageKey, validIds))
  const key = validIds.join('|')
  const [prevKey, setPrevKey] = useState(key)
  if (prevKey !== key) {
    setPrevKey(key)
    const idSet = new Set(validIds)
    const pruned = new Set([...hidden].filter(id => idSet.has(id)))
    if (pruned.size !== hidden.size) setHidden(pruned)
  }
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify([...hidden])) } catch { /* preference remains in memory */ }
  }, [hidden, storageKey])
  return [hidden, setHidden]
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
// Every date used for range math is a LOCAL, time-stripped Date (midnight in
// the browser's own timezone) — never round-tripped through toISOString()
// (which converts to UTC first) or through `new Date(isoDateString)` (which
// parses a bare "YYYY-MM-DD" as UTC midnight per spec). Either round-trip can
// silently shift the displayed/saved date by one day in timezones with a
// negative UTC offset. parseIsoDateLocal/toIso are the only two places an
// ISO date string ever crosses the boundary, and both stay in local
// components throughout.

function addDays(date: Date, days: number): Date {
  const d = new Date(date); d.setDate(d.getDate() + days); return d
}
// Whole calendar days between two local-midnight dates. Math.round (not a
// bare integer division) absorbs the one DST-transition day whose actual
// elapsed milliseconds isn't a clean multiple of 86,400,000 — that day is
// still exactly 1 calendar day away, just not exactly 24h away.
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseIsoDateLocal(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number)
  return new Date(y, m - 1, day)
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function sundayOnOrBefore(d: Date): Date {
  const s = startOfDay(d)
  s.setDate(s.getDate() - s.getDay())
  return s
}
// Adds whole calendar months, clamping the day-of-month when the target
// month is shorter (Jan 31 + 1 month -> Feb 28/29, never overflowing into
// March the way a naive setMonth(+1) would). Used for NAVIGATING the
// anchor (Prev/Next/Today) — see rollingMonthEnd() below for the separate,
// not-quite-the-same rule that governs where a Rolling Month range ENDS.
function addMonthsClamped(d: Date, months: number): Date {
  const totalMonthIndex = d.getFullYear() * 12 + d.getMonth() + months
  const year  = Math.floor(totalMonthIndex / 12)
  const month = ((totalMonthIndex % 12) + 12) % 12
  const daysInTarget = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(d.getDate(), daysInTarget))
}
// The last day of a Rolling Month range starting at `start`: normally the
// day BEFORE the equivalent date one calendar month later (Aug 16 -> Sep
// 15). When that equivalent date doesn't exist in the following month
// (start.getDate() exceeds that month's length), the range instead ends on
// the following month's actual final day — Jan 31 -> Feb 28 (or 29 in a
// leap year), Mar 31 -> Apr 30 — never Feb 27 or Apr 29, and never
// overflowing into the month after.
function rollingMonthEnd(start: Date): Date {
  const totalMonthIndex = start.getFullYear() * 12 + start.getMonth() + 1
  const year  = Math.floor(totalMonthIndex / 12)
  const month = ((totalMonthIndex % 12) + 12) % 12
  const daysInTargetMonth = new Date(year, month + 1, 0).getDate()
  if (start.getDate() > daysInTargetMonth) {
    return new Date(year, month, daysInTargetMonth)
  }
  return addDays(new Date(year, month, start.getDate()), -1)
}

// ─── Date-range modes ─────────────────────────────────────────────────────────

type RangeMode = 'week1' | 'week2' | 'week3' | 'calendarMonth' | 'rollingMonth' | 'custom'

const MODE_LABELS: Record<RangeMode, { he: string; en: string }> = {
  week1:         { he: 'שבוע אחד', en: '1 week' },
  week2:         { he: 'שבועיים', en: '2 weeks' },
  week3:         { he: '3 שבועות', en: '3 weeks' },
  calendarMonth: { he: 'חודש קלנדרי', en: 'Calendar month' },
  rollingMonth:  { he: 'חודש מתגלגל', en: 'Rolling month' },
  custom:        { he: 'טווח מותאם אישית', en: 'Custom range' },
}

const GANTT_STORAGE = {
  mode: 'dyo-gantt-range-mode',
  anchor: 'dyo-gantt-anchor',
  customFrom: 'dyo-gantt-custom-from',
  customTo: 'dyo-gantt-custom-to',
  boards: 'dyo-gantt-hidden-boards',
  users: 'dyo-gantt-hidden-users',
  priorities: 'dyo-gantt-hidden-priorities',
  statuses: 'dyo-gantt-hidden-statuses',
} as const

function storedRangeMode(): RangeMode {
  try {
    const value = localStorage.getItem(GANTT_STORAGE.mode)
    return value && value in MODE_LABELS ? value as RangeMode : 'week2'
  } catch { return 'week2' }
}

function storedLocalDate(key: string, fallback: Date): Date {
  try {
    const value = localStorage.getItem(key)
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseIsoDateLocal(value) : fallback
  } catch { return fallback }
}

const WEEKDAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Pure — both boundaries are inclusive local-midnight dates. customTo is
// clamped up to customFrom here (never producing a negative-length range);
// the raw, possibly-invalid customTo is still compared separately by the
// caller to decide whether to show the "invalid range" warning.
function computeRange(mode: RangeMode, anchor: Date, customFrom: Date, customTo: Date): { viewStart: Date; viewEnd: Date } {
  switch (mode) {
    case 'week1': { const s = sundayOnOrBefore(anchor); return { viewStart: s, viewEnd: addDays(s, 6) } }
    case 'week2': { const s = sundayOnOrBefore(anchor); return { viewStart: s, viewEnd: addDays(s, 13) } }
    case 'week3': { const s = sundayOnOrBefore(anchor); return { viewStart: s, viewEnd: addDays(s, 20) } }
    case 'calendarMonth': {
      const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const e = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      return { viewStart: s, viewEnd: e }
    }
    case 'rollingMonth': {
      const s = startOfDay(anchor)
      return { viewStart: s, viewEnd: rollingMonthEnd(s) }
    }
    case 'custom': {
      const s = customFrom
      const e = customTo < customFrom ? customFrom : customTo
      return { viewStart: s, viewEnd: e }
    }
  }
}

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
  /** True once the pointer is up and the confirmed save is in flight —
   *  kept alive (not cleared) until it resolves, both to avoid a visual
   *  flash back to the old position and to keep suppressing the
   *  post-drag click that would otherwise reopen the task. */
  saving: boolean
}

interface ResizeState {
  taskId: string
  edge: 'start' | 'end'
  startX: number
  origStart: string
  origDue: string
  deltaDays: number
  saving: boolean
}

interface UnscheduledDragState {
  taskId: string
  startX: number
  startY: number
  pointerX: number
  pointerY: number
  /** False until movement exceeds the click-vs-drag threshold. */
  active: boolean
  targetDayIndex: number | null
}

// ─── Checkbox multi-select filter dropdown ───────────────────────────────────
// Shared by Boards, Users, Priorities and Statuses — same visual pattern and
// interaction for all four: a summary button, an outside-click-to-close
// panel (a click on any checkbox inside is never mistaken for "outside"
// since it's still inside the ref'd container, so multiple selections in
// one open session work as expected), and Select All / Clear All controls.
// `hidden` holds the currently UNCHECKED item ids — empty means "all
// selected", matching the existing Boards filter's own convention.

interface FilterItem { id: string; label: string }
interface GanttStats { scheduled: number; withoutDates: number }

function CheckboxFilterDropdown({
  items, hidden, onToggle, onSelectAll, onDeselectAll, allLabel, unitLabel, quickActionLabel, onQuickAction,
}: {
  items: FilterItem[]
  hidden: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  /** Shown on the trigger button when nothing is hidden, e.g. "כל הבורדים". */
  allLabel: string
  /** Shown after the visible/total count when partially selected, e.g. "בורדים". */
  unitLabel: string
  quickActionLabel?: string
  onQuickAction?: () => void
}) {
  const { t } = useWorkLang()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 })

  const positionPanel = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setPanelPosition({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 224)),
    })
  }, [])

  function toggleOpen() {
    if (!open) positionPanel()
    setOpen(value => !value)
  }

  useEffect(() => {
    function handle(e: MouseEvent) {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  useEffect(() => {
    if (!open) return
    positionPanel()
    window.addEventListener('resize', positionPanel)
    window.addEventListener('scroll', positionPanel, true)
    return () => {
      window.removeEventListener('resize', positionPanel)
      window.removeEventListener('scroll', positionPanel, true)
    }
  }, [open, positionPanel])

  const visibleCount = items.length - hidden.size
  const label = hidden.size === 0
    ? allLabel
    : `${visibleCount}/${items.length} ${unitLabel}`

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        className={`flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 bg-white transition-colors focus:outline-none ${hidden.size > 0 ? 'border-primary text-primary font-semibold' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
      >
        {label}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[100] min-w-52 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
          style={{ top: panelPosition.top, left: panelPosition.left }}
        >
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100 sticky top-0 bg-white">
            <button onClick={onSelectAll} className="text-xs text-primary font-semibold hover:underline">{t('בחר הכל', 'Select all')}</button>
            {onQuickAction && quickActionLabel && (
              <button onClick={onQuickAction} className="text-xs text-primary font-bold hover:underline">{quickActionLabel}</button>
            )}
            <button onClick={onDeselectAll} className="text-xs text-gray-400 font-semibold hover:underline">{t('בטל הכל', 'Clear all')}</button>
          </div>
          <div className="flex flex-col gap-1">
            {items.map(item => {
              const checked = !hidden.has(item.id)
              return (
                <button type="button" key={item.id} onClick={() => onToggle(item.id)} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-gray-50 cursor-pointer">
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center border transition-colors cursor-pointer shrink-0 ${checked ? 'bg-primary border-primary' : 'border-gray-300 bg-white'}`}
                  >
                    {checked && <Check size={10} className="text-white" />}
                  </div>
                  <span className="text-xs text-gray-700 flex-1 truncate">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ─── GanttTab ─────────────────────────────────────────────────────────────────

const TASK_COL_WIDTH   = 280
const MIN_DAY_WIDTH    = 64
const DRAG_THRESHOLD_PX = 5

export function GanttTab({
  tasks, boards, assignees, profiles, myProfileId, onStatsChange, onOpenTask, onUpdateTask, readonly = false,
}: {
  tasks: Task[]
  boards: Board[]
  assignees: string[]
  /** Active profiles (id + display name) — the Users filter's authoritative
   *  option list and the source for resolving a task's assigneeId to a
   *  name when only a legacy display-name match is possible. */
  profiles: { id: string; name: string }[]
  myProfileId?: string
  onStatsChange?: Dispatch<SetStateAction<GanttStats>>
  onOpenTask: (id: string) => void
  /** Non-optimistic: resolves with the server-confirmed task, or rejects.
   *  Every Gantt interaction (whole-task drag, resize, unscheduled drop)
   *  awaits this and rolls its own local preview back to the task's real,
   *  unchanged dates on rejection — see updateTaskConfirmed() in Work.tsx. */
  onUpdateTask: (t: Task) => Promise<Task>
  readonly?: boolean
}) {
  const { t } = useWorkLang()

  const [mode,   setMode]   = useState<RangeMode>(storedRangeMode)
  const [anchor, setAnchor] = useState<Date>(() => storedLocalDate(GANTT_STORAGE.anchor, startOfDay(new Date())))
  const [customFrom, setCustomFrom] = useState<Date>(() => storedLocalDate(GANTT_STORAGE.customFrom, startOfDay(new Date())))
  const [customTo,   setCustomTo]   = useState<Date>(() => storedLocalDate(GANTT_STORAGE.customTo, addDays(startOfDay(new Date()), 13)))
  const [drag,   setDrag]   = useState<DragState | null>(null)
  const [resize, setResize] = useState<ResizeState | null>(null)
  const [unscheduledDrag, setUnscheduledDrag] = useState<UnscheduledDragState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!actionError) return
    const timer = setTimeout(() => setActionError(null), 5000)
    return () => clearTimeout(timer)
  }, [actionError])

  // Pruned against the raw boards prop (not visibleBoardsForFilters below,
  // which is itself derived FROM this) — see usePrunedHiddenSet.
  const [hiddenBoards, setHiddenBoards] = usePrunedHiddenSet(useMemo(() => boards.map(b => b.id), [boards]), GANTT_STORAGE.boards)

  const colorMap = useMemo(() => {
    return Object.fromEntries(assignees.map((a, i) => [a, PALETTE[i % PALETTE.length]]))
  }, [assignees])

  // Priorities and statuses are scoped to whichever boards are currently
  // selected in the Boards filter (not the full board list) — unchecking a
  // board also narrows these two option lists to what the remaining
  // selected boards actually define, per board-scoped priority/status
  // resolution used everywhere else (resolveTaskPriority etc.).
  const visibleBoardsForFilters = useMemo(
    () => boards.filter(b => !hiddenBoards.has(b.id)),
    [boards, hiddenBoards]
  )

  // Every task whose assignee can only be resolved by legacy display-name
  // matching (no assigneeId) AND whose name doesn't match any currently
  // active profile gets a real, selectable, deduplicated Legacy/Inactive
  // option here — this is what taskAssigneeKey()'s `name:<value>` bucket
  // actually maps onto in the UI, so such a task is hidden by "select a
  // specific other user" exactly like any other bucket, instead of always
  // slipping through every filter combination.
  const legacyUserOptions = useMemo<FilterItem[]>(() => {
    const seen = new Set<string>()
    const result: FilterItem[] = []
    for (const task of tasks) {
      if (task.assigneeId) continue
      const name = task.assignee?.trim()
      if (!name) continue
      if (profiles.some(p => p.name === name)) continue
      const key = `name:${name}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ id: key, label: t(`${name} (ישן/לא פעיל)`, `${name} (Legacy/Inactive)`) })
    }
    return result
  }, [tasks, profiles, t])

  const userOptions = useMemo<FilterItem[]>(() => [
    ...profiles.map(p => ({ id: p.id, label: p.name })),
    { id: UNASSIGNED_KEY, label: t('לא משויך', 'Unassigned') },
    ...legacyUserOptions,
  ], [profiles, legacyUserOptions, t])

  const priorityOptions = useMemo<FilterItem[]>(() =>
    Array.from(new Map(visibleBoardsForFilters.flatMap(b => priorityDefsForBoard(b)).map(p => [p.id, p])).values())
      .map(p => ({ id: p.id, label: p.label })),
    [visibleBoardsForFilters]
  )

  // 'done' is permanently excluded (see the baseline filter below) so it
  // is never offered as a selectable status — completed tasks are outside
  // the active-planning Gantt by definition. 'archived' is excluded for
  // the same reason: archived tasks never appear regardless of this
  // filter, so listing it would be a dead, do-nothing option. Every other
  // board-defined status — including custom ones, and explicitly
  // including review/to-deploy style statuses — remains selectable.
  const statusOptions = useMemo<FilterItem[]>(() =>
    Array.from(new Map(visibleBoardsForFilters.flatMap(b => statusesForBoard(b)).map(s => [s.id, s])).values())
      .filter(s => s.id !== 'done' && s.id !== 'archived')
      .sort((a, b) => a.order - b.order)
      .map(s => ({ id: s.id, label: s.label })),
    [visibleBoardsForFilters]
  )

  const [hiddenUserKeys,   setHiddenUserKeys]   = usePrunedHiddenSet(useMemo(() => userOptions.map(o => o.id), [userOptions]), GANTT_STORAGE.users)
  const [hiddenPriorities, setHiddenPriorities] = usePrunedHiddenSet(useMemo(() => priorityOptions.map(o => o.id), [priorityOptions]), GANTT_STORAGE.priorities)
  const [hiddenStatuses,   setHiddenStatuses]   = usePrunedHiddenSet(useMemo(() => statusOptions.map(o => o.id), [statusOptions]), GANTT_STORAGE.statuses)

  useEffect(() => {
    try {
      localStorage.setItem(GANTT_STORAGE.mode, mode)
      localStorage.setItem(GANTT_STORAGE.anchor, toIso(anchor))
      localStorage.setItem(GANTT_STORAGE.customFrom, toIso(customFrom))
      localStorage.setItem(GANTT_STORAGE.customTo, toIso(customTo))
    } catch { /* preference remains in memory */ }
  }, [mode, anchor, customFrom, customTo])

  const customRangeInvalid = customTo < customFrom

  const { viewStart, viewEnd } = useMemo(
    () => computeRange(mode, anchor, customFrom, customTo),
    [mode, anchor, customFrom, customTo]
  )
  const totalDays = daysBetween(viewStart, viewEnd) + 1

  // ── Dynamic day width ──
  // The selected range determines the visual scale: short ranges (weeks)
  // stretch to fill the real, measured timeline viewport with no leftover
  // blank space; long ranges (a 31-day calendar month, a wide custom
  // range) fall back to a fixed, readable minimum and let the container
  // scroll horizontally instead of squeezing columns into illegibility.
  // ResizeObserver (not window.innerWidth) is deliberate: it fires for
  // every actual cause of a width change to THIS element — window
  // resize, the sidebar expanding/collapsing (Layout.tsx sits the Gantt
  // in a flex-1 column next to it), or any other layout shift — without
  // having to separately listen for each one.
  const timelineRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)

  useEffect(() => {
    const el = timelineRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setViewportWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setViewportWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  // Week modes (1/2/3) always expand to fill the measured width exactly —
  // no floor — per the explicit "expanded to fill the available timeline
  // width" requirement for those three. Calendar Month, Rolling Month and
  // Custom Range get the OTHER, separately-specified behavior: fill when
  // that stays readable, otherwise fall back to MIN_DAY_WIDTH and let the
  // container scroll horizontally instead of squeezing potentially many
  // more columns into illegibility.
  const fillWidth = viewportWidth === 0 ? MIN_DAY_WIDTH : (viewportWidth - TASK_COL_WIDTH) / totalDays
  const dayWidth = (mode === 'week1' || mode === 'week2' || mode === 'week3')
    ? Math.max(0, fillWidth)
    : Math.max(MIN_DAY_WIDTH, fillWidth)
  // The day-grid's own content width, applied as an EXPLICIT `width` (not
  // just `minWidth`) everywhere below — see the render section for why:
  // a plain block/flex element sized only by `min-width` inside several
  // layers of flex nesting was not reliably expanding past its container
  // in every browser layout pass, so long ranges never actually overflowed
  // `timelineRef`'s own overflow-auto box and instead got silently clipped
  // by an ancestor's overflow-hidden — no scrollbar, no visible fix. An
  // explicit width removes that ambiguity outright.
  const timelineContentWidth = totalDays * dayWidth

  // Drives an explicit overflow-x-scroll/hidden switch (see the render
  // section) instead of leaning on `overflow-x-auto`'s own overflow
  // detection — that keeps the scrollbar's presence tied to the exact
  // same width numbers the layout itself uses, so it can never silently
  // disagree with what's actually rendered. viewportWidth === 0 (not yet
  // measured) deliberately reads as "no overflow" rather than guessing —
  // the very next ResizeObserver callback corrects it. The 1px epsilon
  // absorbs sub-pixel rounding so a Week view that fills EXACTLY doesn't
  // flicker a scrollbar track from floating-point noise.
  const hasHorizontalOverflow = viewportWidth > 0 && (TASK_COL_WIDTH + timelineContentWidth) > viewportWidth + 1

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

  const today = useMemo(() => startOfDay(new Date()), [])
  const todayOffset = daysBetween(viewStart, today) * dayWidth

  function goPrev() {
    if (mode === 'week1') setAnchor(addDays(viewStart, -7))
    else if (mode === 'week2') setAnchor(addDays(viewStart, -14))
    else if (mode === 'week3') setAnchor(addDays(viewStart, -21))
    else if (mode === 'calendarMonth' || mode === 'rollingMonth') setAnchor(addMonthsClamped(viewStart, -1))
    else { setCustomFrom(f => addDays(f, -totalDays)); setCustomTo(tt => addDays(tt, -totalDays)) }
  }
  function goNext() {
    if (mode === 'week1') setAnchor(addDays(viewStart, 7))
    else if (mode === 'week2') setAnchor(addDays(viewStart, 14))
    else if (mode === 'week3') setAnchor(addDays(viewStart, 21))
    else if (mode === 'calendarMonth' || mode === 'rollingMonth') setAnchor(addMonthsClamped(viewStart, 1))
    else { setCustomFrom(f => addDays(f, totalDays)); setCustomTo(tt => addDays(tt, totalDays)) }
  }
  function goToday() {
    const t0 = startOfDay(new Date())
    if (mode === 'custom') { setCustomFrom(t0); setCustomTo(addDays(t0, totalDays - 1)) }
    else setAnchor(t0)
  }

  const filtered = useMemo(() => tasks.filter(t => {
    // Baseline, not filter-driven: completed and archived tasks are
    // always outside the active-planning Gantt, regardless of what's
    // checked above. Literal 'done' only — a to-deploy or review status
    // is never treated as completed.
    if (t.status === 'done' || t.status === 'archived') return false
    if (hiddenBoards.size > 0 && hiddenBoards.has(t.board)) return false
    if (hiddenUserKeys.size > 0 && hiddenUserKeys.has(taskAssigneeKey(t, profiles))) return false
    if (hiddenPriorities.size > 0 && hiddenPriorities.has(t.priority)) return false
    if (hiddenStatuses.size > 0 && hiddenStatuses.has(t.status)) return false
    return true
  }), [tasks, hiddenBoards, hiddenUserKeys, hiddenPriorities, hiddenStatuses, profiles])

  const scheduled   = filtered.filter(t => t.dueDate)
  const unscheduled = filtered.filter(t => !t.dueDate)

  useEffect(() => {
    onStatsChange?.(previous => previous.scheduled === scheduled.length && previous.withoutDates === unscheduled.length
      ? previous
      : { scheduled: scheduled.length, withoutDates: unscheduled.length })
  }, [scheduled.length, unscheduled.length, onStatsChange])

  // left/width in pixels, honoring whichever live preview (whole-drag or
  // edge-resize) currently applies to this task, if any. Width uses +1 day
  // so an inclusive 1-day task (start === due) renders as exactly one full
  // column, and a 2-day task spans exactly two — not one short.
  function barGeometry(t: Task): { left: number; width: number; isPoint: boolean } {
    const isDragging  = drag?.taskId === t.id
    const isResizing  = resize?.taskId === t.id
    const dueD = parseIsoDateLocal(t.dueDate!)

    if (t.startDate) {
      let startD = parseIsoDateLocal(t.startDate)
      let endD   = dueD
      if (isDragging) {
        startD = addDays(startD, drag.deltaDays)
        endD   = addDays(endD, drag.deltaDays)
      } else if (isResizing) {
        if (resize.edge === 'start') {
          startD = addDays(startD, resize.deltaDays)
          if (startD > endD) startD = endD
        } else {
          endD = addDays(endD, resize.deltaDays)
          if (endD < startD) endD = startD
        }
      }
      const left  = daysBetween(viewStart, startD) * dayWidth
      const width = Math.max(dayWidth, (daysBetween(startD, endD) + 1) * dayWidth)
      return { left, width, isPoint: false }
    } else {
      const delta = isDragging ? drag.deltaDays : 0
      const left = daysBetween(viewStart, addDays(dueD, delta)) * dayWidth + dayWidth / 2 - 10
      return { left, width: 20, isPoint: true }
    }
  }

  // ── Whole-bar drag (existing tasks that already have both dates) ──
  const onBarPointerDown = useCallback((e: React.PointerEvent, task: Task) => {
    if (readonly) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ taskId: task.id, startX: e.clientX, origStart: task.startDate, origDue: task.dueDate, deltaDays: 0, saving: false })
  }, [readonly])

  const onBarPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag || drag.saving) return
    const rawDelta = (e.clientX - drag.startX) / dayWidth
    setDrag(prev => prev ? { ...prev, deltaDays: Math.round(rawDelta) } : null)
  }, [drag, dayWidth])

  const onBarPointerUp = useCallback((e: React.PointerEvent, task: Task) => {
    if (readonly || !drag || drag.saving) return
    if (drag.deltaDays === 0) { setDrag(null); return }
    const updated = { ...task }
    if (drag.origDue)   updated.dueDate   = toIso(addDays(parseIsoDateLocal(drag.origDue),   drag.deltaDays))
    if (drag.origStart) updated.startDate = toIso(addDays(parseIsoDateLocal(drag.origStart), drag.deltaDays))
    // Preview (drag state) is kept alive — not cleared — through the
    // await: this avoids a flash back to the old position on success, and
    // on failure clearing it afterward is exactly what "restores the
    // original dates" (barGeometry falls back to the task's real,
    // never-mutated dates the instant `drag` is null again).
    setDrag(prev => prev ? { ...prev, saving: true } : null)
    onUpdateTask(updated)
      .catch(err => setActionError(err instanceof Error ? err.message : 'העברת המשימה נכשלה'))
      .finally(() => setDrag(null))
  }, [readonly, drag, onUpdateTask])

  // ── Left/right edge resize ──
  const onResizePointerDown = useCallback((e: React.PointerEvent, task: Task, edge: 'start' | 'end') => {
    if (readonly || !task.startDate || !task.dueDate) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setResize({ taskId: task.id, edge, startX: e.clientX, origStart: task.startDate, origDue: task.dueDate, deltaDays: 0, saving: false })
  }, [readonly])

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resize || resize.saving) return
    const rawDelta = (e.clientX - resize.startX) / dayWidth
    setResize(prev => prev ? { ...prev, deltaDays: Math.round(rawDelta) } : null)
  }, [resize, dayWidth])

  const onResizePointerUp = useCallback((e: React.PointerEvent, task: Task) => {
    if (readonly || !resize || resize.saving) return
    if (resize.deltaDays === 0) { setResize(null); return }
    const origStartD = parseIsoDateLocal(resize.origStart)
    const origDueD    = parseIsoDateLocal(resize.origDue)
    let newStartD = origStartD
    let newDueD   = origDueD
    // Minimum duration is one day: the moving edge may reach, but never
    // pass, the opposite (fixed) edge.
    if (resize.edge === 'start') {
      newStartD = addDays(origStartD, resize.deltaDays)
      if (newStartD > origDueD) newStartD = origDueD
    } else {
      newDueD = addDays(origDueD, resize.deltaDays)
      if (newDueD < origStartD) newDueD = origStartD
    }
    const updated = { ...task, startDate: toIso(newStartD), dueDate: toIso(newDueD) }
    setResize(prev => prev ? { ...prev, saving: true } : null)
    onUpdateTask(updated)
      .catch(err => setActionError(err instanceof Error ? err.message : 'שינוי גודל המשימה נכשל'))
      .finally(() => setResize(null))
  }, [readonly, resize, onUpdateTask])

  // ── Unscheduled -> timeline drag-to-schedule ──
  // Translates an absolute pointer position into a day index using the
  // timeline viewport's OWN bounding rect + its current scrollLeft (not a
  // relative delta from drag-start, unlike whole-bar drag/resize above) —
  // this is the one interaction that genuinely needs to know which exact
  // column the pointer is physically over right now.
  const pointerToDayIndex = useCallback((clientX: number, clientY: number): number | null => {
    const el = timelineRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (clientY < rect.top || clientY > rect.bottom) return null
    const relativeX = clientX - rect.left - TASK_COL_WIDTH + el.scrollLeft
    if (relativeX < 0) return null
    const idx = Math.floor(relativeX / dayWidth)
    if (idx < 0 || idx >= totalDays) return null
    return idx
  }, [dayWidth, totalDays])

  // Pressing anywhere on the row's left-list entry (title, priority dot,
  // badge, avatar, or the grip icon) starts tracking — but deliberately
  // does NOT call preventDefault()/setPointerCapture() yet, so a normal
  // click on the title button (or anywhere else) is completely
  // undisturbed unless the pointer actually moves past the threshold.
  // That deferred step happens in the move handler below, once real
  // movement proves this is a drag and not a click.
  const onUnscheduledRowPointerDown = useCallback((e: React.PointerEvent, task: Task) => {
    if (readonly) return
    setUnscheduledDrag({ taskId: task.id, startX: e.clientX, startY: e.clientY, pointerX: e.clientX, pointerY: e.clientY, active: false, targetDayIndex: null })
  }, [readonly])

  const onUnscheduledPointerMove = useCallback((e: React.PointerEvent) => {
    if (!unscheduledDrag) return
    const dx = e.clientX - unscheduledDrag.startX
    const dy = e.clientY - unscheduledDrag.startY
    const justCrossedThreshold = !unscheduledDrag.active && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX
    if (justCrossedThreshold) {
      // Now — and only now — commit to "this is a drag": suppress the
      // native click/text-selection that would otherwise follow, and
      // capture the pointer (on this outer wrapper, where these handlers
      // already live) so move/up keep being delivered here regardless of
      // which element the pointer physically passes over next.
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    const active = unscheduledDrag.active || justCrossedThreshold
    const targetDayIndex = active ? pointerToDayIndex(e.clientX, e.clientY) : null
    setUnscheduledDrag(prev => prev ? { ...prev, active, pointerX: e.clientX, pointerY: e.clientY, targetDayIndex } : null)
  }, [unscheduledDrag, pointerToDayIndex])

  const onUnscheduledPointerUp = useCallback(() => {
    if (!unscheduledDrag) return
    const { taskId, active, targetDayIndex } = unscheduledDrag
    setUnscheduledDrag(null)
    if (!active || targetDayIndex === null) return // click, or dropped outside the timeline -> no change
    const task = tasks.find(x => x.id === taskId)
    if (!task) return
    const droppedIso = toIso(addDays(viewStart, targetDayIndex))
    const durationDays = task.startDate && task.dueDate
      ? Math.max(0, daysBetween(parseIsoDateLocal(task.startDate), parseIsoDateLocal(task.dueDate)))
      : 0
    const updated = {
      ...task,
      startDate: droppedIso,
      dueDate: toIso(addDays(parseIsoDateLocal(droppedIso), durationDays)),
    }
    onUpdateTask(updated).catch(err => {
      // Nothing local to roll back — this task was never optimistically
      // removed from the Unscheduled list; it stays there automatically
      // because `tasks` (and therefore `unscheduled`) never changed.
      setActionError(err instanceof Error ? err.message : 'תזמון המשימה נכשל')
    })
  }, [unscheduledDrag, tasks, viewStart, onUpdateTask])

  const ROW_H = 44
  const draggedUnscheduledTask = unscheduledDrag ? tasks.find(x => x.id === unscheduledDrag.taskId) : undefined

  return (
    <div
      className="flex flex-col flex-1 min-h-0 w-full max-w-full min-w-0 gap-2"
      onPointerMove={unscheduledDrag ? onUnscheduledPointerMove : undefined}
      onPointerUp={unscheduledDrag ? onUnscheduledPointerUp : undefined}
    >

      {/* Range controls + filters — one compact horizontal toolbar. */}
      <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap pb-0.5">
        <select
          value={mode}
          onChange={e => setMode(e.target.value as RangeMode)}
          className="order-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 font-semibold focus:outline-none focus:border-primary"
        >
          {(Object.keys(MODE_LABELS) as RangeMode[]).map(m => (
            <option key={m} value={m}>{t(MODE_LABELS[m].he, MODE_LABELS[m].en)}</option>
          ))}
        </select>

        <div className="order-1 flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
          <button onClick={goPrev} title={t('הקודם', 'Previous')} className="p-1.5 text-gray-500 hover:bg-gray-50 hover:text-primary transition-colors">
            <ChevronLeft size={14} />
          </button>
          <button onClick={goToday} className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:text-primary transition-colors border-x border-gray-200">
            {t('היום', 'Today')}
          </button>
          <button onClick={goNext} title={t('הבא', 'Next')} className="p-1.5 text-gray-500 hover:bg-gray-50 hover:text-primary transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>

        {mode === 'custom' && (
          <div className="order-1 flex items-center gap-1.5">
            <input
              type="date"
              value={toIso(customFrom)}
              onChange={e => { if (e.target.value) setCustomFrom(parseIsoDateLocal(e.target.value)) }}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-primary"
            />
            <span className="text-xs text-gray-400">—</span>
            <input
              type="date"
              value={toIso(customTo)}
              onChange={e => { if (e.target.value) setCustomTo(parseIsoDateLocal(e.target.value)) }}
              className={`text-xs border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-primary ${customRangeInvalid ? 'border-red-300 text-red-600' : 'border-gray-200'}`}
            />
            {customRangeInvalid && (
              <span className="text-[10px] text-red-500 font-semibold">{t('טווח לא תקין — התאריך הסופי קודם להתחלה', 'Invalid range — end date is before start date')}</span>
            )}
          </div>
        )}

        <span className="order-1 text-xs text-gray-500 font-medium">
          {viewStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          {' – '}
          {viewEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>

        {actionError && (
          <span className="order-1 flex items-center gap-1.5 text-[11px] text-red-600 font-semibold bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
            {actionError}
            <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </span>
        )}
        {/* Multi-board checkbox filter */}
        <CheckboxFilterDropdown
          items={boards.map(b => ({ id: b.id, label: b.name }))}
          hidden={hiddenBoards}
          onToggle={id => setHiddenBoards(prev => toggleInSet(prev, id))}
          onSelectAll={() => setHiddenBoards(new Set())}
          onDeselectAll={() => setHiddenBoards(new Set(boards.map(b => b.id)))}
          allLabel={t('כל הבורדים', 'All boards')}
          unitLabel={t('בורדים', 'boards')}
        />

        {/* Users — assigneeId authoritative, legacy name-matched as a
            fallback, everything else bucketed under Unassigned, and every
            unmatched legacy name exposed as its own Legacy/Inactive
            checkbox. See taskAssigneeKey() / legacyUserOptions above. */}
        <CheckboxFilterDropdown
          items={userOptions}
          hidden={hiddenUserKeys}
          onToggle={id => setHiddenUserKeys(prev => toggleInSet(prev, id))}
          onSelectAll={() => setHiddenUserKeys(new Set())}
          onDeselectAll={() => setHiddenUserKeys(new Set(userOptions.map(o => o.id)))}
          allLabel={t('כל המשתמשים', 'All users')}
          unitLabel={t('משתמשים', 'users')}
          quickActionLabel={myProfileId ? t('רק אני', 'Only me') : undefined}
          onQuickAction={myProfileId ? () => setHiddenUserKeys(new Set(userOptions.filter(o => o.id !== myProfileId).map(o => o.id))) : undefined}
        />

        {/* Priorities — ids/labels reused as-is from the currently
            selected boards' own priority arrays, deduplicated by id.
            Each row's own displayed priority is still resolved from its
            OWN board only (resolveTaskPriority), never from this merged
            enumeration. */}
        <CheckboxFilterDropdown
          items={priorityOptions}
          hidden={hiddenPriorities}
          onToggle={id => setHiddenPriorities(prev => toggleInSet(prev, id))}
          onSelectAll={() => setHiddenPriorities(new Set())}
          onDeselectAll={() => setHiddenPriorities(new Set(priorityOptions.map(o => o.id)))}
          allLabel={t('כל העדיפויות', 'All priorities')}
          unitLabel={t('עדיפויות', 'priorities')}
        />

        {/* Statuses — active statuses from the currently selected boards
            only; Done and Archive are never offered (see statusOptions). */}
        <CheckboxFilterDropdown
          items={statusOptions}
          hidden={hiddenStatuses}
          onToggle={id => setHiddenStatuses(prev => toggleInSet(prev, id))}
          onSelectAll={() => setHiddenStatuses(new Set())}
          onDeselectAll={() => setHiddenStatuses(new Set(statusOptions.map(o => o.id)))}
          allLabel={t('כל הסטטוסים', 'All statuses')}
          unitLabel={t('סטטוסים', 'statuses')}
        />
        <div className="order-2 min-w-3 flex-1" />
        {/* Assignee legend */}
        <div className="order-2 flex shrink-0 items-center gap-2">
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
      </div>

      {/* Gantt grid — ONE shared horizontal scroll container for both header
          rows and every task row, so they can never desynchronize; the
          inner content div below is given an EXPLICIT width (not minWidth)
          so it reliably overflows this box on long ranges instead of
          silently deferring to an ancestor's overflow-hidden.

          w-full/max-w-full/min-w-0 here (and the same trio up the chain in
          Work.tsx) exist so this box is held to the actually-available
          width rather than being allowed to grow to fit its own oversized
          child — that growth is exactly what was silently swallowing the
          overflow before it ever reached this element's own scrollbar.

          overflow-x is switched explicitly between scroll/hidden (driven
          by hasHorizontalOverflow, computed from the same width numbers
          used everywhere else) instead of left as `auto` — `scroll` always
          renders a real, draggable scrollbar track when a range is wider
          than the viewport, rather than depending on the browser's own
          overflow detection agreeing with this component's math.
          scrollbar-gutter:stable reserves that track's space up front so
          it can never appear to be clipped by a neighboring border/radius.

          dir="ltr" is set explicitly (not just inherited from Work.tsx's
          own root dir="ltr") so the chronological, left-to-right timeline
          and its scrollLeft semantics are self-contained and don't depend
          on an ancestor never changing — Hebrew task titles inside get
          their own dir="rtl" back further down, see the sticky cells. */}
      <div
        ref={timelineRef}
        dir="ltr"
        className={`flex-1 min-h-0 w-full max-w-full min-w-0 ${hasHorizontalOverflow ? 'overflow-x-scroll' : 'overflow-x-hidden'} overflow-y-auto rounded-xl border border-gray-200 bg-white`}
        style={{ scrollbarGutter: 'stable' }}
      >
        <div className="relative" style={{ width: TASK_COL_WIDTH + timelineContentWidth }}>

          {/* Header row 1 — months */}
          <div className="flex sticky top-0 z-20 bg-white border-b border-gray-200">
            <div className="sticky left-0 z-30 bg-gray-50 border-r border-gray-200 flex items-center px-4 shrink-0" style={{ width: TASK_COL_WIDTH, height: 28 }}>
              <span dir="rtl" className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">משימה</span>
            </div>
            <div className="flex shrink-0" style={{ width: timelineContentWidth }}>
              {months.map(m => (
                <div key={m.label + m.startDay} style={{ width: m.span * dayWidth }} className="flex items-center justify-center border-r border-gray-100 h-7">
                  <span className="text-[10px] font-semibold text-gray-500">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Header row 2 — weekday name + exact date, every column.
              Weekday names are always English, even in the Hebrew UI. */}
          <div className="flex sticky top-7 z-20 bg-white border-b border-gray-200">
            <div className="sticky left-0 z-30 bg-gray-50 border-r border-gray-200 shrink-0" style={{ width: TASK_COL_WIDTH, height: 40 }} />
            <div className="flex shrink-0" style={{ width: timelineContentWidth }}>
              {days.map((d, i) => {
                const isToday = d.getTime() === today.getTime()
                const isSun   = d.getDay() === 0
                return (
                  <div
                    key={i}
                    style={{ width: dayWidth }}
                    className={`flex flex-col items-center justify-center gap-0.5 border-r border-gray-50 h-10 ${isSun ? 'bg-primary/5 border-l-2 border-l-primary/20' : ''}`}
                  >
                    <span className={`text-[8px] font-semibold uppercase tracking-wide ${isSun ? 'text-primary' : 'text-gray-400'}`}>
                      {WEEKDAY_NAMES_EN[d.getDay()]}
                    </span>
                    <span className={`text-[11px] font-mono leading-none ${isToday ? 'text-primary font-bold' : 'text-gray-600'}`}>
                      {d.getDate()}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Drop-target column highlight, spanning the full grid height */}
          {unscheduledDrag?.active && unscheduledDrag.targetDayIndex !== null && (
            <div
              className="absolute top-0 bottom-0 bg-primary/10 border-x-2 border-primary/50 pointer-events-none z-10"
              style={{ left: TASK_COL_WIDTH + unscheduledDrag.targetDayIndex * dayWidth, width: dayWidth }}
            />
          )}

          {/* Scheduled task rows */}
          {scheduled.map(task => {
            const p       = resolveTaskPriority(task, boards)
            const color   = colorMap[task.assignee] ?? PALETTE[0]
            const { left: bl, width: bw, isPoint } = barGeometry(task)
            const isDue   = parseIsoDateLocal(task.dueDate!) < today
            const isDrag  = drag?.taskId === task.id
            const isResizing = resize?.taskId === task.id
            const isBusy  = (isDrag && drag.saving) || (isResizing && resize.saving)
            const isOutsideRange = !(bl < timelineContentWidth && bl + bw > 0)
            const isOutsideBeingDragged = isOutsideRange && unscheduledDrag?.taskId === task.id && unscheduledDrag.active

            return (
              <div key={task.id} className={`flex border-b border-gray-50 hover:bg-gray-50/50 group ${isOutsideBeingDragged ? 'opacity-40' : ''}`} style={{ height: ROW_H }}>
                <div
                  onPointerDown={readonly || !isOutsideRange ? undefined : e => onUnscheduledRowPointerDown(e, task)}
                  className={`sticky left-0 z-10 bg-white group-hover:bg-gray-50/50 border-r border-gray-100 flex items-center gap-2 px-3 shrink-0 select-none ${!readonly && isOutsideRange ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  style={{ width: TASK_COL_WIDTH, minWidth: TASK_COL_WIDTH }}
                >
                  {!readonly && isOutsideRange && <GripVertical size={12} className="text-primary shrink-0" />}
                  {p && <span className={`w-2 h-2 rounded-full shrink-0 ${p.dotCls}`} />}
                  <button dir="rtl" onClick={() => !unscheduledDrag?.active && onOpenTask(task.id)} className="flex-1 text-xs text-gray-800 truncate hover:text-primary transition-colors text-left font-medium">{task.title}</button>
                  <ClientBadge name={task.clientName} />
                  <Avatar name={task.assignee} size="xs" />
                </div>

                <div
                  className="relative shrink-0"
                  style={{ width: timelineContentWidth, height: ROW_H }}
                  onPointerMove={isDrag ? onBarPointerMove : isResizing ? onResizePointerMove : undefined}
                  onPointerUp={isDrag ? e => onBarPointerUp(e, task) : isResizing ? e => onResizePointerUp(e, task) : undefined}
                >
                  {days.map((d, i) => d.getDay() === 0 ? (
                    <div key={i} className="absolute top-0 bottom-0 bg-gray-50/80" style={{ left: i * dayWidth, width: dayWidth }} />
                  ) : null)}

                  {todayOffset >= 0 && todayOffset <= timelineContentWidth && (
                    <div className="absolute top-0 bottom-0 w-0.5 z-10 pointer-events-none" style={{ left: todayOffset, backgroundColor: '#6366f1', opacity: 0.3 }} />
                  )}

                  {isOutsideRange && (
                    <span className="absolute inset-0 flex items-center px-4 text-[10px] italic text-gray-400 pointer-events-none">
                      {t('מחוץ לטווח — גרור את שורת המשימה לתאריך חדש', 'Outside this range — drag the task row to a new date')}
                    </span>
                  )}

                  {bl < timelineContentWidth && bl + bw > 0 && (
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
                        className={`group/bar absolute top-2.5 rounded-md select-none transition-opacity ${readonly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
                        style={{
                          left: Math.max(0, bl),
                          width: Math.min(bw, timelineContentWidth - Math.max(0, bl)),
                          height: ROW_H - 20,
                          backgroundColor: color.bg,
                          opacity: isDue ? 0.6 : (isDrag || isResizing) ? 0.75 : 1,
                          boxShadow: (isDrag || isResizing) ? '0 4px 12px rgba(0,0,0,0.2)' : undefined,
                          outline: isDue ? '2px solid #ef4444' : undefined,
                        }}
                        onPointerDown={readonly || isBusy ? undefined : e => onBarPointerDown(e, task)}
                        onClick={() => !drag && !resize && onOpenTask(task.id)}
                      >
                        <span className="px-2 text-[9px] font-semibold truncate block leading-[24px]" style={{ color: '#fff' }}>{task.title}</span>

                        {!readonly && (
                          <>
                            {/* Left handle — start date */}
                            <div
                              onPointerDown={e => onResizePointerDown(e, task, 'start')}
                              onClick={e => e.stopPropagation()}
                              title="שנה תאריך התחלה"
                              className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 hover:bg-black/20 rounded-l-md transition-opacity"
                            />
                            {/* Right handle — due date */}
                            <div
                              onPointerDown={e => onResizePointerDown(e, task, 'end')}
                              onClick={e => e.stopPropagation()}
                              title="שנה תאריך יעד"
                              className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 hover:bg-black/20 rounded-r-md transition-opacity"
                            />
                          </>
                        )}
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
                <div className="sticky left-0 z-10 bg-gray-50/80 border-r border-gray-100 px-4 py-2 shrink-0" style={{ width: TASK_COL_WIDTH, minWidth: TASK_COL_WIDTH }}>
                  <span dir="rtl" className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">לא מתוזמן ({unscheduled.length})</span>
                </div>
                <div className="shrink-0" style={{ width: timelineContentWidth }} />
              </div>
              {unscheduled.map(task => {
                const p     = resolveTaskPriority(task, boards)
                const color = colorMap[task.assignee] ?? PALETTE[0]
                const isBeingDragged = unscheduledDrag?.taskId === task.id && unscheduledDrag.active
                return (
                  <div key={task.id} className={`flex border-b border-gray-50 hover:bg-gray-50/50 group ${isBeingDragged ? 'opacity-40' : ''}`} style={{ height: ROW_H }}>
                    {/* The entire left-list entry is the drag source — not
                        just the grip icon (kept only as a visual hint) — so
                        pressing the title/badge/avatar area and dragging
                        past the threshold also starts a drag, while a plain
                        click (no meaningful movement) still opens the task
                        via the title button's own onClick, completely
                        undisturbed (see onUnscheduledRowPointerDown). */}
                    <div
                      onPointerDown={readonly ? undefined : e => onUnscheduledRowPointerDown(e, task)}
                      className={`sticky left-0 z-10 bg-white group-hover:bg-gray-50/50 border-r border-gray-100 flex items-center gap-2 px-3 shrink-0 select-none ${readonly ? '' : 'cursor-grab active:cursor-grabbing'}`}
                      style={{ width: TASK_COL_WIDTH, minWidth: TASK_COL_WIDTH }}
                    >
                      {!readonly && (
                        <GripVertical size={12} className="text-gray-300 shrink-0" />
                      )}
                      {p && <span className={`w-2 h-2 rounded-full shrink-0 ${p.dotCls}`} />}
                      <button
                        dir="rtl"
                        onClick={() => !unscheduledDrag?.active && onOpenTask(task.id)}
                        className="flex-1 text-xs text-gray-500 truncate hover:text-primary transition-colors text-left"
                      >
                        {task.title}
                      </button>
                      <ClientBadge name={task.clientName} />
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color.bg }} />
                      <Avatar name={task.assignee} size="xs" />
                    </div>
                    <div className="flex items-center px-4 shrink-0" style={{ width: timelineContentWidth }}>
                      <span className="text-[10px] text-gray-300 italic">
                        {readonly ? 'פתח את המשימה כדי לקבוע תאריך יעד' : 'גרור לתאריך בציר הזמן, או פתח את המשימה כדי לקבוע תאריך יעד'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </>
          )}

        </div>
      </div>

      {/* Drag ghost/preview for an unscheduled task being dragged onto the timeline */}
      {unscheduledDrag?.active && draggedUnscheduledTask && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 bg-white border-2 border-primary rounded-lg shadow-xl text-xs font-semibold text-gray-800 max-w-[220px] truncate"
          style={{ left: unscheduledDrag.pointerX + 14, top: unscheduledDrag.pointerY + 14 }}
        >
          {draggedUnscheduledTask.title}
          {unscheduledDrag.targetDayIndex === null && (
            <span className="block text-[9px] text-gray-400 font-normal mt-0.5">גרור לתוך ציר הזמן</span>
          )}
        </div>
      )}
    </div>
  )
}
