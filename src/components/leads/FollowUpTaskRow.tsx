import { useState } from 'react'
import { CalendarClock, Check, Loader2, Phone, PhoneOff, X } from 'lucide-react'
import { useLang } from '../../contexts/LanguageContext'
import { useAuth } from '../../hooks/useAuth'
import type { DbLead, DbLeadPipelineStatus, DbLeadSequenceProgress } from '../../lib/database'
import {
  FOLLOW_UP_CALL_DAYS, FOLLOW_UP_OUTCOMES, cancelFollowUpTask, completeFollowUpTask, isTaskOverdue,
  outcomeNeedsDate, rescheduleFollowUpTask,
  type CompleteTaskResult, type DbLeadFollowUpTask, type FollowUpOutcome,
} from '../../lib/leadFollowUp'

/** `YYYY-MM-DDTHH:mm` in local time, which is what a datetime-local input wants. */
function toLocalInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/**
 * One call somebody owes a lead, with the only three ways out of it: say what
 * happened, move it to another time, or cancel it. There is deliberately no
 * way to close the row without choosing one of them.
 */
export function FollowUpTaskRow({ task, lead, leadName, phone, progress, statuses, onChanged, onOpenLead }: {
  task: DbLeadFollowUpTask
  lead: Pick<DbLead, 'id' | 'pipeline_status_id'>
  leadName?: string
  phone?: string
  progress?: DbLeadSequenceProgress
  statuses: DbLeadPipelineStatus[]
  onChanged?: (result: CompleteTaskResult | null) => void
  onOpenLead?: () => void
}) {
  const { t, lang } = useLang()
  const { profile } = useAuth()
  const [mode, setMode] = useState<null | 'outcome' | 'reschedule' | 'cancel'>(null)
  const [outcome, setOutcome] = useState<FollowUpOutcome | null>(null)
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const overdue = isTaskOverdue(task)
  const due = new Date(task.due_at)
  const stepLabel = task.step_no !== null
    ? t(`שיחה ${task.step_no} מתוך ${FOLLOW_UP_CALL_DAYS.length}`, `Call ${task.step_no} of ${FOLLOW_UP_CALL_DAYS.length}`)
    : t('שיחת חזרה', 'Callback')

  const run = async (work: () => Promise<CompleteTaskResult | null>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await work()
      setMode(null)
      onChanged?.(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('השמירה נכשלה', 'Could not save'))
    } finally {
      setBusy(false)
    }
  }

  const complete = (chosen: FollowUpOutcome, when?: string) => run(() => completeFollowUpTask({
    task, outcome: chosen, progress, statuses, lead, lang,
    userId: profile?.id ?? null,
    ...(when ? { date: new Date(when).toISOString() } : {}),
  }))

  const pickOutcome = (chosen: FollowUpOutcome) => {
    if (!outcomeNeedsDate(chosen)) { void complete(chosen); return }
    setOutcome(chosen)
    // A sensible starting point, always editable: a week for "call me later",
    // a month for "not ready yet", tomorrow for a meeting.
    const days = chosen === 'meeting' ? 1 : chosen === 'not_ready' ? 30 : 7
    const start = new Date(Date.now() + days * 86_400_000)
    start.setHours(10, 0, 0, 0)
    setDate(toLocalInput(start))
  }

  const outline = 'flex h-8 items-center gap-1 rounded-lg border border-gray-300 bg-surface px-2.5 text-xs font-semibold text-gray-600 transition-colors hover:border-gray-400 disabled:opacity-40'

  return (
    <div className={`rounded-xl border bg-white p-3 ${overdue ? 'border-red-300' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${overdue ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'}`}>
          <Phone size={14} />
        </span>
        <div className="min-w-0 flex-1">
          {leadName !== undefined && (
            onOpenLead
              ? <button onClick={onOpenLead} className="block max-w-full truncate text-start text-sm font-bold text-gray-800 underline-offset-2 hover:underline">{leadName}</button>
              : <p className="truncate text-sm font-bold text-gray-800">{leadName}</p>
          )}
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
            <span className="font-semibold text-gray-700">{stepLabel}</span>
            {phone && <a href={`tel:${phone}`} dir="ltr" className="text-primary hover:underline">{phone}</a>}
          </p>
        </div>
        <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold ${overdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
          {overdue ? t('באיחור · ', 'Overdue · ') : ''}
          {due.toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {mode === null && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button onClick={() => void complete('no_answer')} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-600 bg-amber-500 px-3 text-xs font-bold text-amber-950 transition-colors hover:bg-amber-400 disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <PhoneOff size={13} />}{t('אין מענה', 'No Answer')}
          </button>
          <button onClick={() => { setOutcome(null); setMode('outcome') }} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50">
            <Check size={13} />{t('דיברנו — בחר תוצאה', 'We spoke — choose outcome')}
          </button>
          <button onClick={() => { setDate(toLocalInput(new Date(Date.now() + 86_400_000))); setMode('reschedule') }} disabled={busy} className={outline}>
            <CalendarClock size={13} />{t('דחה', 'Reschedule')}
          </button>
          <button onClick={() => setMode('cancel')} disabled={busy} className={outline}>
            <X size={13} />{t('בטל משימה', 'Cancel task')}
          </button>
        </div>
      )}

      {mode === 'outcome' && (
        <div className="mt-2.5 space-y-2 border-t border-gray-100 pt-2.5">
          <div className="flex flex-wrap gap-1.5">
            {FOLLOW_UP_OUTCOMES.filter(item => item.value !== 'no_answer').map(item => (
              <button key={item.value} onClick={() => pickOutcome(item.value)} disabled={busy}
                className={`h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 ${outcome === item.value ? 'border-primary bg-primary text-white' : 'border-gray-300 bg-surface text-gray-700 hover:border-primary'}`}>
                {t(item.he, item.en)}
              </button>
            ))}
            <button onClick={() => setMode(null)} disabled={busy} className="h-8 px-2 text-xs text-gray-500">{t('חזרה', 'Back')}</button>
          </div>
          {outcome && outcomeNeedsDate(outcome) && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold text-gray-600">
                {outcome === 'meeting' ? t('מועד הפגישה', 'Meeting date and time') : t('מתי לחזור אליו', 'When to call back')}
              </label>
              <input type="datetime-local" value={date} onChange={event => setDate(event.target.value)} className="h-8 rounded-lg border border-gray-300 bg-surface px-2 text-xs text-gray-700" />
              <button onClick={() => void complete(outcome, date)} disabled={busy || !date} className="flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-40">
                {busy && <Loader2 size={12} className="animate-spin" />}{t('שמור', 'Save')}
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'reschedule' && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2.5">
          <label className="text-xs font-semibold text-gray-600">{t('מועד חדש', 'New date and time')}</label>
          <input type="datetime-local" value={date} onChange={event => setDate(event.target.value)} className="h-8 rounded-lg border border-gray-300 bg-surface px-2 text-xs text-gray-700" />
          <button onClick={() => void run(async () => { await rescheduleFollowUpTask(task.id, new Date(date).toISOString()); return null })} disabled={busy || !date} className="flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-40">
            {busy && <Loader2 size={12} className="animate-spin" />}{t('שמור מועד', 'Save new time')}
          </button>
          <button onClick={() => setMode(null)} disabled={busy} className="h-8 px-2 text-xs text-gray-500">{t('חזרה', 'Back')}</button>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2.5">
          <p className="text-xs text-gray-600">{t('לבטל את המשימה? היא לא תופיע יותר.', 'Cancel this task? It will not come back.')}</p>
          <button onClick={() => void run(async () => { await cancelFollowUpTask(task.id); return null })} disabled={busy} className="flex h-8 items-center gap-1 rounded-lg border border-red-300 px-3 text-xs font-semibold text-red-600 disabled:opacity-40">
            {busy && <Loader2 size={12} className="animate-spin" />}{t('כן, בטל', 'Yes, cancel it')}
          </button>
          <button onClick={() => setMode(null)} disabled={busy} className="h-8 px-2 text-xs text-gray-500">{t('חזרה', 'Back')}</button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
