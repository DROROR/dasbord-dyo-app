import { Loader2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useLang } from '../../contexts/LanguageContext'
import type { DbLeadPipelineStatus } from '../../lib/database'

export function AddLeadModal({ statuses, onClose, onAdd }: {
  statuses: DbLeadPipelineStatus[]
  onClose: () => void
  onAdd: (data: { name: string; phone: string; email: string; formAnswer: string; statusId: string }) => Promise<void>
}) {
  const { t } = useLang()
  const firstStatus = statuses.find(status => !status.is_archived)?.id ?? ''
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [formAnswer, setFormAnswer] = useState('')
  const [statusId, setStatusId] = useState(firstStatus)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!name.trim() || !phone.trim() || !statusId || saving) return
    setSaving(true)
    setError('')
    try {
      await onAdd({ name: name.trim(), phone: phone.trim(), email: email.trim(), formAnswer: formAnswer.trim(), statusId })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('שמירת הליד נכשלה', 'Could not save lead'))
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'h-10 w-full rounded-lg border border-gray-200 bg-surface px-3 text-sm outline-none focus:border-primary'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label={t('סגור', 'Close')} />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-primary">{t('הוסף ליד', 'Add Lead')}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-gray-500">{t('שם', 'Name')} *<input autoFocus value={name} onChange={e => setName(e.target.value)} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-500">{t('טלפון', 'Phone')} *<input dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-500">{t('אימייל', 'Email')}<input dir="ltr" type="email" value={email} onChange={e => setEmail(e.target.value)} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-500">{t('תשובת הטופס', 'Form answer')}<input value={formAnswer} onChange={e => setFormAnswer(e.target.value)} placeholder={t('קורסים / קהילה / יצירת קורס', 'Courses / community / create courses')} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-xs font-semibold text-gray-500 sm:col-span-2">{t('סטטוס', 'Status')}
            <select value={statusId} onChange={e => setStatusId(e.target.value)} className={`${inputClass} mt-1.5`}>
              {statuses.filter(status => !status.is_archived).map(status => <option key={status.id} value={status.id}>{t(status.label_he, status.label_en)}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="h-9 px-3 text-sm text-gray-500">{t('ביטול', 'Cancel')}</button>
          <button onClick={() => void save()} disabled={!name.trim() || !phone.trim() || !statusId || saving} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}{t('הוסף ליד', 'Add Lead')}
          </button>
        </div>
      </div>
    </div>
  )
}
