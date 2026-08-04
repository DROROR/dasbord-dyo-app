import { useEffect, useState } from 'react'
import { UserCheck, Bot, Loader2, Clock } from 'lucide-react'
import {
  getHumanHeldConversations, returnConversationToBot,
  type HumanHeldConversation,
} from '../lib/database'

/**
 * Conversations a team member has taken over. The bot stays quiet on these
 * until someone hands it back, or the person goes quiet for long enough.
 */
export function HumanHeldConversations({ currentUser }: { currentUser: string }) {
  const [rows, setRows]       = useState<HumanHeldConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setRows(await getHumanHeldConversations())
      } catch (err) {
        console.error('Could not load conversations:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function handBack(row: HumanHeldConversation) {
    setBusy(row.phone)
    try {
      await returnConversationToBot(row.phone, currentUser, row.client_id)
      setRows(prev => prev.filter(r => r.phone !== row.phone))
    } catch (err) {
      console.error('Could not hand the conversation back:', err)
    } finally {
      setBusy(null)
    }
  }

  if (loading) return null
  if (rows.length === 0) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" dir="rtl">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
        <UserCheck size={16} className="text-blue-600" />
        <h2 className="text-sm font-bold text-gray-800">שיחות שנמצאות כרגע בטיפול אנושי</h2>
        <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
          {rows.length}
        </span>
      </div>

      <div className="divide-y divide-gray-50">
        {rows.map(r => {
          const expired = r.quiet_minutes >= r.idle_limit
          return (
            <div key={r.phone} className="px-5 py-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">
                  {r.client_name || r.phone}
                </p>
                <p className="text-[11px] text-gray-400">
                  {r.taken_over_by ? `נלקח על ידי ${r.taken_over_by}` : 'בטיפול'}
                  {r.client_name ? ` · ${r.phone}` : ''}
                </p>
              </div>

              <span
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg font-semibold ${
                  expired ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'
                }`}
              >
                <Clock size={9} />
                {expired
                  ? 'שקט מספיק זמן, הבוט יענה בהודעה הבאה'
                  : `הבוט שקט עוד ${r.idle_limit - r.quiet_minutes} דקות`}
              </span>

              <button
                onClick={() => void handBack(r)}
                disabled={busy === r.phone}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {busy === r.phone ? <Loader2 size={11} className="animate-spin" /> : <Bot size={11} />}
                החזר לבוט
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
