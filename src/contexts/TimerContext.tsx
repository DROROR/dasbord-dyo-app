import { createContext, useContext, useState, useEffect, useRef } from 'react'
import type { TimeEntry } from '../types/work'
import { addTaskTimeEntry } from '../lib/database'

const TIMER_KEY = 'activeTimer'

/** Fired only after the server has confirmed the entry was saved — never
 *  before. `entries` is the task's full, authoritative time-entry array
 *  as returned by the RPC, so every listener can replace its local copy
 *  outright instead of merging a client-guessed shape. */
export const TIMER_ENTRY_SAVED_EVENT = 'timerEntrySaved'
export interface TimerEntrySavedDetail {
  taskId: string
  entry: TimeEntry
  entries: TimeEntry[]
}

interface TimerState {
  taskId: string
  taskTitle: string
  startTime: number
  loggedBy: string
  /** Authoritative profile UUID for the resulting TimeEntry — see loggedById on TimeEntry. */
  loggedById?: string
}

export interface StopResult {
  entry: TimeEntry | null
  taskId: string | null
  discarded: boolean       // true when rounded to 0 minutes (< 30 seconds elapsed)
  error: string | null     // non-null when the save failed — the timer was NOT cleared and remains running
}

interface TimerContextValue {
  timerState: TimerState | null
  elapsed: number               // live seconds since start
  /** True while a stop() is persisting — callers should disable their own Stop control to avoid a second concurrent attempt. */
  saving: boolean
  start: (taskId: string, taskTitle: string, loggedBy: string, loggedById?: string) => void
  /** Persists via the same addTaskTimeEntry RPC every other entry uses, and only clears
   *  the running timer once that save is confirmed. On failure the timer is left running
   *  and recoverable so the caller can show an error and let the user retry. */
  stop: (opts?: { subtaskId?: string }) => Promise<StopResult>
}

const TimerContext = createContext<TimerContextValue | null>(null)

function readStorage(): TimerState | null {
  try {
    const raw = localStorage.getItem(TIMER_KEY)
    if (!raw) return null
    const p: TimerState = JSON.parse(raw)
    if (p.taskId && p.startTime) return p
  } catch {
    // Treat unreadable or malformed persisted state as no active timer.
  }
  return null
}

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [timerState, setTimerState] = useState<TimerState | null>(readStorage)
  const [elapsed,    setElapsed]    = useState(0)
  const [saving,     setSaving]     = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Tick the elapsed counter whenever the running task changes
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (!timerState) { setElapsed(0); return }
    const tick = () => setElapsed(Math.floor((Date.now() - timerState.startTime) / 1000))
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [timerState?.taskId, timerState?.startTime])

  function start(taskId: string, taskTitle: string, loggedBy: string, loggedById?: string) {
    const startTime = Date.now()
    const state: TimerState = { taskId, taskTitle, startTime, loggedBy, loggedById }
    localStorage.setItem(TIMER_KEY, JSON.stringify(state))
    setTimerState(state)
  }

  async function stop(opts?: { subtaskId?: string }): Promise<StopResult> {
    if (!timerState) return { entry: null, taskId: null, discarded: false, error: null }
    const snap = timerState
    const elapsedSec = Math.floor((Date.now() - snap.startTime) / 1000)
    const totalMins = Math.round(elapsedSec / 60)   // round to nearest minute

    if (totalMins === 0) {
      // Nothing worth persisting — this is the one case where clearing
      // immediately is correct, there is no write to wait for.
      localStorage.removeItem(TIMER_KEY)
      setTimerState(null)
      return { entry: null, taskId: snap.taskId, discarded: true, error: null }
    }

    const h = Math.floor(totalMins / 60)
    const m = totalMins % 60
    const entry: TimeEntry = {
      id: Math.random().toString(36).slice(2, 10),
      date: new Date().toISOString().slice(0, 10),
      hours: h, minutes: m,
      loggedBy: snap.loggedBy,
      loggedById: snap.loggedById,
      subtaskId: opts?.subtaskId,
      isLocked: true,
      createdAt: new Date().toISOString(),
    }

    setSaving(true)
    try {
      // The RPC is idempotent on entry.id, so TimerContext is the single
      // place a stop is ever persisted — no separate listener needs (or
      // is allowed) to call it again for the same stop.
      const entries = await addTaskTimeEntry(snap.taskId, entry)
      // Persistence confirmed — only now is the running timer cleared.
      localStorage.removeItem(TIMER_KEY)
      setTimerState(null)
      window.dispatchEvent(new CustomEvent<TimerEntrySavedDetail>(TIMER_ENTRY_SAVED_EVENT, {
        detail: { taskId: snap.taskId, entry, entries },
      }))
      return { entry, taskId: snap.taskId, discarded: false, error: null }
    } catch (err) {
      // Persistence failed — the timer stays exactly as it was
      // (still in timerState and TIMER_KEY), so the user can retry.
      return {
        entry: null, taskId: snap.taskId, discarded: false,
        error: err instanceof Error ? err.message : 'Failed to save time entry',
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <TimerContext.Provider value={{ timerState, elapsed, saving, start, stop }}>
      {children}
    </TimerContext.Provider>
  )
}

export function useTimer() {
  const ctx = useContext(TimerContext)
  if (!ctx) throw new Error('useTimer must be used within TimerProvider')
  return ctx
}
