import { useEffect, useState } from 'react'
import { Users, AlertTriangle, Check, Loader2, GitMerge } from 'lucide-react'
import {
  findDuplicateClients, mergeClients,
  type DuplicateGroup, type DbBillingRecord,
} from '../lib/database'

const MONTHS = ['', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']

function money(n: number | string | null) {
  const v = Number(n ?? 0)
  return `₪${v.toLocaleString('he-IL')}`
}

/**
 * Customers that ended up in the system more than once. The merge is always a
 * deliberate choice — nothing is joined automatically, because billing records
 * are involved.
 */
export function MergeDuplicateClients({ onMerged }: { onMerged?: () => void } = {}) {
  const [groups, setGroups]   = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [keep, setKeep]       = useState<Record<string, string>>({})
  const [keepBilling, setKeepBilling] = useState<Record<string, string>>({})
  const [busy, setBusy]       = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  async function load() {
    try {
      const found = await findDuplicateClients()
      setGroups(found)
      // Default to the oldest record, which holds the original join date.
      const defaults: Record<string, string> = {}
      found.forEach(g => { defaults[g.key] = g.clients[0].id })
      setKeep(defaults)
    } catch (err) {
      console.error('Could not load duplicates:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function doMerge(g: DuplicateGroup) {
    const keepId = keep[g.key]
    const removeIds = g.clients.filter(c => c.id !== keepId).map(c => c.id)

    // For any month billed twice, discard the rows the person did not pick.
    const dropBillingIds: string[] = []
    g.clashingPeriods.forEach(p => {
      const chosen = keepBilling[`${g.key}:${p.year}-${p.month}`] ?? p.records[0].id
      p.records.forEach(r => { if (r.id !== chosen) dropBillingIds.push(r.id) })
    })

    setBusy(g.key)
    try {
      await mergeClients(keepId, removeIds, dropBillingIds)
      setGroups(prev => prev.filter(x => x.key !== g.key))
      setConfirming(null)
      onMerged?.()
    } catch (err) {
      console.error('Merge failed:', err)
      alert('המיזוג נכשל, שום דבר לא שונה') // merge failed, nothing was changed
    } finally {
      setBusy(null)
    }
  }

  if (loading) return null
  if (groups.length === 0) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" dir="rtl">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
        <Users size={16} className="text-amber-600" />
        <h2 className="text-sm font-bold text-gray-800">לקוחות שמופיעים יותר מפעם אחת</h2>
        <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
          {groups.length}
        </span>
      </div>

      <div className="divide-y divide-gray-100">
        {groups.map(g => {
          const keepId = keep[g.key]
          const hasClash = g.clashingPeriods.length > 0
          return (
            <div key={g.key} className="px-5 py-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-gray-800">
                {g.clients[0].name}
                <span className="text-xs font-normal text-gray-400 mr-2">
                  · {g.clients.length} רשומות
                </span>
              </p>

              {/* Which record survives */}
              <div className="flex flex-col gap-2">
                {g.clients.map(c => (
                  <label
                    key={c.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${
                      keepId === c.id ? 'border-primary bg-primary/5' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`keep-${g.key}`}
                      checked={keepId === c.id}
                      onChange={() => setKeep(prev => ({ ...prev, [g.key]: c.id }))}
                      className="accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-700">
                        הצטרף {c.joined_at ?? '—'} · {c.status}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {c.billing_count} חיובים · {c.task_count} משימות · {c.contact_count} אנשי קשר
                      </p>
                    </div>
                    {keepId === c.id && (
                      <span className="text-[10px] font-bold text-primary shrink-0">נשמר</span>
                    )}
                  </label>
                ))}
              </div>

              {/* A month billed on two records has to be decided by a person */}
              {hasClash && (
                <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 flex flex-col gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
                    <AlertTriangle size={12} />
                    יש חודש שמחויב פעמיים, צריך לבחור איזה חיוב נכון
                  </p>
                  {g.clashingPeriods.map(p => (
                    <div key={`${p.year}-${p.month}`} className="flex flex-col gap-1">
                      <p className="text-[11px] font-semibold text-amber-900">
                        {MONTHS[p.month]} {p.year}
                      </p>
                      {p.records.map((r: DbBillingRecord) => {
                        const field = `${g.key}:${p.year}-${p.month}`
                        const chosen = (keepBilling[field] ?? p.records[0].id) === r.id
                        return (
                          <label
                            key={r.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer text-[11px] ${
                              chosen ? 'border-amber-400 bg-white' : 'border-amber-100 bg-white/50'
                            }`}
                          >
                            <input
                              type="radio"
                              name={field}
                              checked={chosen}
                              onChange={() => setKeepBilling(prev => ({ ...prev, [field]: r.id }))}
                              className="accent-amber-600"
                            />
                            <span className="text-gray-700">
                              חבילה {money(r.package_price)} · {r.otp_count} הודעות · {r.user_count} משתמשים · משתנה {money(r.variable_total)}
                            </span>
                            <span className={`mr-auto font-semibold ${r.cc_status === 'paid' ? 'text-green-600' : 'text-gray-400'}`}>
                              {r.cc_status === 'paid' ? 'שולם' : 'לא שולם'}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  ))}
                  <p className="text-[10px] text-amber-700">
                    החיוב שלא נבחר יימחק. השאר יעברו ללקוח שנשמר.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setConfirming(g.key)}
                  disabled={busy === g.key}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy === g.key ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
                  מזג לרשומה אחת
                </button>
                <span className="text-[10px] text-gray-400">
                  כל החיובים, המשימות ואנשי הקשר יעברו לרשומה שנשמרת
                </span>
              </div>

              {confirming === g.key && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirming(null)}>
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
                    <p className="text-sm font-bold text-gray-800">למזג את {g.clients[0].name}?</p>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      {g.clients.length - 1} רשומות ימוזגו לתוך הרשומה שבחרת ואז יימחקו.
                      כל החיובים, המשימות, אנשי הקשר וההיסטוריה יעברו אליה.
                      {hasClash && ' החיובים הכפולים שלא נבחרו יימחקו.'}
                      {' '}הפעולה הזו לא ניתנת לביטול.
                    </p>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setConfirming(null)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">
                        בטל
                      </button>
                      <button
                        onClick={() => void doMerge(g)}
                        disabled={busy === g.key}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50"
                      >
                        <Check size={11} />כן, מזג
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
