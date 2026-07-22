import { useState, useMemo, useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Plus, LayoutGrid, FileText, BarChart2, Bot, User, Briefcase,
  Settings, X, Check, Pencil, ChevronDown, Trash2, Loader2, Clock,
} from 'lucide-react'
import type { Task, Board, PriorityDef, WorkDoc, BoardStatus } from '../types/work'
import { ASSIGNEES, MOCK_CLIENTS, MOCK_DOCS } from '../data/workMockData'
import {
  getTasks,
  createTask as dbCreateTask,
  updateTask as dbUpdateTask,
} from '../lib/database'
import { PENDING_KEY } from '../contexts/TimerContext'
import { DEFAULT_PRIORITY_DEFS, INITIAL_BOARDS, DEFAULT_BOARD_STATUSES } from '../data/workConstants'
import { VerticalBoard }    from '../components/work/VerticalBoard'
import { MyBoard }          from '../components/work/MyBoard'
import { DocsTab }          from '../components/work/DocsTab'
import { AiTaskCreator }    from '../components/work/AiTaskCreator'
import { TaskDetailModal }  from '../components/work/TaskDetailModal'
import { GanttTab }         from '../components/work/GanttTab'
import { HoursTab }         from '../components/work/HoursTab'
import { useAuth }          from '../hooks/useAuth'
import { useNotifications } from '../contexts/NotificationContext'

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkTab = 'myboard' | 'hours' | 'tasks' | 'gantt' | 'docs' | 'ai'

const WORK_TABS: { id: WorkTab; label: string; icon: LucideIcon }[] = [
  { id: 'myboard', label: 'My Board',      icon: User       },
  { id: 'hours',   label: 'Hours',         icon: Clock      },
  { id: 'tasks',   label: 'Tasks',         icon: LayoutGrid },
  { id: 'gantt',   label: 'Gantt',         icon: BarChart2  },
  { id: 'docs',    label: 'Docs',          icon: FileText   },
  { id: 'ai',      label: 'New Task (AI)', icon: Bot        },
]

function newId() { return Math.random().toString(36).slice(2, 10) }

// ─── AddBoardModal ────────────────────────────────────────────────────────────

function AddBoardModal({ assignees, onSave, onClose }: {
  assignees: string[]
  onSave: (b: Board) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const defaultAccess = Object.fromEntries(assignees.map(a => [a, 'full' as const]))

  function submit() {
    if (!name.trim()) return
    onSave({
      id: name.toLowerCase().replace(/\s+/g, '_') + '_' + newId(),
      name: name.trim(),
      isDefault: false,
      access: defaultAccess,
      statuses: DEFAULT_BOARD_STATUSES,
      createdAt: new Date().toISOString(),
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">New Board</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X size={14} /></button>
        </div>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          placeholder="Board name..."
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
          <button onClick={submit} disabled={!name.trim()} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40">
            <Plus size={13} /> Create Board
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── BoardSettingsModal ───────────────────────────────────────────────────────

const ACCESS_LEVELS = ['none', 'view', 'comment', 'full'] as const
type AL = typeof ACCESS_LEVELS[number]
const AL_LABELS: Record<AL, string> = { none: 'No Access', view: 'View', comment: 'Comment', full: 'Full' }

const COLOR_OPTIONS = [
  { dot: 'bg-red-500',    text: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200',    pill: 'bg-red-100 text-red-700',       left: 'border-l-red-400',    label: 'Red'    },
  { dot: 'bg-orange-500', text: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', pill: 'bg-orange-100 text-orange-700', left: 'border-l-orange-400', label: 'Orange' },
  { dot: 'bg-amber-500',  text: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200',  pill: 'bg-amber-100 text-amber-700',   left: 'border-l-amber-400',  label: 'Amber'  },
  { dot: 'bg-blue-400',   text: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200',   pill: 'bg-blue-100 text-blue-700',     left: 'border-l-blue-400',   label: 'Blue'   },
  { dot: 'bg-purple-500', text: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', pill: 'bg-purple-100 text-purple-700', left: 'border-l-purple-500', label: 'Purple' },
  { dot: 'bg-green-500',  text: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-200',  pill: 'bg-green-100 text-green-700',   left: 'border-l-green-500',  label: 'Green'  },
  { dot: 'bg-pink-400',   text: 'text-pink-600',   bg: 'bg-pink-50',   border: 'border-pink-200',   pill: 'bg-pink-100 text-pink-700',     left: 'border-l-pink-400',   label: 'Pink'   },
  { dot: 'bg-gray-400',   text: 'text-gray-600',   bg: 'bg-gray-50',   border: 'border-gray-200',   pill: 'bg-gray-100 text-gray-600',     left: 'border-l-gray-300',   label: 'Gray'   },
]

function BoardSettingsModal({ board, assignees, priorityDefs, tasks, onSave, onDelete, onClose }: {
  board: Board
  assignees: string[]
  priorityDefs: PriorityDef[]
  tasks: Task[]
  onSave: (b: Board, p: PriorityDef[]) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [name,       setName]       = useState(board.name)
  const [access,     setAccess]     = useState(board.access)
  const [pDefs,      setPDefs]      = useState(priorityDefs)
  const [statuses,   setStatuses]   = useState<BoardStatus[]>(board.statuses ?? DEFAULT_BOARD_STATUSES)
  const [newPLabel,  setNewPLabel]  = useState('')
  const [newSLabel,  setNewSLabel]  = useState('')
  const [newSColor,  setNewSColor]  = useState(0)
  const [editingName, setEditingName] = useState(false)
  const [editPIdx,    setEditPIdx]    = useState<number | null>(null)
  const [editPLabel,  setEditPLabel]  = useState('')
  const [editSIdx,    setEditSIdx]    = useState<number | null>(null)
  const [editSLabel,  setEditSLabel]  = useState('')
  const [editSColorIdx, setEditSColorIdx] = useState(0)
  const [delConfirm, setDelConfirm] = useState<{ type: 'priority' | 'status'; idx: number } | null>(null)
  const [tab, setTab]               = useState<'access' | 'priorities' | 'statuses'>('access')

  const boardTasks = tasks.filter(t => t.board === board.id)

  function addPriority() {
    if (!newPLabel.trim()) return
    const col = COLOR_OPTIONS[pDefs.length % COLOR_OPTIONS.length]
    setPDefs(p => [...p, { id: newPLabel.toLowerCase().replace(/\s+/g, '_'), label: newPLabel.trim(), textCls: col.text, bgCls: col.bg, dotCls: col.dot, borderCls: col.border }])
    setNewPLabel('')
  }

  function changePriorityColor(idx: number, col: typeof COLOR_OPTIONS[number]) {
    setPDefs(prev => prev.map((p, i) => i !== idx ? p : { ...p, textCls: col.text, bgCls: col.bg, dotCls: col.dot, borderCls: col.border }))
  }

  function startEditPriority(idx: number) {
    setEditPIdx(idx); setEditPLabel(pDefs[idx].label)
  }

  function savePriorityLabel(idx: number) {
    if (editPLabel.trim()) setPDefs(prev => prev.map((p, i) => i !== idx ? p : { ...p, label: editPLabel.trim() }))
    setEditPIdx(null)
  }

  function deletePriority(idx: number) {
    const p = pDefs[idx]
    const using = boardTasks.filter(t => t.priority === p.id).length
    if (using > 0) { setDelConfirm({ type: 'priority', idx }); return }
    setPDefs(prev => prev.filter((_, i) => i !== idx))
  }

  function addStatus() {
    if (!newSLabel.trim()) return
    const col = COLOR_OPTIONS[newSColor]
    const maxOrder = Math.max(...statuses.map(s => s.order), -1)
    setStatuses(prev => {
      const nonDone = prev.filter(s => s.id !== 'done' && s.id !== 'archived')
      const tail    = prev.filter(s => s.id === 'done' || s.id === 'archived')
      return [...nonDone, { id: newSLabel.toLowerCase().replace(/\s+/g, '_') + '_' + newId(), label: newSLabel.trim(), pillCls: col.pill, leftBorderCls: col.left, canDelete: true, order: maxOrder + 1 }, ...tail]
    })
    setNewSLabel('')
  }

  function startEditStatus(idx: number) {
    const s = statuses[idx]
    setEditSIdx(idx)
    setEditSLabel(s.label)
    const ci = COLOR_OPTIONS.findIndex(c => c.pill === s.pillCls)
    setEditSColorIdx(ci >= 0 ? ci : 0)
  }

  function saveStatusEdit(idx: number) {
    const col = COLOR_OPTIONS[editSColorIdx]
    setStatuses(prev => prev.map((s, i) => i !== idx ? s : {
      ...s,
      label: editSLabel.trim() || s.label,
      pillCls: col.pill,
      leftBorderCls: col.left,
    }))
    setEditSIdx(null)
  }

  function deleteStatus(idx: number) {
    const s = statuses[idx]
    const using = boardTasks.filter(t => t.status === s.id).length
    if (using > 0) { setDelConfirm({ type: 'status', idx }); return }
    setStatuses(prev => prev.filter((_, i) => i !== idx))
  }

  function moveStatus(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= statuses.length) return
    setStatuses(prev => {
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr.map((s, i) => ({ ...s, order: i }))
    })
  }

  function confirmDelete() {
    if (!delConfirm) return
    if (delConfirm.type === 'priority') setPDefs(prev => prev.filter((_, i) => i !== delConfirm.idx))
    else setStatuses(prev => prev.filter((_, i) => i !== delConfirm.idx))
    setDelConfirm(null)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden" style={{ maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          {editingName ? (
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              onBlur={() => setEditingName(false)} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingName(false) }}
              className="flex-1 text-sm font-semibold border-b-2 border-primary focus:outline-none bg-transparent"
            />
          ) : (
            <button onClick={() => setEditingName(true)} className="flex items-center gap-1.5 flex-1 text-sm font-semibold text-gray-800 hover:text-primary transition-colors text-left">
              {name} <Pencil size={11} className="text-gray-400" />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X size={14} /></button>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {(['access', 'priorities', 'statuses'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${tab === t ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {t === 'access' ? 'Access Control' : t === 'priorities' ? 'Priorities' : 'Statuses'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {/* Access tab */}
          {tab === 'access' && (
            <div className="flex flex-col gap-2">
              {assignees.map(n => (
                <div key={n} className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 flex-1">{n}</span>
                  <select value={(access[n] ?? 'full') as AL} onChange={e => setAccess(prev => ({ ...prev, [n]: e.target.value as AL }))} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-primary">
                    {ACCESS_LEVELS.map(l => <option key={l} value={l}>{AL_LABELS[l]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {/* Priorities tab */}
          {tab === 'priorities' && (
            <div className="flex flex-col gap-2">
              {pDefs.map((p, idx) => (
                <div key={p.id} className="flex items-center gap-2 py-1">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${p.dotCls}`} />
                  {editPIdx === idx ? (
                    <input autoFocus value={editPLabel} onChange={e => setEditPLabel(e.target.value)}
                      onBlur={() => savePriorityLabel(idx)}
                      onKeyDown={e => { if (e.key === 'Enter') savePriorityLabel(idx); if (e.key === 'Escape') setEditPIdx(null) }}
                      className="flex-1 text-sm border-b-2 border-primary focus:outline-none bg-transparent"
                    />
                  ) : (
                    <span className="text-sm text-gray-700 flex-1">{p.label}</span>
                  )}
                  <div className="flex gap-0.5">
                    {COLOR_OPTIONS.map(c => (
                      <button key={c.label} title={c.label} onClick={() => changePriorityColor(idx, c)} className={`w-4 h-4 rounded-full border-2 ${c.dot} ${p.dotCls === c.dot ? 'border-gray-600' : 'border-transparent'}`} />
                    ))}
                  </div>
                  <button onClick={() => startEditPriority(idx)} className="p-1 text-gray-300 hover:text-primary transition-colors"><Pencil size={11} /></button>
                  <button onClick={() => deletePriority(idx)} className="p-1 text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={11} /></button>
                </div>
              ))}
              <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100">
                <input value={newPLabel} onChange={e => setNewPLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPriority() }} placeholder="New priority..." className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary" />
                <button onClick={addPriority} disabled={!newPLabel.trim()} className="px-2.5 py-1.5 bg-primary text-white text-xs rounded-lg hover:bg-primary/90 disabled:opacity-40"><Plus size={11} /></button>
              </div>
            </div>
          )}

          {/* Statuses tab */}
          {tab === 'statuses' && (
            <div className="flex flex-col gap-1.5">
              {statuses.map((s, idx) => (
                <div key={s.id} className={`border rounded-xl overflow-hidden transition-colors ${editSIdx === idx ? 'border-primary/40 bg-primary/[0.02]' : 'border-gray-100'}`}>
                  {editSIdx === idx ? (
                    /* Edit mode */
                    <div className="p-3 flex flex-col gap-2">
                      <input
                        autoFocus
                        value={editSLabel}
                        onChange={e => setEditSLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveStatusEdit(idx); if (e.key === 'Escape') setEditSIdx(null) }}
                        className="text-xs font-medium border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 bg-white"
                        placeholder="Status name..."
                      />
                      <div className="flex flex-wrap gap-1">
                        {COLOR_OPTIONS.map((c, ci) => (
                          <button key={c.label} onClick={() => setEditSColorIdx(ci)} title={c.label}
                            className={`px-2 py-0.5 rounded-full text-[9px] font-semibold border-2 transition-all ${c.pill} ${editSColorIdx === ci ? 'border-gray-700 scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2 justify-end pt-1">
                        <button onClick={() => setEditSIdx(null)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded transition-colors">Cancel</button>
                        <button onClick={() => saveStatusEdit(idx)} className="text-xs font-semibold text-white bg-primary hover:bg-primary/90 px-3 py-1 rounded-lg transition-colors">Save</button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <div className="flex items-center gap-2 px-3 py-2">
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button onClick={() => moveStatus(idx, -1)} disabled={idx === 0} className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors"><ChevronDown size={10} className="rotate-180" /></button>
                        <button onClick={() => moveStatus(idx, 1)} disabled={idx === statuses.length - 1} className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors"><ChevronDown size={10} /></button>
                      </div>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap shrink-0 ${s.pillCls}`}>{s.label}</span>
                      <span className="text-xs text-gray-600 flex-1 truncate min-w-0">{s.label}</span>
                      <select
                        value={s.owner ?? ''}
                        onChange={e => setStatuses(prev => prev.map((st, i) => i !== idx ? st : { ...st, owner: e.target.value || undefined }))}
                        className="text-[11px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:border-primary text-gray-600 shrink-0 max-w-[110px]"
                        title="Status owner"
                      >
                        <option value="">Unassigned</option>
                        {assignees.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <button onClick={() => startEditStatus(idx)} className="p-1 text-gray-300 hover:text-primary transition-colors shrink-0" title="Edit"><Pencil size={11} /></button>
                      {s.canDelete ? (
                        <button onClick={() => deleteStatus(idx)} className="p-1 text-gray-300 hover:text-red-500 transition-colors shrink-0" title="Delete"><Trash2 size={11} /></button>
                      ) : (
                        <span className="text-[10px] text-gray-200 shrink-0 w-5 text-center select-none" title="Protected">🔒</span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Add new status */}
              <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-gray-100">
                <div className="flex gap-2">
                  <input value={newSLabel} onChange={e => setNewSLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addStatus() }} placeholder="New status name..." className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
                  <button onClick={addStatus} disabled={!newSLabel.trim()} className="px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"><Plus size={11} /></button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {COLOR_OPTIONS.map((c, i) => (
                    <button key={c.label} onClick={() => setNewSColor(i)} title={c.label}
                      className={`px-2 py-0.5 rounded-full text-[9px] font-semibold border-2 transition-all ${c.pill} ${newSColor === i ? 'border-gray-700 scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Delete confirmation */}
        {delConfirm && (
          <div className="px-5 py-3 bg-red-50 border-t border-red-100 flex items-center gap-3">
            <p className="text-xs text-red-700 flex-1">
              {(() => {
                if (delConfirm.type === 'priority') {
                  const p = pDefs[delConfirm.idx]
                  const cnt = boardTasks.filter(t => t.priority === p.id).length
                  return `${cnt} task${cnt !== 1 ? 's' : ''} use priority "${p.label}". Delete anyway?`
                } else {
                  const s = statuses[delConfirm.idx]
                  const cnt = boardTasks.filter(t => t.status === s.id).length
                  return `${cnt} task${cnt !== 1 ? 's' : ''} use status "${s.label}". Delete anyway?`
                }
              })()}
            </p>
            <button onClick={() => setDelConfirm(null)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-white">Cancel</button>
            <button onClick={confirmDelete} className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-2 py-1 rounded transition-colors">Delete</button>
          </div>
        )}

        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100">
          {!board.isDefault && (
            <button onClick={() => { onDelete(); onClose() }} className="text-xs text-red-500 hover:text-red-700 transition-colors mr-auto">Delete Board</button>
          )}
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
          <button onClick={() => { onSave({ ...board, name, access, statuses }, pDefs); onClose() }} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors">
            <Check size={13} /> Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Work ─────────────────────────────────────────────────────────────────────

export function Work() {
  const { isAdmin, profile }  = useAuth()
  const { addNotification }   = useNotifications()
  const currentUser           = profile?.name ?? 'Dror'
  const workAccess = isAdmin ? 'full' : ((profile?.permissions?.['work'] as string | undefined) ?? 'full')
  const canEdit    = workAccess === 'edit' || workAccess === 'full'

  const [tab,          setTab]          = useState<WorkTab>('myboard')
  const [boards,       setBoards]       = useState<Board[]>(INITIAL_BOARDS)
  const [activeBoard,  setActiveBoard]  = useState(INITIAL_BOARDS[0].id)
  const [priorityDefs, setPriorityDefs] = useState<PriorityDef[]>(DEFAULT_PRIORITY_DEFS)
  const [tasks,        setTasks]        = useState<Task[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [docs,         setDocs]         = useState<WorkDoc[]>(MOCK_DOCS)
  const [openId,       setOpenId]       = useState<string | null>(null)
  const [showAddBoard, setShowAddBoard] = useState(false)
  const [settingsBoard, setSettingsBoard] = useState<Board | null>(null)

  const alertsRunRef = useRef(false)
  const tasksRef     = useRef<Task[]>([])

  const priorityCfg = useMemo(
    () => Object.fromEntries(priorityDefs.map(p => [p.id, p])),
    [priorityDefs],
  )

  const visibleBoards = useMemo(
    () => boards.filter(b => isAdmin || (b.access[currentUser] ?? 'full') !== 'none'),
    [boards, isAdmin, currentUser],
  )

  const boardTasks = useMemo(
    () => tasks.filter(t => t.board === activeBoard),
    [tasks, activeBoard],
  )

  const activeBoardObj = visibleBoards.find(b => b.id === activeBoard) ?? visibleBoards[0]
  const openTask       = openId ? (tasks.find(t => t.id === openId) ?? null) : null

  // Load tasks from Supabase; run stale alerts once after load
  useEffect(() => {
    void (async () => {
      try {
        const data = await getTasks()
        setTasks(data)
        if (!alertsRunRef.current) {
          alertsRunRef.current = true
          data.forEach(t => {
            if (t.status !== 'pending_code_review' && t.status !== 'pending_ux_review') return
            const entry = [...t.statusHistory].reverse().find(e => e.status === t.status)
            if (!entry) return
            const hrs = (Date.now() - new Date(entry.timestamp).getTime()) / 3_600_000
            if (hrs < 48) return
            const reviewer = t.status === 'pending_code_review' ? t.codeReviewer : t.uxReviewer
            addNotification({ type: 'review_stale', message: `"${t.title}" has been in ${t.status === 'pending_code_review' ? 'Code' : 'UX'} Review for ${Math.round(hrs)}h`, taskId: t.id, taskTitle: t.title, severity: 'high' })
            if (reviewer) addNotification({ type: 'review_stale', message: `${reviewer}: review overdue (${Math.round(hrs)}h) for "${t.title}"`, taskId: t.id, taskTitle: t.title })
          })
          data.forEach(t => {
            if (t.board !== 'support') return
            const created = t.statusHistory[0]?.timestamp
            if (!created) return
            const hrs = (Date.now() - new Date(created).getTime()) / 3_600_000
            if (!t.claimed && hrs >= 24) addNotification({ type: 'ticket_unclaimed', message: `Unclaimed support ticket for ${Math.round(hrs)}h: "${t.title}"`, taskId: t.id, taskTitle: t.title, severity: 'high' })
            if (t.status !== 'done' && t.status !== 'archived' && hrs >= 48) addNotification({ type: 'ticket_stale', message: `Unresolved support ticket (${Math.round(hrs)}h): "${t.title}"`, taskId: t.id, taskTitle: t.title, severity: 'high' })
          })
        }
      } catch (err) {
        console.error('Failed to load tasks:', err)
      } finally {
        setTasksLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep tasksRef current so event/effect handlers always see latest tasks
  useEffect(() => { tasksRef.current = tasks }, [tasks])

  // Real-time: process an entry the floating widget just saved (user is on Work page)
  useEffect(() => {
    function handleTimerEntry(e: Event) {
      const { taskId, entry } = (e as CustomEvent).detail
      // Clear the localStorage backup since we're handling it now
      localStorage.removeItem(PENDING_KEY)
      setTasks(prev => {
        const task = prev.find(t => t.id === taskId)
        if (!task) return prev
        const updated = { ...task, timeEntries: [...(task.timeEntries ?? []), entry] }
        void dbUpdateTask(updated.id, updated).catch(console.error)
        return prev.map(t => t.id === taskId ? updated : t)
      })
    }
    window.addEventListener('timerEntrySaved', handleTimerEntry)
    return () => window.removeEventListener('timerEntrySaved', handleTimerEntry)
  }, [])

  // Fallback: on page mount, pick up any entry saved while Work page was not mounted
  useEffect(() => {
    if (tasksLoading) return
    try {
      const raw = localStorage.getItem(PENDING_KEY)
      if (!raw) return
      localStorage.removeItem(PENDING_KEY)
      const { taskId, entry } = JSON.parse(raw)
      const task = tasksRef.current.find(t => t.id === taskId)
      if (!task) return
      const updated = { ...task, timeEntries: [...(task.timeEntries ?? []), entry] }
      setTasks(prev => prev.map(t => t.id === taskId ? updated : t))
      void dbUpdateTask(updated.id, updated).catch(console.error)
    } catch {}
  }, [tasksLoading])

  // Optimistic update + background DB sync
  function updateTask(updated: Task) {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    void dbUpdateTask(updated.id, updated).catch(err => console.error('Task sync failed:', err))
  }

  function changeStatus(taskId: string, newStatus: string) {
    const now      = new Date().toISOString()
    const newEntry = { status: newStatus, timestamp: now, changedBy: currentUser }
    const task     = tasks.find(t => t.id === taskId)
    const newHistory = task ? [...task.statusHistory, newEntry] : [newEntry]
    setTasks(prev => prev.map(t => t.id !== taskId ? t : { ...t, status: newStatus, statusHistory: newHistory }))
    void dbUpdateTask(taskId, { status: newStatus, statusHistory: newHistory })
      .catch(err => console.error('Status sync failed:', err))

    if (task) {
      if (newStatus === 'done') {
        addNotification({
          type: 'task_done_return',
          message: `המשימה "${task.title}" הושלמה — אנא סגור את המשימה סופית`,
          taskId,
          taskTitle: task.title,
        })
      } else {
        const taskBoard  = boards.find(b => b.id === task.board)
        const statusDef  = taskBoard?.statuses.find(s => s.id === newStatus)
        if (statusDef?.owner) {
          addNotification({
            type: 'status_owner_assigned',
            message: `יש משימה חדשה לבדיקה שלך: ${task.title}`,
            taskId,
            taskTitle: task.title,
          })
        }
      }
    }
  }

  async function createTask(partial: Omit<Task, 'id' | 'createdAt' | 'statusHistory' | 'comments'>) {
    const now = new Date().toISOString()
    try {
      const created = await dbCreateTask({
        ...partial,
        createdAt:     now,
        statusHistory: [{ status: partial.status, timestamp: now, changedBy: currentUser }],
        comments:      [],
        attachments:   partial.attachments ?? [],
      })
      setTasks(prev => [created, ...prev])
      if (partial.board === 'support') {
        addNotification({ type: 'support_opened', message: `New support ticket: ${partial.title}`, taskId: created.id, taskTitle: partial.title, severity: 'high' })
      }
      setTab('tasks')
      setActiveBoard(partial.board)
    } catch (err) {
      console.error('Failed to create task:', err)
    }
  }

  async function addTaskWithStatus(statusId: string) {
    const now = new Date().toISOString()
    try {
      const created = await dbCreateTask({
        title: 'New Task', description: '', assignee: currentUser,
        board: activeBoard, priority: 'medium', status: statusId,
        timeEntries: [], createdAt: now,
        statusHistory: [{ status: statusId, timestamp: now, changedBy: currentUser }],
        comments: [], attachments: [],
      })
      setTasks(prev => [created, ...prev])
      setOpenId(created.id)
    } catch (err) {
      console.error('Failed to create task:', err)
    }
  }

  function saveBoardSettings(updated: Board, newPDefs: PriorityDef[]) {
    setBoards(prev => prev.map(b => b.id === updated.id ? updated : b))
    setPriorityDefs(newPDefs)
  }

  function deleteBoard(id: string) {
    setBoards(prev => prev.filter(b => b.id !== id))
    if (activeBoard === id) setActiveBoard(INITIAL_BOARDS[0].id)
  }

  if (workAccess === 'none') {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 text-gray-400">
        <Briefcase size={48} className="opacity-20" />
        <p className="text-base font-medium">אין לך גישה למודול העבודה</p>
        <p className="text-sm text-gray-300">צור קשר עם מנהל המערכת לקבלת הרשאות</p>
      </div>
    )
  }

  return (
    <div dir="ltr" className="flex flex-col -m-6" style={{ height: 'calc(100vh - 64px)' }}>

      {/* Tab bar */}
      <nav className="flex items-center gap-0 border-b border-gray-200 bg-white px-6 shrink-0 overflow-x-auto">
        {WORK_TABS.filter(t => t.id !== 'ai' || canEdit).map(t => {
          const Icon   = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${active ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}
            >
              <Icon size={14} />
              {t.label}
              {t.id === 'ai' && <span className="ml-0.5 bg-accent text-white text-[8px] font-bold px-1.5 py-px rounded-full leading-none">AI</span>}
            </button>
          )
        })}
      </nav>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-6 pt-5 pb-0">

        {tasksLoading && (tab === 'myboard' || tab === 'tasks' || tab === 'gantt') && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-primary opacity-50" />
          </div>
        )}

        {!tasksLoading && tab === 'myboard' && (
          <MyBoard
            tasks={tasks}
            boards={boards}
            currentUser={currentUser}
            priorityCfg={priorityCfg}
            onOpenTask={setOpenId}
            onStatusChange={changeStatus}
          />
        )}

        {tab === 'hours' && (
          <HoursTab currentUser={currentUser} userId={profile?.id ?? null} isAdmin={isAdmin} />
        )}

        {!tasksLoading && tab === 'tasks' && (
          <div className="flex flex-col gap-4 flex-1 min-h-0">
            {/* Board selector */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {visibleBoards.map(b => {
                const active = activeBoard === b.id
                const count  = tasks.filter(t => t.board === b.id).length
                return (
                  <div key={b.id} className="flex items-center gap-0.5">
                    <button
                      onClick={() => setActiveBoard(b.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all border whitespace-nowrap ${active ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/50 hover:text-primary'}`}
                    >
                      {b.name}
                      <span className={`text-xs px-1.5 py-px rounded-full font-bold leading-none ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
                    </button>
                    {isAdmin && (
                      <button onClick={() => setSettingsBoard(b)} className={`p-1.5 rounded-lg transition-colors ${active ? 'text-primary hover:bg-primary/10' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`} title="Board settings">
                        <Settings size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
              {isAdmin && (
                <button onClick={() => setShowAddBoard(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-dashed border-gray-300 text-gray-400 hover:border-primary hover:text-primary transition-colors whitespace-nowrap">
                  <Plus size={13} /> Add Board
                </button>
              )}
              <div className="flex-1" />
              {canEdit && (
                <button
                  onClick={() => addTaskWithStatus('not_started')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-colors shadow-sm shrink-0"
                >
                  <Plus size={14} /> New Task
                </button>
              )}
            </div>

            <VerticalBoard
              tasks={boardTasks}
              priorityCfg={priorityCfg}
              onOpenTask={setOpenId}
              onStatusChange={changeStatus}
              onAddTask={addTaskWithStatus}
              assignees={ASSIGNEES}
              boardStatuses={activeBoardObj?.statuses}
              readonly={!canEdit}
            />
          </div>
        )}

        {!tasksLoading && tab === 'gantt' && (
          <GanttTab
            tasks={tasks}
            boards={visibleBoards}
            assignees={ASSIGNEES}
            priorityCfg={priorityCfg}
            onOpenTask={setOpenId}
            onUpdateTask={updateTask}
          />
        )}

        {tab === 'docs' && (
          <DocsTab
            docs={docs}
            setDocs={setDocs}
            currentUser={currentUser}
            isAdmin={isAdmin}
            assignees={ASSIGNEES}
          />
        )}

        {tab === 'ai' && (
          <AiTaskCreator
            boards={visibleBoards}
            priorityDefs={priorityDefs}
            assignees={ASSIGNEES}
            clients={MOCK_CLIENTS}
            onCreateTask={createTask}
          />
        )}
      </div>

      {/* Modals */}
      {openTask && (
        <TaskDetailModal
          task={openTask}
          onClose={() => setOpenId(null)}
          onUpdate={updateTask}
          currentUser={currentUser}
          priorityCfg={priorityCfg}
          clients={MOCK_CLIENTS}
          assignees={ASSIGNEES}
          boardLabel={activeBoardObj?.name ?? openTask.board}
          boardStatuses={activeBoardObj?.statuses}
        />
      )}

      {showAddBoard && isAdmin && (
        <AddBoardModal
          assignees={ASSIGNEES}
          onSave={b => setBoards(prev => [...prev, b])}
          onClose={() => setShowAddBoard(false)}
        />
      )}

      {settingsBoard && isAdmin && (
        <BoardSettingsModal
          board={settingsBoard}
          assignees={ASSIGNEES}
          priorityDefs={priorityDefs}
          tasks={tasks}
          onSave={saveBoardSettings}
          onDelete={() => deleteBoard(settingsBoard.id)}
          onClose={() => setSettingsBoard(null)}
        />
      )}
    </div>
  )
}
