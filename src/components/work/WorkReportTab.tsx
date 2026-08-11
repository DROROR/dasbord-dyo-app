import { useState, useEffect } from 'react'
import { TrendingUp, Ticket, Clock, Loader2, AlertCircle, Lock, ArrowLeft, X, ExternalLink, UserX, CheckCircle2, Check } from 'lucide-react'
import { Avatar } from '../Avatar'
import { useLang } from '../../contexts/LanguageContext'
import type { Task, WorkReport, WorkReportEmployee, WorkReportEvent, WorkReportTimeEntryRef } from '../../types/work'
import {
  getWorkReport, getWorkReportAccessList, grantWorkReportAccess, revokeWorkReportAccess, getProfiles,
} from '../../lib/database'

// Today's calendar date in the project's reporting timezone (Asia/Jerusalem
// — see the get_work_report() RPC), not the browser's local timezone.
function todayInIsrael(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
}

function fmtHours(h: number): string {
  if (!h) return '0h'
  const hrs = Math.floor(h)
  const min = Math.round((h - hrs) * 60)
  return min > 0 ? `${hrs}h ${min}m` : `${hrs}h`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })
}

// ─── Access panel — Owner only ─────────────────────────────────────────────────
// Deliberately not the work_docs/boards Access pattern (Edge Function +
// multi-level map) — only the Owner may ever manage this, and the table's
// own RLS already enforces that unconditionally, so a direct table
// read/insert/delete is sufficient. Visually mirrors that same pattern
// (a button opening a list of profiles with a control each), per the
// requirement.
//
// Self-fetches its own candidate list (active, non-owner profiles, with
// email) via getProfiles() rather than depending on the parent's already-
// loaded `profiles` prop — that prop only ever carried {id, name} (no
// email) and included the Owner, neither of which fits this panel's own
// requirements. Fetching fresh here also means every time this panel is
// opened (it only ever mounts while shown — see the {showAccess && (...)}
// conditional in WorkReportTab below) it reloads current data, rather
// than risking a stale snapshot from whenever Work.tsx's own profiles
// list last loaded.
interface GrantableProfile { id: string; name: string; email: string }

function AccessPanel({
  myProfileId, onClose,
}: {
  myProfileId?: string
  onClose: () => void
}) {
  const { t: tr } = useLang()
  const [candidates, setCandidates] = useState<GrantableProfile[] | null>(null)
  const [grantedIds, setGrantedIds] = useState<Set<string> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const [allProfiles, grants] = await Promise.all([getProfiles(), getWorkReportAccessList()])
        if (cancelled) return
        // Only active, non-owner profiles are ever grantable — the
        // Owner's access is unconditional and can never be granted or
        // removed here; a deactivated profile can never be granted.
        setCandidates(
          allProfiles
            .filter(p => p.is_active && !p.is_owner)
            .map(p => ({ id: p.id, name: p.name, email: p.email })),
        )
        setGrantedIds(new Set(grants.map(g => g.profileId)))
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function setAccess(profileId: string, grant: boolean) {
    if (!myProfileId || savingId) return
    setSavingId(profileId)
    setSavedId(null)
    setSaveError(null)
    try {
      if (grant) await grantWorkReportAccess(profileId, myProfileId)
      else await revokeWorkReportAccess(profileId)
      // Non-optimistic: read back the actual saved state from the
      // server rather than assuming success just because the write
      // call didn't throw, and verify it matches what was requested
      // before showing any success indicator.
      const confirmed = await getWorkReportAccessList()
      const nowGranted = confirmed.some(r => r.profileId === profileId)
      if (nowGranted !== grant) {
        throw new Error(tr('השינוי לא אומת בקריאה חוזרת — נסה שוב', 'The change could not be verified on read-back — please try again'))
      }
      setGrantedIds(new Set(confirmed.map(r => r.profileId)))
      setSavedId(profileId)
      setTimeout(() => setSavedId(cur => cur === profileId ? null : cur), 1500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : tr('השמירה נכשלה', 'Save failed'))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 shrink-0">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          {tr('ניהול גישה לדוח', 'Report Access Control')}
        </p>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 transition-colors"><X size={13} /></button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 size={13} className="animate-spin" /> {tr('טוען...', 'Loading...')}
        </div>
      )}

      {loadError && !loading && (
        <div className="flex items-center gap-2 text-xs text-red-500 py-2">
          <AlertCircle size={13} /> {loadError}
        </div>
      )}

      {!loading && !loadError && candidates && grantedIds && (
        <>
          {candidates.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">{tr('אין משתמשים פעילים הזכאים להרשאה', 'No active users eligible for access')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {candidates.map(p => {
                const granted = grantedIds.has(p.id)
                const isSaving = savingId === p.id
                return (
                  <div key={p.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-3 py-2">
                    <Avatar name={p.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{p.name}</p>
                      <p className="text-[10px] text-gray-400 truncate">{p.email}</p>
                    </div>
                    {isSaving ? (
                      <Loader2 size={13} className="text-gray-400 animate-spin shrink-0" />
                    ) : savedId === p.id ? (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-green-600 shrink-0">
                        <Check size={13} /> {tr('נשמר', 'Saved')}
                      </span>
                    ) : (
                      <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden shrink-0">
                        <button
                          onClick={() => void setAccess(p.id, false)}
                          disabled={!!savingId}
                          className={`text-[10px] font-semibold px-2.5 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${!granted ? 'bg-gray-200 text-gray-700' : 'bg-white text-gray-400 hover:bg-gray-50'}`}
                        >
                          {tr('ללא גישה', 'No Access')}
                        </button>
                        <button
                          onClick={() => void setAccess(p.id, true)}
                          disabled={!!savingId}
                          className={`text-[10px] font-semibold px-2.5 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${granted ? 'bg-primary text-white' : 'bg-white text-gray-400 hover:bg-gray-50'}`}
                        >
                          {tr('צפייה', 'View')}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {saveError && (
            <div className="flex items-center gap-2 text-xs text-red-500 mt-3">
              <AlertCircle size={13} /> {saveError}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Event / time-entry rows ────────────────────────────────────────────────
function EventRow({
  event, tasks, onOpenTask,
}: {
  event: WorkReportEvent
  tasks: Task[]
  onOpenTask: (id: string) => void
}) {
  const { t: tr } = useLang()
  const openable = tasks.some(t => t.id === event.taskId)
  return (
    <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{event.title}</p>
        <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1 flex-wrap">
          <span>{event.board}</span>
          <span>·</span>
          <span>{fmtTime(event.changedAt)}</span>
          <span>·</span>
          <span className="text-gray-500">
            {event.fromStatusLabel ?? tr('חדש', 'new')} → <span className="font-semibold text-gray-700">{event.toStatusLabel}</span>
          </span>
        </p>
      </div>
      {openable ? (
        <button
          onClick={() => onOpenTask(event.taskId)}
          className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline shrink-0"
        >
          <ExternalLink size={10} /> {tr('פתח', 'Open')}
        </button>
      ) : (
        <span className="flex items-center gap-1 text-[10px] text-gray-300 shrink-0" title={tr('אין לך גישה ללוח של המשימה הזו', "You don't have access to this task's board")}>
          <UserX size={10} /> {tr('אין גישה', 'No access')}
        </span>
      )}
    </div>
  )
}

function TimeEntryRow({ entry }: { entry: WorkReportTimeEntryRef }) {
  return (
    <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-2.5">
      <Clock size={13} className="text-gray-300 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{entry.title}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">{entry.board}</p>
      </div>
      <span className="text-xs font-semibold text-gray-600 shrink-0">{fmtHours(entry.hours)}</span>
    </div>
  )
}

// ─── Employee drill-down ────────────────────────────────────────────────────
function EmployeeDetail({
  employee, tasks, onOpenTask, onBack,
}: {
  employee: WorkReportEmployee
  tasks: Task[]
  onOpenTask: (id: string) => void
  onBack: () => void
}) {
  const { t: tr } = useLang()
  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <Avatar name={employee.name} size="md" />
        <div>
          <p className="text-base font-semibold text-gray-900">{employee.name}</p>
          <p className="text-xs text-gray-400">{tr('סך שעות מדווחות', 'Total tracked')}: {fmtHours(employee.hoursWorked)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 pb-4">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
            {tr('ציר זמן — כל שינויי הסטטוס', 'Timeline — every status transition')} ({employee.events.length})
          </p>
          {employee.events.length === 0 ? (
            <p className="text-xs text-gray-300 py-2">{tr('אין פעילות בתאריך זה', 'No activity on this date')}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {employee.events.map((e, i) => <EventRow key={`${e.taskId}-${e.changedAt}-${i}`} event={e} tasks={tasks} onOpenTask={onOpenTask} />)}
            </div>
          )}
        </div>

        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
            {tr('רישומי זמן', 'Time Entries')} ({employee.timeEntries.length})
          </p>
          {employee.timeEntries.length === 0 ? (
            <p className="text-xs text-gray-300 py-2">{tr('לא נרשם זמן עבודה בתאריך זה', 'No time tracked on this date')}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {employee.timeEntries.map((e, i) => <TimeEntryRow key={`${e.taskId}-${i}`} entry={e} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── WorkReportTab ──────────────────────────────────────────────────────────
export function WorkReportTab({
  isOwner, myProfileId, tasks, onOpenTask,
}: {
  isOwner: boolean
  myProfileId?: string
  tasks: Task[]
  onOpenTask: (id: string) => void
}) {
  const { t: tr } = useLang()
  const [date, setDate] = useState(todayInIsrael)
  const [report, setReport] = useState<WorkReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAccess, setShowAccess] = useState(false)
  const [showSystem, setShowSystem] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const r = await getWorkReport(date)
        if (!cancelled) setReport(r)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [date])

  const selected = report?.employees.find(e => e.id === selectedId) ?? null

  if (selected) {
    return (
      <EmployeeDetail
        employee={selected}
        tasks={tasks}
        onOpenTask={onOpenTask}
        onBack={() => setSelectedId(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={todayInIsrael()}
            onChange={e => e.target.value && setDate(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-primary"
          />
          <span className="text-[10px] text-gray-400">{tr('שעון ישראל (Asia/Jerusalem)', 'Israel time (Asia/Jerusalem)')}</span>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowAccess(s => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${showAccess ? 'bg-primary text-white border-primary' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
          >
            <Lock size={11} /> {tr('גישה', 'Access')}
          </button>
        )}
      </div>

      {showAccess && isOwner && (
        <AccessPanel myProfileId={myProfileId} onClose={() => setShowAccess(false)} />
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-primary opacity-50" />
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {report && !loading && !error && (
        <div className="flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto pb-4">
          {/* Team summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
            <div className="border border-gray-100 bg-white rounded-xl p-5 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><TrendingUp size={18} className="text-primary" /></div>
              <div>
                <p className="text-2xl font-bold text-primary">{report.team.tasksProgressed}</p>
                <p className="text-[11px] text-gray-400">{tr('משימות שהתקדמו', 'Tasks Progressed')}</p>
                <p className="text-[10px] text-gray-300 mt-0.5">{tr('מתוכן הושלמו', 'of which completed')}: {report.team.tasksCompleted}</p>
              </div>
            </div>
            <div className="border border-gray-100 bg-white rounded-xl p-5 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center shrink-0"><Ticket size={18} className="text-orange-500" /></div>
              <div>
                <p className="text-2xl font-bold text-orange-600">{report.team.ticketsHandled}</p>
                <p className="text-[11px] text-gray-400">{tr('כרטיסיות תמיכה שטופלו', 'Support Tickets Handled')}</p>
              </div>
            </div>
            <div className="border border-gray-100 bg-white rounded-xl p-5 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Clock size={18} className="text-blue-500" /></div>
              <div>
                <p className="text-2xl font-bold text-blue-600">{fmtHours(report.team.hoursWorked)}</p>
                <p className="text-[11px] text-gray-400">{tr('סך שעות העבודה', 'Total Hours Worked')}</p>
              </div>
            </div>
          </div>

          {/* Status breakdown — dynamic, derived from whatever statuses were actually used today */}
          {report.statusBreakdown.length > 0 && (
            <div className="shrink-0">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {tr('פילוח לפי סטטוס', 'Status Breakdown')}
              </p>
              <div className="flex flex-wrap gap-2">
                {report.statusBreakdown.map(s => (
                  <span key={s.statusId} className="flex items-center gap-1.5 text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full">
                    {s.toStatusId === 'done' && <CheckCircle2 size={11} className="text-green-500" />}
                    {tr('עבר ל', 'Moved to')} {s.statusLabel}: <span className="font-bold">{s.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* System / unattributed activity */}
          {report.systemActivity.length > 0 && (
            <div className="shrink-0">
              <button
                onClick={() => setShowSystem(s => !s)}
                className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 hover:text-gray-600 transition-colors"
              >
                {tr('פעילות מערכת / לא משויכת', 'System / Unattributed Activity')} ({report.systemActivity.length}) {showSystem ? '▲' : '▼'}
              </button>
              {showSystem && (
                <div className="flex flex-col gap-1.5">
                  {report.systemActivity.map((e, i) => <EventRow key={`${e.taskId}-${e.changedAt}-${i}`} event={e} tasks={tasks} onOpenTask={onOpenTask} />)}
                </div>
              )}
            </div>
          )}

          {/* Employee cards */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 shrink-0">
              {tr('לפי עובד', 'By Employee')}
            </p>
            {report.employees.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">{tr('אין עובדים פעילים', 'No active employees')}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {report.employees.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => setSelectedId(emp.id)}
                    className="flex flex-col gap-3 bg-white border border-gray-100 rounded-2xl p-5 text-left hover:border-primary/40 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={emp.name} size="md" />
                      <p className="text-sm font-semibold text-gray-900 truncate">{emp.name}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-lg font-bold text-primary">{emp.tasksProgressed}</p>
                        <p className="text-[9px] text-gray-400 leading-tight">{tr('משימות', 'Tasks')}</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-blue-600">{fmtHours(emp.hoursWorked)}</p>
                        <p className="text-[9px] text-gray-400 leading-tight">{tr('שעות', 'Hours')}</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-orange-600">{emp.ticketsHandled}</p>
                        <p className="text-[9px] text-gray-400 leading-tight">{tr('כרטיסיות', 'Tickets')}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
