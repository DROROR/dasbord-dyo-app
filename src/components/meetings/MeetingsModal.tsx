import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, CalendarClock, Check, Loader2, Pause, Pencil, Play, Plus, Repeat, RotateCcw, Trash2, X } from 'lucide-react'
import { useLang } from '../../contexts/LanguageContext'
import { GoogleMeetIcon } from './GoogleMeetIcon'
import {
  DEFAULT_MEET_LINK, MEETING_INPUT_ZONE, MEETING_ZONES, WEEKDAYS, cancelMeeting, countdownText,
  createMeeting, createMeetingSchedule, deleteMeetingSchedule, isoToZonedLocal, meetingDateInZone,
  meetingTimeInZone, msUntil, nextOccurrenceIso, restoreMeeting, setMeetingScheduleActive,
  updateMeeting, updateMeetingSchedule, zonedLocalToIso,
  type DbMeeting, type DbMeetingSchedule, type MeetingInput, type ScheduleInput,
} from '../../lib/meetings'

// The whole meeting feature in one dialog, opened from the Meet button in the
// top bar.
//
//   Meetings  — what is coming up: each one's three clocks, its countdown and
//               its Join button, plus the form for a one-off.
//   Weekly    — the standing rules ("every Monday 17:00 Pakistan time"). The
//               server turns each into real meetings a fortnight ahead, so they
//               then behave exactly like any other meeting.
//
// A time is typed once, in whichever of the three zones suits whoever is
// setting it; the other two are shown, never typed, so they cannot disagree.

// Nobody knows in advance how long a meeting will run, so its length is never
// asked for. An hour is simply the point after which it stops showing as live.
const DEFAULT_DURATION = 60
// Two warnings per meeting: the heads-up, then the last call.
const FIRST_WARNINGS = [3, 5, 10, 15, 30, 60]
const FINAL_WARNINGS = [1, 2, 3, 5]

function emptyForm(): MeetingInput {
  // Default to the next whole hour in the client's zone, an hour from now.
  const soon = new Date(Date.now() + 60 * 60 * 1000)
  const local = isoToZonedLocal(soon.toISOString())
  return {
    title: '',
    localStart: `${local.slice(0, 14)}00`,
    timezone: MEETING_INPUT_ZONE,
    durationMinutes: DEFAULT_DURATION,
    meetLink: DEFAULT_MEET_LINK,
    remindMinutes: 5,
    finalRemindMinutes: 1,
    notes: '',
  }
}

function formOf(meeting: DbMeeting): MeetingInput {
  return {
    title: meeting.title,
    localStart: isoToZonedLocal(meeting.starts_at, meeting.input_timezone),
    timezone: meeting.input_timezone,
    durationMinutes: meeting.duration_minutes,
    meetLink: meeting.meet_link,
    remindMinutes: meeting.remind_minutes,
    finalRemindMinutes: meeting.final_remind_minutes,
    notes: meeting.notes ?? '',
  }
}

function emptySchedule(): ScheduleInput {
  return {
    title: '',
    weekday: 1,
    localTime: '17:00',
    timezone: 'Asia/Karachi',
    durationMinutes: DEFAULT_DURATION,
    meetLink: DEFAULT_MEET_LINK,
    remindMinutes: 5,
    finalRemindMinutes: 1,
    notes: '',
    active: true,
  }
}

function scheduleFormOf(schedule: DbMeetingSchedule): ScheduleInput {
  return {
    title: schedule.title,
    weekday: schedule.weekday,
    localTime: schedule.local_time.slice(0, 5),
    timezone: schedule.timezone,
    durationMinutes: schedule.duration_minutes,
    meetLink: schedule.meet_link,
    remindMinutes: schedule.remind_minutes,
    finalRemindMinutes: schedule.final_remind_minutes,
    notes: schedule.notes ?? '',
    active: schedule.active,
  }
}

/** The three clocks for one instant — the same block everywhere it is shown. */
export function ZoneClocks({ iso, locale, className = 'mt-2' }: { iso: string; locale: string; className?: string }) {
  const { lang } = useLang()
  return (
    <div className={`grid grid-cols-3 gap-1.5 ${className}`}>
      {MEETING_ZONES.map(z => (
        <div key={z.zone} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center">
          <p className="text-[10px] font-semibold text-gray-400">{z.flag} {lang === 'he' ? z.labelHe : z.labelEn}</p>
          <p className="text-sm font-bold text-primary tabular-nums leading-tight">{meetingTimeInZone(iso, z.zone, locale)}</p>
          <p className="text-[9px] text-gray-400">{meetingDateInZone(iso, z.zone, locale)}</p>
        </div>
      ))}
    </div>
  )
}

function ZonePicker({ value, onChange, label }: { value: string; onChange: (zone: string) => void; label: string }) {
  const { t, lang } = useLang()
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="flex gap-1.5">
        {MEETING_ZONES.map(z => (
          <button
            key={z.zone}
            type="button"
            onClick={() => onChange(z.zone)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
              value === z.zone ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {z.flag} {lang === 'he' ? z.labelHe : z.labelEn}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-gray-400">{t('השעה נכתבת בשעון הזה; השאר מחושב לבד.', 'The time is typed in this clock; the others are worked out for you.')}</p>
    </div>
  )
}

export function MeetingsModal({ meetings, schedules, now, canEdit, onClose, onChanged, onReload }: {
  meetings: DbMeeting[]
  schedules: DbMeetingSchedule[]
  now: number
  canEdit: boolean
  onClose: () => void
  onChanged: (row: DbMeeting) => void
  onReload: () => void
}) {
  const { t, lang, dir } = useLang()
  const locale = lang === 'he' ? 'he-IL' : 'en-GB'
  const [tab, setTab]       = useState<'meetings' | 'weekly'>('meetings')
  const [mode, setMode]     = useState<'list' | 'form'>('list')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm]     = useState<MeetingInput>(emptyForm)
  const [rule, setRule]     = useState<ScheduleInput>(emptySchedule)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)

  // Finished ones sink to the bottom; everything else is soonest-first.
  const ordered = useMemo(() => {
    const over = (m: DbMeeting) => msUntil(m.starts_at, now) <= -m.duration_minutes * 60_000
    return [...meetings].sort((a, b) => Number(over(a)) - Number(over(b)) || a.starts_at.localeCompare(b.starts_at))
  }, [meetings, now])

  const previewIso = useMemo(() => {
    try { return zonedLocalToIso(form.localStart, form.timezone) } catch { return null }
  }, [form.localStart, form.timezone])

  const rulePreviewIso = useMemo(() => {
    try { return nextOccurrenceIso({ weekday: rule.weekday, local_time: rule.localTime, timezone: rule.timezone }) } catch { return null }
  }, [rule.weekday, rule.localTime, rule.timezone])

  function startNew()   { setForm(emptyForm()); setEditId(null); setError(null); setMode('form') }
  function startRule()  { setRule(emptySchedule()); setEditId(null); setError(null); setMode('form') }
  function startEdit(meeting: DbMeeting)       { setForm(formOf(meeting)); setEditId(meeting.id); setError(null); setMode('form') }
  function startEditRule(sched: DbMeetingSchedule) { setRule(scheduleFormOf(sched)); setEditId(sched.id); setError(null); setMode('form') }
  function backToList()  { setMode('list'); setEditId(null); setError(null) }

  // Escape steps back one level rather than throwing everything away: out of
  // the form to the list, and only out of the list to the page behind.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || saving) return
      if (mode === 'form') backToList()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      if (tab === 'meetings') {
        if (!form.title.trim() || !previewIso) return
        onChanged(editId ? await updateMeeting(editId, form) : await createMeeting(form))
      } else {
        if (!rule.title.trim()) return
        if (editId) await updateMeetingSchedule(editId, rule)
        else await createMeetingSchedule(rule)
        onReload()
      }
      setMode('list')
      setEditId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('השמירה נכשלה', 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  async function runOn(id: string, action: (id: string) => Promise<DbMeeting>) {
    if (busyId) return
    setBusyId(id)
    setError(null)
    try {
      onChanged(await action(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('הפעולה נכשלה', 'Action failed'))
    } finally {
      setBusyId(null)
    }
  }

  async function runOnRule(id: string, action: (id: string) => Promise<unknown>) {
    if (busyId) return
    setBusyId(id)
    setError(null)
    try {
      await action(id)
      onReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('הפעולה נכשלה', 'Action failed'))
    } finally {
      setBusyId(null)
    }
  }

  const zoneLabel = (zone: string) => {
    const found = MEETING_ZONES.find(z => z.zone === zone)
    return found ? `${found.flag} ${lang === 'he' ? found.labelHe : found.labelEn}` : zone
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={() => { if (saving) return; if (mode === 'form') backToList(); else onClose() }}
    >
      <div className="my-8 flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-gray-100 p-5 pb-3">
          {mode === 'form' ? (
            <button
              onClick={backToList}
              disabled={saving}
              title={t('חזרה לרשימה', 'Back to the list')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary"
            >
              {dir === 'rtl' ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
            </button>
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-50">
              <GoogleMeetIcon size={19} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">
              {mode === 'form'
                ? (tab === 'meetings'
                    ? (editId ? t('עריכת פגישה', 'Edit meeting') : t('פגישה חדשה', 'New meeting'))
                    : (editId ? t('עריכת כלל שבועי', 'Edit weekly rule') : t('כלל שבועי חדש', 'New weekly rule')))
                : t('פגישות צוות', 'Team meetings')}
            </p>
            <p className="text-[11px] text-gray-400">
              {mode === 'form' ? t('לחיצה על החץ חוזרת לרשימה', 'The arrow goes back to the list') : t('ישראל · פקיסטן · אוקראינה', 'Israel · Pakistan · Ukraine')}
            </p>
          </div>
          {mode === 'list' && canEdit && (
            <button
              onClick={tab === 'meetings' ? startNew : startRule}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
            >
              <Plus size={14} />
              {tab === 'meetings' ? t('פגישה חדשה', 'New meeting') : t('כלל שבועי', 'Weekly rule')}
            </button>
          )}
          <button onClick={onClose} disabled={saving} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-100 px-5">
          {([
            { id: 'meetings' as const, label: t('קרובות', 'Upcoming'), icon: CalendarClock, count: meetings.filter(m => !m.cancelled_at).length },
            { id: 'weekly'   as const, label: t('שבועי', 'Weekly'),    icon: Repeat,        count: schedules.filter(s => s.active).length },
          ]).map(item => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => { setTab(item.id); backToList() }}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors ${
                  tab === item.id ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-600'
                }`}
              >
                <Icon size={13} />
                {item.label}
                {item.count > 0 && <span className="rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-500">{item.count}</span>}
              </button>
            )
          })}
        </div>

        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
          </div>
        )}

        {/* ── Upcoming meetings ── */}
        {tab === 'meetings' && mode === 'list' && (
          <div className="flex flex-col gap-3 p-5">
            {ordered.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CalendarClock size={28} className="text-gray-200" />
                <p className="text-xs text-gray-400">{t('אין פגישות מתוכננות', 'No meetings scheduled')}</p>
              </div>
            )}

            {ordered.map(meeting => {
              const ms        = msUntil(meeting.starts_at, now)
              const over      = ms <= -meeting.duration_minutes * 60_000
              const running   = ms <= 0 && !over
              const soon      = ms > 0 && ms <= meeting.remind_minutes * 60_000
              const cancelled = Boolean(meeting.cancelled_at)
              return (
                <div
                  key={meeting.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    cancelled ? 'border-gray-100 bg-gray-50 opacity-60'
                      : running ? 'border-[#00832d]/30 bg-[#00832d]/5'
                      : soon    ? 'border-amber-200 bg-amber-50/40'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <p className={`min-w-0 flex-1 text-sm font-semibold ${cancelled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                      {meeting.title}
                      {meeting.schedule_id && <Repeat size={11} className="ms-1.5 inline text-gray-300" />}
                    </p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                      cancelled ? 'bg-gray-200 text-gray-500'
                        : over    ? 'bg-gray-100 text-gray-400'
                        : running ? 'bg-[#00832d] text-white'
                        : soon    ? 'bg-amber-500 text-white'
                        : 'bg-primary/10 text-primary'
                    }`}>
                      {cancelled ? t('בוטלה', 'Cancelled')
                        : over    ? t('הסתיימה', 'Ended')
                        : running ? t('מתקיימת עכשיו', 'Live now')
                        : countdownText(ms, lang === 'he')}
                    </span>
                  </div>

                  <ZoneClocks iso={meeting.starts_at} locale={locale} />

                  {meeting.notes && <p className="mt-2 whitespace-pre-wrap text-[11px] text-gray-500">{meeting.notes}</p>}

                  <div className="mt-2.5 flex items-center gap-1.5">
                    <a
                      href={meeting.meet_link}
                      target="_blank"
                      rel="noreferrer"
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                        cancelled || over ? 'bg-gray-100 text-gray-400' : 'bg-[#00832d] text-white hover:bg-[#026c26]'
                      }`}
                    >
                      <span className={cancelled || over ? 'opacity-40 grayscale' : 'rounded-[3px] bg-white px-1 py-0.5'}>
                        <GoogleMeetIcon size={11} />
                      </span>
                      {t('הצטרפות ב-Google Meet', 'Join Google Meet')}
                    </a>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-gray-400">
                      {meeting.meet_link.replace(/^https?:\/\//, '')}
                    </span>
                    {canEdit && (
                      <>
                        <button
                          onClick={() => startEdit(meeting)}
                          title={t('עריכה', 'Edit')}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => void runOn(meeting.id, cancelled ? restoreMeeting : cancelMeeting)}
                          disabled={busyId === meeting.id}
                          title={cancelled ? t('החזרה', 'Restore') : t('ביטול', 'Cancel')}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500"
                        >
                          {busyId === meeting.id ? <Loader2 size={13} className="animate-spin" />
                            : cancelled ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}

            <button onClick={onReload} className="self-center text-[11px] font-semibold text-gray-400 hover:text-primary">
              {t('רענון', 'Refresh')}
            </button>
          </div>
        )}

        {/* ── One-off meeting form ── */}
        {tab === 'meetings' && mode === 'form' && (
          <div className="flex flex-col gap-3 p-5">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('נושא הפגישה', 'Meeting title')}</p>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                autoFocus
                placeholder={t('סנכרון צוות', 'Team sync')}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <ZonePicker value={form.timezone} onChange={zone => setForm(f => ({ ...f, timezone: zone }))} label={t('באיזה שעון', 'Which clock')} />

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {t('תאריך ושעה', 'Date and time')} — {zoneLabel(form.timezone)}
              </p>
              <input
                type="datetime-local"
                value={form.localStart}
                onChange={e => setForm(f => ({ ...f, localStart: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              {previewIso
                ? <ZoneClocks iso={previewIso} locale={locale} />
                : <p className="mt-2 text-[11px] text-red-500">{t('שעה לא תקינה', 'That time is not valid')}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('התראה 1', 'Warning 1')}</p>
                <select
                  value={form.remindMinutes}
                  onChange={e => setForm(f => {
                    const remindMinutes = Number(e.target.value)
                    return { ...f, remindMinutes, finalRemindMinutes: Math.min(f.finalRemindMinutes, remindMinutes) }
                  })}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {FIRST_WARNINGS.map(r => <option key={r} value={r}>{r} {t('דק׳', 'min')}</option>)}
                </select>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('התראה 2', 'Warning 2')}</p>
                <select
                  value={form.finalRemindMinutes}
                  onChange={e => setForm(f => ({ ...f, finalRemindMinutes: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {FINAL_WARNINGS.filter(r => r <= form.remindMinutes).map(r => <option key={r} value={r}>{r} {t('דק׳', 'min')}</option>)}
                </select>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('קישור Google Meet', 'Google Meet link')}</p>
              <input
                value={form.meetLink}
                onChange={e => setForm(f => ({ ...f, meetLink: e.target.value }))}
                dir="ltr"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('הערות', 'Notes')}</p>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <p className="text-[11px] text-gray-400">
              {t(`סלאק יקבל הודעה עם הקביעה, ${form.remindMinutes} דקות לפני, ושוב ${form.finalRemindMinutes} דקות לפני — עם הקישור.`,
                 `Slack gets a message when this is set, again ${form.remindMinutes} minutes before, and a last call ${form.finalRemindMinutes} minute${form.finalRemindMinutes === 1 ? '' : 's'} before — every one with the link.`)}
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void save()}
                disabled={saving || !form.title.trim() || !previewIso}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {editId ? t('שמירת שינויים', 'Save changes') : t('קביעת הפגישה', 'Set the meeting')}
              </button>
              <button
                onClick={backToList}
                disabled={saving}
                className="rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-50"
              >
                {t('חזרה', 'Back')}
              </button>
            </div>
          </div>
        )}

        {/* ── Weekly rules ── */}
        {tab === 'weekly' && mode === 'list' && (
          <div className="flex flex-col gap-3 p-5">
            <p className="text-[11px] text-gray-400">
              {t('כלל שבועי נקבע פעם אחת והפגישות נוצרות לבד לשבועיים קדימה. כל פגישה בודדת ניתנת לשינוי או לביטול בנפרד.',
                 'A weekly rule is set once and the meetings appear by themselves, two weeks ahead. Any single one can still be moved or cancelled on its own.')}
            </p>

            {schedules.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Repeat size={28} className="text-gray-200" />
                <p className="text-xs text-gray-400">{t('אין כללים שבועיים', 'No weekly rules yet')}</p>
              </div>
            )}

            {schedules.map(schedule => {
              const day = WEEKDAYS.find(d => d.value === schedule.weekday)
              const nextIso = nextOccurrenceIso(schedule)
              return (
                <div key={schedule.id} className={`rounded-xl border p-3 ${schedule.active ? 'border-gray-200' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold ${schedule.active ? 'text-gray-900' : 'text-gray-400'}`}>{schedule.title}</p>
                      <p className="text-[11px] text-gray-500">
                        {t('כל', 'Every')} {day ? (lang === 'he' ? day.he : day.en) : schedule.weekday} · {schedule.local_time.slice(0, 5)} {zoneLabel(schedule.timezone)}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${schedule.active ? 'bg-primary/10 text-primary' : 'bg-gray-200 text-gray-500'}`}>
                      {schedule.active ? t('פעיל', 'On') : t('מושהה', 'Paused')}
                    </span>
                  </div>

                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('הפעם הבאה', 'Next time')}</p>
                  <ZoneClocks iso={nextIso} locale={locale} className="mt-1" />

                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[10px] text-gray-400">
                      {schedule.meet_link.replace(/^https?:\/\//, '')}
                    </span>
                    {canEdit && (
                      <>
                        <button
                          onClick={() => startEditRule(schedule)}
                          title={t('עריכה', 'Edit')}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => void runOnRule(schedule.id, id => setMeetingScheduleActive(id, !schedule.active))}
                          disabled={busyId === schedule.id}
                          title={schedule.active ? t('השהיה', 'Pause') : t('הפעלה', 'Resume')}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary"
                        >
                          {busyId === schedule.id ? <Loader2 size={13} className="animate-spin" />
                            : schedule.active ? <Pause size={13} /> : <Play size={13} />}
                        </button>
                        <button
                          onClick={() => { if (window.confirm(t('למחוק את הכלל השבועי? הפגישות העתידיות שלו יוסרו.', 'Delete this weekly rule? Its future meetings are removed.'))) void runOnRule(schedule.id, deleteMeetingSchedule) }}
                          disabled={busyId === schedule.id}
                          title={t('מחיקה', 'Delete')}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Weekly rule form ── */}
        {tab === 'weekly' && mode === 'form' && (
          <div className="flex flex-col gap-3 p-5">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('נושא הפגישה', 'Meeting title')}</p>
              <input
                value={rule.title}
                onChange={e => setRule(r => ({ ...r, title: e.target.value }))}
                autoFocus
                placeholder={t('סנכרון צוות', 'Team sync')}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <ZonePicker value={rule.timezone} onChange={zone => setRule(r => ({ ...r, timezone: zone }))} label={t('באיזה שעון', 'Which clock')} />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('יום בשבוע', 'Day of the week')}</p>
                <select
                  value={rule.weekday}
                  onChange={e => setRule(r => ({ ...r, weekday: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {WEEKDAYS.map(d => <option key={d.value} value={d.value}>{lang === 'he' ? d.he : d.en}</option>)}
                </select>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('שעה', 'Time')} — {zoneLabel(rule.timezone)}</p>
                <input
                  type="time"
                  value={rule.localTime}
                  onChange={e => setRule(r => ({ ...r, localTime: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {rulePreviewIso && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('הפעם הבאה', 'Next time')}</p>
                <ZoneClocks iso={rulePreviewIso} locale={locale} className="mt-0" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('התראה 1', 'Warning 1')}</p>
                <select
                  value={rule.remindMinutes}
                  onChange={e => setRule(r => {
                    const remindMinutes = Number(e.target.value)
                    return { ...r, remindMinutes, finalRemindMinutes: Math.min(r.finalRemindMinutes, remindMinutes) }
                  })}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {FIRST_WARNINGS.map(r => <option key={r} value={r}>{r} {t('דק׳', 'min')}</option>)}
                </select>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('התראה 2', 'Warning 2')}</p>
                <select
                  value={rule.finalRemindMinutes}
                  onChange={e => setRule(r => ({ ...r, finalRemindMinutes: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {FINAL_WARNINGS.filter(r => r <= rule.remindMinutes).map(r => <option key={r} value={r}>{r} {t('דק׳', 'min')}</option>)}
                </select>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('קישור Google Meet', 'Google Meet link')}</p>
              <input
                value={rule.meetLink}
                onChange={e => setRule(r => ({ ...r, meetLink: e.target.value }))}
                dir="ltr"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('הערות', 'Notes')}</p>
              <textarea
                value={rule.notes}
                onChange={e => setRule(r => ({ ...r, notes: e.target.value }))}
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void save()}
                disabled={saving || !rule.title.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {editId ? t('שמירת שינויים', 'Save changes') : t('קביעת הכלל', 'Save the rule')}
              </button>
              <button
                onClick={backToList}
                disabled={saving}
                className="rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-50"
              >
                {t('חזרה', 'Back')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
