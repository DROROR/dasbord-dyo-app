import { useState, useMemo, useRef, useEffect } from 'react'
import {
  Send, Clock, CheckCheck, Check, XCircle, ImageIcon, Video,
  Link, Tag, Users, Calendar, Info, X,
  Pencil, Save, Plus, ChevronUp, ChevronDown, Loader2, AlertCircle,
} from 'lucide-react'
import { getAllMessages, getClientNameMap,
  getMessageTemplates, updateMessageTemplate,
  getSequences, updateSequenceStep, createSequenceStep, deleteSequenceStep,
  getClients,
} from '../lib/database'
import type { DbMessage, DbMessageTemplate, DbSequenceWithSteps, DbSequenceStep, DbClient } from '../lib/database'
import { getRecipientChannel, getChannelLabel } from '../lib/whatsapp'
import type { Channel } from '../lib/whatsapp'

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageStatus = 'sent' | 'read' | 'failed' | 'scheduled'

// ─── Constants ────────────────────────────────────────────────────────────────

// CSS-only styling per seq_key — not stored in DB
const SEQ_STYLE: Record<string, { accent: string; dot: string }> = {
  a: { accent: 'bg-teal-50 border-teal-200 text-teal-700',       dot: 'bg-teal-400'   },
  b: { accent: 'bg-violet-50 border-violet-200 text-violet-700', dot: 'bg-violet-400' },
  c: { accent: 'bg-orange-50 border-orange-200 text-orange-700', dot: 'bg-orange-400' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PKG_GROUPS = [
  { key: 'solo_pro',         label: 'Solo Pro'         },
  { key: 'master_class',     label: 'Master Class'     },
  { key: 'community_master', label: 'Community Master' },
] as const

const TAG_COLOR: Record<string, string> = {
  'אוטומטי':  'bg-secondary/20 text-secondary-dark',
  'triggered': 'bg-red-100 text-red-600',
  'ידני':      'bg-gray-100 text-gray-600',
}

const STATUS_CONFIG: Record<MessageStatus, { icon: React.ReactNode; label: string; cls: string }> = {
  sent:      { icon: <Check size={12} />,      label: 'נשלח',    cls: 'bg-gray-100 text-gray-500' },
  read:      { icon: <CheckCheck size={12} />, label: 'נקרא',   cls: 'bg-green-100 text-green-700' },
  failed:    { icon: <XCircle size={12} />,    label: 'נכשל',   cls: 'bg-red-100 text-red-600' },
  scheduled: { icon: <Clock size={12} />,      label: 'מתוזמן', cls: 'bg-amber-100 text-amber-700' },
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function AutoTooltip() {
  return (
    <span className="relative group inline-flex items-center">
      <Info size={12} className="text-secondary-dark cursor-help" />
      <span className="pointer-events-none absolute bottom-full mb-2 end-0 w-60 bg-gray-900 text-white text-xs rounded-xl px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 leading-relaxed shadow-lg">
        התזמון מנוהל דרך n8n — כאן מוגדר התוכן בלבד
        <span className="absolute top-full end-3 border-4 border-transparent border-t-gray-900" />
      </span>
    </span>
  )
}

function insertMergeTag(
  current: string,
  setter: (v: string) => void,
  ref: React.RefObject<HTMLTextAreaElement | null>,
) {
  const ta = ref.current
  if (!ta) { setter(current + '{{שם}}'); return }
  const pos  = ta.selectionStart
  const next = current.slice(0, pos) + '{{שם}}' + current.slice(ta.selectionEnd)
  setter(next)
  setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + 5; ta.focus() }, 0)
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-surface rounded-2xl border border-gray-100 shadow-sm ${className}`}>{children}</div>
}

function ChannelBadge({ channel }: { channel: Channel | null | undefined }) {
  if (!channel) return <span className="text-xs text-gray-300">—</span>
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
      channel === 'service' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
    }`}>
      {getChannelLabel(channel)}
    </span>
  )
}

// ─── Compose tab ──────────────────────────────────────────────────────────────

function ComposeTab() {
  const [templates,      setTemplates]      = useState<DbMessageTemplate[]>([])
  const [dbClients,      setDbClients]      = useState<DbClient[]>([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [selectedPkgs,   setSelectedPkgs]   = useState(
    () => new Set<string>(['solo_pro', 'master_class', 'community_master'])
  )
  const [templateId, setTemplateId]   = useState('')
  const [message, setMessage]         = useState('')
  const [link, setLink]               = useState('')
  const [mediaFile, setMediaFile]     = useState<File | null>(null)
  const [mediaError, setMediaError]   = useState('')
  const [scheduled, setScheduled]     = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [sendState, setSendState]     = useState<'idle' | 'sending' | 'sent' | 'scheduled'>('idle')
  const [sendError, setSendError]     = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    getMessageTemplates().then(setTemplates).catch(() => {})
  }, [])
  useEffect(() => {
    getClients()
      .then(setDbClients)
      .catch(() => {})
      .finally(() => setClientsLoading(false))
  }, [])

  const selectedTemplate = useMemo(
    () => templates.find(t => t.id === templateId),
    [templates, templateId]
  )
  const channel = (selectedTemplate?.channel ?? null) as Channel | null

  const allSelected = PKG_GROUPS.every(g => selectedPkgs.has(g.key))
  const toggleAll = () => {
    if (allSelected) setSelectedPkgs(new Set())
    else setSelectedPkgs(new Set(['solo_pro', 'master_class', 'community_master']))
  }
  const togglePkg = (key: string) => {
    setSelectedPkgs(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const pkgCounts = useMemo(() =>
    Object.fromEntries(PKG_GROUPS.map(g => [g.key, dbClients.filter(c => c.package === g.key).length]))
  , [dbClients])
  const willSend = useMemo(() =>
    dbClients
      .filter(c => selectedPkgs.has(c.package))
      .flatMap(c =>
        (c.client_contacts ?? [])
          .filter(cc => cc.receives_updates)
          .map(cc => ({ clientId: c.id, clientName: c.name, phone: cc.phone }))
      )
  , [dbClients, selectedPkgs])
  const totalClientCount = useMemo(
    () => dbClients.filter(c => selectedPkgs.has(c.package)).length,
    [dbClients, selectedPkgs]
  )
  const estSeconds = willSend.length * 7.5

  const handleTemplateChange = (id: string) => {
    setTemplateId(id)
    const t = templates.find(t => t.id === id)
    if (t) setMessage(t.body)
  }

  const insertMergeTag = () => {
    const ta = textareaRef.current
    if (!ta) return
    const pos = ta.selectionStart
    const next = message.slice(0, pos) + '{{שם}}' + message.slice(ta.selectionEnd)
    setMessage(next)
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + 5; ta.focus() }, 0)
  }

  const handleMedia = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const isImg = file.type.startsWith('image/')
    const isVid = file.type.startsWith('video/')
    if (!isImg && !isVid) { setMediaError('יש להעלות תמונה או וידאו בלבד'); return }
    const max = isImg ? 5 * 1024 * 1024 : 16 * 1024 * 1024
    if (file.size > max) { setMediaError(`גודל מקסימלי: ${isImg ? '5MB לתמונה' : '16MB לוידאו'}`); return }
    setMediaError('')
    setMediaFile(file)
    e.target.value = ''
  }

  const handleSend = async () => {
    if (!message.trim() || selectedPkgs.size === 0) return
    if (scheduled && scheduledAt) {
      setSendState('scheduled')
      setTimeout(() => setSendState('idle'), 3000)
      return
    }
    setSendState('sending')
    setSendError(null)
    try {
      const res = await fetch('https://primary-production-2bdeb.up.railway.app/webhook/send-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages: [...selectedPkgs], message }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSendState('sent')
      setTimeout(() => setSendState('idle'), 3000)
    } catch (err) {
      const e = err as { message?: string }
      setSendError(e.message ?? 'שגיאה בשליחה')
      setSendState('idle')
    }
  }

  const canSend = message.trim().length > 0 && selectedPkgs.size > 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

      {/* ── Compose area (right side in RTL) ── */}
      <div className="lg:col-span-2 space-y-4">

        {/* Template selector */}
        <Card className="p-5">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">תבנית</label>
          <select
            value={templateId}
            onChange={e => handleTemplateChange(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-surface appearance-none"
          >
            <option value="">— ללא תבנית (הודעה חופשית) —</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name} [{t.tag}]</option>
            ))}
          </select>
          <div className="mt-2.5 flex items-center gap-2 text-xs text-gray-400">
            <span>ישלח דרך:</span>
            <ChannelBadge channel={channel} />
          </div>
        </Card>

        {/* Message */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">הודעה</label>
            <button
              type="button"
              onClick={insertMergeTag}
              className="flex items-center gap-1.5 text-xs text-secondary-dark bg-secondary/10 hover:bg-secondary/20 px-2.5 py-1 rounded-lg transition-colors"
            >
              <Tag size={11} />
              הוסף {'{{שם}}'}
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={6}
            placeholder="כתוב את ההודעה כאן..."
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary leading-relaxed"
          />
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-xs text-gray-400">
              {message.includes('{{שם}}') && (
                <span className="text-secondary-dark">✓ כולל שם אישי</span>
              )}
            </p>
            <p className="text-xs text-gray-300">{message.length} תווים</p>
          </div>
        </Card>

        {/* Media upload */}
        <Card className="p-5">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">מדיה (אופציונלי)</label>
          {mediaFile ? (
            <div className="flex items-center gap-3 p-3 bg-secondary/10 border border-secondary/20 rounded-xl">
              {mediaFile.type.startsWith('image/') ? <ImageIcon size={18} className="text-secondary-dark shrink-0" /> : <Video size={18} className="text-secondary-dark shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">{mediaFile.name}</p>
                <p className="text-xs text-gray-400">{(mediaFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <button onClick={() => setMediaFile(null)} className="text-gray-400 hover:text-red-500 transition-colors shrink-0">
                <X size={16} />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center gap-2 p-6 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all group">
              <div className="flex gap-3">
                <ImageIcon size={22} className="text-gray-300 group-hover:text-primary/50 transition-colors" />
                <Video size={22} className="text-gray-300 group-hover:text-primary/50 transition-colors" />
              </div>
              <span className="text-sm text-gray-400">גרור קובץ לכאן או <span className="text-primary font-medium">לחץ לבחירה</span></span>
              <span className="text-xs text-gray-300">תמונה עד 5MB · וידאו עד 16MB</span>
              <input type="file" accept="image/*,video/*" onChange={handleMedia} className="hidden" />
            </label>
          )}
          {mediaError && <p className="text-xs text-red-500 mt-2">{mediaError}</p>}
        </Card>

        {/* Link */}
        <Card className="p-5">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">קישור (אופציונלי)</label>
          <div className="relative">
            <Link size={14} className="absolute top-1/2 -translate-y-1/2 end-3 text-gray-400 pointer-events-none" />
            <input
              type="url"
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="https://..."
              className="w-full border border-gray-200 rounded-xl px-4 pe-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              dir="ltr"
            />
          </div>
        </Card>
      </div>

      {/* ── Right panel: recipients + send ── */}
      <div className="space-y-4">

        {/* Recipients */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users size={14} className="text-primary" />
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">נמענים</label>
          </div>
          {clientsLoading ? (
            <div className="flex items-center gap-2 py-3 text-gray-400 text-xs">
              <Loader2 size={13} className="animate-spin" />טוען לקוחות...
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="flex items-center justify-between px-3 py-2 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer select-none transition-colors">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-primary w-3.5 h-3.5" />
                  <span className="text-sm font-medium text-gray-700">כל הלקוחות</span>
                </div>
                <span className="text-xs font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{dbClients.length}</span>
              </label>
              <div className="border-t border-gray-100 pt-1.5 space-y-1">
                {PKG_GROUPS.map(({ key, label }) => (
                  <label key={key} className="flex items-center justify-between px-3 py-1.5 rounded-xl hover:bg-gray-50 cursor-pointer select-none transition-colors">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={selectedPkgs.has(key)} onChange={() => togglePkg(key)} className="accent-primary w-3.5 h-3.5" />
                      <span className="text-sm text-gray-600">{label}</span>
                    </div>
                    <span className="text-xs font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{pkgCounts[key] ?? 0}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500 space-y-1">
            <p><span className="font-semibold text-gray-700">{totalClientCount}</span> לקוחות נבחרו</p>
            <p><span className="font-semibold text-primary">{willSend.length}</span> נמענים (מקבלי עדכונים)</p>
          </div>
        </Card>

        {/* Rate limiting note */}
        <div className="flex items-start gap-2 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
          <Info size={13} className="shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium">קצב שליחה מוגבל</p>
            <p className="text-blue-500">השהייה של 5–10 שניות בין הודעות למניעת חסימה</p>
            {willSend.length > 0 && (
              <p className="text-blue-500">⏱ זמן משוער: ~{Math.round(estSeconds)} שניות ל-{willSend.length} נמענים</p>
            )}
          </div>
        </div>

        {/* Schedule */}
        <Card className="p-5 space-y-3">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={scheduled}
              onChange={e => setScheduled(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Calendar size={14} />
              תזמן שליחה
            </div>
          </label>
          {scheduled && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              dir="ltr"
            />
          )}
        </Card>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend || sendState === 'sending'}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
            sendState === 'sent'      ? 'bg-green-500 text-white' :
            sendState === 'scheduled' ? 'bg-secondary text-white' :
            sendState === 'sending'   ? 'bg-primary/70 text-white cursor-wait' :
            canSend                   ? 'bg-primary text-white hover:bg-primary-dark' :
                                        'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          {sendState === 'sending'   && <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />שולח...</>}
          {sendState === 'sent'      && <><Check size={16} />נשלח ל-{willSend.length} נמענים</>}
          {sendState === 'scheduled' && <><Calendar size={16} />תוזמן לשליחה</>}
          {sendState === 'idle'      && <><Send size={15} />{scheduled && scheduledAt ? 'תזמן שליחה' : `שלח עכשיו (${willSend.length})`}</>}
        </button>
        {sendError && (
          <p className="text-xs text-red-500 text-center">{sendError}</p>
        )}
      </div>
    </div>
  )
}

// ─── Templates tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  // ── Loading ───────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // ── Welcome template ──────────────────────────────────────────────────────
  const [welcomeId,      setWelcomeId]      = useState('')
  const [welcomeBody,    setWelcomeBody]    = useState('')
  const [editingWelcome, setEditingWelcome] = useState(false)
  const [welcomeDraft,   setWelcomeDraft]   = useState('')
  const [welcomeSaving,  setWelcomeSaving]  = useState(false)
  const [welcomeSaved,   setWelcomeSaved]   = useState(false)
  const welcomeRef = useRef<HTMLTextAreaElement>(null)

  // ── Editable templates ────────────────────────────────────────────────────
  const [templates,       setTemplates]       = useState<DbMessageTemplate[]>([])
  const [editingId,       setEditingId]       = useState<string | null>(null)
  const [editDraft,       setEditDraft]       = useState('')
  const [previewId,       setPreviewId]       = useState<string | null>(null)
  const [savingId,        setSavingId]        = useState<string | null>(null)
  const [savedTemplateId, setSavedTemplateId] = useState<string | null>(null)
  const [templateError,   setTemplateError]   = useState<string | null>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)

  // ── Sequences ─────────────────────────────────────────────────────────────
  const [seqs,      setSeqs]      = useState<DbSequenceWithSteps[]>([])
  const [activeSeq, setActiveSeq] = useState('a')
  const [savedSeq,  setSavedSeq]  = useState<string | null>(null)
  const [seqSaving, setSeqSaving] = useState(false)
  const stepRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map())

  // ── Fetch on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([getMessageTemplates(), getSequences()])
      .then(([tmpl, seqData]) => {
        const welcome = tmpl.find(t => t.name === 'ברוך הבא')
        const rest    = tmpl.filter(t => t.name !== 'ברוך הבא')
        setWelcomeId(welcome?.id ?? '')
        setWelcomeBody(welcome?.body ?? '')
        setTemplates(rest)
        setSeqs(seqData)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'שגיאה בטעינה'))
      .finally(() => setLoading(false))
  }, [])

  const currentSeq = seqs.find(s => s.seq_key === activeSeq)

  const refetchTemplates = async () => {
    try {
      const tmpl    = await getMessageTemplates()
      const welcome = tmpl.find(t => t.name === 'ברוך הבא')
      const rest    = tmpl.filter(t => t.name !== 'ברוך הבא')
      setWelcomeId(welcome?.id ?? '')
      setWelcomeBody(welcome?.body ?? '')
      setTemplates(rest)
    } catch { /* silently ignore — user already sees loaded data */ }
  }

  // ── Welcome handlers ──────────────────────────────────────────────────────
  const startEditWelcome = () => { setWelcomeDraft(welcomeBody); setEditingWelcome(true) }
  const cancelWelcome    = () => setEditingWelcome(false)
  const saveWelcome = async () => {
    setWelcomeSaving(true)
    setTemplateError(null)
    try {
      console.log('updateMessageTemplate (welcome)', { id: welcomeId, body: welcomeDraft })
      const { error } = await updateMessageTemplate(welcomeId, welcomeDraft)
      if (error) {
        const e = error as { message?: string }
        setTemplateError(e.message ?? 'שגיאה בשמירה')
        return
      }
      await refetchTemplates()
      setEditingWelcome(false)
      setWelcomeSaved(true)
      setTimeout(() => setWelcomeSaved(false), 2500)
    } finally { setWelcomeSaving(false) }
  }

  // ── Template edit handlers ────────────────────────────────────────────────
  const startEdit  = (t: DbMessageTemplate) => { setEditingId(t.id); setEditDraft(t.body); setPreviewId(null) }
  const cancelEdit = () => setEditingId(null)
  const saveEdit = async (id: string) => {
    setSavingId(id)
    setTemplateError(null)
    try {
      console.log('updateMessageTemplate', { id, body: editDraft })
      const { error } = await updateMessageTemplate(id, editDraft)
      if (error) {
        const e = error as { message?: string }
        setTemplateError(e.message ?? 'שגיאה בשמירה')
        return
      }
      await refetchTemplates()
      setEditingId(null)
      setSavedTemplateId(id)
      setTimeout(() => setSavedTemplateId(null), 2500)
    } finally { setSavingId(null) }
  }

  // ── Step handlers ─────────────────────────────────────────────────────────
  const addStep = async () => {
    if (!currentSeq) return
    const lastDay = currentSeq.steps.at(-1)?.day ?? 0
    const newStep = await createSequenceStep({
      sequence_id: currentSeq.id,
      step_order:  currentSeq.steps.length + 1,
      day:         lastDay + 3,
      message:     '',
      media_url:   null,
    })
    setSeqs(prev => prev.map(s =>
      s.seq_key === activeSeq ? { ...s, steps: [...s.steps, newStep] } : s
    ))
  }

  const removeStep = async (id: string) => {
    await deleteSequenceStep(id)
    setSeqs(prev => prev.map(s =>
      s.seq_key === activeSeq ? { ...s, steps: s.steps.filter(st => st.id !== id) } : s
    ))
  }

  const moveStep = (id: string, dir: 'up' | 'down') =>
    setSeqs(prev => prev.map(s => {
      if (s.seq_key !== activeSeq) return s
      const steps = [...s.steps]
      const i = steps.findIndex(st => st.id === id)
      if (dir === 'up' && i === 0) return s
      if (dir === 'down' && i === steps.length - 1) return s
      const j = dir === 'up' ? i - 1 : i + 1
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      return { ...s, steps: steps.map((st, idx) => ({ ...st, step_order: idx + 1 })) }
    }))

  const updateStep = (id: string, patch: Partial<Pick<DbSequenceStep, 'day' | 'message' | 'media_url'>>) =>
    setSeqs(prev => prev.map(s =>
      s.seq_key === activeSeq
        ? { ...s, steps: s.steps.map(st => st.id === id ? { ...st, ...patch } : st) }
        : s
    ))

  const insertMergeTagInStep = (id: string) => {
    const ta   = stepRefs.current.get(id)
    const step = currentSeq?.steps.find(s => s.id === id)
    if (!step) return
    if (!ta) { updateStep(id, { message: step.message + '{{שם}}' }); return }
    const pos  = ta.selectionStart
    const next = step.message.slice(0, pos) + '{{שם}}' + step.message.slice(ta.selectionEnd)
    updateStep(id, { message: next })
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + 5; ta.focus() }, 0)
  }

  const saveSequence = async () => {
    if (!currentSeq) return
    setSeqSaving(true)
    try {
      await Promise.all(
        currentSeq.steps.map(st =>
          updateSequenceStep(st.id, { message: st.message, day: st.day, step_order: st.step_order })
        )
      )
      setSavedSeq(activeSeq)
      setTimeout(() => setSavedSeq(null), 2500)
    } finally { setSeqSaving(false) }
  }

  // ── Loading / error guards ────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-20 text-gray-400">
      <Loader2 size={22} className="animate-spin text-primary/40" />
      <span className="text-sm">טוען תבניות...</span>
    </div>
  )
  if (error) return (
    <div className="flex flex-col items-center gap-2 py-20">
      <AlertCircle size={24} className="text-red-300" />
      <p className="text-sm text-red-400">{error}</p>
    </div>
  )

  return (
    <div className="space-y-6 max-w-4xl">

      {/* ── הודעת ברוך הבא ─────────────────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-primary">הודעת ברוך הבא</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              נשלחת אוטומטית לכל לקוח חדש שמסיים רכישה ב-WooCommerce
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <AutoTooltip />
            <ChannelBadge channel="service" />
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TAG_COLOR['אוטומטי']}`}>
              אוטומטי
            </span>
          </div>
        </div>

        {editingWelcome ? (
          <div className="space-y-2">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => insertMergeTag(welcomeDraft, setWelcomeDraft, welcomeRef)}
                className="flex items-center gap-1.5 text-xs text-secondary-dark bg-secondary/10 hover:bg-secondary/20 px-2.5 py-1 rounded-lg transition-colors"
              >
                <Tag size={11} />{'{{שם}}'}
              </button>
            </div>
            <textarea
              ref={welcomeRef}
              value={welcomeDraft}
              onChange={e => setWelcomeDraft(e.target.value)}
              rows={5}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary leading-relaxed"
            />
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={saveWelcome}
                disabled={welcomeSaving}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 ${
                  welcomeSaved ? 'bg-green-500 text-white' : 'bg-primary text-white hover:bg-primary-dark'
                }`}
              >
                {welcomeSaved    ? <><Check size={14} />נשמר!</>
                 : welcomeSaving ? <><Loader2 size={14} className="animate-spin" />שומר...</>
                                 : <><Save size={14} />שמור</>}
              </button>
              <button onClick={cancelWelcome} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                בטל
              </button>
            </div>
            {templateError && editingWelcome && (
              <p className="text-xs text-red-500 mt-1">{templateError}</p>
            )}
          </div>
        ) : (
          <>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50/60 rounded-xl px-4 py-3 border border-gray-100">
              {welcomeBody}
            </pre>
            <button
              onClick={startEditWelcome}
              className="mt-3 flex items-center gap-1.5 text-xs text-primary hover:text-primary-dark font-medium transition-colors"
            >
              <Pencil size={12} />ערוך
            </button>
          </>
        )}
      </div>

      {/* ── תבניות שליחה ───────────────────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-base font-semibold text-primary mb-0.5">תבניות שליחה</h2>
        <p className="text-xs text-gray-400 mb-5">תבניות הודעה לשימוש ידני ואוטומטי</p>

        {/* Preview panel */}
        {previewId && (() => {
          const t = templates.find(t => t.id === previewId)
          if (!t) return null
          return (
            <div className="mb-4 bg-primary/5 border border-primary/15 rounded-2xl p-4 relative">
              <button onClick={() => setPreviewId(null)} className="absolute top-3 start-3 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={15} />
              </button>
              <p className="text-xs font-semibold text-primary mb-2 pe-6">{t.name}</p>
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{t.body}</pre>
            </div>
          )
        })()}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {templates.map(t => (
            <div
              key={t.id}
              className={`rounded-2xl border p-4 transition-all ${
                previewId === t.id || editingId === t.id
                  ? 'border-primary/30 shadow-md bg-surface'
                  : 'border-gray-100 shadow-sm hover:border-gray-200 bg-surface'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-gray-800">{t.name}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(t.tag === 'אוטומטי' || t.tag === 'triggered') && <AutoTooltip />}
                  <ChannelBadge channel={t.channel} />
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TAG_COLOR[t.tag ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
                    {t.tag}
                  </span>
                </div>
              </div>

              {editingId === t.id ? (
                <div className="space-y-2 mt-2">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => insertMergeTag(editDraft, setEditDraft, editRef)}
                      className="flex items-center gap-1.5 text-xs text-secondary-dark bg-secondary/10 hover:bg-secondary/20 px-2.5 py-1 rounded-lg transition-colors"
                    >
                      <Tag size={11} />{'{{שם}}'}
                    </button>
                  </div>
                  <textarea
                    ref={editRef}
                    value={editDraft}
                    onChange={e => setEditDraft(e.target.value)}
                    rows={5}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary leading-relaxed"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveEdit(t.id)}
                      disabled={savingId === t.id}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-60 ${
                        savingId === t.id ? 'bg-primary/70 text-white' : 'bg-primary text-white hover:bg-primary-dark'
                      }`}
                    >
                      {savingId === t.id ? <><Loader2 size={12} className="animate-spin" />שומר...</> : <><Save size={12} />שמור</>}
                    </button>
                    <button onClick={cancelEdit} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                      בטל
                    </button>
                  </div>
                  {templateError && editingId === t.id && (
                    <p className="text-xs text-red-500 mt-1">{templateError}</p>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-400 leading-relaxed line-clamp-2 mb-3">
                    {t.body.replace(/\n/g, ' ')}
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setPreviewId(previewId === t.id ? null : t.id)}
                      className="text-xs text-primary hover:text-primary-dark font-medium transition-colors"
                    >
                      {previewId === t.id ? 'סגור' : 'תצוגה מקדימה'}
                    </button>
                    <button
                      onClick={() => startEdit(t)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-primary transition-colors font-medium"
                    >
                      <Pencil size={11} />ערוך
                    </button>
                    {savedTemplateId === t.id && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Check size={10} />נשמר
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── שרשרות חימום ────────────────────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="text-base font-semibold text-primary">שרשרות חימום</h2>
          <ChannelBadge channel="sales" />
        </div>
        <p className="text-xs text-gray-400 mb-5">רצפי הודעות אוטומטיים — כל שרשרת מופעלת לפי סוג ליד או לקוח</p>

        {/* Sequence selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
          {seqs.map(seq => {
            const style = SEQ_STYLE[seq.seq_key] ?? SEQ_STYLE['a']
            return (
              <button
                key={seq.seq_key}
                onClick={() => setActiveSeq(seq.seq_key)}
                className={`px-4 py-3 rounded-xl text-start transition-all border ${
                  activeSeq === seq.seq_key ? style.accent : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${activeSeq === seq.seq_key ? style.dot : 'bg-gray-300'}`} />
                  <p className="text-sm font-semibold">{seq.label}</p>
                </div>
                <p className="text-xs opacity-70 leading-snug ps-4">{seq.description}</p>
                <p className="text-xs opacity-40 ps-4 mt-1">{seq.steps.length} שלבים</p>
              </button>
            )
          })}
        </div>

        {/* Active sequence controls */}
        <div className="flex items-center justify-between mb-4">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${SEQ_STYLE[activeSeq]?.accent ?? ''}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${SEQ_STYLE[activeSeq]?.dot ?? ''}`} />
            {currentSeq?.label} — {currentSeq?.description}
          </div>
          <button
            onClick={addStep}
            className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            <Plus size={13} />הוסף שלב
          </button>
        </div>

        {(currentSeq?.steps.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-3xl mb-3">📋</p>
            <p className="text-sm text-gray-400">אין שלבים בשרשרת — לחץ "הוסף שלב" כדי להתחיל</p>
          </div>
        ) : (
          <div>
            {currentSeq!.steps.map((step, idx) => (
              <div key={step.id}>
                {/* Step card */}
                <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50/40 hover:border-primary/20 transition-colors">
                  <div className="flex items-start gap-3">
                    {/* Reorder */}
                    <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
                      <button
                        onClick={() => moveStep(step.id, 'up')}
                        disabled={idx === 0}
                        className="p-0.5 text-gray-300 hover:text-primary disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronUp size={15} />
                      </button>
                      <div className="w-8 h-8 rounded-xl bg-primary text-white flex items-center justify-center text-xs font-bold">
                        {idx + 1}
                      </div>
                      <button
                        onClick={() => moveStep(step.id, 'down')}
                        disabled={idx === currentSeq!.steps.length - 1}
                        className="p-0.5 text-gray-300 hover:text-primary disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronDown size={15} />
                      </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 shrink-0">יום</span>
                        <input
                          type="number"
                          min={1}
                          value={step.day}
                          onChange={e => updateStep(step.id, { day: Math.max(1, Number(e.target.value)) })}
                          className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-surface"
                        />
                        <span className="text-xs text-gray-400">מכניסה לשרשרת</span>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-400">הודעה</span>
                          <button
                            type="button"
                            onClick={() => insertMergeTagInStep(step.id)}
                            className="flex items-center gap-1 text-xs text-secondary-dark bg-secondary/10 hover:bg-secondary/20 px-2 py-0.5 rounded-md transition-colors"
                          >
                            <Tag size={10} />{'{{שם}}'}
                          </button>
                        </div>
                        <textarea
                          ref={el => {
                            if (el) stepRefs.current.set(step.id, el)
                            else stepRefs.current.delete(step.id)
                          }}
                          value={step.message}
                          onChange={e => updateStep(step.id, { message: e.target.value })}
                          rows={3}
                          placeholder="תוכן ההודעה..."
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary leading-relaxed bg-surface"
                        />
                      </div>

                      {step.media_url ? (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/10 border border-secondary/20 rounded-lg text-xs text-secondary-dark">
                          <ImageIcon size={12} />
                          <span className="truncate flex-1">{step.media_url}</span>
                          <button onClick={() => updateStep(step.id, { media_url: null })} className="text-gray-400 hover:text-red-500 transition-colors">
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <label className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary cursor-pointer px-3 py-1.5 border border-dashed border-gray-200 rounded-lg hover:border-primary/30 transition-colors">
                          <ImageIcon size={12} />
                          הוסף מדיה (אופציונלי)
                          <input
                            type="file"
                            accept="image/*,video/*"
                            className="hidden"
                            onChange={e => {
                              const f = e.target.files?.[0]
                              if (f) updateStep(step.id, { media_url: f.name })
                              e.target.value = ''
                            }}
                          />
                        </label>
                      )}
                    </div>

                    <button
                      onClick={() => removeStep(step.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors shrink-0 mt-1"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Connector */}
                {idx < currentSeq!.steps.length - 1 && (() => {
                  const diff = Math.max(0, currentSeq!.steps[idx + 1].day - step.day)
                  return (
                    <div className="flex flex-col items-center py-0.5 gap-0.5">
                      <div className="h-3 w-px bg-gray-300" />
                      <span className="bg-surface border border-gray-200 text-xs text-gray-400 px-3 py-0.5 rounded-full whitespace-nowrap shadow-sm">
                        {diff === 0 ? 'מיד לאחר' : `${diff} ${diff === 1 ? 'יום' : 'ימים'} לאחר מכן`}
                      </span>
                      <div className="h-3 w-px bg-gray-300" />
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        )}

        {(currentSeq?.steps.length ?? 0) > 0 && (
          <div className="mt-5 pt-4 border-t border-gray-100 flex items-center gap-3">
            <button
              onClick={saveSequence}
              disabled={seqSaving}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-60 ${
                savedSeq === activeSeq ? 'bg-green-500 text-white' : 'bg-primary text-white hover:bg-primary-dark'
              }`}
            >
              {savedSeq === activeSeq
                ? <><Check size={14} />נשמר!</>
                : seqSaving
                  ? <><Loader2 size={14} className="animate-spin" />שומר...</>
                  : <><Save size={14} />שמור {currentSeq?.label}</>
              }
            </button>
            <p className="text-xs text-gray-400">{currentSeq?.steps.length ?? 0} שלבים</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Log tab ──────────────────────────────────────────────────────────────────

function fmtSentAt(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function LogTab() {
  const [messages,  setMessages]  = useState<DbMessage[]>([])
  const [nameMap,   setNameMap]   = useState<Record<string, string>>({})
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getAllMessages(), getClientNameMap()])
      .then(([msgs, names]) => { setMessages(msgs); setNameMap(names) })
      .catch(err => setError(err instanceof Error ? err.message : 'שגיאה'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
      <Loader2 size={20} className="animate-spin" /><span className="text-sm">טוען לוג הודעות...</span>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
      <AlertCircle size={24} className="text-red-300" />
      <p className="text-sm text-red-400">{error}</p>
    </div>
  )

  if (messages.length === 0) return (
    <div className="flex flex-col items-center gap-2 py-16 text-gray-300">
      <Send size={28} />
      <p className="text-sm">אין הודעות שנשלחו עדיין</p>
    </div>
  )

  return (
    <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              {['נמען','טלפון','תבנית','תצוגה מקדימה','נשלח','מספר','סטטוס'].map(h => (
                <th key={h} className="text-right text-xs font-medium text-gray-400 px-4 py-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {messages.map(msg => {
              const s    = STATUS_CONFIG[msg.status as MessageStatus] ?? STATUS_CONFIG['sent']
              const name = nameMap[msg.recipient_id] ?? msg.phone
              return (
                <tr key={msg.id} className="hover:bg-gray-50/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                        {name[0]}
                      </div>
                      <p className="text-sm font-medium text-gray-800">{name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400" dir="ltr">{msg.phone}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded-lg">
                      {msg.template_key ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-48">
                    <p className="text-xs text-gray-500 truncate">{msg.message_text ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap" dir="ltr">
                    {fmtSentAt(msg.sent_at)}
                  </td>
                  <td className="px-4 py-3">
                    <ChannelBadge channel={msg.channel} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
                      {s.icon}{s.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'compose',   label: 'שליחה'  },
  { id: 'templates', label: 'תבניות' },
  { id: 'log',       label: 'לוג'    },
] as const

type TabId = typeof TABS[number]['id']

export function WhatsApp() {
  const [tab, setTab] = useState<TabId>('compose')

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100/60 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t.id
                ? 'bg-surface text-primary shadow-sm'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'compose'   && <ComposeTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'log'       && <LogTab />}
    </div>
  )
}
