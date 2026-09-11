import { Loader2, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useLang } from '../../contexts/LanguageContext'
import type { DbLeadPipelineStatus } from '../../lib/database'

export function DeleteLeadStatusModal({ status, leadCount, onClose, onDelete }: {
  status: DbLeadPipelineStatus
  leadCount: number
  onClose: () => void
  onDelete: () => Promise<void>
}) {
  const { t } = useLang()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    if (leadCount > 0 || deleting) return
    setDeleting(true)
    setError('')
    try {
      await onDelete()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('מחיקת הסטטוס נכשלה', 'Could not delete status'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label={t('סגור', 'Close')} />
      <div className="relative w-full max-w-md rounded-2xl bg-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-gray-800">{t('מחיקת סטטוס', 'Delete status')}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {t('האם למחוק את', 'Are you sure you want to delete')} <strong>{t(status.label_he, status.label_en)}</strong>?
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {leadCount > 0 && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
            {t(`יש להעביר תחילה ${leadCount} לידים לסטטוס אחר.`, `Move ${leadCount} lead${leadCount === 1 ? '' : 's'} to another status first.`)}
          </p>
        )}
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="h-9 px-3 text-sm text-gray-500">{t('ביטול', 'Cancel')}</button>
          <button onClick={() => void confirm()} disabled={leadCount > 0 || deleting}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-40">
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}{t('מחק', 'Delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
