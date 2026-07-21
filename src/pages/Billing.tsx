import { useState, useMemo, useEffect } from 'react'
import {
  AlertTriangle, X, Send, CreditCard, TrendingDown,
  CheckCircle2, Clock, XCircle,
  Save, Check, Info, Loader2, AlertCircle, RefreshCw,
} from 'lucide-react'
import { useSettings } from '../context/SettingsContext'
import type { AppSettings } from '../config/defaults'
import { getBillingWithClients, updateBillingStatus } from '../lib/database'
import type { DbBillingWithClient } from '../lib/database'
import { useLang } from '../contexts/LanguageContext'

// ─── Types ────────────────────────────────────────────────────────────────────

type PackageType   = 'Solo Pro' | 'Master Class' | 'Community Master'
type PaymentStatus = 'paid' | 'unpaid' | 'pending' | 'failed'

interface FullRecord {
  id: string; clientId: string; month: string; monthEn: string
  clientName: string; package: PackageType
  fixed: number; otpPrice: number; otpCount: number; otpTotal: number
  userThreshold: number; blockSize: number; blockPrice: number
  usersCount: number; extraUsers: number; blocks: number; usersTotal: number
  variable: number; total: number
  amountPaid: number | null
  status: PaymentStatus; daysOpen?: number; paidAt?: string
}

const PKG_COLOR: Record<PackageType, string> = {
  'Solo Pro':         'bg-primary/10 text-primary',
  'Master Class':     'bg-secondary/20 text-secondary-dark',
  'Community Master': 'bg-purple-100 text-purple-700',
}

const STATUS_COLOR: Record<PaymentStatus, string> = {
  paid:    'bg-green-100 text-green-700',
  unpaid:  'bg-gray-100 text-gray-500',
  pending: 'bg-amber-100 text-amber-700',
  failed:  'bg-red-100 text-red-600',
}
const STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: 'שולם', unpaid: 'לא שולם', pending: 'ממתין אישור', failed: 'נכשל',
}
const STATUS_LABEL_EN: Record<PaymentStatus, string> = {
  paid: 'Paid', unpaid: 'Unpaid', pending: 'Pending', failed: 'Failed',
}
const STATUS_ICON: Record<PaymentStatus, React.ReactNode> = {
  paid:    <CheckCircle2 size={13} />,
  unpaid:  <Clock size={13} />,
  pending: <Clock size={13} />,
  failed:  <XCircle size={13} />,
}

// ─── DB → UI mapping ──────────────────────────────────────────────────────────

const DB_PKG_MAP: Record<string, PackageType> = {
  solo_pro: 'Solo Pro', master_class: 'Master Class', community_master: 'Community Master',
}

const HEB_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
const EN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtBillingMonth(month: number, year: number): string {
  return `${HEB_MONTHS[month - 1]} ${String(year).slice(-2)}`
}
function fmtBillingMonthEn(month: number, year: number): string {
  return `${EN_MONTHS[month - 1]} ${String(year).slice(-2)}`
}

function daysSince(isoStr: string): number {
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / 864e5)
}

function deriveStatus(
  cc: DbBillingWithClient['cc_status'],
  variable: DbBillingWithClient['variable_status'],
): PaymentStatus {
  if (cc === 'failed') return 'failed'
  if (variable === 'paid') return 'paid'
  if (variable === 'pending') return 'pending'
  return 'unpaid'
}

function dbRowToFullRecord(row: DbBillingWithClient, settings: AppSettings): FullRecord {
  const pkg        = row.clients?.package ?? 'solo_pro'
  const pkgUi      = DB_PKG_MAP[pkg] as PackageType
  const otpPrice   = row.clients?.otp_price     ?? settings.DEFAULT_OTP_PRICE
  const threshold  = row.clients?.user_threshold ?? settings.DEFAULT_USER_THRESHOLD
  const blockSize  = settings.DEFAULT_BLOCK_SIZE
  const blockPrice = row.clients?.block_price    ?? settings.DEFAULT_BLOCK_PRICE
  const extraUsers = Math.max(0, row.user_count - threshold)
  const blocks     = blockPrice > 0 ? Math.round(row.block_cost / blockPrice) : 0
  const status     = deriveStatus(row.cc_status, row.variable_status)
  return {
    id:            row.id,
    clientId:      row.client_id,
    month:         fmtBillingMonth(row.month, row.year),
    monthEn:       fmtBillingMonthEn(row.month, row.year),
    clientName:    row.clients?.name ?? '—',
    package:       pkgUi,
    fixed:         row.package_price,
    otpPrice,
    otpCount:      row.otp_count,
    otpTotal:      row.otp_cost,
    userThreshold: threshold,
    blockSize,
    blockPrice,
    usersCount:    row.user_count,
    extraUsers,
    blocks,
    usersTotal:    row.block_cost,
    variable:      row.variable_total,
    amountPaid:    row.amount_paid ?? null,
    total:         (row.amount_paid ?? 0) + row.variable_total,
    status,
    daysOpen:      status !== 'paid' ? daysSince(row.created_at) : undefined,
    paidAt:        row.payment_date
                     ? new Date(row.payment_date).toLocaleDateString('he-IL')
                     : undefined,
  }
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>{children}</span>
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-surface rounded-2xl border border-gray-100 shadow-sm ${className}`}>{children}</div>
}

function TH({ children }: { children: React.ReactNode }) {
  return <th className="text-right text-xs font-medium text-gray-400 px-4 py-3 whitespace-nowrap">{children}</th>
}

function TD({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3.5 text-sm ${className}`}>{children}</td>
}

// ─── Alert banner ─────────────────────────────────────────────────────────────

function AlertBanner({ records, onDismiss }: { records: FullRecord[]; onDismiss: () => void }) {
  const { t } = useLang()
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
      <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-red-700">{t('חיוב כרטיס אשראי נכשל', 'Credit card charge failed')}</p>
        <p className="text-xs text-red-500 mt-0.5">
          {records.map(r => `${r.clientName} — ₪${r.total.toLocaleString()}`).join(' · ')} — {t('יש לטפל בגבייה ידנית', 'needs manual collection')}
        </p>
      </div>
      <button onClick={onDismiss} className="text-red-300 hover:text-red-500 transition-colors shrink-0">
        <X size={16} />
      </button>
    </div>
  )
}

// ─── Payment request modal ────────────────────────────────────────────────────

function PaymentModal({ record, onClose, onConfirm }: {
  record: FullRecord; onClose: () => void; onConfirm: () => void
}) {
  const { t, dir } = useLang()
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md" dir={dir}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-primary">{t('בקשת תשלום — חיוב משתנה', 'Payment request — variable charge')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Client */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white font-bold shrink-0">
              {record.clientName[0]}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">{record.clientName}</p>
              <Badge className={PKG_COLOR[record.package]}>{record.package}</Badge>
            </div>
          </div>

          {/* Variable breakdown only */}
          <div className="space-y-2 text-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('פירוט חיוב משתנה', 'Variable charge breakdown')}</p>

            <div className="flex items-center justify-between text-gray-600">
              <span>OTP: {record.otpCount} × ₪{record.otpPrice}</span>
              <span className="font-medium">₪{record.otpTotal}</span>
            </div>

            {record.blocks > 0 ? (
              <div className="flex items-center justify-between text-gray-600">
                <span>
                  {record.usersCount.toLocaleString()} {t('משתמשים', 'users')} → {record.blocks} {t('בלוקים', 'blocks')} × ₪{record.blockPrice}
                </span>
                <span className="font-medium">₪{record.usersTotal}</span>
              </div>
            ) : (
              <div className="text-xs text-gray-400">
                {record.usersCount.toLocaleString()} {t('משתמשים', 'users')} — {t('מתחת לסף', 'below threshold')} ({record.userThreshold.toLocaleString()})
              </div>
            )}

            <div className="border-t border-gray-200 pt-3 flex items-center justify-between font-bold text-primary text-base">
              <span>{t('סה"כ לתשלום', 'Total due')}</span>
              <span>₪{record.variable.toLocaleString()}</span>
            </div>
          </div>

          {/* WooCommerce note */}
          <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
            {t('החיוב החודשי הקבוע נגבה אוטומטית דרך WooCommerce', 'The fixed monthly charge is collected automatically via WooCommerce')}
          </p>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-5">
          <button
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-2 bg-primary text-white py-2.5 rounded-xl text-sm font-medium hover:bg-primary-dark transition-colors"
          >
            <Send size={15} />
            {t('שלח בקשת תשלום', 'Send payment request')}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            {t('ביטול', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Open payments tab ────────────────────────────────────────────────────────

function OpenPaymentsTab({ records, onOpenModal }: {
  records: FullRecord[]; onOpenModal: (r: FullRecord) => void
}) {
  const { t } = useLang()
  if (!records.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-300">
        <CheckCircle2 size={36} className="mb-2" />
        <p className="text-sm">{t('כל החשבוניות שולמו', 'All invoices are paid')}</p>
      </div>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <TH>{t('לקוח', 'Customer')}</TH>
              <TH>{t('חבילה', 'Package')}</TH>
              <TH>{t('קבוע', 'Fixed')}</TH>
              <TH>OTP</TH>
              <TH>{t('משתמשים', 'Users')}</TH>
              <TH>{t('תוספת תשלום חודשית', 'Monthly add-on')}</TH>
              <TH>{t('סה"כ', 'Total')}</TH>
              <TH>{t('ימים פתוח', 'Days open')}</TH>
              <TH>{t('סטטוס', 'Status')}</TH>
              <TH>{t('פעולה', 'Action')}</TH>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {records.map(r => (
              <tr key={r.id} className="hover:bg-gray-50/40 transition-colors">
                <TD>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                      {r.clientName[0]}
                    </div>
                    <span className="font-medium text-gray-800">{r.clientName}</span>
                  </div>
                </TD>
                <TD><Badge className={PKG_COLOR[r.package]}>{r.package}</Badge></TD>
                <TD className="text-gray-600">₪{r.amountPaid?.toLocaleString() ?? '—'}</TD>
                <TD className="text-gray-600">{r.otpCount}</TD>
                <TD className="text-gray-600">{r.usersCount.toLocaleString()}</TD>
                <TD className="text-gray-600">₪{r.variable.toLocaleString()}</TD>
                <TD className="font-semibold text-primary">₪{((r.amountPaid ?? 0) + r.variable).toLocaleString()}</TD>
                <TD>
                  <span className={`text-xs font-medium ${r.daysOpen && r.daysOpen > 10 ? 'text-accent' : 'text-gray-500'}`}>
                    {r.daysOpen} {t('ימים', 'days')}
                  </span>
                </TD>
                <TD>
                  <Badge className={STATUS_COLOR[r.status]}>
                    {STATUS_ICON[r.status]}
                    {t(STATUS_LABEL[r.status], STATUS_LABEL_EN[r.status])}
                  </Badge>
                </TD>
                <TD>
                  <button
                    onClick={() => onOpenModal(r)}
                    className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg hover:bg-primary hover:text-white transition-colors font-medium whitespace-nowrap"
                  >
                    <Send size={12} />
                    {t('שלח בקשה', 'Send request')}
                  </button>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({ records }: { records: FullRecord[] }) {
  const { t } = useLang()
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <TH>{t('לקוח', 'Customer')}</TH>
              <TH>{t('חודש', 'Month')}</TH>
              <TH>{t('חבילה', 'Package')}</TH>
              <TH>{t('קבוע', 'Fixed')}</TH>
              <TH>OTP</TH>
              <TH>{t('משתמשים', 'Users')}</TH>
              <TH>{t('תוספת תשלום חודשית', 'Monthly add-on')}</TH>
              <TH>{t('סה"כ', 'Total')}</TH>
              <TH>{t('תאריך תשלום', 'Payment date')}</TH>
              <TH>{t('סטטוס', 'Status')}</TH>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {records.map(r => (
              <tr key={r.id} className="hover:bg-gray-50/40 transition-colors">
                <TD>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                      {r.clientName[0]}
                    </div>
                    <span className="font-medium text-gray-800">{r.clientName}</span>
                  </div>
                </TD>
                <TD className="text-gray-500 whitespace-nowrap">{t(r.month, r.monthEn)}</TD>
                <TD><Badge className={PKG_COLOR[r.package]}>{r.package}</Badge></TD>
                <TD className="text-gray-600">₪{r.amountPaid?.toLocaleString() ?? '—'}</TD>
                <TD className="text-gray-600">{r.otpCount}</TD>
                <TD className="text-gray-600">{r.usersCount.toLocaleString()}</TD>
                <TD className="text-gray-600">₪{r.variable.toLocaleString()}</TD>
                <TD className="font-semibold text-primary">₪{((r.amountPaid ?? 0) + r.variable).toLocaleString()}</TD>
                <TD className="text-gray-400 text-xs">{r.paidAt ?? '—'}</TD>
                <TD>
                  <Badge className={STATUS_COLOR[r.status]}>
                    {STATUS_ICON[r.status]}
                    {t(STATUS_LABEL[r.status], STATUS_LABEL_EN[r.status])}
                  </Badge>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── Pricing settings tab ─────────────────────────────────────────────────────

function NumInput({
  label, description, value, prefix, onChange,
}: {
  label: string; description: string; value: number
  prefix?: string; onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-0.5">{label}</label>
      <p className="text-xs text-gray-400 mb-2">{description}</p>
      <div className="relative">
        {prefix && (
          <span className="absolute top-1/2 -translate-y-1/2 end-3 text-sm text-gray-400 pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          type="number" min={0} step={prefix === '₪' ? 0.1 : 1}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full border border-gray-200 rounded-xl px-4 pe-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
        />
      </div>
    </div>
  )
}

function PricingTab() {
  const { t } = useLang()
  const { settings, updateSettings } = useSettings()
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [saved, setSaved] = useState(false)

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setDraft(d => ({ ...d, [k]: v }))

  const handleSave = () => {
    updateSettings(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings)

  return (
    <Card className="p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-primary mb-1">{t('תמחור ברירת מחדל', 'Default pricing')}</h2>
        <p className="text-xs text-gray-400">
          {t('ערכים אלה משמשים ללקוחות שלא הוגדר להם תמחור מותאם אישית.', 'These values apply to customers without custom pricing.')}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <NumInput
          label={t('מחיר OTP', 'OTP price')} description={t('תשלום לכל הודעת OTP שנשלחת', 'Charge per OTP message sent')}
          value={draft.DEFAULT_OTP_PRICE} prefix="₪"
          onChange={v => set('DEFAULT_OTP_PRICE', v)}
        />
        <NumInput
          label={t('סף משתמשים', 'User threshold')} description={t('מספר המשתמשים הכלול בחבילה הבסיסית', 'Users included in the base package')}
          value={draft.DEFAULT_USER_THRESHOLD}
          onChange={v => set('DEFAULT_USER_THRESHOLD', v)}
        />
        <NumInput
          label={t('גודל בלוק', 'Block size')} description={t('מספר משתמשים בכל בלוק נוסף', 'Users per additional block')}
          value={draft.DEFAULT_BLOCK_SIZE}
          onChange={v => set('DEFAULT_BLOCK_SIZE', v)}
        />
        <NumInput
          label={t('מחיר בלוק', 'Block price')} description={t('תשלום לכל בלוק של משתמשים נוספים', 'Charge per block of extra users')}
          value={draft.DEFAULT_BLOCK_PRICE} prefix="₪"
          onChange={v => set('DEFAULT_BLOCK_PRICE', v)}
        />
      </div>

      <div className="p-4 bg-primary/5 border border-primary/10 rounded-xl flex items-start gap-3">
        <Info size={16} className="text-primary shrink-0 mt-0.5" />
        <div className="text-xs text-primary/80 leading-relaxed space-y-1">
          <p className="font-semibold">{t('נוסחת חיוב משתנה:', 'Variable charge formula:')}</p>
          <p>
            <span className="font-mono bg-primary/10 px-1 rounded">OTPs × ₪{draft.DEFAULT_OTP_PRICE}</span>
            {' + '}
            <span className="font-mono bg-primary/10 px-1 rounded">
              ⌈max(0, {t('משתמשים', 'users')} − {draft.DEFAULT_USER_THRESHOLD.toLocaleString()}) / {draft.DEFAULT_BLOCK_SIZE}⌉ × ₪{draft.DEFAULT_BLOCK_PRICE}
            </span>
          </p>
          <p className="text-primary/60">
            {(() => {
              const EXAMPLE_OTPS  = 300
              const EXAMPLE_USERS = 500
              const otpCost    = EXAMPLE_OTPS * draft.DEFAULT_OTP_PRICE
              const excess     = Math.max(0, EXAMPLE_USERS - draft.DEFAULT_USER_THRESHOLD)
              const blocks     = Math.ceil(excess / draft.DEFAULT_BLOCK_SIZE)
              const blocksCost = blocks * draft.DEFAULT_BLOCK_PRICE
              return `${t('דוגמה', 'Example')}: ${EXAMPLE_OTPS} OTP + ${EXAMPLE_USERS} ${t('משתמשים', 'users')} = ₪${otpCost} + ${blocks} ${t('בלוקים', 'blocks')} × ₪${draft.DEFAULT_BLOCK_PRICE} = ₪${otpCost + blocksCost}`
            })()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!isDirty && !saved}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
            saved
              ? 'bg-green-500 text-white'
              : isDirty
                ? 'bg-primary text-white hover:bg-primary-dark'
                : 'bg-gray-100 text-gray-400 cursor-default'
          }`}
        >
          {saved ? <Check size={15} /> : <Save size={15} />}
          {saved ? t('נשמר בהצלחה', 'Saved') : t('שמור הגדרות', 'Save settings')}
        </button>
        {isDirty && !saved && (
          <button
            onClick={() => setDraft(settings)}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            {t('בטל שינויים', 'Discard changes')}
          </button>
        )}
      </div>
    </Card>
  )
}

// ─── Loading / error UI ───────────────────────────────────────────────────────

function BillingLoading() {
  const { t } = useLang()
  return (
    <div className="flex items-center justify-center gap-2 py-20 text-gray-400">
      <Loader2 size={22} className="animate-spin text-primary/40" />
      <span className="text-sm">{t('טוען נתוני חיוב...', 'Loading billing data...')}</span>
    </div>
  )
}

function BillingError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLang()
  return (
    <div className="flex flex-col items-center gap-3 py-20">
      <AlertCircle size={28} className="text-red-300" />
      <p className="text-sm text-red-500">{message}</p>
      <button onClick={onRetry} className="flex items-center gap-2 text-xs text-primary border border-primary/30 px-3 py-2 rounded-lg hover:bg-primary/5 transition-colors">
        <RefreshCw size={13} />{t('נסה שוב', 'Try again')}
      </button>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function Billing() {
  const { t } = useLang()
  const { settings } = useSettings()

  const [allRecords,     setAllRecords]     = useState<FullRecord[]>([])
  const [loading,        setLoading]        = useState(true)
  const [fetchError,     setFetchError]     = useState<string | null>(null)
  const [saveError,      setSaveError]      = useState<string | null>(null)
  const [dismissedAlert, setDismissedAlert] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<FullRecord | null>(null)
  const [activeTab,      setActiveTab]      = useState<'open' | 'history' | 'pricing'>('open')

  const load = async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const rows = await getBillingWithClients()
      setAllRecords(rows.map(r => dbRowToFullRecord(r, settings)))
    } catch (err) {
      const e = err as { message?: string; details?: string; hint?: string }
      console.error('getBillingWithClients failed', e.message, e.details, e.hint)
      setFetchError(e.message ?? t('שגיאה בטעינת נתוני חיוב', 'Error loading billing data'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openRecords  = useMemo(() => allRecords.filter(r => r.status !== 'paid'), [allRecords])
  const historyFull  = useMemo(() => allRecords.filter(r => r.status === 'paid'),  [allRecords])

  const totalBilled   = allRecords.reduce((s, r) => s + r.total, 0)
  const totalReceived = historyFull.reduce((s, r) => s + r.total, 0)
  const totalOpen     = openRecords.reduce((s, r) => s + r.total, 0)
  const totalOtp      = allRecords.reduce((s, r) => s + r.otpCount, 0)

  const failedRecords = openRecords.filter(r => r.status === 'failed')

  const handleConfirmSend = async () => {
    if (!selectedRecord) return
    // Optimistic update
    setAllRecords(prev => prev.map(r => r.id === selectedRecord.id ? { ...r, status: 'pending' as PaymentStatus } : r))
    setSelectedRecord(null)
    try {
      await updateBillingStatus(selectedRecord.id, 'variable_status', 'pending')
    } catch (err) {
      const e = err as { message?: string; details?: string; hint?: string }
      console.error('updateBillingStatus failed', e.message, e.details, e.hint)
      setSaveError(e.message ?? t('שגיאה בעדכון סטטוס', 'Error updating status'))
      load()
    }
  }

  if (loading) return <BillingLoading />
  if (fetchError) return <BillingError message={fetchError} onRetry={load} />

  const STATS = [
    { label: t('סה"כ חויב', 'Total billed'),      value: `₪${totalBilled.toLocaleString()}`,   icon: CreditCard,   color: 'text-primary',       bg: 'bg-primary/10'   },
    { label: t('סה"כ התקבל', 'Total received'),   value: `₪${totalReceived.toLocaleString()}`, icon: CheckCircle2, color: 'text-green-600',     bg: 'bg-green-100'    },
    { label: t('פתוח לגבייה', 'Open to collect'), value: `₪${totalOpen.toLocaleString()}`,     icon: TrendingDown, color: 'text-accent',        bg: 'bg-accent/10'    },
    { label: t('סה"כ OTP', 'Total OTP'),          value: totalOtp.toLocaleString(),             icon: Clock,        color: 'text-secondary-dark', bg: 'bg-secondary/15' },
  ]

  return (
    <div className="space-y-5 max-w-7xl mx-auto">

      {/* Save error banner */}
      {saveError && (
        <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          <div className="flex items-center gap-2"><AlertCircle size={15} /><span>{saveError}</span></div>
          <button onClick={() => setSaveError(null)}><X size={15} /></button>
        </div>
      )}

      {/* Alert: failed charges */}
      {failedRecords.length > 0 && !dismissedAlert && (
        <AlertBanner records={failedRecords} onDismiss={() => setDismissedAlert(true)} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${bg}`}>
              <Icon size={18} className={color} />
            </div>
            <div className="min-w-0">
              <p className={`text-xl font-bold truncate ${color}`}>{value}</p>
              <p className="text-xs text-gray-400 truncate">{label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div>
        <div className="flex gap-1 mb-4 bg-gray-100/60 p-1 rounded-xl w-fit">
          {([
            { id: 'open',    label: openRecords.length  ? `${t('תשלומים פתוחים', 'Open payments')} (${openRecords.length})` : t('תשלומים פתוחים', 'Open payments') },
            { id: 'history', label: historyFull.length ? `${t('היסטוריה', 'History')} (${historyFull.length})`             : t('היסטוריה', 'History') },
            { id: 'pricing', label: t('הגדרות תמחור', 'Pricing settings') },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === t.id
                  ? 'bg-surface text-primary shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'open' && (
          <OpenPaymentsTab records={openRecords} onOpenModal={setSelectedRecord} />
        )}
        {activeTab === 'history' && (
          <HistoryTab records={historyFull} />
        )}
        {activeTab === 'pricing' && <PricingTab />}
      </div>

      {/* Modal */}
      {selectedRecord && (
        <PaymentModal
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onConfirm={handleConfirmSend}
        />
      )}
    </div>
  )
}
