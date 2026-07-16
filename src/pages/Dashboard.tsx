import { useEffect, useRef, useState } from 'react'
import {
  Users,
  CreditCard,
  UserPlus,
  TrendingUp,
  TrendingDown,
  Bell,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Zap,
  RefreshCw,
  Loader2,
  Clock,
  MessageSquare,
  X,
  BarChart2,
} from 'lucide-react'
import { getDashboardStats, getLatestAgentStatus } from '../lib/database'
import type { DashboardStats, DbAgentLog } from '../lib/database'
import { supabase } from '../lib/supabase'
import { TeamOverview } from '../components/TeamOverview'
import { MOCK_TASKS } from '../data/workMockData'
import { useAuth } from '../hooks/useAuth'
import type { Task } from '../types/work'

interface AgentLog {
  id: string
  agent_name: string
  result_summary: string | null
  run_at: string
  status?: 'success' | 'error' | 'running'
}

function formatHebrewDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function fetchAgentErrors(): Promise<AgentLog[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('agent_logs')
    .select('id, agent_name, result_summary, run_at')
    .eq('status', 'error')
    .gte('run_at', since)
    .order('run_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

const ALERTS: { severity: 'critical' | 'warning' | 'error'; icon: typeof Bell; title: string; desc: string; action: string }[] = []

// Real agents shown in the home status table, overlaid with live status from agent_logs
const AGENT_META = [
  { id: 'woo-new-client',           name: 'לקוח חדש',              desc: 'יצירת לקוח מהרשמה חדשה',          schedule: 'לפי אירוע' },
  { id: 'cardcom-verify-activate',  name: 'אימות תשלום ראשוני',    desc: 'אימות התשלום הראשון מול Cardcom', schedule: 'לפי אירוע' },
  { id: 'welcome-message',          name: 'הודעת ברוכים הבאים',    desc: 'הודעת פתיחה ב-WhatsApp',          schedule: 'לפי אירוע' },
  { id: 'monthly-usage-collector',  name: 'איסוף שימוש חודשי',     desc: 'איסוף OTP ומשתמשים פעילים',       schedule: '1 לחודש' },
  { id: 'monthly-usage-calculator', name: 'חישוב חיוב חודשי',      desc: 'חישוב החיוב המשתנה לכל לקוח',     schedule: '1 לחודש' },
  { id: 'daily-payment-check',      name: 'אימות תשלום יומי',      desc: 'בדיקת חידושי מנוי יומית',         schedule: 'כל יום' },
  { id: 'status-change',            name: 'ניטור סטטוס לקוח',      desc: 'ניטור ביטול והשהיית מנוי',        schedule: 'לפי אירוע' },
  { id: 'send-bulk',                name: 'שליחת WhatsApp מרוכזת', desc: 'שליחה ללקוחות לפי חבילה',         schedule: 'לפי אירוע' },
]

async function fetchRecentActivity(): Promise<AgentLog[]> {
  const { data, error } = await supabase
    .from('agent_logs')
    .select('id, agent_name, result_summary, run_at, status')
    .order('run_at', { ascending: false })
    .limit(8)
  if (error) throw error
  return data ?? []
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} דקות`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `לפני ${hrs} שעות`
  return `לפני ${Math.floor(hrs / 24)} ימים`
}

// ─── Style maps ───────────────────────────────────────────────────────────────

const SEVERITY = {
  critical: {
    wrap: 'border-red-200 bg-red-50',
    icon: 'text-red-500',
    btn:  'bg-red-600 hover:bg-red-700 text-white',
  },
  warning: {
    wrap: 'border-amber-200 bg-amber-50',
    icon: 'text-amber-500',
    btn:  'bg-amber-500 hover:bg-amber-600 text-white',
  },
  error: {
    wrap: 'border-orange-200 bg-orange-50',
    icon: 'text-accent',
    btn:  'bg-accent hover:bg-accent-dark text-white',
  },
}

const AGENT_STATUS = {
  active:    { label: 'פעיל',   dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-100'  },
  sleeping:  { label: 'ממתין',  dot: 'bg-blue-400',  text: 'text-blue-700',  bg: 'bg-blue-100'   },
  scheduled: { label: 'מתוזמן', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-100'  },
  paused:    { label: 'מושהה',  dot: 'bg-gray-400',  text: 'text-gray-600',  bg: 'bg-gray-100'   },
  error:     { label: 'שגיאה',  dot: 'bg-red-500',   text: 'text-red-700',   bg: 'bg-red-100'    },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-semibold text-primary">{title}</h2>
      {action && (
        <button className="text-xs text-secondary-dark hover:text-secondary font-medium transition-colors">
          {action}
        </button>
      )}
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface rounded-2xl border border-gray-100 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { isAdmin }                   = useAuth()
  const [stats, setStats]             = useState<DashboardStats | null>(null)
  const [loading, setLoading]         = useState(true)
  const [tasks,   setTasks]           = useState<Task[]>(MOCK_TASKS)
  const [showTeam, setShowTeam]       = useState(false)
  const [agentErrors, setAgentErrors] = useState<AgentLog[]>([])
  const [liveAgents, setLiveAgents]   = useState<Record<string, DbAgentLog>>({})
  const [activity, setActivity]       = useState<AgentLog[]>([])
  const agentTimerRef                 = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const load = () => {
      fetchAgentErrors().then(setAgentErrors).catch(() => {})
      getLatestAgentStatus().then(setLiveAgents).catch(() => {})
      fetchRecentActivity().then(setActivity).catch(() => {})
    }
    load()
    agentTimerRef.current = setInterval(load, 60 * 60 * 1000)
    return () => {
      if (agentTimerRef.current) clearInterval(agentTimerRef.current)
    }
  }, [])

  const STAT_CARDS = [
    {
      label:     'לקוחות פעילים',
      value:     loading ? '…' : String(stats?.activeClients ?? 0),
      icon:      Users,
      iconColor: 'text-primary',
      iconBg:    'bg-primary/10',
      trend:     'לקוחות פעילים כרגע',
      trendUp:   true,
    },
    {
      label:     'הכנסה חודשית',
      value:     loading ? '…' : `₪${(stats?.monthlyRevenue ?? 0).toLocaleString()}`,
      icon:      CreditCard,
      iconColor: 'text-green-600',
      iconBg:    'bg-green-100',
      trend:     'MRR — חבילות פעילות',
      trendUp:   true,
    },
    {
      label:     'לידים פעילים',
      value:     loading ? '…' : String(stats?.openLeads ?? 0),
      icon:      UserPlus,
      iconColor: 'text-secondary-dark',
      iconBg:    'bg-secondary/15',
      trend:     'לא כולל ארכיב',
      trendUp:   true,
    },
    {
      label:     'תשלומים פתוחים',
      value:     loading ? '…' : String(stats?.unpaidBilling ?? 0),
      icon:      Clock,
      iconColor: 'text-accent',
      iconBg:    'bg-accent/10',
      trend:     stats?.unpaidBilling ? 'ממתינים לגבייה' : 'הכל שולם',
      trendUp:   !(stats?.unpaidBilling),
    },
  ]

  return (
    <div className="space-y-6 max-w-7xl mx-auto">

      {/* ── Team Overview modal ── */}
      {showTeam && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowTeam(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <BarChart2 size={18} className="text-primary" />
                <span className="text-sm font-semibold text-gray-800">סקירת צוות</span>
              </div>
              <button onClick={() => setShowTeam(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><X size={15} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden px-6 py-5 flex flex-col">
              <TeamOverview tasks={tasks} isAdmin={isAdmin} onOpenTask={() => setShowTeam(false)} onUpdate={t => setTasks(prev => prev.map(p => p.id === t.id ? t : p))} />
            </div>
          </div>
        </div>
      )}

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ label, value, icon: Icon, iconColor, iconBg, trend, trendUp }) => (
          <Card key={label} className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
                {loading ? <Loader2 size={18} className={`${iconColor} animate-spin`} /> : <Icon size={18} className={iconColor} />}
              </div>
              <span className={`flex items-center gap-1 text-xs font-medium ${trendUp ? 'text-green-600' : 'text-accent'}`}>
                {trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {trend}
              </span>
            </div>
            <p className="text-2xl font-bold text-primary">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* ── Middle row: Alerts + Activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Alerts — takes 2 of 3 columns */}
        <div className="lg:col-span-2">
          <SectionHeader title="התראות פעילות" action="הצג הכל" />
          <div className="space-y-3">
            {[...ALERTS, ...((stats?.inactiveClients ?? 0) > 0 ? [{
              severity: 'warning' as const,
              icon: AlertTriangle,
              title: `${stats!.inactiveClients} לקוחות מושהים`,
              desc: 'סטטוס: מושהה / פג תוקף / בוטל — נדרשת בדיקה',
              action: 'צפה בלקוחות',
            }] : [])].map(({ severity, icon: Icon, title, desc, action }) => {
              const s = SEVERITY[severity]
              return (
                <div
                  key={title}
                  className={`flex items-center gap-4 p-4 rounded-2xl border ${s.wrap}`}
                >
                  <Icon size={18} className={`${s.icon} shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </div>
                  <button
                    className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${s.btn}`}
                  >
                    {action}
                  </button>
                </div>
              )
            })}
            {agentErrors.map(log => (
              <div
                key={log.id}
                className="flex items-center gap-4 p-4 rounded-2xl border border-red-200 bg-red-50"
              >
                <AlertCircle size={18} className="text-red-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{log.result_summary || log.agent_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{formatHebrewDate(log.run_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity — takes 1 of 3 columns */}
        <div>
          <SectionHeader title="פעילות אחרונה" />
          <Card className="divide-y divide-gray-50">
            {activity.length === 0 ? (
              <div className="p-4 text-xs text-gray-400">אין פעילות אחרונה עדיין</div>
            ) : activity.map(log => {
              const isErr = log.status === 'error'
              const Icon  = isErr ? AlertCircle : CheckCircle2
              const color = isErr ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
              return (
                <div key={log.id} className="flex items-start gap-3 p-4">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${color}`}>
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 truncate">{log.agent_name}</p>
                    <p className="text-xs text-gray-400 truncate">{log.result_summary || ''}</p>
                    <p className="text-xs text-gray-300 mt-0.5">{relativeTime(log.run_at)}</p>
                  </div>
                </div>
              )
            })}
          </Card>
        </div>
      </div>

      {/* ── Team Overview card (admin only) ── */}
      {isAdmin && (
        <div>
          <SectionHeader title="צוות פיתוח" />
          <button
            onClick={() => setShowTeam(true)}
            className="w-full flex items-center gap-4 p-5 bg-surface rounded-2xl border border-gray-100 shadow-sm hover:border-primary/30 hover:shadow-md transition-all text-right"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <BarChart2 size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">סקירת צוות</p>
              <p className="text-xs text-gray-400 mt-0.5">סטטיסטיקות מפתחים, ביקורות, אישורי וואטסאפ, פעילות</p>
            </div>
            <span className="text-xs text-primary font-semibold shrink-0">פתח →</span>
          </button>
        </div>
      )}

      {/* ── Agents status ── */}
      <div>
        <SectionHeader title="סטטוס סוכנים" action="לוח בקרה מלא" />
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">סוכן</th>
                <th className="text-right text-xs font-medium text-gray-400 px-5 py-3 hidden sm:table-cell">תיאור</th>
                <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">סטטוס</th>
                <th className="text-right text-xs font-medium text-gray-400 px-5 py-3 hidden md:table-cell">ריצה אחרונה</th>
                <th className="text-right text-xs font-medium text-gray-400 px-5 py-3 hidden md:table-cell">ריצה הבאה</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {AGENT_META.map(meta => {
                const live = liveAgents[meta.id]
                const status: keyof typeof AGENT_STATUS = !live ? 'sleeping' : live.status === 'error' ? 'error' : 'active'
                const s = AGENT_STATUS[status]
                const lastRun = live ? relativeTime(live.run_at) : 'טרם רץ'
                const { name, desc, schedule: nextRun } = meta
                return (
                  <tr key={meta.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="font-medium text-gray-800">{name}</span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs hidden sm:table-cell">{desc}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${status === 'active' ? 'animate-pulse' : ''}`} />
                        {s.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs hidden md:table-cell">{lastRun}</td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs hidden md:table-cell">{nextRun}</td>
                    <td className="px-5 py-3.5">
                      <button className="p-1.5 text-gray-300 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                        <RefreshCw size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </div>

    </div>
  )
}
