import { useEffect, useState } from 'react'
import { AlertCircle, Check, Loader2, Mail, Plus, Save, Trash2 } from 'lucide-react'
import { useLang } from '../../contexts/LanguageContext'
import {
  createLeadEmailStep, deleteLeadEmailStep, getLeadEmailCounts, getLeadEmailSteps, getUnsubscribeCount, updateLeadEmailStep,
  type DbLeadEmailStep, type LeadEmailCounts,
} from '../../lib/leadEmails'

type Draft = Pick<DbLeadEmailStep, 'day' | 'subject' | 'body' | 'is_active'>

const draftOf = (step: DbLeadEmailStep): Draft => ({ day: step.day, subject: step.subject, body: step.body, is_active: step.is_active })
const changed = (step: DbLeadEmailStep, draft: Draft) =>
  step.day !== draft.day || step.subject !== draft.subject || step.body !== draft.body || step.is_active !== draft.is_active

/**
 * Where the follow-up emails are written: one card per email, with the day it
 * goes out, its subject and its text.
 *
 * Renders nothing at all while the email tables do not exist, so the page it
 * sits on looks exactly as it did before until they do.
 */
export function EmailSequenceEditor({ canEdit }: { canEdit: boolean }) {
  const { t, dir } = useLang()
  const [available, setAvailable] = useState(false)
  const [steps, setSteps] = useState<DbLeadEmailStep[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [counts, setCounts] = useState<Record<string, LeadEmailCounts>>({})
  const [unsubscribed, setUnsubscribed] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getLeadEmailSteps()
      .then(async rows => {
        if (!alive) return
        setSteps(rows)
        setDrafts(Object.fromEntries(rows.map(row => [row.id, draftOf(row)])))
        setAvailable(true)
        // Nice to have, never a reason for the editor not to open.
        const [sentCounts, gone] = await Promise.all([getLeadEmailCounts().catch(() => ({})), getUnsubscribeCount().catch(() => 0)])
        if (alive) { setCounts(sentCounts); setUnsubscribed(gone) }
      })
      .catch(() => { if (alive) setAvailable(false) })
    return () => { alive = false }
  }, [])

  if (!available) return null

  const act = async (key: string, work: () => Promise<void>) => {
    if (busy) return
    setBusy(key)
    setError('')
    try { await work() }
    catch (err) { setError(err instanceof Error ? err.message : t('הפעולה נכשלה', 'That did not work')) }
    finally { setBusy(null) }
  }

  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    setSaved(null)
  }

  const add = () => act('add', async () => {
    const lastDay = Math.max(0, ...steps.map(step => step.day))
    const created = await createLeadEmailStep(steps.length === 0 ? 5 : lastDay + 14)
    setSteps(prev => [...prev, created].sort((a, b) => a.day - b.day))
    setDrafts(prev => ({ ...prev, [created.id]: draftOf(created) }))
  })

  const save = (step: DbLeadEmailStep) => act(step.id, async () => {
    const draft = drafts[step.id]
    // Switched on with nothing to say would be skipped by the server anyway;
    // saying so here is kinder than an email that silently never goes.
    if (draft.is_active && (!draft.subject.trim() || !draft.body.trim())) {
      throw new Error(t('כדי להפעיל מייל צריך גם נושא וגם תוכן', 'An email needs both a subject and a text before it can be switched on'))
    }
    const updated = await updateLeadEmailStep(step.id, draft)
    setSteps(prev => prev.map(item => item.id === step.id ? updated : item).sort((a, b) => a.day - b.day))
    setDrafts(prev => ({ ...prev, [step.id]: draftOf(updated) }))
    setSaved(step.id)
  })

  const remove = (step: DbLeadEmailStep) => act(step.id, async () => {
    try {
      await deleteLeadEmailStep(step.id)
    } catch {
      throw new Error(t('המייל הזה כבר נשלח ללידים ולכן אי אפשר למחוק אותו. אפשר לכבות אותו.', 'This email has already gone out to leads, so it cannot be deleted. Switch it off instead.'))
    } finally {
      setConfirmDelete(null)
    }
    setSteps(prev => prev.filter(item => item.id !== step.id))
  })

  const input = 'w-full rounded-lg border border-gray-200 bg-surface px-3 py-2 text-sm text-gray-700 outline-none focus:border-primary disabled:opacity-60'

  return (
    <div dir={dir} className="rounded-2xl border border-gray-100 bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="mb-0.5 flex items-center gap-2 text-base font-semibold text-primary"><Mail size={16} />{t('מיילים — לידים שלא עונים', 'Emails — unresponsive leads')}</h2>
          <p className="text-xs leading-relaxed text-gray-400">
            {t(
              'נשלחים מ-sales@communitree.online לכל ליד ברצף, לפי מספר הימים מאז שנכנס לרצף. {{שם}} מוחלף בשם הליד. קישור הסרה מתווסף אוטומטית לכל מייל.',
              'Sent from sales@communitree.online to every lead on the sequence, by days since the lead joined it. {{שם}} becomes the lead\'s name. An unsubscribe link is added to every email automatically.',
            )}
          </p>
        </div>
        {unsubscribed > 0 && <span className="shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-500">{unsubscribed} {t('הסירו את עצמם', 'unsubscribed')}</span>}
      </div>

      <div className="space-y-3">
        {steps.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-xs text-gray-400">
            {t('עדיין אין מיילים. הוסף את הראשון — שום דבר לא נשלח עד שמייל מופעל.', 'No emails yet. Add the first one — nothing is sent until an email is switched on.')}
          </p>
        )}

        {steps.map(step => {
          const draft = drafts[step.id] ?? draftOf(step)
          const count = counts[step.id]
          const dirty = changed(step, draft)
          return (
            <div key={step.id} className={`space-y-2.5 rounded-xl border bg-white p-3.5 ${step.is_active ? 'border-primary/30' : 'border-gray-200'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`email-day-${step.id}`} className="text-xs font-semibold text-gray-500">{t('יום', 'Day')}</label>
                <input id={`email-day-${step.id}`} type="number" min={0} max={730} value={draft.day} disabled={!canEdit}
                  onChange={event => setDraft(step.id, { day: Math.min(730, Math.max(0, Math.round(Number(event.target.value) || 0))) })}
                  className="h-8 w-20 rounded-lg border border-gray-200 bg-surface px-2 text-center text-sm text-gray-700 outline-none focus:border-primary disabled:opacity-60" />
                <span className="text-xs text-gray-400">{t('מהכניסה לרצף', 'after joining the sequence')}</span>

                <label className="ms-auto flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-gray-600">
                  <input type="checkbox" checked={draft.is_active} disabled={!canEdit} onChange={event => setDraft(step.id, { is_active: event.target.checked })} className="h-4 w-4 accent-primary" />
                  {draft.is_active ? t('פעיל — נשלח', 'On — being sent') : t('כבוי', 'Off')}
                </label>
              </div>

              <input value={draft.subject} disabled={!canEdit} onChange={event => setDraft(step.id, { subject: event.target.value })}
                placeholder={t('נושא המייל', 'Subject line')} aria-label={t('נושא המייל', 'Subject line')} className={input} />
              <textarea value={draft.body} disabled={!canEdit} onChange={event => setDraft(step.id, { body: event.target.value })} rows={6}
                placeholder={t('תוכן המייל. אפשר להשתמש ב-{{שם}}.', 'Email text. You can use {{שם}} for the name.')} aria-label={t('תוכן המייל', 'Email text')} className={`${input} resize-y leading-relaxed`} />

              <div className="flex flex-wrap items-center gap-2">
                {canEdit && (
                  <button onClick={() => void save(step)} disabled={busy !== null || !dirty} className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-40">
                    {busy === step.id ? <Loader2 size={13} className="animate-spin" /> : saved === step.id && !dirty ? <Check size={13} /> : <Save size={13} />}
                    {saved === step.id && !dirty ? t('נשמר', 'Saved') : t('שמור', 'Save')}
                  </button>
                )}
                {count && (
                  <span className="text-[11px] text-gray-500">
                    {t(`נשלח ל-${count.sent} לידים`, `Sent to ${count.sent} leads`)}
                    {count.failed > 0 && <> · <span className="text-red-600">{count.failed} {t('נכשלו', 'failed')}</span></>}
                    {count.skipped > 0 && <> · {count.skipped} {t('דולגו (איחור)', 'skipped (too late)')}</>}
                  </span>
                )}
                {canEdit && (confirmDelete === step.id ? (
                  <span className="ms-auto flex items-center gap-1.5 text-xs text-gray-600">
                    {t('למחוק את המייל?', 'Delete this email?')}
                    <button onClick={() => void remove(step)} disabled={busy !== null} className="h-8 rounded-lg border border-red-300 px-2.5 font-semibold text-red-600 disabled:opacity-40">{t('כן, מחק', 'Yes, delete')}</button>
                    <button onClick={() => setConfirmDelete(null)} className="h-8 px-1.5 text-gray-500">{t('ביטול', 'Cancel')}</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDelete(step.id)} disabled={busy !== null} title={t('מחק מייל', 'Delete email')} aria-label={t('מחק מייל', 'Delete email')} className="ms-auto rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                    <Trash2 size={14} />
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="mt-3 flex items-center gap-1.5 text-xs text-red-600"><AlertCircle size={13} />{error}</p>}

      {canEdit && (
        <button onClick={() => void add()} disabled={busy !== null} className="mt-3 flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3.5 text-xs font-semibold text-gray-600 transition-colors hover:border-primary hover:text-primary disabled:opacity-40">
          {busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}{t('הוסף מייל', 'Add email')}
        </button>
      )}
    </div>
  )
}
