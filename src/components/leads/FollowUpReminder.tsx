import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Clock, PhoneCall } from 'lucide-react'
import { useLang } from '../../contexts/LanguageContext'
import { useCan } from '../../hooks/useCan'
import { getLeadPipelineStatuses, getLeadSequenceProgress } from '../../lib/database'
import type { DbLeadPipelineStatus, DbLeadSequenceProgress } from '../../lib/database'
import { requestLeadFocus } from '../../lib/focusTarget'
import { FOLLOW_UP_CHANGED_EVENT, getOpenFollowUpTasks, isTaskDue, isTaskOverdue, type FollowUpTaskWithLead } from '../../lib/leadFollowUp'
import { FollowUpTaskRow } from './FollowUpTaskRow'

const HOUR_KEY = 'leadFollowUp.reminderHour'
const SNOOZE_KEY = 'leadFollowUp.snoozeUntil'
const DEFAULT_HOUR = 13
const SNOOZE_MS = 30 * 60_000

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) ? value : fallback
  } catch { return fallback }
}
function writeNumber(key: string, value: number) {
  try { localStorage.setItem(key, String(value)) } catch { /* private mode: the reminder still works for this visit */ }
}

/** This sits in the top bar of every page, so a fault in it must cost nothing but itself. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.error('Follow-up reminder failed:', error) }
  render() { return this.state.failed ? null : this.props.children }
}

/**
 * The daily follow-up reminder: a counter in the top bar, and a list that opens
 * by itself in the afternoon when calls are due.
 *
 * The list has no close button. Each call leaves it only by being given a
 * result, a new time, or a cancellation; the one way to put the list aside is
 * "remind me in 30 minutes", after which it is back. Nothing renders at all
 * for someone with no open tasks, or without edit rights on leads.
 */
function Reminder({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { t } = useLang()
  const canEdit = useCan('leads', 'edit')
  const [tasks, setTasks] = useState<FollowUpTaskWithLead[]>([])
  const [progress, setProgress] = useState<DbLeadSequenceProgress[]>([])
  const [statuses, setStatuses] = useState<DbLeadPipelineStatus[]>([])
  const [open, setOpen] = useState(false)
  const [hour, setHour] = useState(() => readNumber(HOUR_KEY, DEFAULT_HOUR))
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    if (!canEdit) return
    try {
      const openTasks = await getOpenFollowUpTasks()
      setTasks(openTasks)
      if (openTasks.length === 0) return
      const [rows, columns] = await Promise.all([getLeadSequenceProgress(), getLeadPipelineStatuses()])
      setProgress(rows)
      setStatuses(columns)
    } catch {
      // Before the follow-up table exists, or offline: no reminder, no error.
      setTasks([])
    }
  }, [canEdit])

  useEffect(() => {
    void load()
    const poll = window.setInterval(() => { void load() }, 5 * 60_000)
    const tick = window.setInterval(() => setNow(Date.now()), 60_000)
    const onChange = () => { void load() }
    const onFocus = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener(FOLLOW_UP_CHANGED_EVENT, onChange)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(tick)
      window.removeEventListener(FOLLOW_UP_CHANGED_EVENT, onChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const progressById = useMemo(() => new Map(progress.map(row => [row.id, row])), [progress])
  // A paused chain asks for nothing until it is resumed.
  const due = useMemo(() => tasks.filter(task =>
    task.lead !== null && isTaskDue(task, new Date(now)) && progressById.get(task.progress_id ?? '')?.status !== 'paused',
  ), [tasks, progressById, now])
  const overdueCount = due.filter(task => isTaskOverdue(task, new Date(now))).length
  const todayCount = due.length - overdueCount

  // Opens by itself once the chosen hour has come and the list is not put aside.
  useEffect(() => {
    if (open || due.length === 0) return
    if (new Date(now).getHours() < hour) return
    if (now < readNumber(SNOOZE_KEY, 0)) return
    setOpen(true)
  }, [open, due.length, hour, now])

  // Nothing left to do is the only thing that closes it on its own.
  useEffect(() => { if (open && due.length === 0) setOpen(false) }, [open, due.length])

  if (!canEdit || due.length === 0) return null

  const snooze = (ms: number) => { writeNumber(SNOOZE_KEY, Date.now() + ms); setOpen(false) }
  const openLead = (leadId: string) => {
    requestLeadFocus(leadId)
    onNavigate('leads')
    snooze(SNOOZE_MS)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t('משימות מעקב לידים', 'Lead follow-up tasks')}
        className={`flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${overdueCount > 0 ? 'border-red-300 bg-white text-red-600 hover:bg-red-50' : 'border-amber-300 bg-white text-amber-700 hover:bg-amber-50'}`}
      >
        <PhoneCall size={15} />
        <span className="hidden sm:inline">{t('מעקב', 'Follow-ups')}</span>
        {todayCount > 0 && <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-950">{todayCount} {t('היום', 'today')}</span>}
        {overdueCount > 0 && <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">{overdueCount} {t('באיחור', 'overdue')}</span>}
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div role="dialog" aria-modal="true" className="relative flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl bg-surface shadow-2xl">
            <div className="shrink-0 border-b border-gray-100 p-5">
              <h2 className="flex items-center gap-2 text-base font-bold text-primary"><PhoneCall size={18} />{t('משימות המעקב של היום', 'Today\'s follow-up tasks')}</h2>
              <p className="mt-1 text-xs text-gray-500">
                {t(`${todayCount} להיום · ${overdueCount} באיחור. כל משימה נשארת כאן עד שתעדכן אותה.`, `${todayCount} due today · ${overdueCount} overdue. Each task stays here until you update it.`)}
              </p>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-5">
              {due.map(task => (
                <FollowUpTaskRow
                  key={task.id}
                  task={task}
                  lead={{ id: task.lead!.id, pipeline_status_id: task.lead!.pipeline_status_id }}
                  leadName={task.lead!.name}
                  phone={task.lead!.phone}
                  progress={progressById.get(task.progress_id ?? '')}
                  statuses={statuses}
                  onOpenLead={() => openLead(task.lead!.id)}
                />
              ))}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-gray-100 px-5 py-3">
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <Clock size={13} />{t('להציג כל יום מהשעה', 'Show every day from')}
                <select value={hour} onChange={event => { const value = Number(event.target.value); setHour(value); writeNumber(HOUR_KEY, value) }} className="h-8 rounded-lg border border-gray-200 bg-surface px-2 text-xs text-gray-700">
                  {Array.from({ length: 13 }, (_, index) => index + 8).map(value => <option key={value} value={value}>{String(value).padStart(2, '0')}:00</option>)}
                </select>
              </label>
              <button onClick={() => snooze(SNOOZE_MS)} className="ms-auto h-9 rounded-lg border border-gray-300 px-3 text-xs font-semibold text-gray-600 transition-colors hover:border-gray-400">
                {t('הזכר לי בעוד 30 דקות', 'Remind me in 30 minutes')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

export function FollowUpReminder(props: { onNavigate: (page: string) => void }) {
  return <Quiet><Reminder {...props} /></Quiet>
}
