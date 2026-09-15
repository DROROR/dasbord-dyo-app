import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useLang } from '../../contexts/LanguageContext'
import type { DbLeadPipelineStatus, LeadStatusColor } from '../../lib/database'
import { LEAD_STATUS_COLORS } from './AddLeadStatusModal'

export function EditLeadStatusModal({ status, onClose, onSave }: {
  status: DbLeadPipelineStatus
  onClose: () => void
  onSave: (patch: { label_he: string; label_en: string; color: LeadStatusColor }) => Promise<void>
}) {
  const { t } = useLang()
  const [he, setHe] = useState(status.label_he)
  const [en, setEn] = useState(status.label_en)
  const [color, setColor] = useState(status.color)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    if (!he.trim() || !en.trim() || saving) return
    setSaving(true)
    setError('')
    try { await onSave({ label_he: he.trim(), label_en: en.trim(), color }); onClose() }
    catch (err) { setError(err instanceof Error ? err.message : t('לא ניתן לשמור סטטוס', 'Could not save status')) }
    finally { setSaving(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label={t('סגור', 'Close')} />
    <div className="relative w-full max-w-md space-y-4 rounded-2xl bg-surface p-5 shadow-2xl">
      <div className="flex items-center justify-between"><h2 className="text-base font-bold text-primary">{t('ערוך סטטוס', 'Edit Status')}</h2><button onClick={onClose}><X size={18} /></button></div>
      <label className="block text-xs font-semibold text-gray-500">{t('שם בעברית', 'Hebrew name')}<input value={he} onChange={event => setHe(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 bg-surface px-3 text-sm text-gray-700" /></label>
      <label className="block text-xs font-semibold text-gray-500">{t('שם באנגלית', 'English name')}<input value={en} onChange={event => setEn(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 bg-surface px-3 text-sm text-gray-700" /></label>
      <div><p className="mb-2 text-xs font-semibold text-gray-500">{t('צבע', 'Color')}</p><div className="flex flex-wrap gap-2">{(Object.keys(LEAD_STATUS_COLORS) as LeadStatusColor[]).map(value => <button key={value} onClick={() => setColor(value)} title={value} className={`h-8 w-8 rounded-lg border-2 ${LEAD_STATUS_COLORS[value].dot} ${color === value ? 'border-primary ring-2 ring-primary/20' : 'border-transparent'}`} />)}</div></div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-gray-100 pt-4"><button onClick={onClose} className="h-9 px-3 text-sm text-gray-500">{t('ביטול', 'Cancel')}</button><button onClick={() => void save()} disabled={!he.trim() || !en.trim() || saving} className="flex h-9 items-center gap-1 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40">{saving && <Loader2 size={14} className="animate-spin" />}{t('שמור', 'Save')}</button></div>
    </div>
  </div>
}
