import { useState } from 'react'
import { Settings2, MessageSquare, CheckCircle, XCircle, Pencil, Save, X } from 'lucide-react'

function WAChannelCard({
  title, channel, accent, configured,
}: {
  title: string; channel: 'service' | 'sales'; accent: string; configured: boolean
}) {
  const storageKey        = `waPhoneLabel_${channel}`
  const [label, setLabel] = useState(() => localStorage.getItem(storageKey) ?? '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)

  const save = () => {
    localStorage.setItem(storageKey, draft)
    setLabel(draft)
    setEditing(false)
  }
  const cancel = () => setEditing(false)

  return (
    <div className={`rounded-2xl border p-5 ${accent}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-800">{title}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {channel === 'service' ? 'שימוש: לקוחות' : 'שימוש: לידים'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {configured ? (
            <>
              <CheckCircle size={14} className="text-green-500" />
              <span className="text-xs text-green-600 font-medium">מחובר</span>
            </>
          ) : (
            <>
              <XCircle size={14} className="text-gray-300" />
              <span className="text-xs text-gray-400">לא מוגדר</span>
            </>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-400 mb-1.5">מספר להצגה</label>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="+972 50 000 0000"
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
              dir="ltr"
            />
            <button
              onClick={save}
              className="p-2 bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors"
            >
              <Save size={13} />
            </button>
            <button onClick={cancel} className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={13} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 font-mono">{label || '—'}</span>
            <button
              onClick={() => { setDraft(label); setEditing(true) }}
              className="text-gray-400 hover:text-primary transition-colors"
            >
              <Pencil size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function Settings() {
  const serviceConfigured = !!(
    import.meta.env.VITE_GREEN_API_INSTANCE_SERVICE &&
    import.meta.env.VITE_GREEN_API_TOKEN_SERVICE
  )
  const salesConfigured = !!(
    import.meta.env.VITE_GREEN_API_INSTANCE_SALES &&
    import.meta.env.VITE_GREEN_API_TOKEN_SALES
  )

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-primary">הגדרות מערכת</h1>
        <p className="text-sm text-gray-400 mt-1">הגדרות כלליות ומתקדמות</p>
      </div>

      {/* WhatsApp Configuration */}
      <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2.5 mb-5">
          <MessageSquare size={16} className="text-primary shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-primary">הגדרות WhatsApp</h2>
            <p className="text-xs text-gray-400 mt-0.5">שני מספרי WhatsApp — שירות לקוחות ומכירות</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <WAChannelCard
            title="שירות לקוחות"
            channel="service"
            accent="border-blue-100 bg-blue-50/30"
            configured={serviceConfigured}
          />
          <WAChannelCard
            title="מכירות"
            channel="sales"
            accent="border-green-100 bg-green-50/30"
            configured={salesConfigured}
          />
        </div>

        <p className="text-xs text-gray-300 mt-4">
          ערכי החיבור (Instance ID + Token) מוגדרים כמשתני סביבה בקובץ .env
        </p>
      </div>

      {/* Other settings placeholder */}
      <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm p-12 flex flex-col items-center justify-center text-center gap-3">
        <Settings2 size={36} className="text-gray-200" />
        <p className="text-sm font-medium text-gray-400">בקרוב — מפתחות API, התראות ומשתמשים</p>
        <p className="text-xs text-gray-300">הגדרות תמחור הועברו למודול החיוב ← לשונית "הגדרות תמחור"</p>
      </div>
    </div>
  )
}
