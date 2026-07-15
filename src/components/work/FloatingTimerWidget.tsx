import { useState, useEffect, useRef } from 'react'
import { Square, Timer, GripVertical } from 'lucide-react'
import { useTimer } from '../../contexts/TimerContext'

const POSITION_KEY = 'timerWidgetPos'

function fmtTimer(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':')
}

function getSavedPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (typeof p.x === 'number' && typeof p.y === 'number') return p
    }
  } catch {}
  return { x: 24, y: Math.max(0, window.innerHeight - 130) }
}

export function FloatingTimerWidget({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { timerState, elapsed, stop } = useTimer()
  const [pos,      setPos]      = useState<{ x: number; y: number }>(getSavedPos)
  const [dragging, setDragging] = useState(false)

  const posRef     = useRef(pos)
  const dragOffset = useRef({ dx: 0, dy: 0 })

  useEffect(() => { posRef.current = pos }, [pos])

  // Drag window listeners — attach only while dragging
  useEffect(() => {
    if (!dragging) return
    function onMouseMove(e: MouseEvent) {
      const x = Math.max(0, Math.min(window.innerWidth  - 280, e.clientX - dragOffset.current.dx))
      const y = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.current.dy))
      setPos({ x, y })
    }
    function onMouseUp() {
      setDragging(false)
      localStorage.setItem(POSITION_KEY, JSON.stringify(posRef.current))
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [dragging])

  if (!timerState) return null

  function onGripMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    setDragging(true)
    dragOffset.current = { dx: e.clientX - posRef.current.x, dy: e.clientY - posRef.current.y }
  }

  function stopTimer() {
    const result = stop()
    if (result.entry && result.taskId) {
      // Dispatch event so Work page (if mounted) can update the task immediately
      window.dispatchEvent(new CustomEvent('timerEntrySaved', {
        detail: { taskId: result.taskId, entry: result.entry },
      }))
    }
    // pendingTimerEntry localStorage backup is already written by context.stop()
  }

  return (
    <div
      style={{ left: pos.x, top: pos.y, position: 'fixed', zIndex: 100 }}
      className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl shadow-xl px-3 py-3 select-none"
    >
      {/* Drag handle */}
      <div
        onMouseDown={onGripMouseDown}
        className={`text-gray-300 hover:text-gray-400 transition-colors shrink-0 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        title="Drag to move"
      >
        <GripVertical size={14} />
      </div>

      {/* Timer info */}
      <div
        className="flex flex-col gap-0.5 cursor-pointer min-w-0"
        onClick={() => onNavigate('work')}
        title="Go to task"
      >
        <span className="flex items-center gap-1 text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
          <Timer size={10} className="text-primary shrink-0" />
          Active Timer
        </span>
        <span className="text-sm font-semibold text-gray-800 max-w-[170px] truncate">
          {timerState.taskTitle}
        </span>
        <span className="text-lg font-bold font-mono text-primary tabular-nums leading-tight">
          {fmtTimer(elapsed)}
        </span>
      </div>

      {/* Stop button */}
      <button
        onClick={stopTimer}
        className="flex items-center gap-1.5 px-3 py-2 bg-red-100 text-red-600 hover:bg-red-200 rounded-xl text-xs font-bold transition-colors shrink-0"
        title="Stop and save"
      >
        <Square size={11} /> Stop
      </button>
    </div>
  )
}
