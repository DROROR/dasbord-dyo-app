import { useState, useMemo, useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Plus, LayoutGrid, FileText, BarChart2, Bot, User, Briefcase,
  Settings, X, Check, Pencil, ChevronDown, Trash2, Loader2, TrendingUp,
} from 'lucide-react'
import type { Task, Board, PriorityDef, BoardStatus } from '../types/work'
import { boardAccessRank, eligibleAssigneesForBoard } from '../types/work'
import {
  getTasks,
  createTask as dbCreateTask,
  updateTask as dbUpdateTask,
  getBoards,
  createBoard as dbCreateBoard,
  updateBoard as dbUpdateBoard,
  deleteBoard as dbDeleteBoard,
  getClients,
  getProfiles,
  setResourceAccess,
  generateCustomerMessage,
  createPendingMessage,
  hasWorkReportAccess,
} from '../lib/database'
import type { TicketDoneAnswers } from '../components/work/TaskDetailModal'
import { TIMER_ENTRY_SAVED_EVENT, type TimerEntrySavedDetail } from '../contexts/TimerContext'
import { takeTaskFocus, TASK_FOCUS_EVENT } from '../lib/focusTarget'
import { DEFAULT_PRIORITY_DEFS, INITIAL_BOARDS, DEFAULT_BOARD_STATUSES, priorityDefsForBoard } from '../data/workConstants'
import { VerticalBoard }    from '../components/work/VerticalBoard'
import { MyBoard }          from '../components/work/MyBoard'
import { DocsTab }          from '../components/work/DocsTab'
import { AiTaskCreator }    from '../components/work/AiTaskCreator'
import { TaskDetailModal }  from '../components/work/TaskDetailModal'
import { GanttTab }         from '../components/work/GanttTab'
import { WorkReportTab }    from '../components/work/WorkReportTab'
import { useAuth }          from '../hooks/useAuth'
import { useNotifications } from '../contexts/NotificationContext'
import { useWorkLang }          from '../contexts/WorkLanguageContext'
import { AccessDenied }     from '../components/AccessDenied'

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkTab = 'myboard' | 'tasks' | 'gantt' | 'docs' | 'ai' | 'report'

const WORK_TABS: { id: WorkTab; label: string; labelHe?: string; labelEn?: string; icon: LucideIcon }[] = [
  { id: 'myboard', label: 'My Board', labelHe: 'הלוח שלי', labelEn: 'My Board', icon: User },
  { id: 'tasks',   label: 'Tasks', labelHe: 'משימות', labelEn: 'Tasks', icon: LayoutGrid },
  { id: 'gantt',   label: 'Gantt', labelHe: 'גאנט', labelEn: 'Gantt', icon: BarChart2 },
  { id: 'docs',    label: 'Documentation', labelHe: 'דוקומנטציה', labelEn: 'Documentation', icon: FileText },
  { id: 'ai',      label: 'New Task (AI)', labelHe: 'משימה חדשה (AI)', labelEn: 'New Task (AI)', icon: Bot },
  { id: 'report',  label: 'Work Report',   labelHe: 'דוח עבודה', labelEn: 'Work Report', icon: TrendingUp },
]

function newId() { return Math.random().toString(36).slice(2, 10) }

async function loadWithRetry<T>(load: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await load()
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) {
        await new Promise(resolve => window.setTimeout(resolve, 300 * (attempt + 1)))
      }
    }
  }
  throw lastError
}

// ─── AddBoardModal ────────────────────────────────────────────────────────────

function AddBoardModal({ onSave, onClose }: {
  onSave: (b: Board) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')

  function submit() {
    if (!name.trim()) return
    onSave({
      id: name.toLowerCase().replace(/\s+/g, '_') + '_' + newId(),
      name: name.trim(),
      isDefault: false,
      // Starts empty, not populated by name — board.access is keyed by
      // profile UUID and enforced by RLS (has_board_access()). Creating a
      // board requires work:'full', which already bypasses per-board
      // checks, so the creator sees it immediately without an explicit
      // entry; specific people are granted afterwards via Access Control.
      access: {},
      statuses: DEFAULT_BOARD_STATUSES,
      priorities: DEFAULT_PRIORITY_DEFS,
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

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      dir={workDir}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        enabled ? 'bg-primary' : 'bg-gray-200'
      }`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
        enabled ? 'translate-x-4.5' : 'translate-x-0.5'
      }`} />
    </button>
  )
}

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

function BoardSettingsModal({ board, profiles, canManagePermissions, priorityDefs, tasks, onSave, onAccessChange, onDelete, onClose }: {
  board: Board
  profiles: { id: string; name: string }[]
  canManagePermissions: boolean
  priorityDefs: PriorityDef[]
  tasks: Task[]
  onSave: (b: Board, p: PriorityDef[]) => void
  onAccessChange: (boardId: string, access: Record<string, string>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [name,       setName]       = useState(board.name)
  // Access is saved immediately per change (see changeAccess below) via
  // update-resource-access, not batched into the Save button with
  // name/statuses/priorities — board.access is no longer client-writable
  // through the ordinary update path at all.
  const [access,     setAccess]     = useState(board.access)
  const [savingAccessFor, setSavingAccessFor] = useState<string | null>(null)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [pDefs,      setPDefs]      = useState(priorityDefs)
  const [statuses,   setStatuses]   = useState<BoardStatus[]>(board.statuses ?? DEFAULT_BOARD_STATUSES)
  const [allTasksToSupportQueue, setAllTasksToSupportQueue] = useState(board.allTasksToSupportQueue ?? false)
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
  const [tab, setTab]               = useState<'access' | 'priorities' | 'statuses'>(canManagePermissions ? 'access' : 'priorities')

  const boardTasks = tasks.filter(t => t.board === board.id)

  // Saves immediately through update-resource-access — access is no
  // longer part of the batched "Save" button (see onSave below).
  async function changeAccess(profileId: string, level: AL) {
    setSavingAccessFor(profileId)
    setAccessError(null)
    try {
      const next = await setResourceAccess('boards', board.id, profileId, level)
      setAccess(next as Record<string, AL>)
      onAccessChange(board.id, next)
    } catch (err) {
      setAccessError(err instanceof Error ? err.message : 'השמירה נכשלה')
    } finally {
      setSavingAccessFor(null)
    }
  }

  function addPriority() {
    if (!newPLabel.trim()) return
    const col = COLOR_OPTIONS[pDefs.length % COLOR_OPTIONS.length]
    let id = newPLabel.toLowerCase().replace(/\s+/g, '_')
    // Guarantee a unique id even if the slugified label collides with
    // an id already used elsewhere on this board — e.g. an earlier
    // priority whose LABEL was later renamed (label-only edits never
    // touch id, see savePriorityLabel) can leave its original slug
    // "looking free" while still being claimed. Every priority on a
    // board must have a unique id — this is the root cause of the
    // known duplicate id "high" on the development board, fixed here
    // so it can't happen again going forward.
    if (pDefs.some(p => p.id === id)) id = `${id}_${newId()}`
    setPDefs(p => [...p, { id, label: newPLabel.trim(), textCls: col.text, bgCls: col.bg, dotCls: col.dot, borderCls: col.border }])
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
          {(canManagePermissions ? (['access', 'priorities', 'statuses'] as const) : (['priorities', 'statuses'] as const)).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${tab === t ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {t === 'access' ? 'Access Control' : t === 'priorities' ? 'Priorities' : 'Statuses'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {/* Access tab — only ever rendered/reachable when canManagePermissions,
              but the real enforcement is update-resource-access's own
              can_manage_permissions() check server-side, not this gate. */}
          {tab === 'access' && canManagePermissions && (
            <div className="flex flex-col gap-2">
              {statuses.some(s => s.ownerId) && (
                <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                  משתמשים שאחראים על סטטוס (ראו לשונית Statuses) לא ניתן להגביל מתחת ל-View — יש להסיר קודם את האחריות על הסטטוס.
                </p>
              )}
              {profiles.map(p => {
                const isStatusOwner = statuses.some(s => s.ownerId === p.id)
                return (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 flex-1">
                    {p.name}
                    {isStatusOwner && (
                      <span className="ml-1.5 text-[9px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">אחראי סטטוס</span>
                    )}
                  </span>
                  {savingAccessFor === p.id && <Loader2 size={12} className="text-gray-400 animate-spin" />}
                  <select
                    value={(access[p.id] ?? 'none') as AL}
                    disabled={savingAccessFor === p.id}
                    onChange={e => {
                      const next = e.target.value as AL
                      // Belt-and-suspenders alongside the disabled <option>
                      // below — a status owner can never be dropped below
                      // 'view' from this picker. The real, authoritative
                      // block is the enforce_board_access_rules DB trigger;
                      // this just keeps the UI from even offering the
                      // choice, per the same "explain first" requirement.
                      if (isStatusOwner && next === 'none') return
                      void changeAccess(p.id, next)
                    }}
                    title={isStatusOwner ? 'אחראי על סטטוס בבורד זה — יש להסיר קודם את האחריות על הסטטוס לפני הגבלת הגישה מתחת ל-View' : undefined}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-primary disabled:opacity-50"
                  >
                    {ACCESS_LEVELS.map(l => (
                      <option key={l} value={l} disabled={isStatusOwner && l === 'none'}>
                        {AL_LABELS[l]}{isStatusOwner && l === 'none' ? ' (חסום — אחראי סטטוס)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                )
              })}
              {accessError && <p className="text-xs text-red-500 mt-1">{accessError}</p>}
            </div>
          )}

          {/* Priorities tab */}
          {tab === 'priorities' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-primary/[0.04] border border-primary/10">
                <Toggle enabled={allTasksToSupportQueue} onChange={() => setAllTasksToSupportQueue(v => !v)} />
                <span className="text-xs text-gray-700 flex-1">כל המשימות בבורד הזה נכנסות לתור התמיכה</span>
              </div>

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
                    <div className="flex items-center gap-1.5 shrink-0" title="הצג בתור התמיכה המשותף">
                      <Toggle
                        enabled={!!p.showInSupportQueue}
                        onChange={() => setPDefs(prev => prev.map((pr, i) => i !== idx ? pr : { ...pr, showInSupportQueue: !pr.showInSupportQueue }))}
                      />
                    </div>
                    <div className="flex gap-0.5">
                      {COLOR_OPTIONS.map(c => (
                        <button key={c.label} title={c.label} onClick={() => changePriorityColor(idx, c)} className={`w-4 h-4 rounded-full border-2 ${c.dot} ${p.dotCls === c.dot ? 'border-gray-600' : 'border-transparent'}`} />
                      ))}
                    </div>
                    <button onClick={() => startEditPriority(idx)} className="p-1 text-gray-300 hover:text-primary transition-colors"><Pencil size={11} /></button>
                    <button onClick={() => deletePriority(idx)} className="p-1 text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={11} /></button>
                  </div>
                ))}
                <p className="text-[10px] text-gray-400">המתג ליד כל עדיפות: הצג בתור התמיכה המשותף</p>
                <div className="flex gap-2 mt-1 pt-2 border-t border-gray-100">
                  <input value={newPLabel} onChange={e => setNewPLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPriority() }} placeholder="New priority..." className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary" />
                  <button onClick={addPriority} disabled={!newPLabel.trim()} className="px-2.5 py-1.5 bg-primary text-white text-xs rounded-lg hover:bg-primary/90 disabled:opacity-40"><Plus size={11} /></button>
                </div>
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
                        value={s.ownerId ?? ''}
                        onChange={e => {
                          const ownerId = e.target.value || undefined
                          const owner   = ownerId ? profiles.find(p => p.id === ownerId)?.name : undefined
                          setStatuses(prev => prev.map((st, i) => i !== idx ? st : { ...st, ownerId, owner }))
                        }}
                        className="text-[11px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:border-primary text-gray-600 shrink-0 max-w-[110px]"
                        title="Status owner — responsible employee (only active users can be selected)"
                      >
                        <option value="">Unassigned</option>
                        {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
          <button onClick={() => { onSave({ ...board, name, access, statuses, allTasksToSupportQueue }, pDefs); onClose() }} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors">
            <Check size={13} /> Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Work ─────────────────────────────────────────────────────────────────────

export function Work() {
  const { profile, hasPermission, canManagePermissions, isOwner }  = useAuth()
  const { addNotification }   = useNotifications()
  const { t: tr, dir: workDir } = useWorkLang()
  const currentUser           = profile?.name ?? 'Dror'
  const canViewWork  = hasPermission('work', 'view')
  const canEdit      = hasPermission('work', 'edit')
  const canManageWork = hasPermission('work', 'full')
  const canViewDocs   = hasPermission('work_docs', 'view')
  const canCreateDocs = hasPermission('work_docs', 'full')

  // Owner is unconditional; anyone else needs an explicit grant in
  // work_report_access, checked server-side by has_work_report_access()
  // — fetched once so the tab can be hidden entirely for anyone without
  // it, per "unauthorized users must not see the tab". This is UX only:
  // the real gate is inside get_work_report() itself, re-checked on
  // every call regardless of what this flag says client-side.
  const [canViewReport, setCanViewReport] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (isOwner) { if (!cancelled) setCanViewReport(true); return }
      try {
        const v = await hasWorkReportAccess()
        if (!cancelled) setCanViewReport(v)
      } catch {
        if (!cancelled) setCanViewReport(false)
      }
    })()
    return () => { cancelled = true }
  }, [isOwner, profile?.id])

  const [tab,          setTab]          = useState<WorkTab>('myboard')
  const [boards,       setBoards]       = useState<Board[]>(INITIAL_BOARDS)
  const [activeBoard,  setActiveBoard]  = useState(INITIAL_BOARDS[0].id)
  const [tasks,        setTasks]        = useState<Task[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  // INITIAL_BOARDS (the seed constant `boards` starts as) never carries a
  // live statusOwnerId/access map — it's a static fallback for a brand-new
  // project. Status-owner routing and per-board access must never be
  // computed against it. Previously only tasksLoading gated My
  // Board/Tasks/Gantt rendering, so on a fresh page load where the tasks
  // fetch happened to resolve before the boards fetch, routing/access
  // logic ran against stale seed data for at least one render — a task
  // that should have been routed away by status ownership would briefly
  // (or, if the boards fetch failed silently, indefinitely) still show up
  // for its original assignee. Gate on both.
  const [boardsLoading, setBoardsLoading] = useState(true)
  const [openId,       setOpenId]       = useState<string | null>(null)
  const [showAddBoard, setShowAddBoard] = useState(false)
  const [settingsBoard, setSettingsBoard] = useState<Board | null>(null)
  // Surfaced visibly next to the New Task buttons — a failed creation
  // (most commonly: work:'edit' but no 'full' board-access entry, which
  // canCreateInBoard now also catches client-side before the click even
  // reaches the server) must never be a silent no-op.
  const [createTaskError, setCreateTaskError] = useState<string | null>(null)
  // Real clients and real team members — both come from the database so they
  // stay in step with the Clients board and whoever has registered in the panel.
  const [clients,   setClients]   = useState<{ id: string; name: string; phone: string | null }[]>([])
  const [assignees, setAssignees] = useState<string[]>([])
  const [profiles,  setProfiles]  = useState<{ id: string; name: string; isOwner: boolean }[]>([])
  const [isTechnicalSupport, setIsTechnicalSupport] = useState(false)

  const alertsRunRef = useRef(false)
  const tasksRef     = useRef<Task[]>([])
  const deepLinkHandledRef = useRef(false)

  // `profiles` is already filtered to is_active at the source (see the
  // clients/team-members load effect below) — this Set lets MyBoard
  // confirm a status owner is still active before treating a task as
  // routed to them. The server-side clear_status_ownership_on_deactivation
  // trigger already strips ownerId the moment a profile deactivates, but
  // that's a fire-and-forget async cascade; this is a same-render
  // defensive check so a task never appears "routed away" toward someone
  // who can no longer act on it, even in the narrow window before that
  // cascade's effect has been re-fetched into this session's boards state.
  const activeProfileIds = useMemo(() => new Set(profiles.map(p => p.id)), [profiles])

  // RLS (has_board_access) already filters which boards come back from
  // getBoards() — no client-side re-filtering by access needed or done here.
  const visibleBoards = boards

  const activeBoardObj = visibleBoards.find(b => b.id === activeBoard) ?? visibleBoards[0]
  const openTask       = openId ? (tasks.find(t => t.id === openId) ?? null) : null
  // The task's OWN board, not necessarily activeBoardObj — My Board can
  // open a task that lives on a different board than the one currently
  // selected in the Tasks tab.
  const openTaskBoardObj = openTask ? boards.find(b => b.id === openTask.board) : undefined

  // Client-side mirror of has_board_access(board,'comment') — UX gating
  // only, the add_task_comment RPC re-checks this server-side regardless.
  // Only is_owner bypasses; work:'full' (canManageWork) deliberately does
  // not, matching the server-side model.
  function canCommentOnTask(task: Task): boolean {
    if (isOwner) return true
    if (!profile) return false
    const board = boards.find(b => b.id === task.board)
    if (!board) return false
    return boardAccessRank(board.access[profile.id]) >= boardAccessRank('comment')
  }

  // Client-side mirror of "tasks: insert"'s has_board_access(board,'full')
  // half — Bug: the New Task buttons were previously gated on canEdit
  // (has_permission('work','edit')) alone, which says nothing about the
  // per-board access RLS also requires. A user with work:'edit' but no
  // explicit 'full' entry on this specific board's access map saw a live,
  // clickable button that the server silently rejected — canEdit is
  // necessary but not sufficient. This is UX only; has_board_access on
  // the server remains the real, authoritative check.
  function canCreateInBoard(boardId: string): boolean {
    if (isOwner) return true
    if (!profile) return false
    const board = boards.find(b => b.id === boardId)
    if (!board) return false
    return boardAccessRank(board.access[profile.id]) >= boardAccessRank('full')
  }

  // Client-side mirror of "tasks: delete"'s exact rule: owner, or a
  // non-owner with BOTH work:'full' (canManageWork) AND board:'full' on
  // the task's current board. canCreateInBoard already implements the
  // is_owner-bypassed board:'full' half; ANDing it with canManageWork
  // (which is also is_owner-bypassed) reproduces
  // has_permission('work','full') AND has_board_access(board,'full')
  // exactly — work:'edit', board:'view', and board:'comment' alone can
  // never satisfy this. The RLS policy is authoritative; this is UX only.
  function canDeleteTask(task: Task): boolean {
    return canManageWork && canCreateInBoard(task.board)
  }

  // Mirrors the live "tasks: update" RLS policy exactly:
  // has_permission('work','edit') AND has_board_access(board,'full')
  // (Owner bypassed via has_board_access's own bypass, already inside
  // canCreateInBoard). Gates the quick priority/assignee edit controls
  // on task cards — same authorization a full modal edit already
  // requires, nothing broadened. UX only; the server policy is
  // authoritative.
  function canEditTask(task: Task): boolean {
    return canEdit && canCreateInBoard(task.board)
  }

  function canLogTimeOnTask(task: Task): boolean {
    if (!canEdit || !profile) return false
    return canEditTask(task)
      || task.assigneeId === profile.id
      || (task.subtasks ?? []).some(s => s.assigneeId === profile.id && s.status !== 'done')
  }

  // Load tasks from Supabase; run stale alerts once after load
  useEffect(() => {
    void (async () => {
      try {
        const data = await loadWithRetry(() => getTasks())
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
            addNotification({ type: 'review_stale', message: `"${t.title}" has been in ${t.status === 'pending_code_review' ? 'Code' : 'UX'} Review for ${Math.round(hrs)}h`, taskId: t.id, taskTitle: t.title, severity: 'high', dedupeKey: `review_stale:${t.id}:${t.status}` })
            if (reviewer) addNotification({ type: 'review_stale', message: `${reviewer}: review overdue (${Math.round(hrs)}h) for "${t.title}"`, taskId: t.id, taskTitle: t.title, dedupeKey: `review_stale_owner:${t.id}:${t.status}:${reviewer}` })
          })
          data.forEach(t => {
            if (t.board !== 'support') return
            const created = t.statusHistory[0]?.timestamp
            if (!created) return
            const hrs = (Date.now() - new Date(created).getTime()) / 3_600_000
            if (!t.claimed && hrs >= 24) addNotification({ type: 'ticket_unclaimed', message: `Unclaimed support ticket for ${Math.round(hrs)}h: "${t.title}"`, taskId: t.id, taskTitle: t.title, severity: 'high', dedupeKey: `ticket_unclaimed:${t.id}` })
            if (t.status !== 'done' && t.status !== 'archived' && hrs >= 48) addNotification({ type: 'ticket_stale', message: `Unresolved support ticket (${Math.round(hrs)}h): "${t.title}"`, taskId: t.id, taskTitle: t.title, severity: 'high', dedupeKey: `ticket_stale:${t.id}` })
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

  // Load boards from Supabase so they persist and are shared across the whole team.
  // First run seeds the built-in boards, so nothing is lost.
  useEffect(() => {
    void (async () => {
      try {
        const dbBoards = await loadWithRetry(() => getBoards())
        if (dbBoards.length > 0) {
          setBoards(dbBoards)
          setActiveBoard(prev => dbBoards.some(b => b.id === prev) ? prev : dbBoards[0].id)
        }
      } catch (err) {
        console.error('Failed to load boards:', err)
      } finally {
        setBoardsLoading(false)
      }
    })()
  }, [])

  // Open notification targets and durable ?task= deep links after the
  // authenticated task list has loaded. The URL survives login and refresh.
  useEffect(() => {
    if (tasksLoading) return
    const urlTaskId = new URLSearchParams(window.location.search).get('task')
    if (urlTaskId && deepLinkHandledRef.current) return
    const focusId = urlTaskId || takeTaskFocus()
    if (!focusId) return
    const target = tasks.find(t => t.id === focusId)
    if (urlTaskId) deepLinkHandledRef.current = true
    if (!target) return
    const timer = window.setTimeout(() => {
      setTab('tasks')
      setActiveBoard(target.board)
      setOpenId(focusId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [tasksLoading, tasks])

  // Clicking a task notification while already on Work (no navigation, so
  // the mount-time effect above never re-runs and the sessionStorage value
  // sits unread). requestTaskFocus() also dispatches this event for exactly
  // that case; added once at mount, so it reads tasksRef (kept current by
  // the effect below) rather than the `tasks` state closed over at mount.
  useEffect(() => {
    function onTaskFocusRequested(e: Event) {
      const taskId = (e as CustomEvent<string>).detail
      // Clear unconditionally, before the lookup — same as takeTaskFocus()
      // being called first above — so a task not yet loaded can never
      // reopen itself later from a stale sessionStorage entry.
      takeTaskFocus()
      const target = tasksRef.current.find(t => t.id === taskId)
      if (!target) return
      setTab('tasks')
      setActiveBoard(target.board)
      setOpenId(taskId)
    }
    window.addEventListener(TASK_FOCUS_EVENT, onTaskFocusRequested)
    return () => window.removeEventListener(TASK_FOCUS_EVENT, onTaskFocusRequested)
  }, [])

  // Clients and team members come straight from the database, so adding or
  // removing either is picked up here with no code change.
  useEffect(() => {
    void (async () => {
      try {
        const [dbClients, dbProfiles] = await Promise.all([getClients(), getProfiles()])
        setClients(dbClients.map(c => ({ id: c.id, name: c.business_name || c.name, phone: c.phone })))
        // Deactivated profiles must disappear from every assignment/
        // reviewer/status-owner/access selector — filtered once, here,
        // at the source every one of those pickers reads from.
        const activeProfiles = dbProfiles.filter(p => p.is_active)
        setAssignees(activeProfiles.map(p => p.name).filter(Boolean))
        setProfiles(activeProfiles.map(p => ({ id: p.id, name: p.name, isOwner: p.is_owner })))
        setIsTechnicalSupport(
          dbProfiles.find(p => p.id === profile?.id)?.is_technical_support ?? false,
        )
      } catch (err) {
        console.error('Failed to load clients or team members:', err)
      }
    })()
  }, [profile?.id])

  // Keep tasksRef current so event/effect handlers always see latest tasks
  useEffect(() => { tasksRef.current = tasks }, [tasks])

  // TimerContext.stop() already persisted the entry via addTaskTimeEntry
  // and only fires this event once that save is confirmed — this just
  // mirrors the already-authoritative server result into local state,
  // regardless of whether the floating widget or the modal triggered
  // the stop. No RPC call here, so there is exactly one write per stop.
  useEffect(() => {
    function handleTimerEntry(e: Event) {
      const { taskId, entries } = (e as CustomEvent<TimerEntrySavedDetail>).detail
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, timeEntries: entries } : t))
    }
    window.addEventListener(TIMER_ENTRY_SAVED_EVENT, handleTimerEntry)
    return () => window.removeEventListener(TIMER_ENTRY_SAVED_EVENT, handleTimerEntry)
  }, [])

  // Optimistic update + background DB sync
  function updateTask(updated: Task) {
    if (!canEdit) return
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    void dbUpdateTask(updated.id, updated).catch(err => console.error('Task sync failed:', err))
  }

  // Non-optimistic sibling of updateTask(), used only by the Gantt's own
  // drag/resize/drop interactions so they can show a live local preview
  // and only touch shared `tasks` state (or roll their preview back) once
  // the server has actually confirmed the change — reuses the same
  // dbUpdateTask() call updateTask() does, but awaits and rejects instead
  // of swallowing the error, and never applies an unconfirmed write.
  // updateTask()/onUpdate itself (used by TaskDetailModal for every other
  // field edit) is deliberately left untouched.
  async function updateTaskConfirmed(updated: Task): Promise<Task> {
    if (!canEdit) throw new Error('Insufficient permission to edit this task')
    const saved = await dbUpdateTask(updated.id, updated)
    setTasks(prev => prev.map(t => t.id === saved.id ? saved : t))
    return saved
  }

  // Applies an already server-confirmed row (quick priority/assignee
  // edit on a task card — see TaskQuickEdit.tsx) to local state. Never
  // optimistic: by the time this is called, dbUpdateTask() has already
  // awaited and returned the real saved row, so there is nothing left
  // to reconcile in the background.
  function handleTaskSaved(updated: Task) {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  function handleSubtasksChanged(taskId: string, subtasks: NonNullable<Task['subtasks']>) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, subtasks } : t))
  }

  function handleTimeEntriesChanged(taskId: string, timeEntries: Task['timeEntries']) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, timeEntries } : t))
  }

  // Called only after TaskDetailModal has already confirmed the DELETE
  // succeeded server-side — not optimistic, no separate DB call here.
  function handleTaskDeleted(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id))
    setOpenId(null)
  }

  async function createTask(partial: Omit<Task, 'id' | 'createdAt' | 'statusHistory' | 'comments'>) {
    if (!canEdit) return
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
    if (!canEdit || !canCreateInBoard(activeBoard)) return
    setCreateTaskError(null)
    const now = new Date().toISOString()
    try {
      const created = await dbCreateTask({
        title: 'New Task', description: '', assignee: currentUser, assigneeId: profile?.id,
        board: activeBoard, priority: 'medium', status: statusId,
        timeEntries: [], createdAt: now,
        statusHistory: [{ status: statusId, timestamp: now, changedBy: currentUser }],
        comments: [], attachments: [],
      })
      setTasks(prev => [created, ...prev])
      setOpenId(created.id)
    } catch (err) {
      console.error('Failed to create task:', err)
      setCreateTaskError(err instanceof Error ? err.message : 'Failed to create task — please try again.')
    }
  }

  /**
   * A support ticket was closed. Opens the app-update task when the fix needs
   * a release, and prepares the customer message for someone to review.
   */
  async function handleTicketDone(ticket: Task, answers: TicketDoneAnswers) {
    if (!canEdit) return
    const client   = clients.find(c => c.id === ticket.clientId)
    const appName  = client?.name ?? ticket.clientName ?? ''
    const now      = new Date().toISOString()

    if (answers.requiresAppUpdate) {
      const updateBoard = boards.find(b => b.id.startsWith('apps_to_update')) ?? boards.find(b => /apps to update/i.test(b.name))
      if (updateBoard) {
        try {
          const created = await dbCreateTask({
            title: `App update: ${ticket.title}`,
            description:
              `App: ${appName}\n` +
              `Customer: ${ticket.clientName ?? ''}\n` +
              `From support ticket: ${ticket.id}\n` +
              `Completed by: ${currentUser}\n\n` +
              `Fix to include in the next release:\n${ticket.description || ticket.title}`,
            assignee: '',
            board: updateBoard.id,
            priority: ticket.priority,
            status: 'not_started',
            clientId: ticket.clientId,
            clientName: ticket.clientName,
            timeEntries: [],
            createdAt: now,
            statusHistory: [{ status: 'not_started', timestamp: now, changedBy: currentUser }],
            comments: [],
            attachments: [],
            sourceTaskId: ticket.id,
          })
          setTasks(prev => [created, ...prev])
        } catch (err) {
          console.error('Could not create the app update task:', err)
        }
      } else {
        console.warn('No "Apps to update" board found, skipping the update task.')
      }
    }

    if (answers.messageChoice === 'none') return

    try {
      const { summary, message } = await generateCustomerMessage({
        clientName: ticket.clientName ?? '',
        appName,
        taskTitle: ticket.title,
        requiresAppUpdate: answers.requiresAppUpdate,
      })
      await createPendingMessage({
        task_id: ticket.id,
        task_title: ticket.title,
        client_id: ticket.clientId ?? null,
        client_name: ticket.clientName ?? null,
        app_name: appName,
        phone: client?.phone ?? null,
        summary,
        message,
        requires_app_update: answers.requiresAppUpdate,
        status: answers.messageChoice === 'wait' ? 'waiting' : 'pending',
        created_by: currentUser,
      })
    } catch (err) {
      console.error('Could not prepare the customer message:', err)
    }
  }

  function saveBoardSettings(updated: Board, newPDefs: PriorityDef[]) {
    if (!canManageWork) return
    // Priorities are saved on the board itself, so edits survive a refresh.
    const withPriorities: Board = { ...updated, priorities: newPDefs }
    setBoards(prev => prev.map(b => b.id === withPriorities.id ? withPriorities : b))
    void dbUpdateBoard(withPriorities).catch(err => console.error('Board save failed:', err))
  }

  function deleteBoard(id: string) {
    if (!canManageWork) return
    setBoards(prev => prev.filter(b => b.id !== id))
    if (activeBoard === id) setActiveBoard(INITIAL_BOARDS[0].id)
    void dbDeleteBoard(id).catch(err => console.error('Board delete failed:', err))
  }

  if (!canViewWork) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 text-gray-400">
        <Briefcase size={48} className="opacity-20" />
        <p className="text-base font-medium">אין לך גישה למודול העבודה</p>
        <p className="text-sm text-gray-300">צור קשר עם מנהל המערכת לקבלת הרשאות</p>
      </div>
    )
  }

  return (
    <div
      dir={workDir}
      translate="no"
      className="notranslate flex flex-col -m-6 w-full max-w-full min-w-0"
      style={{ height: 'calc(100vh - 64px)' }}
    >

      {/* Tab bar */}
      <nav className="flex items-center gap-0 border-b border-gray-200 bg-white px-6 shrink-0 overflow-x-auto">
        {WORK_TABS.filter(t => (t.id !== 'ai' || canEdit) && (t.id !== 'docs' || canViewDocs) && (t.id !== 'report' || canViewReport)).map(t => {
          const Icon   = t.icon
          const active = tab === t.id
          const label  = t.labelHe && t.labelEn ? tr(t.labelHe, t.labelEn) : t.label
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${active ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}
            >
              <Icon size={14} />
              {label}
              {t.id === 'ai' && <span className="ml-0.5 bg-accent text-white text-[8px] font-bold px-1.5 py-px rounded-full leading-none">AI</span>}
            </button>
          )
        })}
      </nav>

      {/* Content */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col px-6 pt-5 pb-0">

        {(tasksLoading || boardsLoading) && (tab === 'myboard' || tab === 'tasks' || tab === 'gantt') && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-primary opacity-50" />
          </div>
        )}

        {!tasksLoading && !boardsLoading && tab === 'myboard' && (
          <MyBoard
            tasks={tasks}
            boards={boards}
            currentUser={currentUser}
            myProfileId={profile?.id}
            onOpenTask={setOpenId}
            isTechnicalSupport={isTechnicalSupport}
            activeProfileIds={activeProfileIds}
            canEditTask={canEditTask}
            allProfiles={profiles}
            onTaskSaved={handleTaskSaved}
            canMoveTask={canDeleteTask}
          />
        )}

        {!tasksLoading && !boardsLoading && tab === 'tasks' && (
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
                    {canManageWork && (
                      <button onClick={() => setSettingsBoard(b)} className={`p-1.5 rounded-lg transition-colors ${active ? 'text-primary hover:bg-primary/10' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`} title="Board settings">
                        <Settings size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
              {canManageWork && (
                <button onClick={() => setShowAddBoard(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-dashed border-gray-300 text-gray-400 hover:border-primary hover:text-primary transition-colors whitespace-nowrap">
                  <Plus size={13} /> Add Board
                </button>
              )}
              <div className="flex-1" />
              {canEdit && (
                <button
                  onClick={() => addTaskWithStatus('not_started')}
                  disabled={!canCreateInBoard(activeBoard)}
                  title={canCreateInBoard(activeBoard) ? undefined : 'אין לך גישה מלאה ללוח הזה — פנה למנהל כדי לקבל הרשאת Full לפני יצירת משימות כאן'}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-colors shadow-sm shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary"
                >
                  <Plus size={14} /> New Task
                </button>
              )}
            </div>

            {createTaskError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 shrink-0 flex items-center justify-between gap-3">
                <span>{createTaskError}</span>
                <button onClick={() => setCreateTaskError(null)} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
              </p>
            )}

            <VerticalBoard
              tasks={tasks}
              boards={visibleBoards}
              activeBoardId={activeBoard}
              onOpenTask={setOpenId}
              onAddTask={addTaskWithStatus}
              assignees={assignees}
              readonly={!canEdit || !canCreateInBoard(activeBoard)}
              canEditTask={canEditTask}
              eligibleAssigneesFor={task => eligibleAssigneesForBoard(boards.find(b => b.id === task.board), profiles)}
              onTaskSaved={handleTaskSaved}
              onBoardFilterChange={setActiveBoard}
              canMoveTask={canDeleteTask}
              profiles={profiles}
            />
          </div>
        )}

        {!tasksLoading && !boardsLoading && tab === 'gantt' && (
          <GanttTab
            tasks={tasks}
            boards={visibleBoards}
            assignees={assignees}
            profiles={profiles}
            onOpenTask={setOpenId}
            onUpdateTask={updateTaskConfirmed}
            readonly={!canEdit}
          />
        )}

        {tab === 'docs' && (
          canViewDocs ? (
            <DocsTab
              profiles={profiles}
              canManagePermissions={canManagePermissions}
              canCreate={canCreateDocs}
            />
          ) : (
            // Defense in depth: the tab bar already hides this tab when
            // !canViewDocs, but `tab` state could otherwise be forced.
            <AccessDenied />
          )
        )}

        {tab === 'ai' && (
          <AiTaskCreator
            boards={visibleBoards}
            priorityDefs={priorityDefsForBoard(activeBoardObj)}
            assignees={assignees}
            clients={clients}
            onCreateTask={createTask}
          />
        )}

        {tab === 'report' && (
          canViewReport ? (
            <WorkReportTab
              isOwner={isOwner}
              myProfileId={profile?.id}
              tasks={tasks}
              onOpenTask={setOpenId}
            />
          ) : (
            // Defense in depth: the tab bar already hides this tab without
            // access, and get_work_report()/has_work_report_access() are
            // the real, unconditional server-side gate regardless of
            // whatever `tab` state the client is in — this just avoids
            // rendering the report UI shell for a forced tab value.
            <AccessDenied />
          )
        )}
      </div>

      {/* Modals */}
      {openTask && (
        <TaskDetailModal
          task={openTask}
          onClose={() => setOpenId(null)}
          onUpdate={updateTask}
          onDeleted={handleTaskDeleted}
          currentUser={currentUser}
          currentUserId={profile?.id}
          priorityDefs={priorityDefsForBoard(openTaskBoardObj)}
          eligibleAssignees={eligibleAssigneesForBoard(openTaskBoardObj, profiles)}
          clients={clients}
          assignees={assignees}
          boardLabel={openTaskBoardObj?.name ?? openTask.board}
          boardStatuses={openTaskBoardObj?.statuses}
          isTechnicalSupport={isTechnicalSupport}
          boardAllTasksToSupportQueue={openTaskBoardObj?.allTasksToSupportQueue}
          openTicketsForClient={
            openTask.clientId
              ? tasks.filter(t =>
                  t.id !== openTask.id &&
                  t.board === 'support' &&
                  t.clientId === openTask.clientId &&
                  t.status !== 'done' && t.status !== 'archived',
                ).length
              : 0
          }
          onTicketDone={handleTicketDone}
          canComment={canCommentOnTask(openTask)}
          canDelete={canDeleteTask(openTask)}
          readonly={!canEditTask(openTask)}
          canMoveBoard={canDeleteTask(openTask)}
          eligibleMoveBoards={boards.filter(b => b.id !== openTask.board && canCreateInBoard(b.id))}
          profiles={profiles}
          onMoved={handleTaskSaved}
          canManageSubtasks={canEditTask(openTask)}
          canLogTime={canLogTimeOnTask(openTask)}
          canEditWork={canEdit}
          onSubtasksChanged={handleSubtasksChanged}
          onTimeEntriesChanged={handleTimeEntriesChanged}
        />
      )}

      {showAddBoard && canManageWork && (
        <AddBoardModal
          onSave={b => { setBoards(prev => [...prev, b]); void dbCreateBoard(b).catch(err => console.error('Board create failed:', err)) }}
          onClose={() => setShowAddBoard(false)}
        />
      )}

      {settingsBoard && canManageWork && (
        <BoardSettingsModal
          board={settingsBoard}
          profiles={profiles}
          canManagePermissions={canManagePermissions}
          priorityDefs={priorityDefsForBoard(settingsBoard)}
          tasks={tasks}
          onSave={saveBoardSettings}
          onAccessChange={(boardId, access) => setBoards(prev => prev.map(b => b.id === boardId ? { ...b, access: access as Board['access'] } : b))}
          onDelete={() => deleteBoard(settingsBoard.id)}
          onClose={() => setSettingsBoard(null)}
        />
      )}
    </div>
  )
}
