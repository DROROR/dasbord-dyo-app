import { useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useLang } from '../../contexts/LanguageContext'
import type { LeadStatusColor } from '../../lib/database'

export const LEAD_STATUS_COLORS: Record<LeadStatusColor, { border: string; badge: string; dot: string }> = {
  blue: { border: 'border-t-blue-500', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  green: { border: 'border-t-green-500', badge: 'bg-green-100 text-green-600', dot: 'bg-green-500' },
  violet: { border: 'border-t-violet-500', badge: 'bg-purple-100 text-purple-700', dot: 'bg-violet-500' },
  amber: { border: 'border-t-amber-500', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  rose: { border: 'border-t-rose-500', badge: 'bg-red-100 text-red-700', dot: 'bg-rose-500' },
  cyan: { border: 'border-t-cyan-500', badge: 'bg-cyan-100 text-cyan-700', dot: 'bg-cyan-500' },
  orange: { border: 'border-t-orange-500', badge: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  slate: { border: 'border-t-slate-500', badge: 'bg-gray-100 text-gray-700', dot: 'bg-slate-500' },
}

const COLORS = Object.keys(LEAD_STATUS_COLORS) as LeadStatusColor[]

export function AddLeadStatusModal({ onClose, onAdd }: {
  onClose: () => void
  onAdd: (label: string, color: LeadStatusColor) => Promise<void>
}) {
  const { t } = useLang()
  const [label, setLabel] = useState('')
  const [color, setColor] = useState<LeadStatusColor>('blue')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!label.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await onAdd(label.trim(), color)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('שמירת הסטטוס נכשלה', 'Could not save status'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label={t('סגור', 'Close')} />
      <div className="relative w-full max-w-md rounded-2xl bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-primary">{t('הוסף סטטוס', 'Add Status')}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <label className="mb-1.5 block text-xs font-semibold text-gray-500">{t('שם הסטטוס', 'Status name')}</label>
        <input autoFocus value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save() }}
          placeholder={t('לדוגמה: ממתין לאישור', 'Example: Waiting for approval')}
          className="h-10 w-full rounded-lg border border-gray-200 bg-surface px-3 text-sm outline-none focus:border-primary" />
        <p className="mb-2 mt-4 text-xs font-semibold text-gray-500">{t('צבע', 'Color')}</p>
        <div className="flex flex-wrap gap-2">
          {COLORS.map(value => <button key={value} onClick={() => setColor(value)} title={value}
            className={`h-8 w-8 rounded-lg border-2 ${LEAD_STATUS_COLORS[value].dot} ${color === value ? 'border-primary ring-2 ring-primary/20' : 'border-transparent'}`} />)}
        </div>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="h-9 px-3 text-sm text-gray-500">{t('ביטול', 'Cancel')}</button>
          <button onClick={() => void save()} disabled={!label.trim() || saving}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}{t('הוסף סטטוס', 'Add Status')}
          </button>
        </div>
      </div>
    </div>
  )
}
