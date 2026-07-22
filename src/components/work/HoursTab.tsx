import { useState, useEffect, useMemo } from 'react'
import {
  Clock, Plus, Trash2, Loader2, ChevronLeft, ChevronRight, Check, Pencil, X,
} from 'lucide-react'
import {
  getTimeLogs, addTimeLog, updateTimeLog, deleteTimeLog,
} from '../../lib/database'
import type { DbTimeLog } from '../../lib/database'

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const round1 = (n: number) => Math.round(n * 10) / 10

function fmtDayHeader(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

interface Props {
  currentUser: string
  userId: string | null
  isAdmin: boolean
}

export function HoursTab({ currentUser, userId, isAdmin }: Props) {
  const today = new Date()
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() }) // m: 0-indexed
  const [logs, setLogs] = useState<DbTimeLog[]>([])
  const [loading, setLoading] = useState(true)

  // add form
  const [date, setDate] = useState(isoDate(today))
  const [task, setTask] = useState('')
  const [hours, setHours] = useState('')
  const [saving, setSaving] = useState(false)

  // inline edit
  const [editId, setEditId] = useState<string | null>(null)
  const [editTask, setEditTask] = useState('')
  const [editHours, setEditHours] = useState('')

  const fromDate = `${ym.y}-${pad(ym.m + 1)}-01`
  const lastDay = new Date(ym.y, ym.m + 1, 0).getDate()
  const toDate = `${ym.y}-${pad(ym.m + 1)}-${pad(lastDay)}`
  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  async function load() {
    setLoading(true)
    try {
      setLogs(await getTimeLogs(fromDate, toDate))
    } catch (e) {
      console.error('load time logs failed', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [ym.y, ym.m]) // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(
    () => logs.filter(l => (userId ? l.user_id === userId : l.person === currentUser)),
    [logs, userId, currentUser],
  )
  const myTotal = round1(mine.reduce((s, l) => s + Number(l.hours), 0))

  const teamTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of logs) map.set(l.person, (map.get(l.person) ?? 0) + Number(l.hours))
    return [...map.entries()].map(([person, h]) => ({ person, hours: round1(h) })).sort((a, b) => b.hours - a.hours)
  }, [logs])

  // group my entries by date
  const grouped = useMemo(() => {
    const map = new Map<string, DbTimeLog[]>()
    for (const l of mine) {
      const arr = map.get(l.work_date) ?? []
      arr.push(l)
      map.set(l.work_date, arr)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [mine])

  async function add() {
    const h = Number(hours)
    if (!task.trim() || !h || h <= 0) return
    setSaving(true)
    try {
      await addTimeLog({ user_id: userId, person: currentUser, work_date: date, task: task.trim(), hours: h })
      setTask('')
      setHours('')
      await load()
    } catch (e) {
      console.error('add time log failed', e)
    } finally {
      setSaving(false)
    }
  }

  function startEdit(l: DbTimeLog) {
    setEditId(l.id)
    setEditTask(l.task)
    setEditHours(String(l.hours))
  }
  async function saveEdit(id: string) {
    const h = Number(editHours)
    await updateTimeLog(id, { task: editTask.trim(), hours: h > 0 ? h : 0 })
    setEditId(null)
    await load()
  }
  async function remove(id: string) {
    setLogs(prev => prev.filter(l => l.id !== id))
    await deleteTimeLog(id)
  }

  const changeMonth = (dir: -1 | 1) => setYm(({ y, m }) => {
    const nm = m + dir
    if (nm < 0) return { y: y - 1, m: 11 }
    if (nm > 11) return { y: y + 1, m: 0 }
    return { y, m: nm }
  })

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-6">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Month nav + my total */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button onClick={() => changeMonth(-1)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-primary transition-colors"><ChevronLeft size={16} /></button>
            <span className="text-sm font-semibold text-gray-800 min-w-[130px] text-center">{monthLabel}</span>
            <button onClick={() => changeMonth(1)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-primary transition-colors"><ChevronRight size={16} /></button>
          </div>
          <div className="flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-xl px-4 py-2">
            <Clock size={16} className="text-primary" />
            <span className="text-sm text-gray-500">My hours this month:</span>
            <span className="text-lg font-bold text-primary">{myTotal}h</span>
          </div>
        </div>

        {/* Admin: team totals */}
        {isAdmin && teamTotals.length > 0 && (
          <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Team this month</p>
            <div className="flex flex-wrap gap-2">
              {teamTotals.map(t => (
                <div key={t.person} className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-1.5">
                  <span className="text-sm text-gray-700">{t.person}</span>
                  <span className="text-sm font-bold text-primary">{t.hours}h</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add entry */}
        <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-semibold text-gray-800 mb-3">Log time</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <label className="text-xs text-gray-400">What did you do?</label>
              <input value={task} onChange={e => setTask(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
                placeholder="e.g. Built the hours tab"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
            </div>
            <div className="flex flex-col gap-1 w-24">
              <label className="text-xs text-gray-400">Hours</label>
              <input type="number" min={0} step={0.25} value={hours} onChange={e => setHours(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
                placeholder="2.5"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
            </div>
            <button onClick={add} disabled={saving || !task.trim() || !Number(hours)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
            </button>
          </div>
        </div>

        {/* Entries */}
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-primary/50" /></div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-300">
            <Clock size={32} className="mb-2" />
            <p className="text-sm">No hours logged for {monthLabel} yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(([day, rows]) => {
              const dayTotal = round1(rows.reduce((s, r) => s + Number(r.hours), 0))
              return (
                <div key={day}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500">{fmtDayHeader(day)}</span>
                    <span className="text-xs font-medium text-gray-400">{dayTotal}h</span>
                  </div>
                  <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
                    {rows.map(l => (
                      <div key={l.id} className="flex items-center gap-3 px-4 py-3">
                        {editId === l.id ? (
                          <>
                            <input value={editTask} onChange={e => setEditTask(e.target.value)}
                              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary" />
                            <input type="number" min={0} step={0.25} value={editHours} onChange={e => setEditHours(e.target.value)}
                              className="w-20 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary" />
                            <button onClick={() => saveEdit(l.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"><Check size={15} /></button>
                            <button onClick={() => setEditId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X size={15} /></button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-sm text-gray-800">{l.task}</span>
                            <span className="text-sm font-semibold text-primary tabular-nums">{round1(Number(l.hours))}h</span>
                            <button onClick={() => startEdit(l)} className="p-1.5 text-gray-300 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"><Pencil size={13} /></button>
                            <button onClick={() => remove(l.id)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={13} /></button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
