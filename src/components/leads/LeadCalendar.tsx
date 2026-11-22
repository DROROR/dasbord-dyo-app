import { AlertTriangle, ChevronLeft, ChevronRight, Clock, ExternalLink, Mail, Phone, Search, SlidersHorizontal, Video, X } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useLang } from '../../contexts/LanguageContext'
import type { DbGoogleCalendar, DbGoogleCalendarEvent, DbLeadPipelineStatus } from '../../lib/database'
import { LEAD_STATUS_COLORS } from './AddLeadStatusModal'

export interface CalendarLead {
  id: string; name: string; phone: string; email: string; dueAt: string; endsAt: string | null
  googleEventId: string | null; calendarId: string | null
  pipelineStatusId: string | null; meetingPending: boolean
  source: string; category: string; campaignName: string; clientName: string
  // Set on events that come straight from Google and belong to no lead.
  google?: { htmlLink: string | null; meetLink: string | null }
}

type CalendarView = 'day' | 'week' | 'month' | 'schedule'
type Anchor = { rect: DOMRect }

const VIEW_KEY = 'leadCalendarView'
const VIEWS: CalendarView[] = ['day', 'week', 'month', 'schedule']
const HOUR_HEIGHT = 48
const MEETING_MINUTES = 30
const SCHEDULE_DAYS = 60
const NO_STATUS = 'none'
const CALENDAR_COLORS: Record<string, string> = {
  pink: 'bg-pink-500', blue: 'bg-blue-500', green: 'bg-emerald-500', purple: 'bg-violet-500', orange: 'bg-orange-500', teal: 'bg-teal-500',
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
const startOfWeek = (date: Date) => addDays(startOfDay(date), -date.getDay())
const dayKey = (date: Date) => date.toLocaleDateString('en-CA')
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b)
const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes()
const endOf = (lead: CalendarLead) => {
  const start = Date.parse(lead.dueAt)
  const end = lead.endsAt ? Date.parse(lead.endsAt) : NaN
  return new Date(end > start ? end : start + MEETING_MINUTES * 60_000)
}

function initialView(): CalendarView {
  try {
    const saved = localStorage.getItem(VIEW_KEY) as CalendarView | null
    if (saved && VIEWS.includes(saved)) return saved
  } catch {
    // Falls back to the screen-size default when storage is unavailable.
  }
  return window.innerWidth < 768 ? 'day' : 'week'
}

function layoutDay(events: CalendarLead[]) {
  const placed: { lead: CalendarLead; start: number; minutes: number; column: number; columns: number }[] = []
  let cluster: typeof placed = []
  let columnEnds: number[] = []
  let clusterEnd = -1
  const flush = () => { cluster.forEach(item => { item.columns = columnEnds.length }); cluster = []; columnEnds = [] }
  for (const lead of events) {
    const start = minutesOf(new Date(lead.dueAt))
    const minutes = Math.max((endOf(lead).getTime() - Date.parse(lead.dueAt)) / 60_000, 15)
    const end = start + minutes
    if (start >= clusterEnd) flush()
    let column = columnEnds.findIndex(columnEnd => columnEnd <= start)
    if (column === -1) { column = columnEnds.length; columnEnds.push(end) } else columnEnds[column] = end
    const item = { lead, start, minutes, column, columns: 1 }
    cluster.push(item); placed.push(item)
    clusterEnd = Math.max(clusterEnd, end)
  }
  flush()
  return placed
}

function Popover({ anchor, width = 320, onClose, children }: { anchor: Anchor; width?: number; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const { rect } = anchor
  const left = Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16))
  const below = rect.bottom + 6
  const top = below + 320 > window.innerHeight ? Math.max(16, rect.top - 326) : below
  return <>
    <div className="fixed inset-0 z-40" onClick={onClose} />
    <div role="dialog" style={{ left, top, width }} className="fixed z-50 max-h-[min(420px,calc(100vh-32px))] overflow-y-auto rounded-xl border border-gray-200 bg-surface p-4 shadow-2xl">{children}</div>
  </>
}

export function LeadCalendar({ leads, calendars, googleEvents, statuses, onOpen }: {
  leads: CalendarLead[]; calendars: DbGoogleCalendar[]; googleEvents: DbGoogleCalendarEvent[]
  statuses: DbLeadPipelineStatus[]; onOpen: (id: string) => void
}) {
  const { t, lang } = useLang()
  const locale = lang === 'he' ? 'he-IL' : 'en-GB'
  const [view, setView] = useState<CalendarView>(initialView)
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()))
  const [miniMonth, setMiniMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [now, setNow] = useState(() => new Date())
  const [query, setQuery] = useState('')
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(() => new Set())
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(() => new Set())
  const [source, setSource] = useState('all')
  const [category, setCategory] = useState('all')
  const [campaign, setCampaign] = useState('all')
  const [client, setClient] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState<{ lead: CalendarLead } & Anchor | null>(null)
  const [dayList, setDayList] = useState<{ date: Date } & Anchor | null>(null)

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch { /* View choice stays in memory only. */ } }, [view])
  const jumpTo = (date: Date) => { setAnchorDate(startOfDay(date)); setMiniMonth(new Date(date.getFullYear(), date.getMonth(), 1)) }

  const statusById = new Map(statuses.map(status => [status.id, status]))
  const statusKey = (lead: CalendarLead) => lead.pipelineStatusId && statusById.has(lead.pipelineStatusId) ? lead.pipelineStatusId : NO_STATUS
  const colorOf = (lead: CalendarLead) => LEAD_STATUS_COLORS[statusById.get(lead.pipelineStatusId ?? '')?.color ?? 'slate']
  // A lead meeting not yet in Google is about to be created in the first calendar.
  const calendarById = new Map(calendars.map(calendar => [calendar.calendar_id, calendar]))
  const calendarOf = (lead: CalendarLead) => calendarById.get(lead.calendarId ?? '') ?? calendars[0]
  const calendarName = (calendar: DbGoogleCalendar) => calendar.name || calendar.calendar_id
  const calendarTone = (calendar?: DbGoogleCalendar) => CALENDAR_COLORS[calendar?.color ?? ''] ?? 'bg-slate-500'
  const tone = (lead: CalendarLead) => calendars.length ? calendarTone(calendarOf(lead)) : colorOf(lead).dot
  const statusLabel = (lead: CalendarLead) => { const status = statusById.get(lead.pipelineStatusId ?? ''); return status ? (lang === 'he' ? status.label_he : status.label_en) : t('ללא סטטוס', 'No status') }
  const isOverdue = (lead: CalendarLead) => lead.meetingPending && new Date(lead.dueAt).getTime() < now.getTime()
  const isPast = (lead: CalendarLead) => endOf(lead).getTime() < now.getTime()
  const fmtTime = (date: Date) => date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const fmtRange = (lead: CalendarLead) => `${fmtTime(new Date(lead.dueAt))} – ${fmtTime(endOf(lead))}`

  const options = (pick: (lead: CalendarLead) => string) => Array.from(new Set(leads.map(pick).filter(Boolean))).sort()
  const sourceOptions = options(lead => lead.source)
  const categoryOptions = options(lead => lead.category)
  const campaignOptions = options(lead => lead.campaignName)
  const clientOptions = options(lead => lead.clientName)
  const statusRows = (() => {
    const counts = new Map<string, number>()
    leads.forEach(lead => counts.set(statusKey(lead), (counts.get(statusKey(lead)) ?? 0) + 1))
    const rows = statuses.filter(status => !status.is_archived || counts.has(status.id)).map(status => ({ key: status.id, label: lang === 'he' ? status.label_he : status.label_en, dot: LEAD_STATUS_COLORS[status.color].dot, count: counts.get(status.id) ?? 0 }))
    if (counts.has(NO_STATUS)) rows.push({ key: NO_STATUS, label: t('ללא סטטוס', 'No status'), dot: LEAD_STATUS_COLORS.slate.dot, count: counts.get(NO_STATUS) ?? 0 })
    return rows
  })()

  const position = new Map(calendars.map(calendar => [calendar.calendar_id, calendar.position]))
  const linked = new Set(leads.map(lead => lead.googleEventId).filter(Boolean))
  const seen = new Set<string>()
  const googleItems: CalendarLead[] = googleEvents
    .filter(event => calendarById.has(event.calendar_id))
    .sort((a, b) => (position.get(a.calendar_id) ?? 0) - (position.get(b.calendar_id) ?? 0))
    .filter(event => { if (linked.has(event.event_id) || seen.has(event.event_id)) return false; seen.add(event.event_id); return true })
    .map(event => ({
      id: `g:${event.calendar_id}:${event.event_id}`, name: event.summary || t('(ללא כותרת)', '(No title)'), phone: '', email: '',
      dueAt: event.starts_at, endsAt: event.ends_at, googleEventId: event.event_id, calendarId: event.calendar_id,
      pipelineStatusId: null, meetingPending: false, source: '', category: '', campaignName: '', clientName: '',
      google: { htmlLink: event.html_link, meetLink: event.meet_link },
    }))
  const leadOnlyFilters = source !== 'all' || category !== 'all' || campaign !== 'all' || client !== 'all' || overdueOnly
  const toggleCalendar = (id: string) => setHiddenCalendars(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const filtered = (() => {
    const q = query.trim().toLowerCase()
    const shownCalendar = (lead: CalendarLead) => !calendars.length || !hiddenCalendars.has(calendarOf(lead).calendar_id)
    const events = googleItems.filter(item => !leadOnlyFilters && shownCalendar(item) && (!q || item.name.toLowerCase().includes(q)))
    return leads.filter(lead => shownCalendar(lead) && !hiddenStatuses.has(statusKey(lead))
      && (source === 'all' || lead.source === source)
      && (category === 'all' || lead.category === category)
      && (campaign === 'all' || lead.campaignName === campaign)
      && (client === 'all' || lead.clientName === client)
      && (!overdueOnly || isOverdue(lead))
      && (!q || `${lead.name} ${lead.phone} ${lead.email}`.toLowerCase().includes(q)))
      .concat(events)
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
  })()
  const byDay = new Map<string, CalendarLead[]>()
  filtered.forEach(lead => { const key = dayKey(new Date(lead.dueAt)); byDay.set(key, [...(byDay.get(key) ?? []), lead]) })
  const eventsOn = (date: Date) => byDay.get(dayKey(date)) ?? []

  const hasFilters = Boolean(query || hiddenStatuses.size || hiddenCalendars.size || leadOnlyFilters)
  const clearFilters = () => { setQuery(''); setHiddenStatuses(new Set()); setHiddenCalendars(new Set()); setSource('all'); setCategory('all'); setCampaign('all'); setClient('all'); setOverdueOnly(false) }
  const overdueCount = leads.filter(isOverdue).length
  const todayEvents = eventsOn(now)
  const nextEvent = todayEvents.find(lead => !isPast(lead))

  const weekStart = startOfWeek(anchorDate)
  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
  const range = view === 'day' ? [anchorDate, addDays(anchorDate, 1)]
    : view === 'week' ? [weekStart, addDays(weekStart, 7)]
    : view === 'month' ? [monthStart, new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)]
    : [anchorDate, addDays(anchorDate, SCHEDULE_DAYS)]
  const inRangeCount = filtered.filter(lead => { const time = new Date(lead.dueAt).getTime(); return time >= range[0].getTime() && time < range[1].getTime() }).length

  const title = (() => {
    if (view === 'day') return anchorDate.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    if (view === 'week') {
      const end = addDays(weekStart, 6)
      if (weekStart.getMonth() === end.getMonth()) return weekStart.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
      return `${weekStart.toLocaleDateString(locale, { month: 'short' })} – ${end.toLocaleDateString(locale, { month: 'short', year: 'numeric' })}`
    }
    return anchorDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  })()
  const move = (step: number) => jumpTo(view === 'day' ? addDays(anchorDate, step)
    : view === 'week' ? addDays(anchorDate, 7 * step)
    : new Date(anchorDate.getFullYear(), anchorDate.getMonth() + step, 1))
  const goToDay = (date: Date) => { jumpTo(date); setView('day'); setDayList(null) }
  const openEvent = (lead: CalendarLead, event: MouseEvent<HTMLElement>) => { event.stopPropagation(); setSelected({ lead, rect: event.currentTarget.getBoundingClientRect() }) }
  const toggleStatus = (key: string) => setHiddenStatuses(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })

  const countdown = (lead: CalendarLead) => {
    const minutes = Math.round((new Date(lead.dueAt).getTime() - now.getTime()) / 60_000)
    if (minutes <= 0) return t('עכשיו', 'Now')
    if (minutes < 60) return t(`בעוד ${minutes} דק׳`, `in ${minutes} min`)
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return t(`בעוד ${hours} ש׳${rest ? ` ${rest} דק׳` : ''}`, `in ${hours}h${rest ? ` ${rest}m` : ''}`)
  }
  const viewLabel: Record<CalendarView, string> = { day: t('יום', 'Day'), week: t('שבוע', 'Week'), month: t('חודש', 'Month'), schedule: t('לו״ז', 'Schedule') }
  const weekdayShort = (date: Date) => date.toLocaleDateString(locale, { weekday: 'short' })
  const selectClass = 'h-8 w-full rounded-lg border border-gray-200 bg-surface px-2 text-xs text-gray-600 outline-none focus:border-primary'

  const miniDays = (() => { const start = startOfWeek(miniMonth); return Array.from({ length: 42 }, (_, index) => addDays(start, index)) })()

  const sidebar = (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">{miniMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</p>
          <div className="flex">
            <button onClick={() => setMiniMonth(month => new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-full p-1 text-gray-500 hover:bg-gray-100" aria-label={t('חודש קודם', 'Previous month')}><ChevronLeft size={15} className="rtl:rotate-180" /></button>
            <button onClick={() => setMiniMonth(month => new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-full p-1 text-gray-500 hover:bg-gray-100" aria-label={t('חודש הבא', 'Next month')}><ChevronRight size={15} className="rtl:rotate-180" /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center">
          {miniDays.slice(0, 7).map(date => <span key={date.toISOString()} className="py-1 text-[10px] font-semibold text-gray-400">{date.toLocaleDateString(locale, { weekday: 'narrow' })}</span>)}
          {miniDays.map(date => {
            const isToday = sameDay(date, now)
            const isSelected = sameDay(date, anchorDate)
            const outside = date.getMonth() !== miniMonth.getMonth()
            return <button key={date.toISOString()} onClick={() => jumpTo(date)} className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] ${isToday ? 'bg-primary font-bold text-white' : isSelected ? 'bg-blue-100 font-semibold text-primary' : outside ? 'text-gray-300 hover:bg-gray-100' : 'text-gray-600 hover:bg-gray-100'}`}>
              {date.getDate()}
              {!isToday && eventsOn(date).length > 0 && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
            </button>
          })}
        </div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-bold text-gray-800">{t('היום', 'Today')}</p>
          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-white">{todayEvents.length}</span>
        </div>
        {todayEvents.length === 0 && <p className="text-xs text-gray-400">{t('אין פגישות היום', 'No meetings today')}</p>}
        <div className="space-y-1.5">
          {todayEvents.map(lead => {
            const isNext = lead.id === nextEvent?.id
            const past = isPast(lead)
            return <button key={lead.id} onClick={event => openEvent(lead, event)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors ${isNext ? 'bg-surface shadow-sm ring-1 ring-primary/30' : 'hover:bg-surface'} ${past ? 'opacity-50' : ''}`}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${isOverdue(lead) ? 'bg-red-500' : tone(lead)}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-gray-800">{lead.name}</span>
                <span className="block text-[11px] text-gray-500">{fmtTime(new Date(lead.dueAt))}</span>
              </span>
              {isNext && <span className="shrink-0 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">{countdown(lead)}</span>}
              {isOverdue(lead) && <AlertTriangle size={13} className="shrink-0 text-red-500" />}
            </button>
          })}
        </div>
      </div>

      {calendars.length > 0 && <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('יומנים', 'Calendars')}</p>
        <div className="space-y-0.5">
          {calendars.map(calendar => {
            const visible = !hiddenCalendars.has(calendar.calendar_id)
            return <button key={calendar.calendar_id} onClick={() => toggleCalendar(calendar.calendar_id)} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-start hover:bg-gray-50">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${visible ? calendarTone(calendar) : 'border-2 border-gray-300'}`}>{visible && <svg viewBox="0 0 12 12" className="h-3 w-3 text-white"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{calendarName(calendar)}</span>
            </button>
          })}
        </div>
      </div>}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('סטטוסים', 'Statuses')}</p>
        <div className="space-y-0.5">
          {statusRows.map(row => {
            const visible = !hiddenStatuses.has(row.key)
            return <button key={row.key} onClick={() => toggleStatus(row.key)} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-start hover:bg-gray-50">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${visible ? row.dot : 'border-2 border-gray-300'}`}>{visible && <svg viewBox="0 0 12 12" className="h-3 w-3 text-white"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{row.label}</span>
              <span className="text-[11px] text-gray-400">{row.count}</span>
            </button>
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('סינון נוסף', 'More filters')}</p>
        <select value={source} onChange={e => setSource(e.target.value)} aria-label={t('מקור', 'Source')} className={selectClass}><option value="all">{t('כל המקורות', 'All sources')}</option>{sourceOptions.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <select value={category} onChange={e => setCategory(e.target.value)} aria-label={t('קטגוריה', 'Category')} className={selectClass}><option value="all">{t('כל הקטגוריות', 'All categories')}</option>{categoryOptions.map(value => <option key={value} value={value}>{value}</option>)}</select>
        {campaignOptions.length > 0 && <select value={campaign} onChange={e => setCampaign(e.target.value)} aria-label={t('קמפיין', 'Campaign')} className={selectClass}><option value="all">{t('כל הקמפיינים', 'All campaigns')}</option>{campaignOptions.map(value => <option key={value} value={value}>{value}</option>)}</select>}
        {clientOptions.length > 0 && <select value={client} onChange={e => setClient(e.target.value)} aria-label={t('לקוח', 'Client')} className={selectClass}><option value="all">{t('כל הלקוחות', 'All clients')}</option>{clientOptions.map(value => <option key={value} value={value}>{value}</option>)}</select>}
        <button onClick={() => setOverdueOnly(value => !value)} className={`flex h-8 w-full items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ${overdueOnly ? 'bg-red-100 text-red-600' : 'border border-gray-200 text-gray-500 hover:bg-gray-50'}`}><AlertTriangle size={13} />{t('רק באיחור', 'Overdue only')}{overdueCount > 0 && <span className="ms-auto">{overdueCount}</span>}</button>
        {hasFilters && <button onClick={clearFilters} className="flex h-8 w-full items-center justify-center gap-1 text-xs text-gray-500 hover:text-gray-700"><X size={13} />{t('נקה סינון', 'Clear filters')}</button>}
      </div>
    </div>
  )

  return (
    <section className="flex overflow-hidden rounded-xl border border-gray-200 bg-surface">
      {filtersOpen && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setFiltersOpen(false)} />}
      <aside className={`${filtersOpen ? 'fixed inset-y-0 start-0 z-40 block w-72 overflow-y-auto shadow-2xl' : 'hidden'} border-e border-gray-200 bg-surface p-3 lg:static lg:z-auto lg:block lg:w-64 lg:shrink-0 lg:shadow-none`}>
        <div className="mb-2 flex justify-end lg:hidden"><button onClick={() => setFiltersOpen(false)} className="rounded-full p-1 text-gray-500 hover:bg-gray-100" aria-label={t('סגור', 'Close')}><X size={16} /></button></div>
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 p-2.5">
          <button onClick={() => setFiltersOpen(true)} className="relative rounded-lg border border-gray-200 p-1.5 text-gray-500 lg:hidden" aria-label={t('סינון', 'Filters')}><SlidersHorizontal size={16} />{hasFilters && <span className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />}</button>
          <button onClick={() => jumpTo(new Date())} className="h-8 rounded-full border border-gray-300 px-4 text-xs font-semibold text-gray-700 hover:bg-gray-50">{t('היום', 'Today')}</button>
          <button onClick={() => move(-1)} className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100" aria-label={t('הקודם', 'Previous')}><ChevronLeft size={18} className="rtl:rotate-180" /></button>
          <button onClick={() => move(1)} className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100" aria-label={t('הבא', 'Next')}><ChevronRight size={18} className="rtl:rotate-180" /></button>
          <h2 className="me-auto text-base font-bold text-gray-800 sm:text-lg">{title}</h2>
          {overdueCount > 0 && <button onClick={() => setOverdueOnly(true)} className="flex h-7 items-center gap-1 rounded-md bg-red-100 px-2 text-xs font-semibold text-red-600"><AlertTriangle size={13} />{overdueCount} {t('דורשות טיפול', 'Need attention')}</button>}
          <span className="hidden text-xs text-gray-400 sm:inline">{inRangeCount} {t('פגישות', 'meetings')}</span>
          <label className="relative w-full sm:w-52"><Search size={14} className="absolute start-2.5 top-2 text-gray-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('חפש שם, טלפון או אימייל', 'Search name, phone or email')} className="h-8 w-full rounded-lg border border-gray-200 bg-surface ps-8 pe-3 text-xs outline-none focus:border-primary" /></label>
          <div className="flex rounded-lg border border-gray-200 p-0.5">
            {VIEWS.map(option => <button key={option} onClick={() => setView(option)} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${view === option ? 'bg-blue-100 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}>{viewLabel[option]}</button>)}
          </div>
        </header>

        {todayEvents.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-200 bg-blue-50/40 px-2.5 py-2 lg:hidden">
            <span className="shrink-0 text-xs font-bold text-gray-700">{t('היום', 'Today')} · {todayEvents.length}</span>
            {todayEvents.map(lead => <button key={lead.id} onClick={event => openEvent(lead, event)} className={`flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-surface px-2.5 py-1 text-xs ${isPast(lead) ? 'opacity-50' : ''} ${lead.id === nextEvent?.id ? 'ring-1 ring-primary/40' : ''}`}>
              <span className={`h-2 w-2 rounded-full ${isOverdue(lead) ? 'bg-red-500' : tone(lead)}`} />
              <span className="font-semibold text-gray-700">{fmtTime(new Date(lead.dueAt))}</span>
              <span className="max-w-28 truncate text-gray-600">{lead.name}</span>
              {lead.id === nextEvent?.id && <span className="font-bold text-primary">{countdown(lead)}</span>}
            </button>)}
          </div>
        )}

        {(view === 'day' || view === 'week') && (
          <TimeGrid key={`${view}-${dayKey(view === 'day' ? anchorDate : weekStart)}`} days={view === 'day' ? [anchorDate] : Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))}
            now={now} locale={locale} eventsOn={eventsOn} weekdayShort={weekdayShort} fmtTime={fmtTime}
            tone={tone} isOverdue={isOverdue} isPast={isPast} selectedId={selected?.lead.id} onEvent={openEvent} onDay={goToDay} />
        )}

        {view === 'month' && (() => {
          const start = startOfWeek(monthStart)
          const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
          const days = Array.from({ length: Math.ceil((monthStart.getDay() + daysInMonth) / 7) * 7 }, (_, index) => addDays(start, index))
          return <div className="flex flex-col">
            <div className="grid grid-cols-7 border-b border-gray-200">
              {days.slice(0, 7).map(date => <div key={date.toISOString()} className="py-1.5 text-center text-[11px] font-semibold uppercase text-gray-500">{weekdayShort(date)}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map(date => {
                const events = eventsOn(date)
                const isToday = sameDay(date, now)
                const outside = date.getMonth() !== monthStart.getMonth()
                return <div key={date.toISOString()} className={`min-w-0 h-[clamp(92px,calc((100vh-320px)/5),132px)] overflow-hidden border-b border-e border-gray-200 p-1 [&:nth-child(7n)]:border-e-0 ${outside ? 'bg-gray-50/40' : ''}`}>
                  <div className="mb-0.5 flex justify-center"><button onClick={() => goToDay(date)} className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[11px] font-semibold hover:bg-gray-100 ${isToday ? 'bg-primary text-white hover:bg-primary' : outside ? 'text-gray-300' : 'text-gray-700'}`}>{date.getDate()}</button></div>
                  <div className="space-y-px">
                    {events.slice(0, 3).map(lead => <button key={lead.id} onClick={event => openEvent(lead, event)} title={`${fmtTime(new Date(lead.dueAt))} ${lead.name}`} className={`flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-start text-[11px] hover:bg-gray-100 ${isPast(lead) ? 'opacity-60' : ''}`}>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${isOverdue(lead) ? 'bg-red-500' : tone(lead)}`} />
                      <span className="hidden shrink-0 text-gray-500 sm:inline">{fmtTime(new Date(lead.dueAt))}</span>
                      <span className={`truncate font-semibold ${isOverdue(lead) ? 'text-red-600' : 'text-gray-700'}`}>{lead.name}</span>
                    </button>)}
                    {events.length > 3 && <button onClick={event => setDayList({ date, rect: event.currentTarget.getBoundingClientRect() })} className="w-full rounded px-1 py-0.5 text-start text-[11px] font-semibold text-gray-500 hover:bg-gray-100">+{events.length - 3} {t('נוספות', 'more')}</button>}
                  </div>
                </div>
              })}
            </div>
          </div>
        })()}

        {view === 'schedule' && (() => {
          const days = Array.from({ length: SCHEDULE_DAYS }, (_, index) => addDays(anchorDate, index)).filter(date => eventsOn(date).length > 0)
          if (days.length === 0) return <p className="p-10 text-center text-sm text-gray-400">{t('אין פגישות ב־60 הימים הקרובים', 'No meetings in the next 60 days')}</p>
          return <div className="max-h-[calc(100vh-240px)] min-h-[420px] divide-y divide-gray-100 overflow-y-auto">
            {days.map(date => {
              const isToday = sameDay(date, now)
              return <div key={date.toISOString()} className="flex gap-3 px-3 py-2.5">
                <button onClick={() => goToDay(date)} className="flex w-24 shrink-0 items-start gap-2 text-start">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold ${isToday ? 'bg-primary text-white' : 'text-gray-700'}`}>{date.getDate()}</span>
                  <span className={`pt-1.5 text-[11px] font-semibold uppercase ${isToday ? 'text-primary' : 'text-gray-500'}`}>{date.toLocaleDateString(locale, { month: 'short', weekday: 'short' })}</span>
                </button>
                <div className="min-w-0 flex-1 space-y-0.5">
                  {eventsOn(date).map(lead => <button key={lead.id} onClick={event => openEvent(lead, event)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start hover:bg-gray-50 ${isPast(lead) ? 'opacity-60' : ''}`}>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${isOverdue(lead) ? 'bg-red-500' : tone(lead)}`} />
                    <span className="w-28 shrink-0 text-xs text-gray-500">{fmtRange(lead)}</span>
                    <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${isOverdue(lead) ? 'text-red-600' : 'text-gray-800'}`}>{lead.name}</span>
                    <span className="hidden truncate text-xs text-gray-400 sm:inline">{lead.google ? calendarName(calendarOf(lead)) : statusLabel(lead)}</span>
                  </button>)}
                </div>
              </div>
            })}
          </div>
        })()}
      </div>

      {dayList && (
        <Popover anchor={dayList} width={280} onClose={() => setDayList(null)}>
          <div className="mb-3 flex items-start justify-between">
            <button onClick={() => goToDay(dayList.date)} className="text-start">
              <p className="text-[11px] font-semibold uppercase text-gray-500">{weekdayShort(dayList.date)}</p>
              <p className="text-2xl font-semibold text-gray-800">{dayList.date.getDate()}</p>
            </button>
            <button onClick={() => setDayList(null)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100" aria-label={t('סגור', 'Close')}><X size={15} /></button>
          </div>
          <div className="space-y-1">
            {eventsOn(dayList.date).map(lead => <button key={lead.id} onClick={event => openEvent(lead, event)} className={`block w-full truncate rounded-md px-2 py-1 text-start text-xs font-semibold text-white ${isOverdue(lead) ? 'bg-red-500' : tone(lead)} ${isPast(lead) ? 'opacity-60' : ''}`}>{fmtTime(new Date(lead.dueAt))} {lead.name}</button>)}
          </div>
        </Popover>
      )}

      {selected && (
        <Popover anchor={selected} onClose={() => setSelected(null)}>
          <div className="flex items-start gap-3">
            <span className={`mt-1.5 h-3.5 w-3.5 shrink-0 rounded ${isOverdue(selected.lead) ? 'bg-red-500' : tone(selected.lead)}`} />
            <div className="min-w-0 flex-1">
              <p className="break-words text-lg font-semibold text-gray-800">{selected.lead.name}</p>
              <p className="text-xs text-gray-500">{new Date(selected.lead.dueAt).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} · {fmtRange(selected.lead)}</p>
            </div>
            <button onClick={() => setSelected(null)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100" aria-label={t('סגור', 'Close')}><X size={15} /></button>
          </div>
          {selected.lead.google ? <div className="mt-3 space-y-2 text-xs text-gray-600">
            <p className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${tone(selected.lead)}`} />{calendarName(calendarOf(selected.lead))}{!isPast(selected.lead) && sameDay(new Date(selected.lead.dueAt), now) && <span className="flex items-center gap-1 font-semibold text-primary"><Clock size={12} />{countdown(selected.lead)}</span>}</p>
            <div className="flex gap-2 pt-2">
              {selected.lead.google.meetLink && <a href={selected.lead.google.meetLink} target="_blank" rel="noreferrer" className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-white hover:bg-primary/90"><Video size={14} />{t('הצטרף ל־Meet', 'Join Meet')}</a>}
              {selected.lead.google.htmlLink && <a href={selected.lead.google.htmlLink} target="_blank" rel="noreferrer" className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"><ExternalLink size={14} />Google Calendar</a>}
            </div>
          </div> : <>
          <div className="mt-3 space-y-2 text-xs text-gray-600">
            {calendars.length > 0 && <p className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${tone(selected.lead)}`} />{calendarName(calendarOf(selected.lead))}</p>}
            <p className="flex items-center gap-2"><span className={`rounded-md px-2 py-0.5 font-semibold ${colorOf(selected.lead).badge}`}>{statusLabel(selected.lead)}</span>{isOverdue(selected.lead) && <span className="flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 font-semibold text-red-600"><AlertTriangle size={12} />{t('באיחור', 'Overdue')}</span>}{!isPast(selected.lead) && sameDay(new Date(selected.lead.dueAt), now) && <span className="flex items-center gap-1 font-semibold text-primary"><Clock size={12} />{countdown(selected.lead)}</span>}</p>
            {selected.lead.phone && <a href={`tel:${selected.lead.phone}`} dir="ltr" className="flex items-center gap-2 hover:text-primary"><Phone size={13} className="text-gray-400" />{selected.lead.phone}</a>}
            {selected.lead.email && <a href={`mailto:${selected.lead.email}`} className="flex min-w-0 items-center gap-2 hover:text-primary"><Mail size={13} className="shrink-0 text-gray-400" /><span className="truncate">{selected.lead.email}</span></a>}
            {[[t('מקור', 'Source'), selected.lead.source], [t('קטגוריה', 'Category'), selected.lead.category], [t('קמפיין', 'Campaign'), selected.lead.campaignName], [t('לקוח', 'Client'), selected.lead.clientName]].filter(([, value]) => value).map(([label, value]) => <p key={label} className="flex gap-2"><span className="w-16 shrink-0 text-gray-400">{label}</span><span className="min-w-0 truncate">{value}</span></p>)}
          </div>
          <button onClick={() => { onOpen(selected.lead.id); setSelected(null) }} className="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-white hover:bg-primary/90"><ExternalLink size={14} />{t('פתח ליד', 'Open lead')}</button>
          </>}
        </Popover>
      )}
    </section>
  )
}

function TimeGrid({ days, now, locale, eventsOn, weekdayShort, fmtTime, tone, isOverdue, isPast, selectedId, onEvent, onDay }: {
  days: Date[]; now: Date; locale: string
  eventsOn: (date: Date) => CalendarLead[]; weekdayShort: (date: Date) => string; fmtTime: (date: Date) => string
  tone: (lead: CalendarLead) => string; isOverdue: (lead: CalendarLead) => boolean; isPast: (lead: CalendarLead) => boolean
  selectedId?: string; onEvent: (lead: CalendarLead, event: MouseEvent<HTMLElement>) => void; onDay: (date: Date) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const columns = `56px repeat(${days.length}, minmax(0, 1fr))`
  const hours = Array.from({ length: 24 }, (_, hour) => hour)

  const [initialTop] = useState(() => {
    const firstEvent = days.flatMap(eventsOn)[0]
    const focusMinutes = days.some(date => sameDay(date, now)) ? minutesOf(now) : firstEvent ? minutesOf(new Date(firstEvent.dueAt)) : 8 * 60
    return Math.max(0, (focusMinutes / 60 - 1.5) * HOUR_HEIGHT)
  })
  useEffect(() => { scrollRef.current?.scrollTo({ top: initialTop }) }, [initialTop])

  return (
    <div ref={scrollRef} className="h-[calc(100vh-240px)] min-h-[480px] overflow-y-auto">
      <div className="sticky top-0 z-20 grid border-b border-gray-200 bg-surface" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map(date => {
          const isToday = sameDay(date, now)
          return <button key={date.toISOString()} onClick={() => onDay(date)} className="flex flex-col items-center gap-0.5 py-2">
            <span className={`text-[11px] font-semibold uppercase ${isToday ? 'text-primary' : 'text-gray-500'}`}>{weekdayShort(date)}</span>
            <span className={`flex h-10 w-10 items-center justify-center rounded-full text-xl font-medium transition-colors ${isToday ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'}`}>{date.getDate()}</span>
          </button>
        })}
      </div>
      <div className="relative grid" style={{ gridTemplateColumns: columns, height: 24 * HOUR_HEIGHT }}>
        <div className="relative">
          {hours.slice(1).map(hour => <span key={hour} className="absolute end-2 -translate-y-1/2 text-[10px] text-gray-400" style={{ top: hour * HOUR_HEIGHT }}>{new Date(2000, 0, 1, hour).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>)}
        </div>
        {days.map(date => {
          const isToday = sameDay(date, now)
          return <div key={date.toISOString()} className={`relative border-s border-gray-200 ${isToday ? 'bg-blue-50/30' : ''}`}>
            {hours.slice(1).map(hour => <div key={hour} className="absolute inset-x-0 border-t border-gray-100" style={{ top: hour * HOUR_HEIGHT }} />)}
            {layoutDay(eventsOn(date)).map(({ lead, start, minutes, column, columns: count }) => {
              const overdue = isOverdue(lead)
              return <button key={lead.id} onClick={event => onEvent(lead, event)} title={`${fmtTime(new Date(lead.dueAt))} ${lead.name}`}
                style={{ top: (start / 60) * HOUR_HEIGHT + 1, height: Math.max((minutes / 60) * HOUR_HEIGHT - 2, 20), insetInlineStart: `calc(${(column / count) * 100}% + 1px)`, width: `calc(${100 / count}% - 4px)` }}
                className={`absolute z-10 flex items-center gap-1 overflow-hidden rounded-md px-1.5 text-start text-[11px] leading-tight text-white shadow-sm transition-shadow hover:z-20 hover:shadow-md ${overdue ? 'bg-red-500' : tone(lead)} ${isPast(lead) && !overdue ? 'opacity-60' : ''} ${selectedId === lead.id ? 'ring-2 ring-gray-800 ring-offset-1' : ''}`}>
                {overdue && <AlertTriangle size={11} className="shrink-0" />}
                <span className="truncate font-semibold">{lead.name}</span>
                <span className="hidden shrink-0 opacity-90 sm:inline">{fmtTime(new Date(lead.dueAt))}</span>
              </button>
            })}
            {isToday && <div className="pointer-events-none absolute inset-x-0 z-30 h-0.5 bg-red-500" style={{ top: (minutesOf(now) / 60) * HOUR_HEIGHT }}><span className="absolute -start-1.5 -top-[5px] h-3 w-3 rounded-full bg-red-500" /></div>}
          </div>
        })}
      </div>
    </div>
  )
}
