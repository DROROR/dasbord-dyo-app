import { useCallback, useEffect, useMemo, useState } from 'react'
import { getMeetingSchedules, getMeetings, isMeetingDueSoon, msUntil, type DbMeeting, type DbMeetingSchedule } from '../lib/meetings'

// The top bar's meeting clock. One fetch on mount, a refetch every minute (so
// a meeting someone else sets shows up without a reload), and a one-second
// tick so the countdown moves. The tick only bumps a counter — the list itself
// is not refetched every second.

const REFRESH_MS = 60_000

export function useMeetings(enabled: boolean) {
  const [meetings, setMeetings]   = useState<DbMeeting[]>([])
  const [schedules, setSchedules] = useState<DbMeetingSchedule[]>([])
  const [loading,  setLoading]  = useState(enabled)
  const [error,    setError]    = useState<string | null>(null)
  const [now,      setNow]      = useState(() => Date.now())

  const reload = useCallback(async () => {
    if (!enabled) return
    try {
      const [rows, rules] = await Promise.all([getMeetings(), getMeetingSchedules()])
      setMeetings(rows)
      setSchedules(rules)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) { setMeetings([]); setSchedules([]); setLoading(false); return }
    void reload()
    const timer = window.setInterval(() => { void reload() }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [enabled, reload])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [enabled])

  const live = useMemo(
    () => meetings.filter(m => !m.cancelled_at),
    [meetings],
  )

  /** The soonest meeting that has not finished yet. */
  const next = useMemo(
    () => live.find(m => msUntil(m.starts_at, now) > -m.duration_minutes * 60_000) ?? null,
    [live, now],
  )

  /** Meetings inside their own warning window — what the dialog pops for. */
  const dueSoon = useMemo(
    () => live.filter(m => isMeetingDueSoon(m, now)),
    [live, now],
  )

  /** Applies one changed/new row locally so the UI does not wait for a refetch. */
  const applyLocal = useCallback((row: DbMeeting) => {
    setMeetings(current => {
      const rest = current.filter(m => m.id !== row.id)
      return [...rest, row].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    })
  }, [])

  return { meetings, schedules, live, next, dueSoon, loading, error, now, reload, applyLocal }
}
