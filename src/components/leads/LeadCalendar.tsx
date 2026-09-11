import { AlertTriangle, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../contexts/LanguageContext'
import type { DbLeadPipelineStatus } from '../../lib/database'
import { LEAD_STATUS_COLORS } from './AddLeadStatusModal'

export interface CalendarLead {
  id: string; name: string; phone: string; dueAt: string
  pipelineStatusId: string | null; statusUpdatedAt: string; meetingPending: boolean
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function LeadCalendar({ leads, statuses, onOpen }: {
  leads: CalendarLead[]; statuses: DbLeadPipelineStatus[]; onOpen: (id: string) => void
}) {
  const { t, lang } = useLang()
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1) })
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState<'all' | 'upcoming' | 'overdue'>('all')
  const [, refreshClock] = useState(0)
  useEffect(() => { const timer = window.setInterval(() => refreshClock(value => value + 1), 30_000); return () => window.clearInterval(timer) }, [])
  const locale = lang === 'he' ? 'he-IL' : 'en-GB'
  const days = useMemo(() => {
    const start = new Date(month)
    start.setDate(1 - start.getDay())
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start); date.setDate(start.getDate() + index); return date
    })
  }, [month])
  const weekdays = lang === 'he'
    ? ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const move = (amount: number) => setMonth(current => new Date(current.getFullYear(), current.getMonth() + amount, 1))
  const isOverdue = (lead: CalendarLead) => lead.meetingPending && new Date(lead.dueAt).getTime() < Date.now()
  const filteredLeads = useMemo(() => { const q=query.trim().toLowerCase(); return leads.filter(lead => { const overdue=isOverdue(lead); return (statusFilter === 'all' || lead.pipelineStatusId === statusFilter) && (timeFilter === 'all' || (timeFilter === 'upcoming' ? new Date(lead.dueAt).getTime() >= Date.now() : overdue)) && (!q || (lead.name + ' ' + lead.phone).toLowerCase().includes(q)) }) }, [leads, query, statusFilter, timeFilter])
  const hasFilters = Boolean(query || statusFilter !== 'all' || timeFilter !== 'all')
  const overdueCount = leads.filter(isOverdue).length

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-surface">
      <header className="border-b border-gray-200 p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)) }} className="h-8 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600">{t('היום', 'Today')}</button>
          <button onClick={() => move(-1)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><ChevronLeft size={17} /></button>
          <button onClick={() => move(1)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><ChevronRight size={17} /></button>
          <h2 className="me-auto text-base font-bold text-gray-800">{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</h2>
          {overdueCount > 0 && <button onClick={() => setTimeFilter('overdue')} className="flex h-7 items-center gap-1 rounded-md bg-red-100 px-2 text-xs font-semibold text-red-600"><AlertTriangle size={13} />{overdueCount} {t('דורשות טיפול', 'Need attention')}</button>}
          <span className="text-xs text-gray-400">{filteredLeads.length} {t('פגישות מתוזמנות', 'scheduled meetings')}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <label className="relative min-w-40 flex-1 sm:max-w-64"><Search size={14} className="absolute start-2.5 top-2 text-gray-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('חפש שם או טלפון', 'Search name or phone')} className="h-8 w-full rounded-lg border border-gray-200 bg-surface ps-8 pe-3 text-xs outline-none focus:border-primary" /></label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-8 min-w-36 rounded-lg border border-gray-200 bg-surface px-2.5 text-xs text-gray-600"><option value="all">{t('כל הסטטוסים', 'All statuses')}</option>{statuses.filter(s => !s.is_archived).map(s => <option key={s.id} value={s.id}>{lang === 'he' ? s.label_he : s.label_en}</option>)}</select>
          <select value={timeFilter} onChange={e => setTimeFilter(e.target.value as 'all' | 'upcoming' | 'overdue')} className="h-8 min-w-32 rounded-lg border border-gray-200 bg-surface px-2.5 text-xs text-gray-600"><option value="all">{t('כל הפגישות', 'All meetings')}</option><option value="upcoming">{t('קרובות', 'Upcoming')}</option><option value="overdue">{t('באיחור', 'Overdue')}</option></select>
          {hasFilters && <button onClick={() => { setQuery(''); setStatusFilter('all'); setTimeFilter('all') }} className="flex h-8 items-center gap-1 px-2 text-xs text-gray-500"><X size={13} />{t('נקה', 'Clear')}</button>}
        </div>
      </header>
      <div className="w-full overflow-hidden">
        <div className="w-full">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50/60">
            {weekdays.map(day => <div key={day} className="border-e border-gray-200 px-2 py-2 text-center text-[11px] font-bold uppercase text-gray-500 last:border-e-0">{day}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map(date => {
              const events = filteredLeads.filter(lead => sameDay(new Date(lead.dueAt), date)).sort((a, b) => a.dueAt.localeCompare(b.dueAt))
              const outside = date.getMonth() !== month.getMonth()
              const today = sameDay(date, new Date())
              return <div key={date.toISOString()} className={`min-w-0 h-[clamp(58px,calc((100vh-300px)/6),88px)] overflow-hidden border-b border-e border-gray-200 p-0.5 sm:p-1 last:border-e-0 ${outside ? 'bg-gray-50/40' : 'bg-surface'}`}>
                <div className="flex justify-end"><span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${today ? 'bg-primary text-white' : outside ? 'text-gray-300' : 'text-gray-600'}`}>{date.getDate()}</span></div>
                <div className="space-y-1">
                  {events.slice(0, 2).map(lead => {
                    const status = statuses.find(item => item.id === lead.pipelineStatusId)
                    const overdue = isOverdue(lead)
                    const color = status ? LEAD_STATUS_COLORS[status.color].badge : 'bg-blue-100 text-blue-700'
                    return <button key={lead.id} onClick={() => onOpen(lead.id)} title={`${lead.name} · ${lead.phone}`} className={`block w-full min-w-0 truncate rounded px-1 py-1 text-start text-[9px] font-semibold sm:px-1.5 sm:text-[10px] lg:text-[11px] ${overdue ? 'bg-red-100 text-red-600' : color}`}>
                      <span className="me-1 hidden font-bold sm:inline">{new Date(lead.dueAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>{lead.name}
                    </button>
                  })}
                  {events.length > 2 && <p className="truncate px-0.5 text-[9px] font-semibold text-gray-400">+{events.length - 2} {t('נוספים', 'more')}</p>}
                </div>
              </div>
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
