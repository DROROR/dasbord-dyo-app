import { useState, useEffect, useRef } from 'react'
import { Archive, Calendar, Loader2, PhoneOff, PhoneCall, Plus } from 'lucide-react'
import { useLang } from '../../contexts/LanguageContext'
import type { DbLeadHistory } from '../../lib/database'
import { NO_ANSWER_THRESHOLD, countNoAnswer } from '../../lib/leadNoAnswer'

export function LeadHistoryPanel({ entries, canEdit, onAdd, onNotRelevant }: {
  entries: DbLeadHistory[]
  canEdit: boolean
  onAdd: (kind: DbLeadHistory['kind'], body?: string, occurredAt?: string) => Promise<void>
  /** Archives the lead. Sits with the other call outcomes because that is where
   *  it gets used — straight after a call that went nowhere. Omitted when the
   *  lead is already archived. */
  onNotRelevant?: () => void
}) {
  const { t, lang } = useLang()
  const [note, setNote] = useState('')
  const [callAt, setCallAt] = useState(() => {
    const now = new Date()
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  })
  const [saving, setSaving] = useState(false)
  const [latestAllowed] = useState(() => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) })
  const [error, setError] = useState('')
  async function add(kind: DbLeadHistory['kind']) {
    if (saving || (kind === 'note' && !note.trim())) return
    if (kind === 'completed_call' && (!callAt || new Date(callAt).getTime() > Date.now())) return
    setSaving(true)
    setError('')
    try {
      await onAdd(kind, kind === 'note' ? note.trim() : undefined, kind === 'completed_call' ? new Date(callAt).toISOString() : undefined)
      if (kind === 'note') setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('שמירת ההיסטוריה נכשלה', 'Could not save history entry'))
    } finally {
      setSaving(false)
    }
  }
  // Shown on the button itself, so the agent sees how close this lead is to
  // moving on its own before deciding to tap again. Read off the entries the
  // panel already has — no new prop, no second count.
  const attempts = countNoAnswer(entries)
  const atThreshold = attempts >= NO_ANSWER_THRESHOLD
  // The count going up has to be visible, or a tap that worked looks like a
  // tap that did nothing: the badge pops for a moment whenever it changes.
  const [bumped, setBumped] = useState(false)
  const lastAttemptsRef = useRef(attempts)
  useEffect(() => {
    if (attempts === lastAttemptsRef.current) return
    lastAttemptsRef.current = attempts
    setBumped(true)
    const timer = window.setTimeout(() => setBumped(false), 450)
    return () => window.clearTimeout(timer)
  }, [attempts])
  const sorted = [...entries].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.recorded_at.localeCompare(b.recorded_at) || a.id.localeCompare(b.id))
  return <section className="space-y-3 border-t border-gray-100 pt-4">
    <h3 className="text-sm font-bold text-gray-800">{t('היסטוריית ליד', 'Lead history')}</h3>
    {canEdit && <div className="space-y-2 rounded-lg border border-gray-200 p-3">
      <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} placeholder={t('כתוב הערה חדשה', 'Write a new note')} className="w-full resize-y rounded-lg border border-gray-200 bg-surface px-3 py-2 text-sm text-gray-700 outline-none focus:border-primary" />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void add('note')} disabled={saving || !note.trim()} className="flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-40"><Plus size={13} />{t('הוסף הערה', 'Add Note')}</button>
        <input type="datetime-local" value={callAt} max={latestAllowed} onChange={event => setCallAt(event.target.value)} className="h-9 rounded-lg border border-gray-200 bg-surface px-2 text-xs text-gray-700" />
        <button onClick={() => void add('completed_call')} disabled={saving || !callAt} className="flex h-9 items-center gap-1 rounded-lg border border-primary px-3 text-xs font-semibold text-primary disabled:opacity-40"><PhoneCall size={13} />{t('רשום שיחה שהושלמה', 'Record Completed Call')}</button>
        {/* The call outcome logged most often, and the one the automation
            counts, so it is the filled button of this row rather than another
            outline. amber-500 and amber-950 are both left alone by the dark
            sheet in index.css, so this one pair reads the same in both themes;
            an amber-50/100 fill would have flipped to a dark brown. */}
        <button
          onClick={() => void add('no_answer')}
          disabled={saving}
          className={`flex h-10 cursor-pointer select-none items-center gap-2 rounded-lg border border-amber-600 bg-amber-500 px-3.5 text-xs font-bold text-amber-950 shadow-sm transition-all hover:-translate-y-px hover:bg-amber-400 hover:shadow-md active:translate-y-0 active:scale-[0.98] active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-wait disabled:opacity-50 ${atThreshold ? 'ring-2 ring-amber-300' : ''}`}
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <PhoneOff size={15} />}
          {t('ניסיון קשר — אין מענה', 'Contact Attempt — No Answer')}
          <span className={`inline-flex h-5 min-w-[32px] items-center justify-center rounded-full bg-amber-950 px-1 text-[10px] font-bold leading-none tabular-nums text-amber-50 transition-transform duration-200 ${bumped ? 'motion-safe:scale-[1.35]' : 'scale-100'}`}>{atThreshold ? attempts : `${attempts}/${NO_ANSWER_THRESHOLD}`}</span>
        </button>
        {onNotRelevant && <button onClick={onNotRelevant} disabled={saving} title={t('מעביר את הליד לארכיון — ההיסטוריה נשמרת', 'Moves the lead to the archive — its history is kept')} className="flex h-9 items-center gap-1 rounded-lg border border-gray-300 px-3 text-xs font-semibold text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:opacity-40"><Archive size={13} />{t('לא רלוונטי', 'Not relevant')}</button>}
        {saving && <Loader2 size={14} className="animate-spin text-primary" />}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>}
    <ol className="space-y-2">
      {sorted.length === 0 && <li className="text-xs text-gray-400">{t('עדיין אין היסטוריה', 'No history yet')}</li>}
      {sorted.map(entry => <li key={entry.id} className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500"><Calendar size={12} /><time>{new Date(entry.occurred_at).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</time><strong className="text-gray-700">{entry.author_name}</strong><span className="ms-auto font-semibold text-primary">{entry.kind === 'note' ? t('הערה', 'Note') : entry.kind === 'completed_call' ? t('שיחה שהושלמה', 'Completed Call') : t('ניסיון קשר — אין מענה', 'Contact Attempt — No Answer')}</span></div>
        {entry.body && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{entry.body}</p>}
      </li>)}
    </ol>
  </section>
}
