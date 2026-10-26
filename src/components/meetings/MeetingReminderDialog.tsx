import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useLang } from '../../contexts/LanguageContext'
import { countdownText, meetingStage, msUntil, type DbMeeting } from '../../lib/meetings'
import { ZoneClocks } from './MeetingsModal'
import { GoogleMeetIcon } from './GoogleMeetIcon'

// The "your meeting is about to start" dialog. It appears over whatever page is
// open — the top bar hosts it, and the top bar is on every page — at the first
// warning (5 minutes before by default), again at the last call (1 minute), and
// once the meeting is live.
//
// Dismissals are remembered in localStorage per meeting AND per stage: closing
// the 5-minute warning is not a reason to stay quiet at the last call, but it
// does mean not being nagged again by that same warning on the next page change
// or reload. The key carries starts_at too, so a rescheduled meeting warns
// afresh.

const DISMISSED_KEY = 'dyo-meeting-reminders-dismissed'

/**
 * Three short beeps for the last call, synthesised rather than loaded, so the
 * app carries no audio file and nothing has to be fetched at the moment it is
 * needed. A browser that has had no interaction on the page yet refuses to make
 * sound at all — that is the browser's rule, not something to work around, so
 * the failure is swallowed and the dialog still shows.
 */
function beep() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const audio = new Ctor()
    void audio.resume?.()
    for (let i = 0; i < 3; i++) {
      const at = audio.currentTime + i * 0.28
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, at)
      // Fade each beep in and out — a square-edged tone clicks on most speakers.
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18)
      osc.connect(gain).connect(audio.destination)
      osc.start(at)
      osc.stop(at + 0.2)
    }
    window.setTimeout(() => void audio.close().catch(() => {}), 1500)
  } catch {
    // No audio device, or the page has not been interacted with yet.
  }
}

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    return raw ? JSON.parse(raw) as string[] : []
  } catch {
    return []
  }
}

const keyOf = (meeting: DbMeeting, stage: string) => `${meeting.id}@${meeting.starts_at}#${stage}`

export function MeetingReminderDialog({ meetings, now }: { meetings: DbMeeting[]; now: number }) {
  const { t, lang } = useLang()
  const locale = lang === 'he' ? 'he-IL' : 'en-GB'
  const [dismissed, setDismissed] = useState<string[]>(readDismissed)
  const beepedFor = useRef<string | null>(null)

  // Keep the stored list from growing forever: only keys for meetings still in
  // play are worth remembering.
  useEffect(() => {
    const live = new Set(meetings.flatMap(m => ['first', 'final', 'live'].map(stage => keyOf(m, stage))))
    const kept = dismissed.filter(key => live.has(key))
    if (kept.length === dismissed.length) return
    setDismissed(kept)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(kept)) } catch { /* private mode */ }
  }, [meetings, dismissed])

  // The last call, and the start itself, beep once each — enough to catch
  // someone looking at another window, not enough to become noise.
  const beepKey = meetings
    .map(meeting => ({ meeting, stage: meetingStage(meeting, now) }))
    .filter(({ stage }) => stage === 'final' || stage === 'live')
    .map(({ meeting, stage }) => keyOf(meeting, stage!))[0] ?? null

  useEffect(() => {
    if (!beepKey || beepedFor.current === beepKey) return
    beepedFor.current = beepKey
    beep()
  }, [beepKey])

  const hit = meetings
    .map(meeting => ({ meeting, stage: meetingStage(meeting, now) }))
    .find(({ meeting, stage }) => stage !== null && !dismissed.includes(keyOf(meeting, stage)))
  if (!hit || !hit.stage) return null

  const { meeting, stage } = hit
  const ms = msUntil(meeting.starts_at, now)

  function dismiss() {
    const next = [...dismissed, keyOf(meeting, stage!)]
    setDismissed(next)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  const live = stage === 'live'
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className={`flex items-center gap-2.5 px-5 py-4 ${live ? 'bg-[#00832d]' : stage === 'final' ? 'bg-red-500' : 'bg-amber-500'}`}>
          <span className="shrink-0 rounded-md bg-white px-1.5 py-1">
            <GoogleMeetIcon size={16} />
          </span>
          <p className="min-w-0 flex-1 text-sm font-bold text-white">
            {live
              ? t('הפגישה מתחילה עכשיו', 'The meeting is starting now')
              : `${t('הפגישה מתחילה בעוד', 'Meeting starts in')} ${countdownText(ms, lang === 'he')}`}
          </p>
          <button onClick={dismiss} className="rounded-lg p-1 text-white/80 transition-colors hover:bg-white/20 hover:text-white">
            <X size={15} />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm font-semibold text-gray-900">{meeting.title}</p>
          <ZoneClocks iso={meeting.starts_at} locale={locale} />
          {meeting.notes && <p className="mt-2 whitespace-pre-wrap text-[11px] text-gray-500">{meeting.notes}</p>}

          <div className="mt-4 flex items-center gap-2">
            <a
              href={meeting.meet_link}
              target="_blank"
              rel="noreferrer"
              onClick={dismiss}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#00832d] px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#026c26]"
            >
              <span className="rounded-[3px] bg-white px-1 py-0.5">
                <GoogleMeetIcon size={13} />
              </span>
              {t('הצטרפות ב-Google Meet', 'Join Google Meet')}
            </a>
            <button
              onClick={dismiss}
              className="rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-50"
            >
              {t('לא עכשיו', 'Not now')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
