import { useState, useEffect } from 'react'
import { Loader2, Save, AlertCircle, CheckCircle2, Mail, Lock } from 'lucide-react'
import {
  getEmailTemplate, saveEmailTemplate,
  EMAIL_TEMPLATE_DEFAULTS, type EmailTemplateInput,
} from '../lib/database'
import { useLang } from '../contexts/LanguageContext'

export function EmailFormat() {
  const { lang } = useLang()
  const isHe = lang === 'he'

  const [form, setForm] = useState<EmailTemplateInput>(EMAIL_TEMPLATE_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getEmailTemplate()
      .then(row => setForm({
        subject:    row.subject,
        header:     row.header,
        body_above: row.body_above,
        body_below: row.body_below,
        footer:     row.footer,
      }))
      .catch(() => setError(isHe ? 'שגיאה בטעינת התבנית' : 'Failed to load template'))
      .finally(() => setLoading(false))
  }, [])

  function set(field: keyof EmailTemplateInput, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    setSaved(false)
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const saved = await saveEmailTemplate(form)
      setForm({
        subject:    saved.subject,
        header:     saved.header,
        body_above: saved.body_above,
        body_below: saved.body_below,
        footer:     saved.footer,
      })
      setSaved(true)
    } catch {
      setError(isHe ? 'שגיאה בשמירת התבנית' : 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={28} className="text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Mail size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {isHe ? 'פורמט אימייל' : 'Email Format'}
          </h1>
          <p className="text-sm text-gray-500">
            {isHe
              ? 'התאם אישית את האימייל שיישלח לכל לקוח חדש לאחר רכישה'
              : 'Customize the welcome email sent to every new client after purchase'}
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">

        {/* Subject */}
        <Field
          label={isHe ? 'נושא האימייל' : 'Email Subject'}
          hint={isHe ? 'שורת הנושא שהמשתמש יראה בתיבת הדואר' : 'The subject line the recipient sees in their inbox'}
        >
          <input
            type="text"
            value={form.subject}
            onChange={e => set('subject', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        {/* Header */}
        <Field
          label={isHe ? 'כותרת' : 'Header'}
          hint={isHe ? 'הכותרת הגדולה בראש האימייל' : 'The large heading at the top of the email'}
        >
          <input
            type="text"
            value={form.header}
            onChange={e => set('header', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        {/* Body above */}
        <Field
          label={isHe ? 'טקסט מעל פרטי הכניסה' : 'Text above login details'}
          hint={isHe ? 'הטקסט שמופיע לפני האימייל והסיסמה' : 'Appears just before the email and password block'}
        >
          <textarea
            rows={3}
            value={form.body_above}
            onChange={e => set('body_above', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
        </Field>

        {/* Fixed credentials placeholder */}
        <div className="px-6 py-4 bg-gray-50">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
            {isHe ? 'פרטי כניסה — קבוע, ממולא אוטומטית' : 'Login details — fixed, auto-filled'}
          </p>
          <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white px-5 py-4 space-y-3">
            <div className="flex items-center gap-3">
              <Mail size={15} className="text-gray-400 shrink-0" />
              <div className="flex-1">
                <span className="text-xs text-gray-400 font-medium">
                  {isHe ? 'אימייל:' : 'Email:'}
                </span>
                <span className="ml-2 text-sm text-gray-500 italic">
                  {isHe ? 'כתובת האימייל של הלקוח' : "Client's email address"}
                </span>
              </div>
              <Lock size={13} className="text-gray-300" />
            </div>
            <div className="flex items-center gap-3">
              <Lock size={15} className="text-gray-400 shrink-0" />
              <div className="flex-1">
                <span className="text-xs text-gray-400 font-medium">
                  {isHe ? 'סיסמה:' : 'Password:'}
                </span>
                <span className="ml-2 text-sm text-gray-500 italic">
                  {isHe ? 'הסיסמה שנוצרה אוטומטית' : 'Auto-generated password'}
                </span>
              </div>
              <Lock size={13} className="text-gray-300" />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {isHe
              ? 'שדות אלו אינם ניתנים לעריכה — הם ממולאים אוטומטית בעת שליחת האימייל'
              : 'These fields are not editable — they are filled in automatically when the email is sent'}
          </p>
        </div>

        {/* Body below */}
        <Field
          label={isHe ? 'טקסט מתחת לפרטי הכניסה' : 'Text below login details'}
          hint={isHe ? 'הטקסט שמופיע אחרי האימייל והסיסמה' : 'Appears just after the email and password block'}
        >
          <textarea
            rows={3}
            value={form.body_below}
            onChange={e => set('body_below', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
        </Field>

        {/* Footer */}
        <Field
          label={isHe ? 'חתימה / פוטר' : 'Footer / Signature'}
          hint={isHe ? 'הטקסט הקטן בתחתית האימייל' : 'Small closing text at the bottom of the email'}
        >
          <input
            type="text"
            value={form.footer}
            onChange={e => set('footer', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </Field>
      </div>

      {/* Save bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {error && (
            <>
              <AlertCircle size={16} className="text-red-500 shrink-0" />
              <p className="text-sm text-red-600">{error}</p>
            </>
          )}
          {saved && !error && (
            <>
              <CheckCircle2 size={16} className="text-green-500 shrink-0" />
              <p className="text-sm text-green-600">
                {isHe ? 'נשמר בהצלחה' : 'Saved successfully'}
              </p>
            </>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {saving
            ? <Loader2 size={15} className="animate-spin" />
            : <Save size={15} />}
          {isHe ? 'שמור' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function Field({
  label, hint, children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="px-6 py-5 space-y-2">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="text-xs text-gray-400">{hint}</p>
      </div>
      {children}
    </div>
  )
}
