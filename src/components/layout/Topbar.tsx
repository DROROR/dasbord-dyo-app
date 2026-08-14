import { useRef, useState, useEffect } from 'react'
import { Bell, Search, PanelRight, X, Check, AlertTriangle, MessageSquare, Code, Palette, RotateCcw, Clock, Send, Globe, ExternalLink, UserPlus, ListChecks } from 'lucide-react'
import { useNotifications } from '../../contexts/NotificationContext'
import { requestTaskFocus, requestClientFocus } from '../../lib/focusTarget'
import { useLang } from '../../contexts/LanguageContext'
import type { NotificationType, AppNotification } from '../../types/work'

const PAGE_TITLES: Record<string, { he: string; en: string }> = {
  dashboard:   { he: 'לוח בקרה',    en: 'Dashboard' },
  clients:     { he: 'לקוחות',      en: 'Clients' },
  billing:     { he: 'חיוב',        en: 'Billing' },
  whatsapp:    { he: 'וואטסאפ',     en: 'WhatsApp' },
  leads:       { he: 'לידים',       en: 'Leads' },
  agents:      { he: 'סוכנים',      en: 'Agents' },
  bots:        { he: 'אימון בוטים', en: 'Bot Training' },
  permissions: { he: 'הרשאות',      en: 'Permissions' },
  work:        { he: 'Work',        en: 'Work' },
  settings:    { he: 'הגדרות',      en: 'Settings' },
}

const NOTIF_ICON: Record<NotificationType, React.ElementType> = {
  support_opened:        AlertTriangle,
  support_escalation:    MessageSquare,
  code_review:           Code,
  ux_review:             Palette,
  fixing:                RotateCcw,
  review_stale:          Clock,
  ticket_unclaimed:      AlertTriangle,
  ticket_stale:          AlertTriangle,
  wa_pending:            MessageSquare,
  status_owner_assigned: Bell,
  task_done_return:      Check,
  task_assigned:         UserPlus,
  subtask_assigned:      ListChecks,
}

const NOTIF_COLOR: Record<NotificationType, string> = {
  support_opened:        'bg-red-100 text-red-600',
  support_escalation:    'bg-amber-100 text-amber-700',
  code_review:           'bg-purple-100 text-purple-600',
  ux_review:             'bg-pink-100 text-pink-600',
  fixing:                'bg-orange-100 text-orange-600',
  review_stale:          'bg-red-100 text-red-600',
  ticket_unclaimed:      'bg-red-100 text-red-600',
  ticket_stale:          'bg-red-100 text-red-600',
  wa_pending:            'bg-green-100 text-green-600',
  status_owner_assigned: 'bg-blue-100 text-blue-600',
  task_done_return:      'bg-green-100 text-green-600',
  task_assigned:         'bg-blue-100 text-blue-700',
  subtask_assigned:      'bg-cyan-100 text-cyan-700',
}

// A notification type with no entry above must never blank the screen.
const FALLBACK_ICON  = Bell
const FALLBACK_COLOR = 'bg-gray-100 text-gray-600'

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─── WA approval inline panel ────────────────────────────────────────────────

function WaApprovalPanel({ n, onDone }: { n: AppNotification; onDone: () => void }) {
  const [msg, setMsg] = useState(n.waDetails?.message ?? '')

  return (
    <div className="px-4 py-3 bg-green-50 border-t border-green-100" dir="rtl">
      <p className="text-[11px] font-semibold text-green-800 mb-2">
        📱 שלח WhatsApp ל{n.waDetails?.clientName}
      </p>
      <textarea
        value={msg}
        onChange={e => setMsg(e.target.value)}
        rows={3}
        className="w-full text-xs text-gray-700 border border-green-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-green-400 bg-white leading-relaxed"
      />
      <div className="flex gap-2 mt-2 justify-end">
        <button
          onClick={onDone}
          className="px-3 py-1.5 text-xs font-semibold bg-white border border-green-200 text-green-700 rounded-lg hover:bg-green-50 transition-colors"
        >
          בטל
        </button>
        <button
          onClick={onDone}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          <Send size={11} /> אשר ושלח
        </button>
      </div>
    </div>
  )
}

interface Props {
  activePage: string
  onToggleSidebar: () => void
  onNavigate: (page: string) => void
}

export function Topbar({ activePage, onToggleSidebar, onNavigate }: Props) {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()
  const { t, lang, toggle } = useLang()
  const pt = PAGE_TITLES[activePage]
  const pageTitle = pt ? t(pt.he, pt.en) : activePage
  const [panelOpen, setPanelOpen]   = useState(false)
  const [expandedWa, setExpandedWa] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false)
        setExpandedWa(null)
      }
    }
    if (panelOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [panelOpen])

  function handleNotifClick(n: AppNotification) {
    if (n.type === 'wa_pending') {
      setExpandedWa(prev => prev === n.id ? null : n.id)
      markRead(n.id)
    } else if (n.taskId) {
      openTicket(n)
    } else if (n.clientId) {
      openClient(n)
    } else {
      markRead(n.id)
    }
  }

  function openTicket(n: AppNotification) {
    if (!n.taskId) return
    markRead(n.id)
    setPanelOpen(false)
    requestTaskFocus(n.taskId)
    onNavigate('work')
  }

  function openClient(n: AppNotification) {
    if (!n.clientId) return
    markRead(n.id)
    setPanelOpen(false)
    requestClientFocus(n.clientId)
    onNavigate('clients')
  }

  return (
    <header className="h-16 bg-surface border-b border-gray-200 flex items-center justify-between px-5 shrink-0 gap-4">
      {/* Right: Toggle + Page title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary transition-colors"
          aria-label="Toggle sidebar"
        >
          <PanelRight size={18} />
        </button>
        <h1 className="text-base font-semibold text-primary">
          {pageTitle}
        </h1>
      </div>

      {/* Left: Search + Notifications + Avatar */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative hidden sm:block">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 end-3 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder={t('חיפוש...', 'Search...')}
            className="w-48 lg:w-64 bg-gray-50 border border-gray-200 rounded-lg text-sm pe-9 ps-3 py-2 text-right placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
        </div>

        {/* Language toggle */}
        <button
          onClick={toggle}
          title={t('שנה שפה', 'Change language')}
          className="flex items-center gap-1.5 px-2.5 h-9 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100 hover:text-primary transition-colors"
        >
          <Globe size={15} />
          {lang === 'he' ? 'EN' : 'עב'}
        </button>

        {/* Notifications */}
        <div className="relative" ref={panelRef}>
          <button
            onClick={() => setPanelOpen(o => !o)}
            className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary transition-colors"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute top-1 end-1 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {panelOpen && (
            <div
              className="absolute end-0 top-full mt-2 w-96 bg-white border border-gray-200 rounded-2xl shadow-xl z-50 overflow-hidden"
              style={{ maxHeight: '520px' }}
            >
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Bell size={14} className="text-gray-500" />
                  <span className="text-sm font-semibold text-gray-800">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="text-[10px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{unreadCount} new</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-gray-100">
                      <Check size={10} /> Mark all read
                    </button>
                  )}
                  <button onClick={() => setPanelOpen(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                    <X size={13} />
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="overflow-y-auto" style={{ maxHeight: '440px' }}>
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                    <Bell size={24} className="text-gray-200" />
                    <p className="text-sm text-gray-400">No notifications yet</p>
                  </div>
                ) : (
                  notifications.map(n => {
                    const Icon    = NOTIF_ICON[n.type]  ?? FALLBACK_ICON
                    const iconCls = NOTIF_COLOR[n.type] ?? FALLBACK_COLOR
                    const isHigh  = n.severity === 'high'
                    const isWa    = n.type === 'wa_pending'
                    return (
                      <div key={n.id}>
                        <button
                          onClick={() => handleNotifClick(n)}
                          className={`flex items-start gap-3 w-full px-4 py-3 border-b border-gray-50 text-left transition-colors hover:bg-gray-50 ${!n.read ? 'bg-blue-50/40' : ''}`}
                        >
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${iconCls}`}>
                            <Icon size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs leading-snug ${!n.read ? 'font-semibold text-gray-800' : 'text-gray-600'} ${isHigh ? 'text-red-800' : ''}`}>
                              {n.message}
                            </p>
                            {n.taskTitle && n.taskTitle !== n.message && (
                              <p className="text-[10px] text-gray-400 mt-0.5 truncate">{n.taskTitle}</p>
                            )}

                            {/* Who it is about, and how to get to them */}
                            {(n.clientName || n.phone) && (
                              <p className="text-[10px] text-gray-500 mt-1 truncate">
                                <span className="font-semibold">{n.clientName || 'לקוח לא מזוהה'}</span>
                                {n.phone && <span className="text-gray-400"> · {n.phone}</span>}
                              </p>
                            )}
                            {(n.taskId || n.clientId) && (
                              <span className="flex items-center gap-3 mt-1.5">
                                {n.taskId && (
                                  <span
                                    role="link"
                                    tabIndex={0}
                                    onClick={e => { e.stopPropagation(); openTicket(n) }}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); openTicket(n) } }}
                                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline cursor-pointer"
                                  >
                                    <ExternalLink size={9} />פתח קריאה
                                  </span>
                                )}
                                {n.clientId && (
                                  <span
                                    role="link"
                                    tabIndex={0}
                                    onClick={e => { e.stopPropagation(); openClient(n) }}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); openClient(n) } }}
                                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline cursor-pointer"
                                  >
                                    <ExternalLink size={9} />כרטיס לקוח
                                  </span>
                                )}
                              </span>
                            )}

                            <p className="text-[10px] text-gray-300 mt-0.5">{fmtRelative(n.timestamp)}</p>
                          </div>
                          {!n.read && <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0 mt-1.5" />}
                          {isWa && <span className="text-[9px] text-green-600 font-semibold shrink-0 mt-1">{expandedWa === n.id ? '▲' : '▼'}</span>}
                        </button>

                        {isWa && expandedWa === n.id && (
                          <WaApprovalPanel
                            n={n}
                            onDone={() => {
                              setExpandedWa(null)
                              markRead(n.id)
                            }}
                          />
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Avatar */}
        <button className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-sm font-semibold hover:bg-primary-dark transition-colors">
          א
        </button>
      </div>
    </header>
  )
}
