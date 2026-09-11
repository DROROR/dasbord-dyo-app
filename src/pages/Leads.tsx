import { useState, useEffect } from 'react'
import {
  Users, UserPlus, Calendar, Clock, AlertTriangle,
  X, Check, CheckCheck, Phone, Mail, Archive,
  Loader2, RefreshCw, AlertCircle, Plus, Trash2, ChevronDown, CalendarDays, Search,
} from 'lucide-react'
import { getLeads, getLeadPipelineStatuses, createLeadPipelineStatus, deleteLeadPipelineStatus, createManualLead, updateLead as dbUpdateLead, deleteLead as dbDeleteLead } from '../lib/database'
import type { DbLead, DbLeadPipelineStatus, LeadStatusColor } from '../lib/database'
import { useCan } from '../hooks/useCan'
import { useLang } from '../contexts/LanguageContext'
import { AddLeadStatusModal, LEAD_STATUS_COLORS } from '../components/leads/AddLeadStatusModal'
import { DeleteLeadStatusModal } from '../components/leads/DeleteLeadStatusModal'
import { AddLeadModal } from '../components/leads/AddLeadModal'
import { LeadCalendar } from '../components/leads/LeadCalendar'
import { getGoogleSheetSyncStatus, syncGoogleSheetLeads, type GoogleSheetSyncResult } from '../lib/googleSheets'

// ─── Types ────────────────────────────────────────────────────────────────────

type LeadStatus   = 'new' | 'meeting_set' | 'producer' | 'follow_up' | 'archived'
type ActiveStatus = Exclude<LeadStatus, 'archived'>
type LeadType     = 'has_course' | 'producing'
type LeadSource   = 'Facebook' | 'Instagram' | 'Manual'
type FollowUpTone = 'friendly' | 'professional' | 'urgent'
type ModalTab     = 'details' | 'whatsapp' | 'followup'

interface ChatMessage { from: 'us' | 'lead'; text: string; time: string }

interface Lead {
  id: string; name: string; phone: string; email: string
  source: LeadSource; leadType: LeadType; status: LeadStatus
  pipelineStatusId: string | null
  formAnswer: string
  dueAt: string | null
  statusUpdatedAt: string
  entryDate: string; lastUpdate: string
  meetingDate?: string; followUpDate?: string
  followUpNote?: string; followUpTone?: FollowUpTone
  inSequence: boolean; notes: string
  chat: ChatMessage[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TODAY = new Date()

const SOURCE_COLOR: Record<LeadSource, string> = {
  Facebook:  'bg-blue-100 text-blue-700',
  Instagram: 'bg-pink-100 text-pink-700',
  Manual:    'bg-gray-100 text-gray-600',
}

const LEAD_TYPE_COLOR: Record<LeadType, string> = {
  has_course: 'bg-emerald-100 text-emerald-700',
  producing:  'bg-violet-100 text-violet-700',
}

const LEAD_TYPE_LABEL: Record<LeadType, { he: string; en: string }> = {
  has_course: { he: 'יש קורס', en: 'Has a course' },
  producing: { he: 'מעוניין — בהפקה', en: 'Interested — production' },
}

// Sequence A = existing-course leads, Sequence B = producing leads
const SEQUENCE_LABEL: Record<LeadType, { he: string; en: string }> = {
  has_course: { he: 'שרשרת א׳', en: 'Sequence A' },
  producing: { he: 'שרשרת ב׳', en: 'Sequence B' },
}
const SEQUENCE_COLOR: Record<LeadType, string>  = {
  has_course: 'bg-teal-100 text-teal-700',
  producing:  'bg-purple-100 text-purple-700',
}

const TONE_OPTIONS: Array<{ value: FollowUpTone; labelHe: string; labelEn: string }> = [
  { value: 'friendly', labelHe: 'ידידותי', labelEn: 'Friendly' },
  { value: 'professional', labelHe: 'מקצועי', labelEn: 'Professional' },
  { value: 'urgent', labelHe: 'דחוף', labelEn: 'Urgent' },
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
    email:         row.email ?? '',
    source:        row.source ? DB_SOURCE_MAP[row.source] : 'Manual',
    leadType:      row.lead_type ?? 'has_course',
    status:        DB_STATUS_MAP[row.status],
    pipelineStatusId: row.pipeline_status_id,
    formAnswer: row.form_answer ?? '',
    dueAt: row.due_at,
    statusUpdatedAt: row.status_updated_at,
    entryDate:     row.created_at,
    lastUpdate:    row.follow_up_date ?? row.status_updated_at ?? row.created_at,
    followUpDate:  row.follow_up_date ?? undefined,
    followUpNote:  row.follow_up_note ?? undefined,
    followUpTone:  (row.follow_up_tone as FollowUpTone | undefined) ?? undefined,
    inSequence:    false,
    notes:         row.notes ?? row.follow_up_note ?? '',
    chat:          [],
  }
}

// ─── Loading / error states ───────────────────────────────────────────────────

function LoadingScreen() {
  const { t } = useLang()
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-400">
      <Loader2 size={32} className="animate-spin text-primary/40" />
      <p className="text-sm">{t('טוען לידים...', 'Loading leads...')}</p>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLang()
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <AlertCircle size={32} className="text-red-300" />
      <p className="text-sm text-red-500">{message}</p>
      <button onClick={onRetry} className="flex items-center gap-2 text-xs text-primary border border-primary/30 px-3 py-2 rounded-lg hover:bg-primary/5 transition-colors">
        <RefreshCw size={13} />{t('נסה שוב', 'Try again')}
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

function fmtDate(iso: string, withYear = false, lang: 'he' | 'en' = 'he'): string {
  return new Date(iso).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', {
    day: '2-digit', month: '2-digit',
    ...(withYear ? { year: '2-digit' } : {}),
  })
}

function fmtDateTime(iso: string, lang: 'he' | 'en'): string {
  return new Date(iso).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function isLeadDueOverdue(lead: Lead): boolean {
  return lead.status === 'meeting_set' && !!lead.dueAt && new Date(lead.dueAt).getTime() < Date.now()
}

function followUpUrgency(iso: string): 'overdue' | 'today' | 'upcoming' {
  const d = new Date(iso)
  if (d.toDateString() === TODAY.toDateString()) return 'today'
  if (d < TODAY) return 'overdue'
  return 'upcoming'
}
function leadCategoryColor(answer: string): string {
  const value = answer.toLowerCase()
  if (value.includes('community') || value.includes('קהילה')) return 'bg-purple-100 text-purple-700'
  if (value.includes('create') || value.includes('ליצור')) return 'bg-blue-100 text-blue-700'
  return 'bg-green-100 text-green-600'
}


// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, alert = false }: {
  icon: React.ReactNode; label: string; value: number; alert?: boolean
}) {
  const hot = alert && value > 0
  return (
    <div className={`bg-surface rounded-2xl border shadow-sm p-3 flex items-start gap-2.5 ${hot ? 'border-red-200 bg-red-50/30' : 'border-gray-100'}`}>
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
  const { t, lang } = useLang()
  const alert = isStale(lead) || isLeadDueOverdue(lead)
  const category = lead.formAnswer || t(LEAD_TYPE_LABEL[lead.leadType].he, LEAD_TYPE_LABEL[lead.leadType].en)
  return (
    <button onClick={onClick} className="grid min-h-11 w-full min-w-[620px] grid-cols-[minmax(180px,1.5fr)_150px_minmax(170px,1fr)_170px] items-center gap-3 border-b border-gray-100 bg-surface px-3 py-2 text-start transition-colors last:border-b-0 hover:bg-gray-50">
      <span className="flex min-w-0 items-center gap-2"><strong className="truncate text-sm text-gray-800">{lead.name}</strong>{alert && <AlertTriangle size={13} className="shrink-0 text-red-500" />}</span>
      <span dir="ltr" className="truncate text-xs text-gray-500">{lead.phone}</span>
      <span className={`w-fit max-w-full truncate rounded-md px-2 py-1 text-xs font-semibold ${leadCategoryColor(category)}`}>{category}</span>
      <span className={`flex items-center gap-1 text-xs ${isLeadDueOverdue(lead) ? 'font-semibold text-red-600' : 'text-gray-400'}`}>
        {lead.dueAt ? <><CalendarDays size={11} />{new Date(lead.dueAt).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</> : '—'}
      </span>
    </button>
  )
}

// ─── Kanban column ────────────────────────────────────────────────────────────

function KanbanColumn({ col, leads, onLeadClick, onDelete }: {
  col: DbLeadPipelineStatus
  onDelete?: () => void
  leads: Lead[]
  onLeadClick: (l: Lead) => void
}) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-xl border border-gray-100 bg-surface">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(value => !value)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
          <ChevronDown size={15} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          <h3 className={`truncate rounded-md px-2 py-1 text-xs font-semibold ${LEAD_STATUS_COLORS[col.color].badge}`}>{t(col.label_he, col.label_en)}</h3>
          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">{leads.length}</span>
        </button>
        {onDelete && (
          <button onClick={onDelete} className="ms-auto rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title={t('מחק סטטוס', 'Delete status')}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {open && <div className="overflow-x-auto bg-gray-50/30 p-2">
        {leads.length === 0
          ? <p className="py-5 text-center text-xs text-gray-400">{t('אין לידים', 'No leads')}</p>
          : leads.map(l => <LeadCard key={l.id} lead={l} onClick={() => onLeadClick(l)} />)
        }
      </div>}
    </div>
  )
}

// ─── Lead modal ───────────────────────────────────────────────────────────────

function LeadModal({ lead, onClose, onUpdate, onDelete, canEdit, canDelete, statuses }: {
  lead: Lead
  onClose: () => void
  onUpdate: (id: string, patch: Partial<Lead>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  canEdit: boolean
  canDelete: boolean
  statuses: DbLeadPipelineStatus[]
}) {
  const { t, lang } = useLang()
  const [tab,          setTab]          = useState<ModalTab>('details')
  const [followUpDate, setFollowUpDate] = useState(lead.followUpDate ?? '')
  const [followUpNote, setFollowUpNote] = useState(lead.followUpNote ?? '')
  const [tone,         setTone]         = useState<FollowUpTone>(lead.followUpTone ?? 'friendly')
  const [fupSaved,     setFupSaved]     = useState(false)
  const [detailNotes, setDetailNotes] = useState(lead.notes)
  const [detailFormAnswer, setDetailFormAnswer] = useState(lead.formAnswer)
  const [detailDueAt, setDetailDueAt] = useState(lead.dueAt ? lead.dueAt.slice(0, 16) : '')
  const [detailsSaved, setDetailsSaved] = useState(false)
  const [schedulingMeeting, setSchedulingMeeting] = useState(false)
  const [saving, setSaving] = useState<'details' | 'followup' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const modalPipeline = statuses.find(status => status.id === lead.pipelineStatusId)
  const needsAttention = (modalPipeline?.legacy_status === 'meeting' || (!modalPipeline && lead.status === 'meeting_set')) && !!lead.dueAt && new Date(lead.dueAt).getTime() < Date.now()

  const confirmMeeting = () => {
    if (!detailDueAt) return
    const dueAt = new Date(detailDueAt).toISOString()
    onUpdate(lead.id, { status: 'meeting_set', pipelineStatusId: statuses.find(item => item.legacy_status === 'meeting')?.id ?? lead.pipelineStatusId, dueAt, statusUpdatedAt: new Date().toISOString(), lastUpdate: new Date().toISOString().slice(0, 10) })
    setSchedulingMeeting(false)
  }

  const changePipelineStatus = (pipelineStatusId: string) => {
    const pipeline = statuses.find(item => item.id === pipelineStatusId)
    if (!pipeline) return
    const isMeetingStatus = pipeline.legacy_status === 'meeting'
    const mappedStatus = pipeline.legacy_status ? DB_STATUS_MAP[pipeline.legacy_status] : lead.status
    setSchedulingMeeting(false)
    if (isMeetingStatus && !detailDueAt) {
      setSchedulingMeeting(true)
      return
    }
    void onUpdate(lead.id, {
      pipelineStatusId,
      status: mappedStatus,
      ...(isMeetingStatus && detailDueAt ? { dueAt: new Date(detailDueAt).toISOString() } : {}),
      statusUpdatedAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
    })
    if (pipeline.legacy_status === 'followup') setTab('followup')
  }

  const handleDelete = async () => {
    if (!canDelete || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await onDelete(lead.id)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t('מחיקת הליד נכשלה', 'Could not delete lead'))
      setDeleting(false)
    }
  }

  const saveFollowUp = async () => {
    if (!canEdit || saving) return
    setSaving('followup')
    try {
      await onUpdate(lead.id, { followUpDate, followUpNote, followUpTone: tone })
      setFupSaved(true)
      setTimeout(() => setFupSaved(false), 2500)
    } finally {
      setSaving(null)
    }
  }

  const saveDetails = async () => {
    if (!canEdit || saving) return
    setSaving('details')
    try {
      await onUpdate(lead.id, { notes: detailNotes, formAnswer: detailFormAnswer, dueAt: detailDueAt ? new Date(detailDueAt).toISOString() : null })
      setDetailsSaved(true)
      setTimeout(() => setDetailsSaved(false), 2000)
    } finally {
      setSaving(null)
    }
  }

  const MODAL_TABS: Array<{ id: ModalTab; label: string }> = [
    { id: 'details', label: t('פרטים', 'Details') },
    { id: 'whatsapp', label: 'WhatsApp'    },
    { id: 'followup', label: t('תזכורת חזרה', 'Follow-up reminder') },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[88vh]">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-primary">{lead.name}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLOR[lead.source]}`}>
                {lead.source === 'Manual' ? t('ידני', 'Manual') : lead.source}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${leadCategoryColor(lead.formAnswer || LEAD_TYPE_LABEL[lead.leadType].en)}`}>
                {lead.formAnswer || t(LEAD_TYPE_LABEL[lead.leadType].he, LEAD_TYPE_LABEL[lead.leadType].en)}
              </span>
              {lead.inSequence && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SEQUENCE_COLOR[lead.leadType]}`}>
                  {t(SEQUENCE_LABEL[lead.leadType].he, SEQUENCE_LABEL[lead.leadType].en)}
                </span>
              )}
              {needsAttention && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                  <AlertTriangle size={10} />{t('ממתין לעדכון', 'Waiting for update')}
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
          {needsAttention && (
            <div className="mb-3 flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-700">
              <AlertTriangle size={20} className="mt-0.5 shrink-0" />
              <div><p className="text-sm font-bold">{t('הפגישה עברה — נדרש עדכון', 'Meeting passed — update required')}</p><p className="mt-0.5 text-xs">{t('עדכן את סטטוס הליד או קבע מועד חדש לפגישה.', 'Update the lead status or schedule a new meeting time.')}</p></div>
            </div>
          )}

          {/* ── פרטים ── */}
          {tab === 'details' && (
              <div className="space-y-2">

                {/* Contact */}
                <div className="space-y-2.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('פרטי יצירת קשר', 'Contact details')}</p>
                  <div className="flex items-center gap-2.5 text-sm text-gray-700">
                    <Phone size={14} className="text-gray-400 shrink-0" />
                    <span dir="ltr">{lead.phone}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm text-gray-700">
                    <Mail size={14} className="text-gray-400 shrink-0" />
                    <span dir="ltr">{lead.email}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <Calendar size={14} className="shrink-0 text-gray-400" />
                      <span><strong className="block text-[10px] text-gray-400">{t('נוצר', 'Created')}</strong>{fmtDateTime(lead.entryDate, lang)}</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <Clock size={14} className="shrink-0 text-gray-400" />
                      <span><strong className="block text-[10px] text-gray-400">{t('תאריך ושעת יעד', 'Due date & time')}</strong>{lead.dueAt ? fmtDateTime(lead.dueAt, lang) : t('לא נקבע', 'Not set')}</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <RefreshCw size={14} className="shrink-0 text-gray-400" />
                      <span><strong className="block text-[10px] text-gray-400">{t('עדכון סטטוס אחרון', 'Last status update')}</strong>{fmtDateTime(lead.statusUpdatedAt, lang)}</span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-gray-500 sm:col-span-2">{t('תשובת הטופס / קטגוריה', 'Form answer / category')}
                    <input value={detailFormAnswer} onChange={e => setDetailFormAnswer(e.target.value)} disabled={!canEdit} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 bg-surface px-3 text-sm text-gray-700 outline-none focus:border-primary disabled:opacity-50" />
                  </label>
                  <label className="text-xs font-semibold text-gray-500 sm:col-span-2">{t('תאריך ושעת יעד', 'Due date and time')}
                    <input type="datetime-local" value={detailDueAt} onChange={e => setDetailDueAt(e.target.value)} disabled={!canEdit} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 bg-surface px-3 text-sm text-gray-700 outline-none focus:border-primary disabled:opacity-50" />
                  </label>
                  <label className="text-xs font-semibold text-gray-500 sm:col-span-2">{t('הערות', 'Notes')}
                    <textarea value={detailNotes} onChange={e => setDetailNotes(e.target.value)} disabled={!canEdit} rows={4} placeholder={t('מה למדת על הליד ומה דיברתם?', 'What did you learn and discuss with this lead?')} className="mt-1.5 w-full resize-y rounded-lg border border-gray-200 bg-surface px-3 py-2 text-sm text-gray-700 outline-none focus:border-primary disabled:opacity-50" />
                  </label>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-400">{t('סטטוס צינור', 'Pipeline status')}</label>
                  <select value={lead.pipelineStatusId ?? ''} onChange={e => changePipelineStatus(e.target.value)} disabled={!canEdit}
                    className="h-10 w-full rounded-lg border border-gray-200 bg-surface px-3 text-sm text-gray-700 outline-none focus:border-primary disabled:opacity-50">
                    {statuses.map(status => (
                      <option key={status.id} value={status.id}>{t(status.label_he, status.label_en)}</option>
                    ))}
                  </select>
                </div>

                {schedulingMeeting && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <p className="mb-2 text-xs font-semibold text-blue-700">{t('בחר תאריך ושעה לפגישה', 'Select meeting date and time')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="datetime-local" value={detailDueAt} onChange={e => setDetailDueAt(e.target.value)} className="h-9 min-w-[220px] flex-1 rounded-lg border border-blue-200 bg-surface px-3 text-sm" />
                      <button onClick={() => setSchedulingMeeting(false)} className="h-9 px-3 text-sm text-gray-500">{t('ביטול', 'Cancel')}</button>
                      <button onClick={confirmMeeting} disabled={!detailDueAt} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40">{t('אשר פגישה', 'Confirm meeting')}</button>
                    </div>
                  </div>
                )}

              </div>
          )}

          {/* ── WhatsApp ── */}
          {tab === 'whatsapp' && (
            <div>
              <p className="text-xs text-gray-400 text-center mb-4">{t('היסטוריית שיחה עם ', 'Conversation history with ')}{lead.name}</p>
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
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('תאריך חזרה', 'Follow-up date')}</label>
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
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('הערת הקשר לבוט', 'Context note for the bot')}</label>
                <textarea
                  value={followUpNote}
                  onChange={e => setFollowUpNote(e.target.value)}
                  rows={3}
                  placeholder={t('מה לאמר כשמתקשרים בחזרה? הבוט ישתמש בהערה זו.', 'What should be said when following up? The bot will use this note.')}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary leading-relaxed"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('טון הפנייה', 'Message tone')}</label>
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
                      {t(opt.labelHe, opt.labelEn)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-gray-100 bg-surface px-5 py-3">
          {canDelete && <button onClick={() => { setDeleteError(''); setConfirmDelete(true) }} className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"><Trash2 size={14} />{t('מחק ליד', 'Delete lead')}</button>}
          <div className="ms-auto flex items-center gap-2">
            <button onClick={onClose} className="h-9 px-3 text-sm text-gray-500">{t('סגור', 'Close')}</button>
            {tab === 'details' && canEdit && <button onClick={() => void saveDetails()} disabled={saving !== null} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving === 'details' ? t('שומר...', 'Saving...') : detailsSaved ? t('נשמר', 'Saved') : t('שמור פרטים', 'Save details')}</button>}
            {tab === 'followup' && canEdit && <button onClick={() => void saveFollowUp()} disabled={saving !== null} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving === 'followup' ? t('שומר...', 'Saving...') : fupSaved ? t('נשמר!', 'Saved!') : t('שמור תזכורת', 'Save reminder')}</button>}
          </div>
        </div>
      </div>
      {confirmDelete && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" onClick={() => !deleting && setConfirmDelete(false)} aria-label={t('ביטול', 'Cancel')} />
          <div className="relative w-full max-w-sm rounded-2xl border border-gray-100 bg-surface p-5 shadow-2xl">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-100 text-red-600"><Trash2 size={20} /></div>
            <h3 className="text-base font-bold text-gray-800">{t('למחוק את הליד?', 'Delete this lead?')}</h3>
            <p className="mt-1.5 text-sm leading-6 text-gray-500">{t('פעולה זו תמחק לצמיתות את', 'This will permanently delete')} <strong className="text-gray-700">{lead.name}</strong>. {t('לא ניתן לבטל פעולה זו.', 'This action cannot be undone.')}</p>
            {deleteError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4">
              <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="h-9 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-600 disabled:opacity-50">{t('ביטול', 'Cancel')}</button>
              <button onClick={() => void handleDelete()} disabled={deleting} className="flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}{deleting ? t('מוחק...', 'Deleting...') : t('מחק לצמיתות', 'Delete permanently')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Archive view ─────────────────────────────────────────────────────────────

function ArchiveView({ leads, onLeadClick }: { leads: Lead[]; onLeadClick: (l: Lead) => void }) {
  const { t, lang } = useLang()
  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center bg-surface rounded-2xl border border-gray-100 shadow-sm">
        <p className="text-3xl mb-3">📭</p>
        <p className="text-sm text-gray-400">{t('אין לידים בארכיב', 'No archived leads')}</p>
      </div>
    )
  }
  return (
    <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              {[t('שם', 'Name'), t('טלפון', 'Phone'), t('מקור', 'Source'), t('סוג', 'Type'), t('נכנס', 'Added'), t('הערה', 'Note')].map(h => (
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
                    {lead.source === 'Manual' ? t('ידני', 'Manual') : lead.source}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${leadCategoryColor(lead.formAnswer || LEAD_TYPE_LABEL[lead.leadType].en)}`}>
                    {lead.formAnswer || t(LEAD_TYPE_LABEL[lead.leadType].he, LEAD_TYPE_LABEL[lead.leadType].en)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDateTime(lead.entryDate, lang)}</td>
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
  const { t } = useLang()
  const canEdit = useCan('leads', 'edit')
  const canDeleteStatuses = useCan('leads', 'full')
  const [leads,        setLeads]        = useState<Lead[]>([])
  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState<string | null>(null)
  const [view, setView] = useState<'kanban' | 'calendar' | 'archive'>('kanban')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [statuses, setStatuses] = useState<DbLeadPipelineStatus[]>([])
  const [addingStatus, setAddingStatus] = useState(false)
  const [addingLead, setAddingLead] = useState(false)
  const [deletingStatus, setDeletingStatus] = useState<DbLeadPipelineStatus | null>(null)
  const [leadQuery, setLeadQuery] = useState('')
  const [leadStatusFilter, setLeadStatusFilter] = useState('all')
  const [leadSourceFilter, setLeadSourceFilter] = useState('all')
  const [leadCategoryFilter, setLeadCategoryFilter] = useState('all')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [syncingSheet, setSyncingSheet] = useState(false)
  const [sheetSyncResult, setSheetSyncResult] = useState<GoogleSheetSyncResult | null>(null)
  const [sheetSyncError, setSheetSyncError] = useState('')
  const [sheetSyncedAt, setSheetSyncedAt] = useState<Date | null>(null)
  const [sheetConfigured, setSheetConfigured] = useState(false)

  const load = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setFetchError(null)
    try {
      const [rows, pipelineStatuses] = await Promise.all([getLeads(), getLeadPipelineStatuses()])
      setLeads(rows.map(dbLeadToLead))
      setStatuses(pipelineStatuses)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : t('שגיאה בטעינת לידים', 'Failed to load leads'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!canDeleteStatuses) return
    void getGoogleSheetSyncStatus().then(status => setSheetConfigured(status.configured)).catch(() => setSheetConfigured(false))
  }, [canDeleteStatuses])

  const handleSheetSync = async () => {
    if (syncingSheet) return
    setSyncingSheet(true)
    setSheetSyncError('')
    try {
      const result = await syncGoogleSheetLeads()
      setSheetSyncResult(result)
      setSheetSyncedAt(new Date())
      await load(false)
    } catch (error) {
      setSheetSyncResult(null)
      setSheetSyncError(error instanceof Error ? error.message : t('סנכרון Google Sheets נכשל', 'Google Sheets sync failed'))
    } finally {
      setSyncingSheet(false)
    }
  }

  const pipelineFor = (lead: Lead) => statuses.find(status => status.id === lead.pipelineStatusId)
  const hasLegacyStatus = (lead: Lead, status: DbLead['status']) =>
    pipelineFor(lead)?.legacy_status === status || (!pipelineFor(lead) && UI_STATUS_MAP[lead.status] === status)
  const isArchivedLead = (lead: Lead) => pipelineFor(lead)?.is_archived || hasLegacyStatus(lead, 'irrelevant')
  const isPendingMeeting = (lead: Lead) => hasLegacyStatus(lead, 'meeting')
  const isOverdueMeeting = (lead: Lead) => isPendingMeeting(lead) && !!lead.dueAt && new Date(lead.dueAt).getTime() < Date.now()

  const archived = leads.filter(isArchivedLead)
  const categoryOptions = Array.from(new Set(leads.map(lead => lead.formAnswer || LEAD_TYPE_LABEL[lead.leadType].en).filter(Boolean))).sort()
  const normalizedLeadQuery = leadQuery.trim().toLowerCase()
  const filteredBoardLeads = leads.filter(lead => {
    const category = lead.formAnswer || LEAD_TYPE_LABEL[lead.leadType].en
    if (normalizedLeadQuery && !(lead.name + ' ' + lead.phone + ' ' + lead.email).toLowerCase().includes(normalizedLeadQuery)) return false
    if (leadStatusFilter !== 'all' && lead.pipelineStatusId !== leadStatusFilter) return false
    if (leadSourceFilter !== 'all' && lead.source !== leadSourceFilter) return false
    if (leadCategoryFilter !== 'all' && category !== leadCategoryFilter) return false
    if (attentionOnly && !isOverdueMeeting(lead) && !isStale(lead)) return false
    return true
  })
  const boardFiltersActive = Boolean(leadQuery || leadStatusFilter !== 'all' || leadSourceFilter !== 'all' || leadCategoryFilter !== 'all' || attentionOnly)

  const stats = {
    active:    leads.filter(lead => !isArchivedLead(lead)).length,
    newToday:  leads.filter(lead => lead.entryDate.slice(0, 10) === TODAY_ISO).length,
    meetings:  leads.filter(isPendingMeeting).length,
    followUps: leads.filter(lead => hasLegacyStatus(lead, 'followup')).length,
    stale:     leads.filter(lead => isStale(lead) || isOverdueMeeting(lead)).length,
  }

  const handleUpdate = async (id: string, patch: Partial<Lead>) => {
    if (!canEdit) return
    // Optimistic update
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
    setSelectedLead(prev => prev?.id === id ? { ...prev, ...patch } : prev)
    // Persist to DB
    try {
      if (patch.status === 'archived') {
        await dbUpdateLead(id, { status: 'irrelevant', ...(patch.pipelineStatusId !== undefined ? { pipeline_status_id: patch.pipelineStatusId } : {}) })
        return
      }
      type DbPatch = Parameters<typeof dbUpdateLead>[1]
      const dbPatch: DbPatch = {}
      if (patch.status      !== undefined) dbPatch.status         = UI_STATUS_MAP[patch.status]
      if (patch.pipelineStatusId !== undefined) dbPatch.pipeline_status_id = patch.pipelineStatusId
      if (patch.leadType    !== undefined) dbPatch.lead_type      = patch.leadType
      if (patch.followUpDate !== undefined) dbPatch.follow_up_date = patch.followUpDate ?? null
      if (patch.followUpNote !== undefined) dbPatch.follow_up_note = patch.followUpNote ?? null
      if (patch.followUpTone !== undefined) dbPatch.follow_up_tone = patch.followUpTone ?? null
      if (patch.formAnswer !== undefined) dbPatch.form_answer = patch.formAnswer || null
      if (patch.notes !== undefined) dbPatch.notes = patch.notes || null
      if (patch.dueAt !== undefined) dbPatch.due_at = patch.dueAt
      if (Object.keys(dbPatch).length > 0) await dbUpdateLead(id, dbPatch)
    } catch {
      // Silent: optimistic update stands; reload on next visit
    }
  }


  const handleDeleteLead = async (id: string) => {
    await dbDeleteLead(id)
    setLeads(prev => prev.filter(lead => lead.id !== id))
    setSelectedLead(null)
  }

  const handleAddStatus = async (label: string, color: LeadStatusColor) => {
    const created = await createLeadPipelineStatus({
      label_he: label, label_en: label, color,
      position: (statuses.at(-1)?.position ?? 0) + 10,
    })
    setStatuses(prev => [...prev, created])
  }

  const handleDeleteStatus = async (status: DbLeadPipelineStatus) => {
    await deleteLeadPipelineStatus(status.id)
    setStatuses(prev => prev.filter(item => item.id !== status.id))
  }

  const handleAddLead = async (data: { name: string; phone: string; email: string; formAnswer: string; statusId: string }) => {
    const created = await createManualLead({ name: data.name, phone: data.phone, email: data.email, form_answer: data.formAnswer, pipeline_status_id: data.statusId })
    setLeads(prev => [dbLeadToLead(created), ...prev])
  }

  if (loading) return <LoadingScreen />
  if (fetchError) return <ErrorScreen message={fetchError} onRetry={load} />

  return (
    <div className="space-y-2">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={<Users size={16} />}         label={t('לידים פעילים', 'Active leads')}    value={stats.active}    />
        <StatCard icon={<UserPlus size={16} />}      label={t('חדש היום', 'New today')}        value={stats.newToday}  />
        <StatCard icon={<Calendar size={16} />}      label={t('שיחות מתוזמנות', 'Scheduled meetings')} value={stats.meetings}  />
        <StatCard icon={<Clock size={16} />}         label={t('ממתינים לחזרה', 'Waiting for follow-up')}  value={stats.followUps} />
        <StatCard icon={<AlertTriangle size={16} />} label={t('ממתין לעדכון', 'Waiting for update')}    value={stats.stale}     alert />
      </div>

      {/* View controls */}
      <div className="flex w-full flex-wrap items-center gap-1 rounded-xl bg-gray-100/60 p-1">
        <button onClick={() => setView('kanban')} className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${view === 'kanban' ? 'bg-surface text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>{t('לוח קנבן', 'Kanban board')}</button>
        <button onClick={() => setView('calendar')} className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all ${view === 'calendar' ? 'bg-surface text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}><CalendarDays size={13} />{t('יומן', 'Calendar')}</button>
        <button onClick={() => setView('archive')} className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all ${view === 'archive' ? 'bg-surface text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}><Archive size={13} />{t('ארכיב', 'Archive')}{archived.length > 0 && <span className="rounded-md bg-gray-200 px-1.5 py-0.5 text-xs text-gray-500">{archived.length}</span>}</button>
        <div dir="ltr" className="ms-auto flex flex-wrap items-center gap-1.5">
          {canDeleteStatuses && <button onClick={() => void handleSheetSync()} disabled={syncingSheet || !sheetConfigured} title={!sheetConfigured ? t('ממתין להגדרת חשבון השירות', 'Waiting for service-account configuration') : undefined} className={`flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition-colors ${sheetConfigured ? 'border-[#0F9D58] bg-[#0F9D58] text-white hover:bg-[#0B8043]' : 'cursor-not-allowed border-green-200 bg-green-50 text-green-700'}`}><img src="/google-sheets-logo.svg" alt="" className="h-[18px] w-[14px] shrink-0 object-contain" />{syncingSheet ? t('מסנכרן...', 'Syncing...') : !sheetConfigured ? t('Google Sheet לא מוגדר', 'Google Sheet not configured') : t('סנכרן Google Sheet', 'Sync Google Sheet')}</button>}
          {canEdit && <button onClick={() => setAddingLead(true)} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"><UserPlus size={15} />{t('הוסף ליד', 'Add Lead')}</button>}
          {view === 'kanban' && canEdit && <><span className="mx-1 h-6 w-px bg-gray-300" aria-hidden="true" /><button onClick={() => setAddingStatus(true)} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"><Plus size={15} />{t('הוסף סטטוס', 'Add Status')}</button></>}
        </div>
      </div>

      {sheetSyncResult && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700"><Check size={14} /><strong>{t('הסנכרון הושלם', 'Sheet sync complete')}</strong><span>{sheetSyncResult.created} {t('נוצרו', 'created')} · {sheetSyncResult.existing} {t('כבר קיימים', 'already existed')} · {sheetSyncResult.skipped} {t('דולגו', 'skipped')}</span>{sheetSyncedAt && <span className="ms-auto text-green-600">{sheetSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}<button onClick={() => setSheetSyncResult(null)}><X size={13} /></button></div>}
      {sheetSyncError && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle size={14} /><span>{sheetSyncError}</span><button onClick={() => setSheetSyncError('')} className="ms-auto"><X size={13} /></button></div>}

      {view !== 'calendar' && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-gray-100 bg-surface p-2">
          <label className="relative min-w-44 flex-1 sm:max-w-64"><Search size={14} className="absolute start-2.5 top-2 text-gray-400" /><input value={leadQuery} onChange={e => setLeadQuery(e.target.value)} placeholder={t('חפש שם, טלפון או אימייל', 'Search name, phone or email')} className="h-8 w-full rounded-lg border border-gray-200 bg-surface ps-8 pe-3 text-xs outline-none focus:border-primary" /></label>
          <select value={leadStatusFilter} onChange={e => setLeadStatusFilter(e.target.value)} className="h-8 min-w-36 rounded-lg border border-gray-200 bg-surface px-2 text-xs text-gray-600"><option value="all">{t('כל הסטטוסים', 'All statuses')}</option>{statuses.map(status => <option key={status.id} value={status.id}>{t(status.label_he, status.label_en)}</option>)}</select>
          <select value={leadSourceFilter} onChange={e => setLeadSourceFilter(e.target.value)} className="h-8 min-w-28 rounded-lg border border-gray-200 bg-surface px-2 text-xs text-gray-600"><option value="all">{t('כל המקורות', 'All sources')}</option><option value="Manual">{t('ידני', 'Manual')}</option><option value="Facebook">Facebook</option><option value="Instagram">Instagram</option></select>
          <select value={leadCategoryFilter} onChange={e => setLeadCategoryFilter(e.target.value)} className="h-8 min-w-32 rounded-lg border border-gray-200 bg-surface px-2 text-xs text-gray-600"><option value="all">{t('כל הקטגוריות', 'All categories')}</option>{categoryOptions.map(category => <option key={category} value={category}>{category}</option>)}</select>
          <button onClick={() => setAttentionOnly(value => !value)} className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold ${attentionOnly ? 'bg-red-100 text-red-600' : 'border border-gray-200 text-gray-500'}`}><AlertTriangle size={13} />{t('דורש עדכון', 'Needs attention')}</button>
          {boardFiltersActive && <button onClick={() => { setLeadQuery(''); setLeadStatusFilter('all'); setLeadSourceFilter('all'); setLeadCategoryFilter('all'); setAttentionOnly(false) }} className="h-8 px-2 text-xs text-gray-500">{t('נקה', 'Clear')}</button>}
        </div>
      )}

      {view === 'kanban' && (
        <div className="flex w-full flex-col gap-2">
          {statuses.filter(status => !status.is_archived).map(col => (
            <KanbanColumn key={col.id} col={col} leads={filteredBoardLeads.filter(lead => lead.pipelineStatusId === col.id)} onLeadClick={setSelectedLead}
              onDelete={canDeleteStatuses && col.legacy_status === null ? () => setDeletingStatus(col) : undefined} />
          ))}
        </div>
      )}

      {view === 'calendar' && (
        <LeadCalendar leads={leads.filter(lead => lead.dueAt).map(lead => ({ id: lead.id, name: lead.name, phone: lead.phone, dueAt: lead.dueAt!, pipelineStatusId: lead.pipelineStatusId, statusUpdatedAt: lead.statusUpdatedAt, meetingPending: isPendingMeeting(lead) }))} statuses={statuses} onOpen={id => setSelectedLead(leads.find(lead => lead.id === id) ?? null)} />
      )}

      {view === 'archive' && <ArchiveView leads={filteredBoardLeads.filter(isArchivedLead)} onLeadClick={setSelectedLead} />}

      {addingLead && <AddLeadModal statuses={statuses} onClose={() => setAddingLead(false)} onAdd={handleAddLead} />}
      {/* Modal */}
      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleUpdate}
          onDelete={handleDeleteLead}
          canEdit={canEdit}
          canDelete={canDeleteStatuses}
          statuses={statuses}
        />
      )}
      {addingStatus && <AddLeadStatusModal onClose={() => setAddingStatus(false)} onAdd={handleAddStatus} />}
      {deletingStatus && <DeleteLeadStatusModal status={deletingStatus} leadCount={leads.filter(lead => lead.pipelineStatusId === deletingStatus.id).length} onClose={() => setDeletingStatus(null)} onDelete={() => handleDeleteStatus(deletingStatus)} />}
    </div>
  )
}
