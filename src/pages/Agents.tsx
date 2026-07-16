import { useState, useEffect } from 'react'
import {
  ChevronDown, ChevronUp, Play, FileText, Clock, Zap,
  CheckCircle2, XCircle, Info, AlertTriangle, ArrowDown, RefreshCw,
  Loader2,
} from 'lucide-react'
import { getAgentLogs, getLatestAgentStatus } from '../lib/database'
import type { DbAgentLog } from '../lib/database'

type AgentStatus   = 'ממתין' | 'פעיל' | 'שגיאה' | 'כבוי'
type AgentSchedule = 'monthly' | 'daily' | 'triggered' | 'continuous'
type LogResult     = 'success' | 'error' | 'info'
type RunState      = 'idle' | 'running' | 'done'

interface AgentLog  { time: string; action: string; result: LogResult }
interface Agent {
  id: string; name: string; desc: string
  schedule: AgentSchedule; scheduleLabel: string
  status: AgentStatus; enabled: boolean
  nextRun: string; lastRun: string; lastResult: string
  log: AgentLog[]
}

interface FlowNode { label: string; sub?: string; emoji?: string; decision?: boolean; multi?: boolean }
interface Flow {
  id: string; agentId: string | string[]; title: string
  trigger: string; color: string; nodes: FlowNode[]
}
interface FlowConnection {
  from: string; to: string; label: string
  type: 'sequential' | 'synchronized'
}
interface FlowGroup {
  id: string; label: string
  flows: Flow[]; connections: FlowConnection[]
}

const STATUS_CONFIG: Record<AgentStatus, { bg: string; text: string; dot: string; pulse: boolean }> = {
  'פעיל':   { bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-500',  pulse: true  },
  'ממתין':  { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-400',   pulse: false },
  'שגיאה':  { bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500',    pulse: false },
  'כבוי':   { bg: 'bg-gray-100',  text: 'text-gray-500',   dot: 'bg-gray-400',   pulse: false },
}

const AGENTS: Agent[] = [
  {
    id: "woo-new-client",
    name: "לקוח חדש",
    desc: "יוצר לקוח חדש במערכת מתוך הרשמה חדשה ב-WooCommerce, ומעביר לאימות תשלום",
    schedule: "triggered", scheduleLabel: "Webhook — הרשמה חדשה",
    status: 'ממתין', enabled: true,
    nextRun: "בהמתנה לטריגר", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "cardcom-verify-activate",
    name: "אימות תשלום ראשוני",
    desc: "מאמת מול Cardcom שהתשלום הראשון עבר, מפעיל את הלקוח או פותח התראה אם נכשל",
    schedule: "triggered", scheduleLabel: "אחרי לקוח חדש",
    status: 'ממתין', enabled: true,
    nextRun: "בהמתנה לטריגר", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "welcome-message",
    name: "הודעת ברוכים הבאים",
    desc: "שולח הודעת ברוכים הבאים ללקוח חדש ב-WhatsApp",
    schedule: "triggered", scheduleLabel: "אחרי הרשמה",
    status: 'ממתין', enabled: true,
    nextRun: "בהמתנה לטריגר", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "monthly-usage-collector",
    name: "איסוף שימוש חודשי",
    desc: "בתחילת כל חודש אוסף כמות OTP ומשתמשים פעילים לכל לקוח ושומר במערכת",
    schedule: "monthly", scheduleLabel: "1 לחודש, 06:00",
    status: 'ממתין', enabled: true,
    nextRun: "1 לחודש, 06:00", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "monthly-usage-calculator",
    name: "חישוב חיוב חודשי",
    desc: "מחשב את החיוב המשתנה של כל לקוח לפי השימוש והמחירים",
    schedule: "monthly", scheduleLabel: "1 לחודש, 07:00",
    status: 'ממתין', enabled: true,
    nextRun: "1 לחודש, 07:00", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "daily-payment-check",
    name: "אימות תשלום יומי",
    desc: "בודק מדי יום מנויים שהיו אמורים להתחדש, ומתריע פעם אחת אם התשלום לא נמצא",
    schedule: "daily", scheduleLabel: "כל יום, 06:00",
    status: 'ממתין', enabled: true,
    nextRun: "מחר, 06:00", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "status-change",
    name: "ניטור סטטוס לקוח",
    desc: "עוקב אחרי שינויי סטטוס מנוי כמו ביטול או השהיה, ומעדכן את הלוח עם התראה",
    schedule: "triggered", scheduleLabel: "Webhook — עדכון מנוי",
    status: 'ממתין', enabled: true,
    nextRun: "בהמתנה לטריגר", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "package-change",
    name: "שינוי חבילה",
    desc: "מעדכן את חבילת הלקוח כאשר הוא מחליף מנוי",
    schedule: "triggered", scheduleLabel: "Webhook — החלפת מנוי",
    status: 'ממתין', enabled: true,
    nextRun: "בהמתנה לטריגר", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "send-bulk",
    name: "שליחת WhatsApp מרוכזת",
    desc: "שולח הודעות WhatsApp ללקוחות לפי חבילה, עם מרווח בטוח בין כל הודעה",
    schedule: "triggered", scheduleLabel: "מהלוח — שליחה מרוכזת",
    status: 'ממתין', enabled: true,
    nextRun: "בהמתנה לטריגר", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "google-contacts",
    name: "הוספה ל-Google Contacts",
    desc: "מוסיף כל לקוח חדש לאנשי הקשר ב-Google. מוכן לפעולה, ממתין לחיבור חשבון Google",
    schedule: "triggered", scheduleLabel: "אחרי הרשמה",
    status: 'כבוי', enabled: false,
    nextRun: "—", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "collection-followup",
    name: "מעקב גבייה — 15/20/25",
    desc: "בודק אילו בקשות תשלום חודשיות שולמו ושולח תזכורות ב-15, 20 ו-25 לחודש. בבנייה",
    schedule: "monthly", scheduleLabel: "15/20/25 לחודש",
    status: 'כבוי', enabled: false,
    nextRun: "—", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "sales-bot",
    name: "בוט מכירות",
    desc: "מענה אוטומטי ללידים ממודעות, תיאום שיחות וניתוב להמרה. בבנייה",
    schedule: "continuous", scheduleLabel: "24/7",
    status: 'כבוי', enabled: false,
    nextRun: "—", lastRun: '—', lastResult: '—',
    log: [],
  },
  {
    id: "support-bot",
    name: "בוט תמיכה",
    desc: "מענה אוטומטי לשאלות תמיכה ב-WhatsApp ופתיחת פניות לנושאים מורכבים. בבנייה",
    schedule: "continuous", scheduleLabel: "24/7",
    status: 'כבוי', enabled: false,
    nextRun: "—", lastRun: '—', lastResult: '—',
    log: [],
  },
]

// ─── DB helpers ───────────────────────────────────────────────────────────────

function fmtRunAt(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function dbStatusToAgent(log: DbAgentLog | undefined, enabled: boolean): AgentStatus {
  if (!enabled) return 'כבוי'
  if (!log) return 'ממתין'
  if (log.status === 'running') return 'פעיל'
  if (log.status === 'error')   return 'שגיאה'
  return 'ממתין'
}

function dbLogToAgentLog(log: DbAgentLog): AgentLog {
  const resultMap: Record<DbAgentLog['status'], LogResult> = {
    success: 'success', error: 'error', running: 'info',
  }
  return {
    time:   fmtRunAt(log.run_at),
    action: log.result_summary ?? log.status,
    result: resultMap[log.status],
  }
}

// ─── Flow groups ───────────────────────────────────────────────────────────────

const FLOW_GROUPS: FlowGroup[] = [
  {
    id: 'billing-monthly',
    label: 'חיוב חודשי — 1 לחודש',
    flows: [
      {
        id: 'billing-collect',
        agentId: 'billing-collect',
        title: 'גביית חיובים חודשית',
        trigger: '1 לחודש, 00:00',
        color: 'border-primary text-primary bg-primary/5',
        nodes: [
          { label: 'SuperAdmin API', sub: 'שליפת לקוחות', emoji: '🗄️' },
          { label: 'n8n', sub: 'עיבוד נתונים', emoji: '⚙️' },
          { label: 'חישוב חיובים', sub: 'OTP + משתמשים', emoji: '🧮' },
          { label: 'Cardcom', sub: 'עיבוד תשלום', emoji: '💳' },
          { label: 'עדכון CRM', sub: 'סטטוס + היסטוריה', emoji: '✅' },
        ],
      },
      {
        id: 'cardcom-audit',
        agentId: 'cardcom-audit',
        title: 'ביקורת Cardcom חודשית',
        trigger: '1 לחודש, 02:00',
        color: 'border-primary text-primary bg-primary/5',
        nodes: [
          { label: 'CRM', sub: 'שליפת לקוחות', emoji: '🗄️' },
          { label: 'Cardcom', sub: 'שליפת עסקאות', emoji: '💳' },
          { label: 'השוואה', sub: 'CRM vs Cardcom', emoji: '🔄' },
          { label: 'אי-התאמה?', sub: 'בדיקה', emoji: '⚠️', decision: true },
          { label: 'התראת מנהל', sub: 'לוח בקרה', emoji: '🔔' },
        ],
      },
    ],
    connections: [
      { from: 'billing-collect', to: 'cardcom-audit', label: 'ביקורת מסתנכרת — רץ אחרי גבייה (02:00)', type: 'synchronized' },
    ],
  },
  {
    id: 'billing-followup',
    label: 'מעקב גבייה — רצף חודשי',
    flows: [
      {
        id: 'billing-check-15',
        agentId: 'billing-check-15',
        title: 'בדיקת גבייה — יום 15',
        trigger: '15 לחודש, 09:00',
        color: 'border-amber-400 text-amber-700 bg-amber-50',
        nodes: [
          { label: 'Cardcom', sub: 'בדיקת תשלומים', emoji: '🔍' },
          { label: 'לא שולם?', sub: 'בדיקה', emoji: '❓', decision: true },
          { label: 'WhatsApp', sub: 'תזכורת ראשונה', emoji: '📱' },
          { label: 'לוח בקרה', sub: 'התראת מנהל', emoji: '🔔' },
        ],
      },
      {
        id: 'billing-check-20',
        agentId: 'billing-check-20',
        title: 'בדיקת גבייה — יום 20',
        trigger: '20 לחודש, 09:00',
        color: 'border-amber-400 text-amber-700 bg-amber-50',
        nodes: [
          { label: 'Cardcom', sub: 'בדיקת תשלומים', emoji: '🔍' },
          { label: 'לא שולם?', sub: 'בדיקה', emoji: '❓', decision: true },
          { label: 'WhatsApp', sub: 'תזכורת שנייה', emoji: '📱' },
          { label: 'לוח בקרה', sub: 'התראת מנהל', emoji: '🔔' },
        ],
      },
      {
        id: 'billing-check-25',
        agentId: 'billing-check-25',
        title: 'בדיקת גבייה — יום 25',
        trigger: '25 לחודש, 09:00',
        color: 'border-amber-400 text-amber-700 bg-amber-50',
        nodes: [
          { label: 'Cardcom', sub: 'בדיקת תשלומים', emoji: '🔍' },
          { label: 'לא שולם?', sub: 'בדיקה', emoji: '❓', decision: true },
          { label: 'WhatsApp', sub: 'תזכורת שלישית', emoji: '📱' },
          { label: 'לוח בקרה', sub: 'סימון פגום', emoji: '🚨' },
        ],
      },
    ],
    connections: [
      { from: 'billing-check-15', to: 'billing-check-20', label: 'אם לא שולם — ממשיך ביום 20', type: 'sequential' },
      { from: 'billing-check-20', to: 'billing-check-25', label: 'אם עדיין לא שולם — ממשיך ביום 25', type: 'sequential' },
    ],
  },
  {
    id: 'instant',
    label: 'אוטומציה מיידית — Webhook',
    flows: [
      {
        id: 'cc-failed',
        agentId: 'cc-failed',
        title: 'כשל כרטיס אשראי',
        trigger: 'Webhook — Cardcom',
        color: 'border-red-400 text-red-700 bg-red-50',
        nodes: [
          { label: 'Cardcom', sub: 'Webhook כשל', emoji: '🛒' },
          { label: 'n8n', sub: 'זיהוי כשל', emoji: '⚙️' },
          { label: 'WhatsApp', sub: 'הודעה מיידית', emoji: '📱' },
          { label: 'עדכון CRM', sub: 'סמן + תזמן', emoji: '📋' },
        ],
      },
    ],
    connections: [],
  },
  {
    id: 'leads-clients',
    label: 'לידים ולקוחות',
    flows: [
      {
        id: 'renewal',
        agentId: 'renewal',
        title: 'התראות חידוש מנוי',
        trigger: 'יומי 08:00',
        color: 'border-secondary text-teal-700 bg-teal-50',
        nodes: [
          { label: 'CRM', sub: 'סריקת לקוחות', emoji: '🔎' },
          { label: 'חודש 11-12?', sub: 'סינון', emoji: '📅', decision: true },
          { label: 'WhatsApp', sub: 'הצעת חידוש', emoji: '📩' },
          { label: 'CRM', sub: 'עדכון סטטוס', emoji: '✅' },
        ],
      },
      {
        id: 'contacts',
        agentId: 'contacts',
        title: 'שמירת אנשי קשר',
        trigger: 'שינוי סטטוס ליד',
        color: 'border-gray-400 text-gray-700 bg-gray-50',
        nodes: [
          { label: 'Leads CRM', sub: 'סטטוס השתנה', emoji: '👤' },
          { label: 'ארכיב / לא רלוונטי?', sub: 'סינון', emoji: '🚫', decision: true },
          { label: 'Green API', sub: 'שמירת איש קשר', emoji: '📲' },
          { label: 'אנשי קשר WA', sub: '"שם DYO"', emoji: '✅' },
        ],
      },
    ],
    connections: [],
  },
  {
    id: 'bots',
    label: 'בוטים 24/7',
    flows: [
      {
        id: 'sales',
        agentId: 'sales-bot',
        title: 'בוט מכירות',
        trigger: '24/7 — מכירות',
        color: 'border-green-500 text-green-700 bg-green-50',
        nodes: [
          { label: 'Facebook / Instagram', sub: 'ליד חדש', emoji: '📢' },
          { label: 'בוט מכירות LLM', sub: 'שיחה אוטומטית', emoji: '🤖' },
          { label: 'Calendly / תשלום / דמו', sub: 'נתוב לפי עניין', emoji: '🎯', multi: true },
        ],
      },
      {
        id: 'support',
        agentId: 'support-bot',
        title: 'בוט תמיכה',
        trigger: '24/7 — תמיכה',
        color: 'border-violet-400 text-violet-700 bg-violet-50',
        nodes: [
          { label: 'WhatsApp / Admin', sub: 'שאלת תמיכה', emoji: '💬' },
          { label: 'בוט תמיכה LLM', sub: 'ניתוח ומענה', emoji: '🤖' },
          { label: 'פתרון / ClickUp Ticket', sub: 'סגירה או העברה', emoji: '🎫', multi: true },
        ],
      },
    ],
    connections: [],
  },
]

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      dir="ltr"
      onClick={e => { e.stopPropagation(); onChange() }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        enabled ? 'bg-primary' : 'bg-gray-200'
      }`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
        enabled ? 'translate-x-4.5' : 'translate-x-0.5'
      }`} />
    </button>
  )
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const c = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot} ${c.pulse ? 'animate-pulse' : ''}`} />
      {status}
    </span>
  )
}

function LogIcon({ result }: { result: LogResult }) {
  if (result === 'success') return <CheckCircle2 size={13} className="text-green-500 shrink-0 mt-0.5" />
  if (result === 'error')   return <XCircle      size={13} className="text-red-500   shrink-0 mt-0.5" />
  return                           <Info         size={13} className="text-blue-400  shrink-0 mt-0.5" />
}

function ScheduleIcon({ schedule }: { schedule: AgentSchedule }) {
  if (schedule === 'triggered')  return <Zap size={13} className="text-amber-500" />
  if (schedule === 'continuous') return <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
  return <Clock size={13} className="text-gray-400" />
}

function AgentCard({
  agent, runState, expanded, logsLoading,
  onToggleExpand, onToggleEnabled, onRun,
}: {
  agent: Agent; runState: RunState; expanded: boolean; logsLoading?: boolean
  onToggleExpand: () => void; onToggleEnabled: () => void; onRun: () => void
}) {
  const isError = agent.status === 'שגיאה'

  return (
    <div className={`bg-surface rounded-2xl border shadow-sm transition-all ${
      isError ? 'border-red-200' : 'border-gray-100'
    }`}>
      {/* Header row */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer select-none"
        onClick={onToggleExpand}
      >
        <button
          className="text-gray-300 hover:text-gray-500 transition-colors shrink-0"
          onClick={e => { e.stopPropagation(); onToggleExpand() }}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-primary">{agent.name}</span>
            <StatusBadge status={agent.status} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{agent.desc}</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400">
            <ScheduleIcon schedule={agent.schedule} />
            <span>{agent.scheduleLabel}</span>
          </div>
          <Toggle enabled={agent.enabled} onChange={onToggleEnabled} />
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">
          {/* 3-cell detail grid */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'הרצה הבאה', value: agent.nextRun },
              { label: 'הרצה אחרונה', value: agent.lastRun },
              { label: 'תוצאה אחרונה', value: agent.lastResult },
            ].map(({ label, value }) => (
              <div key={label} className={`rounded-xl p-3 text-center ${
                isError && label === 'תוצאה אחרונה' ? 'bg-red-50 border border-red-100' : 'bg-gray-50'
              }`}>
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className={`text-xs font-medium break-words leading-snug ${
                  isError && label === 'תוצאה אחרונה' ? 'text-red-600' : 'text-primary'
                }`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Activity log */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">לוג פעילות</p>
            {logsLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <Loader2 size={13} className="animate-spin" />טוען לוג מ-Supabase...
              </div>
            ) : agent.log.length === 0 ? (
              <p className="text-xs text-gray-400">אין רשומות לוג</p>
            ) : (
              <div className="space-y-1.5">
                {agent.log.map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <LogIcon result={entry.result} />
                    <span className="text-gray-400 shrink-0 font-mono">{entry.time}</span>
                    <span className="text-gray-600">{entry.action}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={onRun}
              disabled={!agent.enabled || runState === 'running'}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                runState === 'running'
                  ? 'bg-amber-50 text-amber-600 border border-amber-200'
                  : runState === 'done'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : agent.enabled
                      ? 'bg-primary text-white hover:bg-primary-dark'
                      : 'bg-gray-100 text-gray-400 cursor-default'
              }`}
            >
              {runState === 'running' ? (
                <><span className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />הרץ...</>
              ) : runState === 'done' ? (
                <><CheckCircle2 size={14} />הסתיים</>
              ) : (
                <><Play size={14} />הרץ עכשיו</>
              )}
            </button>
            <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800 transition-all">
              <FileText size={14} />לוג מלא
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AgentListTab() {
  const [agents,      setAgents]      = useState<Agent[]>(AGENTS)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [runStates,   setRunStates]   = useState<Record<string, RunState>>({})
  // DB overlays
  const [liveStatus,  setLiveStatus]  = useState<Record<string, DbAgentLog>>({})
  // Per-agent log: undefined = not loaded, 'loading', or DbAgentLog[]
  const [dbLogs, setDbLogs] = useState<Record<string, DbAgentLog[] | 'loading'>>({})

  useEffect(() => {
    getLatestAgentStatus().then(setLiveStatus).catch(() => {})
  }, [])

  // Merge DB live status into agent display
  const displayAgents = agents.map(a => {
    const liveLog = liveStatus[a.id]
    const liveAgentStatus = dbStatusToAgent(liveLog, a.enabled)
    const liveLastRun    = liveLog ? fmtRunAt(liveLog.run_at) : a.lastRun
    const liveLastResult = liveLog?.result_summary ?? a.lastResult
    return { ...a, status: liveAgentStatus, lastRun: liveLastRun, lastResult: liveLastResult }
  })

  const counts = {
    active:  displayAgents.filter(a => a.status === 'פעיל').length,
    waiting: displayAgents.filter(a => a.status === 'ממתין').length,
    error:   displayAgents.filter(a => a.status === 'שגיאה').length,
    off:     displayAgents.filter(a => a.status === 'כבוי').length,
  }

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else {
        next.add(id)
        // Lazy-load logs when first expanding
        if (!dbLogs[id]) {
          setDbLogs(prev => ({ ...prev, [id]: 'loading' }))
          getAgentLogs(id).then(logs => setDbLogs(prev => ({ ...prev, [id]: logs }))).catch(() => {
            setDbLogs(prev => { const n = { ...prev }; delete n[id]; return n })
          })
        }
      }
      return next
    })
  }

  const toggleEnabled = (id: string) =>
    setAgents(prev => prev.map(a => {
      if (a.id !== id) return a
      const enabled = !a.enabled
      const status: AgentStatus = enabled ? (a.schedule === 'continuous' ? 'פעיל' : 'ממתין') : 'כבוי'
      return { ...a, enabled, status }
    }))

  const runAgent = (id: string) => {
    setRunStates(r => ({ ...r, [id]: 'running' }))
    setTimeout(() => {
      setRunStates(r => ({ ...r, [id]: 'done' }))
      setTimeout(() => setRunStates(r => ({ ...r, [id]: 'idle' })), 1500)
    }, 2000)
  }

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'פעילים',  value: counts.active,  cls: 'text-green-600' },
          { label: 'ממתינים', value: counts.waiting, cls: 'text-blue-600'  },
          { label: 'שגיאות',  value: counts.error,   cls: counts.error > 0 ? 'text-red-600' : 'text-gray-500',
            card: counts.error > 0 ? 'border-red-200 bg-red-50' : '' },
          { label: 'כבויים',  value: counts.off,     cls: 'text-gray-500'  },
        ].map(({ label, value, cls, card }) => (
          <div key={label} className={`bg-surface rounded-2xl border p-4 text-center shadow-sm ${card ?? 'border-gray-100'}`}>
            <p className={`text-2xl font-bold ${cls}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Agent cards */}
      <div className="space-y-3">
        {displayAgents.map(agent => {
          const rawLogs = dbLogs[agent.id]
          // Show DB logs when available, otherwise fall back to static mock log
          const resolvedLog: AgentLog[] = rawLogs === 'loading'
            ? []
            : rawLogs
              ? rawLogs.map(dbLogToAgentLog)
              : agent.log
          const logsLoading = rawLogs === 'loading'
          return (
            <AgentCard
              key={agent.id}
              agent={{ ...agent, log: resolvedLog }}
              logsLoading={logsLoading}
              runState={runStates[agent.id] ?? 'idle'}
              expanded={expandedIds.has(agent.id)}
              onToggleExpand={() => toggleExpand(agent.id)}
              onToggleEnabled={() => toggleEnabled(agent.id)}
              onRun={() => runAgent(agent.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

function FlowNodeCard({ node }: { node: FlowNode }) {
  if (node.decision) {
    return (
      <div className="flex flex-col items-center gap-1 min-w-[110px]">
        <div className="w-[90px] h-[90px] rotate-45 border-2 border-dashed border-amber-400 bg-amber-50 flex items-center justify-center shrink-0">
          <div className="-rotate-45 text-center px-1">
            <p className="text-xs font-medium text-amber-700 leading-tight">{node.label}</p>
            {node.sub && <p className="text-[10px] text-amber-500 leading-tight">{node.sub}</p>}
          </div>
        </div>
      </div>
    )
  }

  if (node.multi) {
    return (
      <div className="flex flex-col items-center gap-1 min-w-[130px]">
        <div className="border-2 border-dashed border-primary/40 rounded-xl px-3 py-2.5 bg-primary/5 text-center">
          {node.emoji && <p className="text-base mb-1">{node.emoji}</p>}
          <p className="text-xs font-medium text-primary leading-tight">{node.label}</p>
          {node.sub && <p className="text-[10px] text-primary/60 leading-tight mt-0.5">{node.sub}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-1 min-w-[110px]">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-3 py-2.5 text-center">
        {node.emoji && <p className="text-base mb-1">{node.emoji}</p>}
        <p className="text-xs font-medium text-gray-700 leading-tight">{node.label}</p>
        {node.sub && <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{node.sub}</p>}
      </div>
    </div>
  )
}

function FlowCard({ flow, hasError }: { flow: Flow; hasError: boolean }) {
  return (
    <div className={`bg-surface rounded-2xl border shadow-sm p-4 transition-colors ${
      hasError ? 'border-red-300 bg-red-50/30' : 'border-gray-100'
    }`}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-primary">{flow.title}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${flow.color}`}>
            {flow.trigger}
          </span>
        </div>
        {hasError && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-xs font-semibold">
            <AlertTriangle size={11} />שגיאה פעילה
          </span>
        )}
      </div>
      <div dir="ltr" className="overflow-x-auto pb-1">
        <div className="flex items-center gap-1 w-max">
          {flow.nodes.map((node, i) => (
            <div key={i} className="flex items-center gap-1">
              <FlowNodeCard node={node} />
              {i < flow.nodes.length - 1 && (
                <span className="text-gray-300 text-lg font-light px-0.5 shrink-0">→</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FlowConnector({ connection }: { connection: FlowConnection }) {
  const isSync = connection.type === 'synchronized'
  return (
    <div className="flex items-center justify-center py-1.5">
      <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
        isSync
          ? 'bg-blue-50 border-blue-200 text-blue-600'
          : 'bg-amber-50 border-amber-200 text-amber-700'
      }`}>
        {isSync ? <RefreshCw size={10} /> : <ArrowDown size={10} />}
        {connection.label}
      </div>
    </div>
  )
}

function FlowMapTab() {
  const agentStatusMap: Record<string, AgentStatus> = Object.fromEntries(
    AGENTS.map(a => [a.id, a.status])
  )
  const hasError = (agentId: string | string[]) => {
    const ids = Array.isArray(agentId) ? agentId : [agentId]
    return ids.some(id => agentStatusMap[id] === 'שגיאה')
  }

  return (
    <div className="space-y-4">
      {FLOW_GROUPS.map(group => (
        <div key={group.id} className="bg-gray-50/70 rounded-2xl border border-gray-200 p-4 space-y-1">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            {group.label}
          </h3>
          {group.flows.map(flow => {
            const conn = group.connections.find(c => c.from === flow.id)
            return (
              <div key={flow.id}>
                <FlowCard flow={flow} hasError={hasError(flow.agentId)} />
                {conn && <FlowConnector connection={conn} />}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

type Tab = 'list' | 'flow'

export function Agents() {
  const [tab, setTab] = useState<Tab>('list')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-primary">סוכני אוטומציה</h1>
          <p className="text-sm text-gray-400 mt-0.5">לוח בקרה — n8n agents</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {([
            { key: 'list', label: 'רשימת Agents' },
            { key: 'flow', label: 'מפת זרימה' },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === key
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'list' ? <AgentListTab /> : <FlowMapTab />}
    </div>
  )
}
