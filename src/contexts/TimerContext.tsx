import { createContext, useContext, useState, useEffect, useRef } from 'react'
import type { TimeEntry } from '../types/work'

const TIMER_KEY   = 'activeTimer'
const PENDING_KEY = 'pendingTimerEntry'

interface TimerState {
  taskId: string
  taskTitle: string
  startTime: number
  loggedBy: string
}

export interface StopResult {
  entry: TimeEntry | null
  taskId: string | null
  discarded: boolean   // true when rounded to 0 minutes (< 30 seconds elapsed)
}

interface TimerContextValue {
  timerState: TimerState | null
  elapsed: number               // live seconds since start
  start: (taskId: string, taskTitle: string, loggedBy: string) => void
  stop: () => StopResult        // caller decides what to do with the entry
}

const TimerContext = createContext<TimerContextValue | null>(null)

function readStorage(): TimerState | null {
  try {
    const raw = localStorage.getItem(TIMER_KEY)
    if (!raw) return null
    const p: TimerState = JSON.parse(raw)
    if (p.taskId && p.startTime) return p
  } catch {}
  return null
}

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [timerState, setTimerState] = useState<TimerState | null>(readStorage)
  const [elapsed,    setElapsed]    = useState(0)
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

  function start(taskId: string, taskTitle: string, loggedBy: string) {
    const startTime = Date.now()
    const state: TimerState = { taskId, taskTitle, startTime, loggedBy }
    localStorage.setItem(TIMER_KEY, JSON.stringify(state))
    setTimerState(state)
  }

  function stop(): StopResult {
    if (!timerState) return { entry: null, taskId: null, discarded: false }
    const snap = { ...timerState }
    const elapsedSec = Math.floor((Date.now() - snap.startTime) / 1000)
    localStorage.removeItem(TIMER_KEY)
    setTimerState(null)

    const totalMins = Math.round(elapsedSec / 60)   // round to nearest minute
    if (totalMins === 0) {
      return { entry: null, taskId: snap.taskId, discarded: true }
    }

    const h = Math.floor(totalMins / 60)
    const m = totalMins % 60
    const entry: TimeEntry = {
      id: Math.random().toString(36).slice(2, 10),
      date: new Date().toISOString().slice(0, 10),
      hours: h, minutes: m,
      loggedBy: snap.loggedBy,
      isLocked: true,
      createdAt: new Date().toISOString(),
    }

    // Backup for when Work page isn't mounted yet (cross-page navigation case)
    localStorage.setItem(PENDING_KEY, JSON.stringify({ taskId: snap.taskId, entry }))

    return { entry, taskId: snap.taskId, discarded: false }
  }

  return (
    <TimerContext.Provider value={{ timerState, elapsed, start, stop }}>
      {children}
    </TimerContext.Provider>
  )
}

export function useTimer() {
  const ctx = useContext(TimerContext)
  if (!ctx) throw new Error('useTimer must be used within TimerProvider')
  return ctx
}

export { PENDING_KEY }
