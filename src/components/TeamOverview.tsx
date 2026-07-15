import { useState } from 'react'
import { Shield, MessageSquare, Send } from 'lucide-react'
import { Avatar } from './Avatar'
import { DEVELOPERS } from '../data/workMockData'
import type { Task, StatusHistoryEntry } from '../types/work'
import { STATUS_PILL, STATUS_LABEL } from '../data/workConstants'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtHours(h: number) {
  if (h === 0) return '0h'
  const hrs = Math.floor(h); const min = Math.round((h - hrs) * 60)
  return min > 0 ? `${hrs}h ${min}m` : `${hrs}h`
}
function isOverdue(due?: string) { return !!due && new Date(due) < new Date() }
function hoursSince(iso: string) { return (Date.now() - new Date(iso).getTime()) / 3_600_000 }

type Period = 'today' | 'week' | 'month' | 'custom'

function inPeriod(iso: string | undefined, period: Period, from: string, to: string): boolean {
  if (!iso) return false
  const d = new Date(iso).getTime()
  const now = new Date()
  if (period === 'today') {
    return new Date(iso).toDateString() === now.toDateString()
  }
  if (period === 'week') {
    const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1); mon.setHours(0,0,0,0)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999)
    return d >= mon.getTime() && d <= sun.getTime()
  }
  if (period === 'month') {
    return new Date(iso).getMonth() === now.getMonth() && new Date(iso).getFullYear() === now.getFullYear()
  }
  if (!from || !to) return false
  return d >= new Date(from).setHours(0,0,0,0) && d <= new Date(to).setHours(23,59,59,999)
}

function StatCard({ label, value, sub, color = 'blue' }: { label: string; value: number | string; sub: string; color?: 'blue' | 'red' | 'green' | 'purple' }) {
  const n      = typeof value === 'number' ? value : 0
  const active = n > 0
  type S = { bg: string; val: string; lbl: string }
  const s: S = (
    color === 'red'    ? { bg: active ? 'bg-red-50 border-red-200'     : 'bg-white border-gray-100', val: active ? 'text-red-600'   : 'text-gray-300', lbl: active ? 'text-red-500'   : 'text-gray-400' }
  : color === 'green'  ? { bg: active ? 'bg-green-50 border-green-200' : 'bg-white border-gray-100', val: active ? 'text-green-600' : 'text-gray-300', lbl: active ? 'text-green-600' : 'text-gray-400' }
  : color === 'purple' ? { bg: 'bg-white border-gray-100',                                           val: 'text-purple-600',                           lbl: 'text-gray-400' }
  :                      { bg: 'bg-white border-gray-100',                                           val: 'text-primary',                              lbl: 'text-gray-400' }
  )
  return (
    <div className={`border rounded-xl p-4 shadow-sm ${s.bg}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${s.lbl}`}>{label}</p>
      <p className={`text-2xl font-bold ${s.val}`}>{value}</p>
      <p className={`text-[10px] mt-0.5 ${s.lbl}`}>{sub}</p>
    </div>
  )
}

// ─── TeamOverview ─────────────────────────────────────────────────────────────

export function TeamOverview({
  tasks, isAdmin, onOpenTask, onUpdate,
}: {
  tasks: Task[]
  isAdmin: boolean
  onOpenTask: (id: string) => void
  onUpdate: (t: Task) => void
}) {
  const [period, setPeriod]   = useState<Period>('month')
  const [fromDate, setFrom]   = useState('')
  const [toDate,   setTo]     = useState('')

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
          <Shield size={26} className="text-red-300" />
        </div>
        <p className="text-sm font-semibold text-gray-500">גישה נדחתה</p>
        <p className="text-xs text-gray-400">סקירת הצוות מוגבלת למנהלי מערכת.</p>
      </div>
    )
  }

  const periodLabel: Record<Period, string> = { today: 'היום', week: 'השבוע', month: 'החודש', custom: 'מותאם' }
  const activityLabel: Record<Period, string> = { today: 'פעילות היום', week: 'פעילות השבוע', month: 'פעילות החודש', custom: 'פעילות בתקופה' }

  function inP(iso?: string) { return inPeriod(iso, period, fromDate, toDate) }

  // ── Period-aware aggregations ──────────────────────────────────────────────

  const completedPeriod   = tasks.filter(t => t.status === 'done' && inP(t.doneAt))
  const movedToCodeReview = tasks.filter(t => t.statusHistory.some(e => e.status === 'pending_code_review' && inP(e.timestamp)))
  const movedToUxReview   = tasks.filter(t => t.statusHistory.some(e => e.status === 'pending_ux_review'   && inP(e.timestamp)))
  // Overdue: tasks whose due date falls in the period and haven't been completed
  const overdueTasks      = tasks.filter(t => inP(t.dueDate) && isOverdue(t.dueDate) && t.status !== 'done' && t.status !== 'archived')
  const waApprovals       = tasks.filter(t => t.whatsappPending === true)

  // Pending reviews that entered that status during the period
  const pendingReviews = tasks.filter(t =>
    (t.status === 'pending_code_review' || t.status === 'pending_ux_review') &&
    t.statusHistory.some(e => (e.status === 'pending_code_review' || e.status === 'pending_ux_review') && inP(e.timestamp))
  )

  // All status changes within the selected period
  const periodActivity: { task: Task; entry: StatusHistoryEntry }[] = []
  tasks.forEach(t => t.statusHistory.forEach(e => {
    if (inP(e.timestamp)) periodActivity.push({ task: t, entry: e })
  }))
  periodActivity.sort((a, b) => new Date(b.entry.timestamp).getTime() - new Date(a.entry.timestamp).getTime())

  const devStats = DEVELOPERS.map(dev => {
    const devTasks   = tasks.filter(t => t.assignee === dev.name)
    const doneP      = devTasks.filter(t => t.status === 'done' && inP(t.doneAt))
    const toCodeRev  = devTasks.filter(t => t.statusHistory.some(e => e.status === 'pending_code_review' && inP(e.timestamp)))
    const toUxRev    = devTasks.filter(t => t.statusHistory.some(e => e.status === 'pending_ux_review'   && inP(e.timestamp)))
    // Open tasks: currently not done/archived (current workload)
    const openDev    = devTasks.filter(t => t.status !== 'done' && t.status !== 'archived')
    // Hours: sum timeEntries whose date falls within the selected period
    const hours      = devTasks
      .flatMap(t => t.timeEntries)
      .filter(e => inP(e.date))
      .reduce((sum, e) => sum + e.hours + e.minutes / 60, 0)
    const activeNow  = devTasks.some(t => t.status === 'in_progress')
    // Status moves within the period by this developer
    const periodMoves: { task: Task; entry: StatusHistoryEntry }[] = []
    devTasks.forEach(t => t.statusHistory.forEach(e => {
      if (inP(e.timestamp) && e.changedBy === dev.name)
        periodMoves.push({ task: t, entry: e })
    }))
    return { dev, doneP, toCodeRev, toUxRev, openDev, hours, activeNow, periodMoves }
  })

  const reviewRows = pendingReviews.map(task => {
    const entries  = [...task.statusHistory].reverse()
    const entry    = entries.find(e => e.status === task.status)
    const hrs      = hoursSince(entry?.timestamp ?? task.createdAt)
    const reviewer = task.status === 'pending_code_review' ? task.codeReviewer : task.uxReviewer
    const kind     = task.status === 'pending_code_review' ? 'בדיקת קוד' : 'בדיקת UI/UX'
    const kindCls  = task.status === 'pending_code_review' ? 'bg-purple-100 text-purple-700' : 'bg-pink-100 text-pink-700'
    return { task, hrs, reviewer, kind, kindCls }
  })

  return (
    <div className="flex flex-col gap-6 overflow-y-auto pb-6 flex-1 min-h-0" dir="rtl">

      {/* Period filter */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {(['today', 'week', 'month', 'custom'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${period === p ? 'bg-primary text-white border-primary' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
          >
            {periodLabel[p]}
          </button>
        ))}
        {period === 'custom' && (
          <>
            <input type="date" value={fromDate} onChange={e => setFrom(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-primary" />
            <span className="text-gray-400 text-xs">←</span>
            <input type="date" value={toDate} onChange={e => setTo(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-primary" />
          </>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shrink-0">
        <StatCard label="הושלמו"             value={completedPeriod.length}   sub={periodLabel[period]}  color="green"  />
        <StatCard label="→ בדיקת קוד"        value={movedToCodeReview.length} sub={periodLabel[period]}  color="purple" />
        <StatCard label="→ בדיקת UX"         value={movedToUxReview.length}   sub={periodLabel[period]}  color="purple" />
        <StatCard label="באיחור"             value={overdueTasks.length}      sub={periodLabel[period]}  color="red"    />
        <StatCard label="אישורי WhatsApp"    value={waApprovals.length}       sub="ממתין לאדמין"         color="green"  />
      </div>

      {/* Developer table */}
      <section className="shrink-0">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">סקירת מפתחים — {periodLabel[period]}</p>
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80">
                {['מפתח', 'שעות (תקופה)', 'הושלמו', '→ ק. קוד', '→ ק. UX', 'פתוחות', 'סטטוס'].map((h, i) => (
                  <th key={h} className={`px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider ${i === 0 ? 'text-right' : 'text-center'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {devStats.map(({ dev, doneP, toCodeRev, toUxRev, openDev, hours, activeNow, periodMoves }) => (
                <tr key={dev.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={dev.name} />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{dev.name}</p>
                        <p className="text-[10px] text-gray-400">{dev.role}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center"><span className="text-sm font-semibold text-gray-700">{fmtHours(hours)}</span></td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${doneP.length > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>{doneP.length}</span>
                  </td>
                  <td className="px-4 py-3 text-center"><span className="text-sm text-gray-600">{toCodeRev.length}</span></td>
                  <td className="px-4 py-3 text-center"><span className="text-sm text-gray-600">{toUxRev.length}</span></td>
                  <td className="px-4 py-3 text-center"><span className="text-sm text-gray-600">{openDev.length}</span></td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${activeNow ? 'bg-green-400 animate-pulse' : 'bg-gray-200'}`} />
                        <span className={`text-[10px] font-semibold ${activeNow ? 'text-green-600' : 'text-gray-400'}`}>{activeNow ? 'פעיל' : 'לא פעיל'}</span>
                      </div>
                      {periodMoves.length > 0 && (
                        <span className="text-[9px] text-gray-400">{periodMoves.length} תנועות</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Period Activity */}
      <section className="shrink-0">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">{activityLabel[period]}</p>
        {periodActivity.length === 0 ? (
          <p className="text-sm text-gray-400 italic">לא תועדו שינויי סטטוס בתקופה זו.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {periodActivity.slice(0, 20).map(({ task, entry }, i) => (
              <button key={i} onClick={() => onOpenTask(task.id)} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-2.5 hover:border-gray-200 hover:shadow-sm transition-all text-right w-full">
                <Avatar name={entry.changedBy} size="xs" />
                <span className="text-xs font-semibold text-gray-700 shrink-0">{entry.changedBy}</span>
                <span className="text-xs text-gray-400 shrink-0">→</span>
                <span className="text-xs font-medium text-gray-800 flex-1 truncate">{task.title}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${STATUS_PILL[entry.status] ?? 'bg-gray-100 text-gray-500'}`}>{STATUS_LABEL[entry.status] ?? entry.status}</span>
                <span className="text-[10px] text-gray-400 font-mono shrink-0">
                  {period === 'today'
                    ? new Date(entry.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
                    : new Date(entry.timestamp).toLocaleDateString('he-IL', { day: '2-digit', month: 'short' })}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Pending Reviews */}
      {reviewRows.length > 0 && (
        <section className="shrink-0">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">ביקורות ממתינות — {periodLabel[period]}</p>
          <div className="flex flex-col gap-2">
            {reviewRows.map(({ task, hrs, reviewer, kind, kindCls }) => {
              const stale = hrs >= 48
              return (
                <button key={task.id} onClick={() => onOpenTask(task.id)} className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all text-right w-full hover:shadow-sm ${stale ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 hover:border-gray-200'}`}>
                  <span className="text-[10px] font-mono text-gray-400 shrink-0">{task.id}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${kindCls}`}>{kind}</span>
                  <span className="text-sm font-medium text-gray-800 flex-1 truncate">{task.title}</span>
                  {reviewer && <div className="flex items-center gap-1.5 shrink-0"><Avatar name={reviewer} size="xs" /><span className="text-xs text-gray-500">{reviewer}</span></div>}
                  <span className={`text-[10px] font-bold shrink-0 ${stale ? 'text-red-600' : 'text-gray-400'}`}>{Math.round(hrs)}h{stale ? ' ⚠' : ''}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* WA Approvals */}
      {waApprovals.length > 0 && (
        <section className="shrink-0">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">אישורי WhatsApp ממתינים</p>
          <div className="flex flex-col gap-2">
            {waApprovals.map(task => (
              <div key={task.id} className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <MessageSquare size={14} className="text-green-600 shrink-0" />
                  <span className="text-[10px] font-mono text-green-600 shrink-0">{task.id}</span>
                  <span className="text-sm font-medium text-green-900 flex-1 truncate">{task.title}</span>
                  <span className="text-xs font-semibold text-green-700 shrink-0">{task.clientName}</span>
                </div>
                <div className="bg-white/70 rounded-lg px-3 py-2 text-xs text-gray-600 italic border border-green-100 leading-relaxed">
                  "היי {task.clientName}, רצינו לעדכן אותך שהטיפול ב{task.title} הושלם בהצלחה. אנחנו כאן לכל שאלה 🙏"
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => onUpdate({ ...task, whatsappPending: false })} className="px-3 py-1.5 bg-white border border-green-200 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-50 transition-colors">בטל</button>
                  <button onClick={() => onUpdate({ ...task, whatsappPending: false })} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-colors"><Send size={11} /> אשר ושלח</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
