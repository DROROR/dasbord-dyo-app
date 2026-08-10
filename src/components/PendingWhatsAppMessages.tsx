import { useEffect, useState } from 'react'
import { MessageSquare, Send, Pencil, Check, X, ExternalLink, Clock, Loader2 } from 'lucide-react'
import {
  getPendingMessages, updatePendingMessage, markMessageSent,
  type DbPendingMessage,
} from '../lib/database'
import { requestTaskFocus } from '../lib/focusTarget'
import { useCan } from '../hooks/useCan'

/**
 * Customer updates written when a support ticket was finished. Nothing goes out
 * on its own — someone reads it, edits if needed, and sends.
 */
export function PendingWhatsAppMessages({
  currentUser, onNavigate,
}: {
  currentUser: string
  onNavigate?: (page: string) => void
}) {
  const canView = useCan('whatsapp', 'view')
  const canSend = useCan('whatsapp', 'send')
  const [messages, setMessages] = useState<DbPendingMessage[]>([])
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState<string | null>(null)
  const [draft,    setDraft]    = useState('')
  const [busy,     setBusy]     = useState<string | null>(null)
  const [confirming, setConfirming] = useState<DbPendingMessage | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setMessages(await getPendingMessages())
      } catch (err) {
        console.error('Could not load pending messages:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function saveEdit(m: DbPendingMessage) {
    if (!canSend) return
    setBusy(m.id)
    try {
      await updatePendingMessage(m.id, { message: draft })
      setMessages(prev => prev.map(x => x.id === m.id ? { ...x, message: draft } : x))
      setEditing(null)
    } catch (err) {
      console.error('Could not save the message:', err)
    } finally {
      setBusy(null)
    }
  }

  async function send(m: DbPendingMessage) {
    if (!canSend) return
    setBusy(m.id)
    try {
      await markMessageSent(m, currentUser)
      setMessages(prev => prev.filter(x => x.id !== m.id))
      setConfirming(null)
    } catch (err) {
      console.error('Could not mark the message as sent:', err)
    } finally {
      setBusy(null)
    }
  }

  function openTicket(m: DbPendingMessage) {
    if (!m.task_id) return
    requestTaskFocus(m.task_id)
    onNavigate?.('work')
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center justify-center gap-2 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" />טוען הודעות...
      </div>
    )
  }

  if (!canView || messages.length === 0) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" dir="rtl">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
        <MessageSquare size={16} className="text-green-600" />
        <h2 className="text-sm font-bold text-gray-800">הודעות WhatsApp מוכנות לשליחה ללקוחות</h2>
        <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
          {messages.length}
        </span>
      </div>

      <div className="divide-y divide-gray-50">
        {messages.map(m => (
          <div key={m.id} className="px-5 py-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-800">{m.client_name || 'לקוח'}</span>
              {m.app_name && m.app_name !== m.client_name && (
                <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-lg">{m.app_name}</span>
              )}
              {m.requires_app_update && (
                <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-lg font-semibold">
                  ממתין לעדכון גרסה
                </span>
              )}
              {m.status === 'waiting' && (
                <span className="flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-lg font-semibold">
                  <Clock size={9} />ממתין לקריאות נוספות של הלקוח
                </span>
              )}
            </div>

            {m.task_title && (
              <button
                onClick={() => openTicket(m)}
                className="flex items-center gap-1 text-[11px] text-primary hover:underline self-start"
              >
                <ExternalLink size={10} />{m.task_title}
              </button>
            )}

            {editing === m.id ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={5}
                  className="w-full text-xs text-gray-700 border border-gray-200 rounded-xl px-3 py-2 leading-relaxed focus:outline-none focus:border-primary resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => void saveEdit(m)}
                    disabled={busy === m.id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Check size={11} />שמור
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-gray-50"
                  >
                    <X size={11} />בטל
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl px-3 py-2">
                {m.message}
              </p>
            )}

            {editing !== m.id && canSend && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setEditing(m.id); setDraft(m.message) }}
                  className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded-lg hover:bg-gray-50"
                >
                  <Pencil size={11} />ערוך
                </button>
                <button
                  onClick={() => setConfirming(m)}
                  disabled={busy === m.id}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  <Send size={11} />שלח ללקוח
                </button>
                {m.phone && <span className="text-[10px] text-gray-400">{m.phone}</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Sending is not reversible, so the number is shown before it goes. */}
      {confirming && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirming(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-gray-800">לשלוח את ההודעה ללקוח?</p>
            <p className="text-xs text-gray-500">
              {confirming.client_name}
              {confirming.phone ? ` · ${confirming.phone}` : ' · אין מספר טלפון שמור'}
            </p>
            <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl px-3 py-2 max-h-48 overflow-y-auto">
              {confirming.message}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirming(null)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">
                בטל
              </button>
              <button
                onClick={() => void send(confirming)}
                disabled={busy === confirming.id}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <Send size={11} />אשר ושלח
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
