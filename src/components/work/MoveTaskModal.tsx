import { useState } from 'react'
import { ArrowRightLeft, AlertCircle, Loader2, X } from 'lucide-react'
import { useLang } from '../../contexts/LanguageContext'
import type { Task, Board } from '../../types/work'
import { eligibleAssigneesForBoard } from '../../types/work'
import { priorityDefsForBoard } from '../../data/workConstants'
import { moveTaskToBoard, StaleSourceBoardError } from '../../lib/database'

// Moves a task to a different board via the atomic move_task_to_board()
// RPC — never several client UPDATEs. Every destination choice (status,
// priority, assignee) is resolved strictly from the DESTINATION board's
// own configuration, never reused from the source board just because an
// id happens to match. Non-optimistic: onMoved only fires with the
// server's own returned row, after the RPC actually confirms.
export function MoveTaskModal({
  task, sourceBoardName, eligibleBoards, profiles, onClose, onMoved,
}: {
  task: Task
  sourceBoardName: string
  /** Boards the caller has 'full' access to, excluding the task's current board — never boards the caller can't actually move into. */
  eligibleBoards: Board[]
  profiles: { id: string; name: string; isOwner: boolean }[]
  onClose: () => void
  onMoved: (t: Task) => void
}) {
  const { t: tr } = useLang()
  // Captured once, at mount — the board the caller actually saw when
  // they opened this dialog, independent of whatever the `task` prop
  // does afterward (e.g. a background refresh while the modal stays
  // open). Sent to the server as expected_source_board; the RPC
  // rejects the whole call if the task's live board no longer matches
  // this, rather than silently moving it from wherever it happens to
  // be now.
  const [expectedSourceBoard] = useState(task.board)
  const [step, setStep] = useState<'pick' | 'confirm'>('pick')
  const [destBoardId, setDestBoardId] = useState('')
  const [destStatusId, setDestStatusId] = useState('')
  const [destPriorityId, setDestPriorityId] = useState('')
  const [destAssigneeId, setDestAssigneeId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [staleSource, setStaleSource] = useState(false)

  const destBoard = eligibleBoards.find(b => b.id === destBoardId) ?? null
  const destStatuses = [...(destBoard?.statuses ?? [])].sort((a, b) => a.order - b.order)
  const destPriorities = priorityDefsForBoard(destBoard ?? undefined)
  const destEligibleAssignees = destBoard ? eligibleAssigneesForBoard(destBoard, profiles) : []

  function pickBoard(id: string) {
    const b = eligibleBoards.find(x => x.id === id) ?? null
    setDestBoardId(id)
    setDestStatusId([...(b?.statuses ?? [])].sort((a, c) => a.order - c.order)[0]?.id ?? '')
    setDestPriorityId('')
    // Per spec: if the current assignee is still active + eligible on the
    // destination board, it may stay selected; otherwise reset to
    // Unassigned rather than silently keeping an ineligible id.
    const stillEligible = b && task.assigneeId && eligibleAssigneesForBoard(b, profiles).some(p => p.id === task.assigneeId)
    setDestAssigneeId(stillEligible ? task.assigneeId! : '')
  }

  const destStatusLabel = destStatuses.find(s => s.id === destStatusId)?.label ?? destStatusId
  const destPriorityLabel = destPriorities.find(p => p.id === destPriorityId)?.label
  const destAssigneeName = destEligibleAssignees.find(p => p.id === destAssigneeId)?.name

  async function confirmMove() {
    if (saving || !destBoard || !destStatusId) return
    setSaving(true)
    setError(null)
    setStaleSource(false)
    try {
      // Never applied optimistically — onMoved only fires below, after
      // the server has actually confirmed the move.
      const updated = await moveTaskToBoard(task.id, expectedSourceBoard, destBoardId, destStatusId, destPriorityId || null, destAssigneeId || null)
      onMoved(updated)
      onClose()
    } catch (err) {
      if (err instanceof StaleSourceBoardError) {
        setStaleSource(true)
        setError(tr(
          'המשימה עברה ללוח אחר מאז שנפתחה — טענו אותה מחדש ונסו שוב.',
          'This task moved to another board since it was opened — reload it and try again.',
        ))
      } else {
        setError(err instanceof Error ? err.message : tr('ההעברה נכשלה', 'Move failed'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col gap-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <ArrowRightLeft size={16} className="text-primary" />
          </div>
          <p className="text-sm font-semibold text-gray-900 flex-1">{tr('העברת משימה ללוח אחר', 'Move task to another board')}</p>
          <button onClick={onClose} disabled={saving} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <X size={15} />
          </button>
        </div>

        {step === 'pick' && (
          <div className="flex flex-col gap-3">
            {eligibleBoards.length === 0 ? (
              <p className="text-xs text-gray-500">{tr('אין לך גישה מלאה ללוח אחר להעביר אליו.', 'You don’t have full access to any other board to move this task to.')}</p>
            ) : (
              <>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{tr('לוח יעד', 'Destination board')}</p>
                  <select value={destBoardId} onChange={e => pickBoard(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary">
                    <option value="">{tr('בחר לוח...', 'Select a board...')}</option>
                    {eligibleBoards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>

                {destBoard && (
                  <>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{tr('סטטוס יעד', 'Destination status')}</p>
                      <select value={destStatusId} onChange={e => setDestStatusId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary">
                        {destStatuses.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{tr('עדיפות יעד', 'Destination priority')}</p>
                      <select value={destPriorityId} onChange={e => setDestPriorityId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary">
                        <option value="">{tr('ללא עדיפות', 'No Priority')}</option>
                        {destPriorities.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{tr('אחראי ביעד', 'Destination assignee')}</p>
                      <select value={destAssigneeId} onChange={e => setDestAssigneeId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary">
                        <option value="">{tr('לא משויך', 'Unassigned')}</option>
                        {destEligibleAssignees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </>
            )}

            <div className="flex gap-2 justify-end mt-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">{tr('ביטול', 'Cancel')}</button>
              <button
                onClick={() => setStep('confirm')}
                disabled={!destBoard || !destStatusId}
                className="px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {tr('המשך', 'Continue')}
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && destBoard && (
          <div className="flex flex-col gap-4">
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 flex flex-col gap-2 text-sm">
              <p className="text-gray-700">
                {tr('מ:', 'From:')} <span className="font-semibold">{sourceBoardName}</span> ← {tr('אל:', 'To:')} <span className="font-semibold text-primary">{destBoard.name}</span>
              </p>
              <p className="text-gray-700">{tr('סטטוס חדש:', 'New status:')} <span className="font-semibold">{destStatusLabel}</span></p>
              <p className="text-gray-700">{tr('עדיפות חדשה:', 'New priority:')} <span className="font-semibold">{destPriorityLabel ?? tr('ללא עדיפות', 'No Priority')}</span></p>
              <p className="text-gray-700">{tr('אחראי חדש:', 'New assignee:')} <span className="font-semibold">{destAssigneeName ?? tr('לא משויך', 'Unassigned')}</span></p>
            </div>
            <p className="text-xs text-gray-400">
              {tr('תוכן המשימה (תיאור, תגובות, קבצים, זמנים) יישמר ללא שינוי.', 'The task’s content (description, comments, attachments, dates) is preserved unchanged.')}
            </p>
            {error && (
              <div className="flex items-center gap-2 text-xs text-red-500">
                <AlertCircle size={13} /> {error}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              {staleSource ? (
                // Retrying would just fail again — expectedSourceBoard is
                // frozen from when this dialog opened, and the task has
                // since moved. The only correct next step is to close and
                // reopen it fresh.
                <button onClick={onClose} className="px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors">
                  {tr('סגור', 'Close')}
                </button>
              ) : (
                <>
                  <button onClick={() => setStep('pick')} disabled={saving} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40">
                    {tr('חזרה', 'Back')}
                  </button>
                  <button
                    onClick={() => void confirmMove()}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <ArrowRightLeft size={13} />}
                    {saving ? tr('מעביר...', 'Moving...') : tr('העבר משימה', 'Move Task')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
