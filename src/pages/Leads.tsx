import { useState, useEffect } from 'react'
import {
  Users, UserPlus, Calendar, Clock, AlertTriangle,
  X, Check, CheckCheck, Phone, Mail, Archive, UserCheck,
  Loader2, RefreshCw, AlertCircle,
} from 'lucide-react'
import { getLeads, updateLead as dbUpdateLead, archiveLead as dbArchiveLead } from '../lib/database'
import type { DbLead } from '../lib/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type LeadStatus   = 'new' | 'meeting_set' | 'producer' | 'follow_up' | 'archived'
type ActiveStatus = Exclude<LeadStatus, 'archived'>
type LeadType     = 'has_course' | 'producing'
type LeadSource   = 'Facebook' | 'Instagram'
type FollowUpTone = 'friendly' | 'professional' | 'urgent'
type ModalTab     = 'details' | 'whatsapp' | 'followup'

interface ChatMessage { from: 'us' | 'lead'; text: string; time: string }

interface Lead {
  id: string; name: string; phone: string; email: string
  source: LeadSource; leadType: LeadType; status: LeadStatus
  entryDate: string; lastUpdate: string
  meetingDate?: string; followUpDate?: string
  followUpNote?: string; followUpTone?: FollowUpTone
  inSequence: boolean; notes: string
  chat: ChatMessage[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TODAY = new Date()

const COLUMNS: Array<{ id: ActiveStatus; label: string; desc: string; accent: string }> = [
  { id: 'new',         label: 'ליד חדש',    desc: 'הגיע אוטומטית מפרסום',          accent: 'border-t-blue-400'   },
  { id: 'meeting_set', label: 'נקבעה שיחה', desc: 'הבוט זיהה תיאום ב-Calendly',    accent: 'border-t-secondary'  },
  { id: 'producer',    label: 'מעוניין — בהפקה', desc: 'ליד מעוניין בתהליך הפקת קורס',  accent: 'border-t-violet-400' },
  { id: 'follow_up',   label: 'לחזור אליו', desc: 'ממתין לחזרה ידנית',              accent: 'border-t-amber-400'  },
]

const SOURCE_COLOR: Record<LeadSource, string> = {
  Facebook:  'bg-blue-100 text-blue-700',
  Instagram: 'bg-pink-100 text-pink-700',
}

const LEAD_TYPE_COLOR: Record<LeadType, string> = {
  has_course: 'bg-emerald-100 text-emerald-700',
  producing:  'bg-violet-100 text-violet-700',
}

const LEAD_TYPE_LABEL: Record<LeadType, string> = {
  has_course: 'יש קורס',
  producing:  'מעוניין — בהפקה',
}

// Sequence A = existing-course leads, Sequence B = producing leads
const SEQUENCE_LABEL: Record<LeadType, string>  = { has_course: 'שרשרת א׳', producing: 'שרשרת ב׳'  }
const SEQUENCE_COLOR: Record<LeadType, string>  = {
  has_course: 'bg-teal-100 text-teal-700',
  producing:  'bg-purple-100 text-purple-700',
}

const TONE_OPTIONS: Array<{ value: FollowUpTone; label: string }> = [
  { value: 'friendly',     label: 'ידידותי'  },
  { value: 'professional', label: 'מקצועי'   },
  { value: 'urgent',       label: 'דחוף'     },
]

// ─── DB → UI mapping ──────────────────────────────────────────────────────────

const DB_STATUS_MAP: Record<DbLead['status'], LeadStatus> = {
  new:        'new',
  meeting:    'meeting_set',
  producing:  'producer',
  followup:   'follow_up',
  irrelevant: 'archived',
}

const UI_STATUS_MAP: Record<LeadStatus, DbLead['status']> = {
  new:         'new',
  meeting_set: 'meeting',
  producer:    'producing',
  follow_up:   'followup',
  archived:    'irrelevant',
}

const DB_SOURCE_MAP: Record<NonNullable<DbLead['source']>, LeadSource> = {
  facebook:  'Facebook',
  instagram: 'Instagram',
}

function dbLeadToLead(row: DbLead): Lead {
  return {
    id:            row.id,
    name:          row.name,
    phone:         row.phone,
    email:         '',
    source:        row.source ? DB_SOURCE_MAP[row.source] : 'Facebook',
    leadType:      row.lead_type ?? 'has_course',
    status:        DB_STATUS_MAP[row.status],
    entryDate:     row.created_at.slice(0, 10),
    lastUpdate:    row.follow_up_date ?? row.created_at.slice(0, 10),
    followUpDate:  row.follow_up_date ?? undefined,
    followUpNote:  row.follow_up_note ?? undefined,
    followUpTone:  (row.follow_up_tone as FollowUpTone | undefined) ?? undefined,
    inSequence:    false,
    notes:         row.follow_up_note ?? '',
    chat:          [],
  }
}

// ─── Loading / error states ───────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-400">
      <Loader2 size={32} className="animate-spin text-primary/40" />
      <p className="text-sm">טוען לידים...</p>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <AlertCircle size={32} className="text-red-300" />
      <p className="text-sm text-red-500">{message}</p>
      <button onClick={onRetry} className="flex items-center gap-2 text-xs text-primary border border-primary/30 px-3 py-2 rounded-lg hover:bg-primary/5 transition-colors">
        <RefreshCw size={13} />נסה שוב
      </button>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysDiff(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / 864e5)
}

function isStale(lead: Lead): boolean {
  return lead.status === 'meeting_set' && !!lead.meetingDate &&
    daysDiff(new Date(lead.meetingDate), TODAY) >= 3
}

function fmtDate(iso: string, withYear = false): string {
  return new Date(iso).toLocaleDateString('he-IL', {
    day: '2-digit', month: '2-digit',
    ...(withYear ? { year: '2-digit' } : {}),
  })
}

function followUpUrgency(iso: string): 'overdue' | 'today' | 'upcoming' {
  const d = new Date(iso)
  if (d.toDateString() === TODAY.toDateString()) return 'today'
  if (d < TODAY) return 'overdue'
  return 'upcoming'
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, alert = false }: {
  icon: React.ReactNode; label: string; value: number; alert?: boolean
}) {
  const hot = alert && value > 0
  return (
    <div className={`bg-surface rounded-2xl border shadow-sm p-4 flex items-start gap-3 ${hot ? 'border-red-200 bg-red-50/30' : 'border-gray-100'}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${hot ? 'bg-red-100 text-red-500' : 'bg-primary/10 text-primary'}`}>
        {icon}
      </div>
      <div>
        <p className={`text-xl font-bold leading-none mb-0.5 ${hot ? 'text-red-600' : 'text-gray-800'}`}>{value}</p>
        <p className="text-xs text-gray-400 leading-snug">{label}</p>
      </div>
    </div>
  )
}

// ─── Lead card ────────────────────────────────────────────────────────────────

function LeadCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  const stale = isStale(lead)

  return (
    <button
      onClick={onClick}
      className="w-full text-start bg-surface rounded-2xl border border-gray-100 shadow-sm p-3.5 hover:border-primary/30 hover:shadow-md transition-all"
    >
      {/* Name + source */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{lead.name}</p>
          <p className="text-xs text-gray-400 mt-0.5" dir="ltr">{lead.phone}</p>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${SOURCE_COLOR[lead.source]}`}>
          {lead.source}
        </span>
      </div>

      {/* Tags row */}
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {/* Lead type */}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${LEAD_TYPE_COLOR[lead.leadType]}`}>
          {LEAD_TYPE_LABEL[lead.leadType]}
        </span>

        {/* Stale alert */}
        {stale && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
            <AlertTriangle size={10} />ממתין לעדכון
          </span>
        )}

        {/* Warming sequence */}
        {lead.inSequence && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SEQUENCE_COLOR[lead.leadType]}`}>
            {SEQUENCE_LABEL[lead.leadType]}
          </span>
        )}

        {/* Follow-up date */}
        {lead.followUpDate && (() => {
          const urg = followUpUrgency(lead.followUpDate!)
          return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              urg === 'overdue' ? 'bg-red-100 text-red-600' :
              urg === 'today'   ? 'bg-amber-100 text-amber-700' :
                                  'bg-gray-100 text-gray-500'
            }`}>
              <Clock size={10} />{fmtDate(lead.followUpDate!)}
            </span>
          )
        })()}
      </div>

      <p className="text-xs text-gray-300">{fmtDate(lead.entryDate, true)}</p>
    </button>
  )
}

// ─── Kanban column ────────────────────────────────────────────────────────────

function KanbanColumn({ col, leads, onLeadClick }: {
  col: typeof COLUMNS[number]
  leads: Lead[]
  onLeadClick: (l: Lead) => void
}) {
  return (
    <div className={`bg-surface rounded-2xl border border-gray-100 shadow-sm border-t-4 ${col.accent} flex flex-col`}>
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700">{col.label}</h3>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">{leads.length}</span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{col.desc}</p>
      </div>
      <div className="p-3 space-y-2.5 flex-1 min-h-36 bg-gray-50/30">
        {leads.length === 0
          ? <p className="text-xs text-gray-300 text-center py-8">אין לידים</p>
          : leads.map(l => <LeadCard key={l.id} lead={l} onClick={() => onLeadClick(l)} />)
        }
      </div>
    </div>
  )
}

// ─── Lead modal ───────────────────────────────────────────────────────────────

function LeadModal({ lead, onClose, onUpdate, onConvert }: {
  lead: Lead
  onClose: () => void
  onUpdate: (id: string, patch: Partial<Lead>) => void
  onConvert: (id: string) => void
}) {
  const [tab,          setTab]          = useState<ModalTab>('details')
  const [converted,    setConverted]    = useState(false)
  const [followUpDate, setFollowUpDate] = useState(lead.followUpDate ?? '')
  const [followUpNote, setFollowUpNote] = useState(lead.followUpNote ?? '')
  const [tone,         setTone]         = useState<FollowUpTone>(lead.followUpTone ?? 'friendly')
  const [fupSaved,     setFupSaved]     = useState(false)

  const changeStatus = (status: LeadStatus) =>
    onUpdate(lead.id, { status, lastUpdate: new Date().toISOString().slice(0, 10) })

  const changeLeadType = (leadType: LeadType) =>
    onUpdate(lead.id, { leadType })

  const handleConvert = () => {
    setConverted(true)
    setTimeout(() => { onConvert(lead.id); onClose() }, 2000)
  }

  const saveFollowUp = () => {
    onUpdate(lead.id, { followUpDate, followUpNote, followUpTone: tone })
    setFupSaved(true)
    setTimeout(() => setFupSaved(false), 2500)
  }

  const MODAL_TABS: Array<{ id: ModalTab; label: string }> = [
    { id: 'details',  label: 'פרטים'       },
    { id: 'whatsapp', label: 'WhatsApp'    },
    { id: 'followup', label: 'תזכורת חזרה' },
  ]

  const StatusBtn = ({
    status, label, activeClass, hoverClass,
  }: {
    status: LeadStatus; label: string; activeClass: string; hoverClass: string
  }) => (
    <button
      onClick={() => changeStatus(status)}
      className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-sm font-medium transition-all border ${
        lead.status === status ? activeClass : `border-gray-200 text-gray-600 ${hoverClass}`
      }`}
    >
      {lead.status === status && <Check size={13} />}
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-primary">{lead.name}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLOR[lead.source]}`}>
                {lead.source}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${LEAD_TYPE_COLOR[lead.leadType]}`}>
                {LEAD_TYPE_LABEL[lead.leadType]}
              </span>
              {lead.inSequence && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SEQUENCE_COLOR[lead.leadType]}`}>
                  {SEQUENCE_LABEL[lead.leadType]}
                </span>
              )}
              {isStale(lead) && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                  <AlertTriangle size={10} />ממתין לעדכון
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 shrink-0 mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 shrink-0 px-5">
          {MODAL_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-all ${
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-5">

          {/* ── פרטים ── */}
          {tab === 'details' && (
            converted ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                  <Check size={32} className="text-green-600" />
                </div>
                <p className="text-lg font-bold text-gray-800">הועבר ללקוחות בהצלחה!</p>
                <p className="text-sm text-gray-400">הליד הפך ללקוח פעיל במערכת</p>
              </div>
            ) : (
              <div className="space-y-5">

                {/* Contact */}
                <div className="space-y-2.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">פרטי יצירת קשר</p>
                  <div className="flex items-center gap-2.5 text-sm text-gray-700">
                    <Phone size={14} className="text-gray-400 shrink-0" />
                    <span dir="ltr">{lead.phone}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm text-gray-700">
                    <Mail size={14} className="text-gray-400 shrink-0" />
                    <span dir="ltr">{lead.email}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm text-gray-700">
                    <Calendar size={14} className="text-gray-400 shrink-0" />
                    <span>נכנס ב-{fmtDate(lead.entryDate, true)}</span>
                  </div>
                  {lead.meetingDate && (
                    <div className="flex items-center gap-2.5 text-sm text-gray-700">
                      <Clock size={14} className="text-gray-400 shrink-0" />
                      <span>שיחה: {fmtDate(lead.meetingDate, true)}</span>
                    </div>
                  )}
                </div>

                {/* Lead type selector */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">סוג ליד</p>
                  <div className="flex gap-2">
                    {(['has_course', 'producing'] as LeadType[]).map(lt => (
                      <button
                        key={lt}
                        onClick={() => changeLeadType(lt)}
                        className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all border ${
                          lead.leadType === lt
                            ? lt === 'has_course'
                              ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                              : 'bg-violet-100 border-violet-300 text-violet-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {lead.leadType === lt && <span className="me-1">✓</span>}
                        {LEAD_TYPE_LABEL[lt]}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    קובע איזו שרשרת חימום תוגדר: {lead.leadType === 'has_course' ? 'שרשרת א' : 'שרשרת ב'}
                  </p>
                </div>

                {/* Notes */}
                {lead.notes && (
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-400 mb-1">הערות</p>
                    <p className="text-sm text-gray-700">{lead.notes}</p>
                  </div>
                )}

                {/* Status buttons */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">עדכן סטטוס</p>
                  <div className="grid grid-cols-2 gap-2">
                    <StatusBtn
                      status="meeting_set" label="נקבעה שיחה"
                      activeClass="bg-secondary/20 border-secondary/40 text-secondary-dark"
                      hoverClass="hover:border-secondary/40 hover:bg-secondary/10"
                    />
                    <StatusBtn
                      status="producer" label="מעוניין — בהפקה"
                      activeClass="bg-violet-100 border-violet-300 text-violet-700"
                      hoverClass="hover:border-violet-200 hover:bg-violet-50"
                    />
                    <button
                      onClick={() => { changeStatus('follow_up'); setTab('followup') }}
                      className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-sm font-medium transition-all border ${
                        lead.status === 'follow_up'
                          ? 'bg-amber-100 border-amber-300 text-amber-700'
                          : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50'
                      }`}
                    >
                      {lead.status === 'follow_up' && <Check size={13} />}
                      לחזור אליו
                    </button>
                    <StatusBtn
                      status="archived" label="לא רלוונטי"
                      activeClass="bg-gray-200 border-gray-300 text-gray-600"
                      hoverClass="hover:border-gray-300 hover:bg-gray-50"
                    />
                    <button
                      onClick={handleConvert}
                      className="col-span-2 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent-dark transition-all border border-accent"
                    >
                      <UserCheck size={15} />הפוך ללקוח
                    </button>
                  </div>
                </div>
              </div>
            )
          )}

          {/* ── WhatsApp ── */}
          {tab === 'whatsapp' && (
            <div>
              <p className="text-xs text-gray-400 text-center mb-4">היסטוריית שיחה עם {lead.name}</p>
              <div className="space-y-2" dir="ltr">
                {lead.chat.map((msg, i) => (
                  <div key={i} className={`flex ${msg.from === 'us' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
                        msg.from === 'us'
                          ? 'bg-primary text-white rounded-bl-sm'
                          : 'bg-gray-100 text-gray-800 rounded-br-sm'
                      }`}
                      dir="rtl"
                    >
                      <p>{msg.text}</p>
                      <div className={`flex items-center gap-1 mt-1 ${msg.from === 'us' ? 'justify-end' : 'justify-start'}`}>
                        <span className={`text-xs ${msg.from === 'us' ? 'text-white/60' : 'text-gray-400'}`}>{msg.time}</span>
                        {msg.from === 'us' && <CheckCheck size={12} className="text-white/60" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Follow-up ── */}
          {tab === 'followup' && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">תאריך חזרה</label>
                <input
                  type="date"
                  value={followUpDate}
                  onChange={e => setFollowUpDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">הערת הקשר לבוט</label>
                <textarea
                  value={followUpNote}
                  onChange={e => setFollowUpNote(e.target.value)}
                  rows={3}
                  placeholder="מה לאמר כשמתקשרים בחזרה? הבוט ישתמש בהערה זו."
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary leading-relaxed"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">טון הפנייה</label>
                <div className="flex gap-2">
                  {TONE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setTone(opt.value)}
                      className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all border ${
                        tone === opt.value
                          ? 'bg-primary text-white border-primary'
                          : 'border-gray-200 text-gray-600 hover:border-primary/40 hover:bg-primary/5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={saveFollowUp}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  fupSaved ? 'bg-green-500 text-white' : 'bg-primary text-white hover:bg-primary-dark'
                }`}
              >
                {fupSaved ? <><Check size={14} />נשמר!</> : 'שמור תזכורת'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Archive view ─────────────────────────────────────────────────────────────

function ArchiveView({ leads, onLeadClick }: { leads: Lead[]; onLeadClick: (l: Lead) => void }) {
  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center bg-surface rounded-2xl border border-gray-100 shadow-sm">
        <p className="text-3xl mb-3">📭</p>
        <p className="text-sm text-gray-400">אין לידים בארכיב</p>
      </div>
    )
  }
  return (
    <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              {['שם', 'טלפון', 'מקור', 'סוג', 'נכנס', 'הערה'].map(h => (
                <th key={h} className="text-right text-xs font-medium text-gray-400 px-4 py-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {leads.map(lead => (
              <tr key={lead.id} onClick={() => onLeadClick(lead)} className="hover:bg-gray-50/50 cursor-pointer transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 text-xs font-bold shrink-0">
                      {lead.name[0]}
                    </div>
                    <span className="font-medium text-gray-700">{lead.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400" dir="ltr">{lead.phone}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLOR[lead.source]}`}>
                    {lead.source}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${LEAD_TYPE_COLOR[lead.leadType]}`}>
                    {LEAD_TYPE_LABEL[lead.leadType]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(lead.entryDate, true)}</td>
                <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{lead.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

const TODAY_ISO = new Date().toISOString().slice(0, 10)

export function Leads() {
  const [leads,        setLeads]        = useState<Lead[]>([])
  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState<string | null>(null)
  const [view,         setView]         = useState<'kanban' | 'archive'>('kanban')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [convertName,  setConvertName]  = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const rows = await getLeads()
      setLeads(rows.map(dbLeadToLead))
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'שגיאה בטעינת לידים')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const archived = leads.filter(l => l.status === 'archived')

  const stats = {
    active:    leads.filter(l => l.status !== 'archived').length,
    newToday:  leads.filter(l => l.entryDate === TODAY_ISO).length,
    meetings:  leads.filter(l => l.status === 'meeting_set').length,
    followUps: leads.filter(l => l.status === 'follow_up').length,
    stale:     leads.filter(isStale).length,
  }

  const handleUpdate = async (id: string, patch: Partial<Lead>) => {
    // Optimistic update
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
    setSelectedLead(prev => prev?.id === id ? { ...prev, ...patch } : prev)
    // Persist to DB
    try {
      if (patch.status === 'archived') { await dbArchiveLead(id); return }
      type DbPatch = Parameters<typeof dbUpdateLead>[1]
      const dbPatch: DbPatch = {}
      if (patch.status      !== undefined) dbPatch.status         = UI_STATUS_MAP[patch.status]
      if (patch.leadType    !== undefined) dbPatch.lead_type      = patch.leadType
      if (patch.followUpDate !== undefined) dbPatch.follow_up_date = patch.followUpDate ?? null
      if (patch.followUpNote !== undefined) dbPatch.follow_up_note = patch.followUpNote ?? null
      if (patch.followUpTone !== undefined) dbPatch.follow_up_tone = patch.followUpTone ?? null
      if (Object.keys(dbPatch).length > 0) await dbUpdateLead(id, dbPatch)
    } catch {
      // Silent: optimistic update stands; reload on next visit
    }
  }

  const handleConvert = (id: string) => {
    const name = leads.find(l => l.id === id)?.name ?? ''
    setLeads(prev => prev.filter(l => l.id !== id))
    setConvertName(name)
    setTimeout(() => setConvertName(null), 4000)
  }

  if (loading) return <LoadingScreen />
  if (fetchError) return <ErrorScreen message={fetchError} onRetry={load} />

  return (
    <div className="space-y-5">
      {/* Conversion banner */}
      {convertName && (
        <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
          <Check size={16} className="text-green-600 shrink-0" />
          <span><strong>{convertName}</strong> הועבר ללקוחות בהצלחה!</span>
          <button onClick={() => setConvertName(null)} className="ms-auto text-green-400 hover:text-green-600 transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={<Users size={16} />}         label="לידים פעילים"    value={stats.active}    />
        <StatCard icon={<UserPlus size={16} />}      label="חדש היום"        value={stats.newToday}  />
        <StatCard icon={<Calendar size={16} />}      label="שיחות מתוזמנות" value={stats.meetings}  />
        <StatCard icon={<Clock size={16} />}         label="ממתינים לחזרה"  value={stats.followUps} />
        <StatCard icon={<AlertTriangle size={16} />} label="ממתין לעדכון"    value={stats.stale}     alert />
      </div>

      {/* View toggle */}
      <div className="flex gap-1 bg-gray-100/60 p-1 rounded-xl w-fit">
        <button
          onClick={() => setView('kanban')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
            view === 'kanban' ? 'bg-surface text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          לוח קנבן
        </button>
        <button
          onClick={() => setView('archive')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
            view === 'archive' ? 'bg-surface text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <Archive size={13} />ארכיב
          {archived.length > 0 && (
            <span className="text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full leading-none">
              {archived.length}
            </span>
          )}
        </button>
      </div>

      {/* Kanban — 4 columns on large screens, 2×2 on medium, stacked on mobile */}
      {view === 'kanban' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map(col => (
            <KanbanColumn
              key={col.id}
              col={col}
              leads={leads.filter(l => l.status === col.id)}
              onLeadClick={setSelectedLead}
            />
          ))}
        </div>
      )}

      {/* Archive */}
      {view === 'archive' && (
        <ArchiveView leads={archived} onLeadClick={setSelectedLead} />
      )}

      {/* Modal */}
      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleUpdate}
          onConvert={handleConvert}
        />
      )}
    </div>
  )
}
