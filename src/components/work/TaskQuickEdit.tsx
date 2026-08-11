import { useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { Avatar } from '../Avatar'
import type { Task, PriorityDef, AssigneeOption } from '../../types/work'
import { updateTask as dbUpdateTask } from '../../lib/database'

// Shared by every task-card renderer (VerticalBoard, MyBoard) so
// priority/assignee quick-edit behaves identically everywhere: server-
// confirmed (never optimistic — local UI only updates from the row
// updateTask() actually returns), a visible error on failure, and
// disabled while a save is in flight so a second click can't fire a
// duplicate submission. Both stop propagation on every click so
// opening the popover, or picking an option inside it, never also
// triggers the card's own onClick (which opens the task modal).

// ─── Priority ─────────────────────────────────────────────────────────────────

export function PriorityQuickEdit({
  task, priorityDefs, canEdit, onSaved,
}: {
  task: Task
  /** This task's OWN board's priorities — never a cross-board merged map. */
  priorityDefs: PriorityDef[]
  canEdit: boolean
  onSaved: (updated: Task) => void
}) {
  const [open,    setOpen]    = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const current = priorityDefs.find(p => p.id === task.priority)

  async function choose(id: string) {
    if (saving) return
    if (id === task.priority) { setOpen(false); return }
    setSaving(true)
    setError(null)
    try {
      const updated = await dbUpdateTask(task.id, { priority: id })
      onSaved(updated)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save priority')
    } finally {
      setSaving(false)
    }
  }

  if (!canEdit) {
    return current ? (
      <span className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border shrink-0 ${current.textCls} ${current.bgCls} ${current.borderCls}`}>
        <span className={`w-2 h-2 rounded-full ${current.dotCls}`} />
        {current.label}
      </span>
    ) : null
  }

  return (
    <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-60 ${
          current ? `${current.textCls} ${current.bgCls} ${current.borderCls} hover:brightness-95` : 'text-gray-400 bg-white border-gray-200 hover:border-gray-300'
        }`}
      >
        {saving
          ? <Loader2 size={10} className="animate-spin" />
          : <span className={`w-2 h-2 rounded-full ${current ? current.dotCls : 'bg-gray-300'}`} />}
        {current ? current.label : 'No priority'}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[150px] max-h-64 overflow-y-auto">
            {priorityDefs.map(p => (
              <button
                key={p.id}
                onClick={() => void choose(p.id)}
                disabled={saving}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium text-left hover:bg-gray-50 transition-colors disabled:opacity-50 ${p.id === task.priority ? 'bg-gray-50' : ''}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${p.dotCls}`} />
                <span className={`${p.textCls} flex-1`}>{p.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <div className="absolute left-0 top-full mt-1 z-30 flex items-center gap-1 text-[10px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-2 py-1 whitespace-nowrap">
          <AlertCircle size={10} /> {error}
        </div>
      )}
    </div>
  )
}

// ─── Assignee ─────────────────────────────────────────────────────────────────

export function AssigneeQuickEdit({
  task, eligible, canEdit, onSaved, size = 'xs',
}: {
  task: Task
  /** Active profiles + Owner + non-owner profiles with board access above 'none' on this task's board. */
  eligible: AssigneeOption[]
  canEdit: boolean
  onSaved: (updated: Task) => void
  size?: 'xs' | 'sm'
}) {
  const [open,   setOpen]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  async function choose(opt: AssigneeOption | null) {
    if (saving) return
    if ((opt?.id ?? null) === (task.assigneeId ?? null)) { setOpen(false); return }
    setSaving(true)
    setError(null)
    try {
      // Empty string (not undefined) is this codebase's established
      // "clear this optional field" sentinel in taskToRow() — sending
      // undefined would omit the key entirely and leave the previous
      // value untouched, which is wrong for a genuine unassign.
      const updated = await dbUpdateTask(task.id, { assigneeId: opt?.id ?? '', assignee: opt?.name ?? '' })
      onSaved(updated)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save assignee')
    } finally {
      setSaving(false)
    }
  }

  if (!canEdit) {
    return <Avatar name={task.assignee} size={size} />
  }

  return (
    <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button onClick={() => setOpen(o => !o)} disabled={saving} className="rounded-full disabled:opacity-60 hover:ring-2 hover:ring-primary/30 transition-all">
        {saving ? <Loader2 size={size === 'xs' ? 16 : 20} className="animate-spin text-gray-400" /> : <Avatar name={task.assignee} size={size} />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[170px] max-h-64 overflow-y-auto">
            <button
              onClick={() => void choose(null)}
              disabled={saving}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 transition-colors disabled:opacity-50 ${!task.assigneeId ? 'bg-gray-50 font-semibold text-gray-700' : 'text-gray-400'}`}
            >
              Unassigned
            </button>
            {eligible.map(p => (
              <button
                key={p.id}
                onClick={() => void choose(p)}
                disabled={saving}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 transition-colors disabled:opacity-50 ${p.id === task.assigneeId ? 'bg-gray-50 font-semibold text-gray-800' : 'text-gray-600'}`}
              >
                <Avatar name={p.name} size="xs" />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <div className="absolute right-0 top-full mt-1 z-30 flex items-center gap-1 text-[10px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-2 py-1 whitespace-nowrap">
          <AlertCircle size={10} /> {error}
        </div>
      )}
    </div>
  )
}
