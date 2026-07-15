import { useState, useMemo, useEffect } from 'react'
import {
  ArrowRight, Search, Users, CreditCard, TrendingUp, Clock,
  Pencil, Save, X, Check, CheckCheck, AlertCircle,
  MessageSquare, Ticket, ChevronDown, ChevronUp, Plus, Trash2, Loader2, RefreshCw,
} from 'lucide-react'
import { useSettings } from '../context/SettingsContext'
import type { AppSettings } from '../config/defaults'
import {
  getClients,
  updateClient as dbUpdateClient,
  updateClientContacts as dbUpdateClientContacts,
  getBillingRecords,
} from '../lib/database'
import type { DbClient, DbContact, DbBillingRecord } from '../lib/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type PackageType   = 'Solo Pro' | 'Master Class' | 'Community Master'
type ClientStatus  = 'active' | 'pending' | 'on_hold' | 'expired' | 'cancelled'
type TabId         = 'details' | 'billing' | 'whatsapp' | 'tickets'
type MsgStatus     = 'sent' | 'read' | 'failed'
type TicketStatus  = 'open' | 'pending' | 'closed'
type TicketPriority = 'low' | 'medium' | 'high'
type ContactRole   = 'בעלים' | 'מנהל אפליקציה' | 'מזין תוכן' | 'אחר'

interface Contact {
  id: string
  name: string
  phone: string
  role: ContactRole
  receivesPayments: boolean  // only one per client
  receivesUpdates: boolean   // multiple allowed
}

interface Client {
  id: string
  name: string
  businessName: string
  email: string
  phone: string
  package: PackageType
  joinDate: string
  status: ClientStatus
  subscriptionMonth: number
  otpPrice?: number
  userThreshold?: number
  blockPrice?: number
  notes: string
  contacts: Contact[]
}

interface BillingMonth {
  month: string; fixed: number; otpCount: number; otpTotal: number
  usersCount: number; extraUsers: number; blocks: number
  usersTotal: number; total: number; paid: boolean
}

interface WhatsAppMsg {
  id: string; direction: 'in' | 'out'; content: string; time: string; status: MsgStatus
}

interface SupportTicket {
  id: string; subject: string; status: TicketStatus
  priority: TicketPriority; createdAt: string; closedAt?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PACKAGE_PRICE: Record<PackageType, number> = {
  'Solo Pro': 140, 'Master Class': 235, 'Community Master': 370,
}
const PKG_COLOR: Record<PackageType, string> = {
  'Solo Pro':          'bg-primary/10 text-primary',
  'Master Class':      'bg-secondary/20 text-secondary-dark',
  'Community Master':  'bg-purple-100 text-purple-700',
}
const STATUS_COLOR: Record<ClientStatus, string> = {
  active:   'bg-green-100 text-green-700',
  pending:  'bg-yellow-100 text-yellow-700',
  on_hold:  'bg-orange-100 text-orange-600',
  expired:  'bg-gray-100 text-gray-500',
  cancelled:'bg-red-100 text-red-600',
}
const STATUS_LABEL: Record<ClientStatus, string> = {
  active: 'פעיל', pending: 'ממתין', on_hold: 'מושהה', expired: 'פג תוקף', cancelled: 'בוטל',
}

const TICKET_PRIORITY_COLOR: Record<TicketPriority, string> = {
  high: 'bg-red-100 text-red-600', medium: 'bg-amber-100 text-amber-600', low: 'bg-gray-100 text-gray-500',
}
const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = { high: 'דחוף', medium: 'בינוני', low: 'נמוך' }
const TICKET_STATUS_COLOR: Record<TicketStatus, string> = {
  open: 'bg-blue-100 text-blue-700', pending: 'bg-amber-100 text-amber-700', closed: 'bg-gray-100 text-gray-400',
}
const TICKET_STATUS_LABEL: Record<TicketStatus, string> = { open: 'פתוח', pending: 'בטיפול', closed: 'סגור' }

const ROLE_OPTIONS: ContactRole[] = ['בעלים', 'מנהל אפליקציה', 'מזין תוכן', 'אחר']
const ROLE_COLOR: Record<ContactRole, string> = {
  'בעלים':            'bg-primary/10 text-primary',
  'מנהל אפליקציה':   'bg-secondary/20 text-teal-700',
  'מזין תוכן':        'bg-violet-100 text-violet-700',
  'אחר':              'bg-gray-100 text-gray-500',
}

// ─── DB → UI mapping ──────────────────────────────────────────────────────────

const DB_PACKAGE_MAP: Record<DbClient['package'], PackageType> = {
  solo_pro:          'Solo Pro',
  master_class:      'Master Class',
  community_master:  'Community Master',
}

const UI_PACKAGE_MAP: Record<PackageType, DbClient['package']> = {
  'Solo Pro':         'solo_pro',
  'Master Class':     'master_class',
  'Community Master': 'community_master',
}

const DB_ROLE_MAP: Record<DbContact['role'], ContactRole> = {
  owner:           'בעלים',
  app_manager:     'מנהל אפליקציה',
  content_manager: 'מזין תוכן',
  other:           'אחר',
}

const UI_ROLE_MAP: Record<ContactRole, DbContact['role']> = {
  'בעלים':           'owner',
  'מנהל אפליקציה':  'app_manager',
  'מזין תוכן':       'content_manager',
  'אחר':             'other',
}

function calcSubscriptionMonth(joinedAt: string | null): number {
  if (!joinedAt) return 1
  const joined = new Date(joinedAt)
  const now    = new Date()
  return Math.max(1, (now.getFullYear() - joined.getFullYear()) * 12 + now.getMonth() - joined.getMonth() + 1)
}

function dbContactToContact(c: DbContact): Contact {
  return {
    id:               c.id,
    name:             c.name,
    phone:            c.phone,
    role:             DB_ROLE_MAP[c.role],
    receivesPayments: c.receives_payments,
    receivesUpdates:  c.receives_updates,
  }
}

function dbClientToClient(row: DbClient): Client {
  return {
    id:                row.id,
    name:              row.name,
    businessName:      row.business_name,
    email:             row.email ?? '',
    phone:             row.phone ?? '',
    package:           DB_PACKAGE_MAP[row.package],
    joinDate:          row.joined_at ?? '',
    status:            row.status,
    subscriptionMonth: calcSubscriptionMonth(row.joined_at),
    otpPrice:          row.otp_price     ?? undefined,
    userThreshold:     row.user_threshold ?? undefined,
    blockPrice:        row.block_price    ?? undefined,
    notes:             row.notes ?? '',
    contacts:          (row.client_contacts ?? []).map(dbContactToContact),
  }
}

function clientToDbUpdate(c: Client): Parameters<typeof dbUpdateClient>[1] {
  return {
    name:           c.name,
    business_name:  c.businessName,
    email:          c.email || null,
    phone:          c.phone || null,
    package:        UI_PACKAGE_MAP[c.package],
    joined_at:      c.joinDate || null,
    status:         c.status,
    notes:          c.notes || null,
    otp_price:      c.otpPrice     ?? null,
    user_threshold: c.userThreshold ?? null,
    block_price:    c.blockPrice    ?? null,
  }
}

function contactToDbInsert(c: Contact): Omit<DbContact, 'id' | 'client_id' | 'created_at'> {
  return {
    name:             c.name,
    phone:            c.phone,
    role:             UI_ROLE_MAP[c.role],
    receives_payments: c.receivesPayments,
    receives_updates:  c.receivesUpdates,
  }
}

const HEB_MONTHS = ['', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
const fmtBillingMonth = (m: number, y: number) => `${HEB_MONTHS[m]} ${String(y).slice(2)}`

function generateBilling(client: Client, settings: AppSettings): BillingMonth[] {
  const MONTHS = ['ינואר 25', 'פברואר 25', 'מרץ 25', 'אפריל 25', 'מאי 25', 'יוני 25']
  const effOtpPrice   = client.otpPrice      ?? settings.DEFAULT_OTP_PRICE
  const effThreshold  = client.userThreshold ?? settings.DEFAULT_USER_THRESHOLD
  const effBlockPrice = client.blockPrice    ?? settings.DEFAULT_BLOCK_PRICE
  const effBlockSize  = settings.DEFAULT_BLOCK_SIZE
  const seed = parseInt(client.id)
  return MONTHS.map((month, i) => {
    const otpCount   = 80 + ((seed * 37 + i * 53) % 250)
    const usersCount = 200 + ((seed * 71 + i * 29) % 1500)
    const otpTotal   = Math.round(otpCount * effOtpPrice * 100) / 100
    const extraUsers = Math.max(0, usersCount - effThreshold)
    const blocks     = Math.ceil(extraUsers / effBlockSize)
    const usersTotal = blocks * effBlockPrice
    const fixed      = PACKAGE_PRICE[client.package]
    return { month, fixed, otpCount, otpTotal, usersCount, extraUsers, blocks, usersTotal, total: fixed + otpTotal + usersTotal, paid: i < 5 }
  })
}

const WHATSAPP: Record<string, WhatsAppMsg[]> = {
  '1': [
    { id: 'a', direction: 'out', content: 'שלום יוסי! החשבון החודשי שלך מוכן לתשלום. סה"כ ₪245. לתשלום לחץ כאן.',       time: '01/06 09:00', status: 'read'   },
    { id: 'b', direction: 'in',  content: 'תודה, שילמתי.',                                                                 time: '01/06 09:45', status: 'read'   },
    { id: 'c', direction: 'out', content: 'מעולה! הקבלה נשלחה לאימייל שלך. תודה על הנאמנות.',                            time: '01/06 09:46', status: 'read'   },
    { id: 'd', direction: 'out', content: 'תזכורת: המנוי שלך מסתיים בחודש הבא. נשמח לחדש אותו בקלות, צור קשר!',         time: '15/06 10:00', status: 'sent'   },
  ],
  '2': [
    { id: 'a', direction: 'out', content: 'שלום מרים, OTP השתמשת ב-180 החודש. החשבון: ₪379.',                           time: '01/06 08:00', status: 'read'   },
    { id: 'b', direction: 'in',  content: 'בסדר, אפשר לקבל פירוט?',                                                       time: '01/06 08:30', status: 'read'   },
    { id: 'c', direction: 'out', content: 'כמובן: ₪235 קבוע + ₪144 עבור 180 OTP (₪0.8 ליחידה).',                       time: '01/06 08:31', status: 'read'   },
    { id: 'd', direction: 'in',  content: 'מצוין, תודה.',                                                                 time: '01/06 08:35', status: 'read'   },
  ],
  '5': [
    { id: 'a', direction: 'out', content: 'שלום נועה! המנוי שלך מתקרב לסיום (חודש 11). ניתן לחדש בתנאים מיוחדים.', time: '20/06 09:00', status: 'sent'   },
    { id: 'b', direction: 'out', content: 'האם קיבלת את ההודעה הקודמת?',                                           time: '22/06 10:00', status: 'failed' },
  ],
}

const TICKETS: Record<string, SupportTicket[]> = {
  '1': [
    { id: 't1', subject: 'בעיה בהתחברות לאפליקציה', status: 'closed',  priority: 'high',   createdAt: '10/05/2025', closedAt: '11/05/2025' },
    { id: 't2', subject: 'שאלה לגבי תמחור OTP',     status: 'open',    priority: 'medium', createdAt: '02/06/2025' },
  ],
  '2': [{ id: 't1', subject: 'שגיאה בייצוא דוחות',     status: 'pending', priority: 'medium', createdAt: '25/05/2025' }],
  '3': [
    { id: 't1', subject: 'עדכון כתובת חיוב',          status: 'closed',  priority: 'low',    createdAt: '01/04/2025', closedAt: '02/04/2025' },
    { id: 't2', subject: 'הגדלת מכסת משתמשים',        status: 'open',    priority: 'high',   createdAt: '10/06/2025' },
  ],
  '5': [{ id: 't1', subject: 'בעיה בשליחת הודעות WA', status: 'open',    priority: 'high',   createdAt: '18/06/2025' }],
  '8': [{ id: 't1', subject: 'עזרה בהגדרת onboarding', status: 'pending', priority: 'medium', createdAt: '12/06/2025' }],
}

// ─── Loading / error states ───────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-400">
      <Loader2 size={32} className="animate-spin text-primary/40" />
      <p className="text-sm">טוען לקוחות...</p>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-400">
      <AlertCircle size={32} className="text-red-300" />
      <p className="text-sm text-red-500">{message}</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 text-xs text-primary border border-primary/30 px-3 py-2 rounded-lg hover:bg-primary/5 transition-colors"
      >
        <RefreshCw size={13} />נסה שוב
      </button>
    </div>
  )
}

function SaveErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 mb-4">
      <div className="flex items-center gap-2">
        <AlertCircle size={15} className="shrink-0" />
        <span>שגיאה בשמירה: {message}</span>
      </div>
      <button onClick={onDismiss} className="text-red-400 hover:text-red-600"><X size={15} /></button>
    </div>
  )
}

// ─── Shared UI pieces ─────────────────────────────────────────────────────────

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>{children}</span>
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-surface rounded-2xl border border-gray-100 shadow-sm ${className}`}>{children}</div>
}

function Field({ label, value, editing, onChange }: { label: string; value: string; editing: boolean; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {editing
        ? <input value={value} onChange={e => onChange(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
        : <p className="text-sm font-medium text-gray-800">{value}</p>}
    </div>
  )
}

function NumberField({ label, value, editing, onChange, prefix = '', defaultVal }: {
  label: string; value: number | undefined; editing: boolean
  onChange: (v: number | undefined) => void; prefix?: string; defaultVal?: number
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {editing
        ? <div className="relative">
            {prefix && <span className="absolute top-1/2 -translate-y-1/2 end-3 text-xs text-gray-400">{prefix}</span>}
            <input type="number"
              value={value ?? ''} placeholder={defaultVal !== undefined ? `ברירת מחדל: ${defaultVal}` : ''}
              onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
              className="w-full border border-gray-200 rounded-lg px-3 pe-7 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        : value !== undefined
          ? <p className="text-sm font-medium text-gray-800">{prefix}{value}</p>
          : <p className="text-sm text-gray-400 italic">ברירת מחדל: {prefix}{defaultVal}</p>
      }
    </div>
  )
}

// ─── Contacts section ─────────────────────────────────────────────────────────

function ContactRow({
  contact, editing, onUpdate, onRemove,
}: {
  contact: Contact
  editing: boolean
  onUpdate: (field: keyof Contact, value: unknown) => void
  onRemove: () => void
}) {
  const initials = contact.name
    ? contact.name.split(' ').slice(0, 2).map(w => w[0]).join('')
    : '?'

  if (!editing) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/30">
        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-800">{contact.name || '—'}</span>
            <Badge className={ROLE_COLOR[contact.role]}>{contact.role}</Badge>
          </div>
          <p className="text-xs text-gray-400 mt-0.5" dir="ltr">{contact.phone || '—'}</p>
        </div>
        <div className="flex items-center gap-1.5 text-base shrink-0">
          {contact.receivesPayments && <span title="מקבל דרישות תשלום">💳</span>}
          {contact.receivesUpdates  && <span title="מקבל עדכונים">📢</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 rounded-xl border border-gray-200 bg-white space-y-2.5">
      <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
        <input
          value={contact.name} onChange={e => onUpdate('name', e.target.value)}
          placeholder="שם מלא"
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
        <input
          value={contact.phone} onChange={e => onUpdate('phone', e.target.value)}
          placeholder="טלפון" dir="ltr"
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
        <select
          value={contact.role} onChange={e => onUpdate('role', e.target.value as ContactRole)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        >
          {ROLE_OPTIONS.map(r => <option key={r}>{r}</option>)}
        </select>
        <button onClick={onRemove} className="p-1 text-red-300 hover:text-red-500 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox" checked={contact.receivesPayments}
            onChange={e => onUpdate('receivesPayments', e.target.checked)}
            className="rounded accent-primary"
          />
          💳 מקבל דרישות תשלום
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox" checked={contact.receivesUpdates}
            onChange={e => onUpdate('receivesUpdates', e.target.checked)}
            className="rounded accent-primary"
          />
          📢 מקבל עדכונים
        </label>
      </div>
    </div>
  )
}

function ContactsSection({
  contacts, editing, onChange,
}: {
  contacts: Contact[]
  editing: boolean
  onChange: (contacts: Contact[]) => void
}) {
  const addContact = () => {
    const base = contacts.length === 0
    onChange([...contacts, {
      id: `c-${Date.now()}`,
      name: '', phone: '',
      role: contacts.some(c => c.role === 'בעלים') ? 'אחר' : 'בעלים',
      receivesPayments: base,
      receivesUpdates:  base,
    }])
  }

  const removeContact = (id: string) => {
    const next = contacts.filter(c => c.id !== id)
    if (next.length === 1) {
      onChange([{ ...next[0], receivesPayments: true, receivesUpdates: true }])
    } else {
      onChange(next)
    }
  }

  const updateContact = (id: string, field: keyof Contact, value: unknown) => {
    if (field === 'receivesPayments') {
      if (value === true) {
        onChange(contacts.map(c => ({ ...c, receivesPayments: c.id === id })))
      } else {
        // block unchecking the last payment recipient
        const others = contacts.filter(c => c.id !== id && c.receivesPayments)
        if (others.length === 0) return
        onChange(contacts.map(c => c.id === id ? { ...c, receivesPayments: false } : c))
      }
    } else {
      onChange(contacts.map(c => c.id === id ? { ...c, [field]: value } : c))
    }
  }

  const paymentContact = contacts.find(c => c.receivesPayments)
  const updateContacts = contacts.filter(c => c.receivesUpdates)

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-primary">אנשי קשר</h3>
          {!editing && contacts.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {[
                paymentContact && `💳 ${paymentContact.name}`,
                updateContacts.length > 0 && `📢 ${updateContacts.map(c => c.name).join(', ')}`,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {editing && (
          <button
            onClick={addContact}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark border border-primary/30 hover:border-primary bg-primary/5 hover:bg-primary/10 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={12} />הוסף
          </button>
        )}
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-gray-400">
          {editing ? 'לחץ "+ הוסף" להוספת איש קשר.' : 'אין אנשי קשר מוגדרים.'}
        </p>
      ) : (
        <div className="space-y-2">
          {contacts.map(contact => (
            <ContactRow
              key={contact.id}
              contact={contact}
              editing={editing}
              onUpdate={(field, value) => updateContact(contact.id, field, value)}
              onRemove={() => removeContact(contact.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function DetailsTab({ client, onSave }: { client: Client; onSave: (c: Client) => void }) {
  const { settings } = useSettings()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(client)

  const set = <K extends keyof Client>(k: K, v: Client[K]) => setDraft(d => ({ ...d, [k]: v }))

  const handleSave   = () => { onSave(draft); setEditing(false) }
  const handleCancel = () => { setDraft(client); setEditing(false) }

  return (
    <div className="space-y-6 p-5">
      {/* Contact info */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-primary">פרטי קשר</h3>
          {!editing
            ? <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary transition-colors"><Pencil size={13} />עריכה</button>
            : <div className="flex gap-2">
                <button onClick={handleSave}   className="flex items-center gap-1 text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary-dark transition-colors"><Save size={12} />שמור</button>
                <button onClick={handleCancel} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg transition-colors"><X size={12} />ביטול</button>
              </div>
          }
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="שם מלא" value={draft.name}         editing={editing} onChange={v => set('name', v)} />
          <Field label="שם עסק" value={draft.businessName} editing={editing} onChange={v => set('businessName', v)} />
          <Field label="אימייל" value={draft.email}        editing={editing} onChange={v => set('email', v)} />
        </div>
      </section>

      {/* Contacts section */}
      <ContactsSection
        contacts={draft.contacts}
        editing={editing}
        onChange={contacts => set('contacts', contacts)}
      />

      {/* Subscription */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-4">פרטי מנוי</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">חבילה</label>
            <Badge className={PKG_COLOR[client.package]}>{client.package}</Badge>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">סטטוס</label>
            {editing
              ? <select value={draft.status} onChange={e => set('status', e.target.value as ClientStatus)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                  <option value="active">פעיל</option>
                  <option value="on_hold">מושהה</option>
                  <option value="cancelled">בוטל</option>
                  <option value="pending">ממתין</option>
                  <option value="expired">פג תוקף</option>
                </select>
              : <Badge className={STATUS_COLOR[draft.status]}>{STATUS_LABEL[draft.status]}</Badge>
            }
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">חודש מנוי</label>
            <span className={`text-sm font-semibold ${client.subscriptionMonth >= 11 ? 'text-accent' : 'text-gray-800'}`}>
              {client.subscriptionMonth} / 12
            </span>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">תאריך הצטרפות</label>
            <p className="text-sm font-medium text-gray-800">{client.joinDate}</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">מחיר חבילה</label>
            <p className="text-sm font-medium text-gray-800">₪{PACKAGE_PRICE[client.package]}/חודש</p>
          </div>
        </div>
      </section>

      {/* Custom pricing */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-4">תמחור מותאם אישית</h3>
        <div className="grid grid-cols-3 gap-4">
          <NumberField label="מחיר OTP"     value={draft.otpPrice}      editing={editing} onChange={v => set('otpPrice', v)}      prefix="₪" defaultVal={settings.DEFAULT_OTP_PRICE} />
          <NumberField label="סף משתמשים"   value={draft.userThreshold} editing={editing} onChange={v => set('userThreshold', v)}             defaultVal={settings.DEFAULT_USER_THRESHOLD} />
          <NumberField label={`מחיר בלוק (${settings.DEFAULT_BLOCK_SIZE})`} value={draft.blockPrice} editing={editing} onChange={v => set('blockPrice', v)} prefix="₪" defaultVal={settings.DEFAULT_BLOCK_PRICE} />
        </div>
        <p className="text-xs text-gray-400 mt-3">
          * חיוב משתנה: ₪{draft.otpPrice ?? settings.DEFAULT_OTP_PRICE} לכל OTP
          {' + '}₪{draft.blockPrice ?? settings.DEFAULT_BLOCK_PRICE} לכל {settings.DEFAULT_BLOCK_SIZE} משתמשים מעל {(draft.userThreshold ?? settings.DEFAULT_USER_THRESHOLD).toLocaleString()}
        </p>
      </section>

      {/* Notes */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-3">הערות</h3>
        {editing
          ? <textarea value={draft.notes} onChange={e => set('notes', e.target.value)} rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          : <p className="text-sm text-gray-500">{client.notes || '—'}</p>
        }
      </section>
    </div>
  )
}

function BillingTable({ billing }: { billing: BillingMonth[] }) {
  const total = billing.reduce((s, r) => s + r.total, 0)
  const paid  = billing.filter(r => r.paid).reduce((s, r) => s + r.total, 0)
  return (
    <div className="p-5">
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'סה"כ תקופה',  value: `₪${total.toLocaleString()}`,          color: 'text-primary'   },
          { label: 'שולם',        value: `₪${paid.toLocaleString()}`,            color: 'text-green-600' },
          { label: 'יתרה לגבייה', value: `₪${(total - paid).toLocaleString()}`, color: 'text-accent'    },
        ].map(s => (
          <Card key={s.label} className="p-4 text-center">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {['חודש', 'קבוע', 'OTP כמות', 'OTP ₪', 'משתמשים', 'בלוקים', '₪ משתנה', 'סה"כ', 'שולם'].map(h => (
                  <th key={h} className="text-right text-xs font-medium text-gray-400 px-4 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {billing.map(r => (
                <tr key={r.month} className="hover:bg-gray-50/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">{r.month}</td>
                  <td className="px-4 py-3 text-gray-600">₪{r.fixed}</td>
                  <td className="px-4 py-3 text-gray-600">{r.otpCount}</td>
                  <td className="px-4 py-3 text-gray-600">₪{r.otpTotal}</td>
                  <td className="px-4 py-3 text-gray-600">{r.usersCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{r.blocks}</td>
                  <td className="px-4 py-3 text-gray-600">₪{r.usersTotal}</td>
                  <td className="px-4 py-3 font-semibold text-primary">₪{r.total.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {r.paid
                      ? <span className="inline-flex items-center gap-1 text-green-600 text-xs"><Check size={12} />שולם</span>
                      : <span className="inline-flex items-center gap-1 text-amber-500 text-xs"><Clock size={12} />ממתין</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function BillingTab({ client }: { client: Client }) {
  const { settings } = useSettings()
  const [records, setRecords] = useState<DbBillingRecord[] | null>(null)
  const [connErr, setConnErr] = useState(false)

  useEffect(() => {
    setRecords(null)
    setConnErr(false)
    getBillingRecords(client.id)
      .then(setRecords)
      .catch(() => setConnErr(true))
  }, [client.id])

  // No Supabase connection — fall back to generated mock data
  if (connErr) {
    return <BillingTable billing={generateBilling(client, settings)} />
  }

  if (records === null) {
    return (
      <div className="flex items-center justify-center h-36 gap-2 text-gray-400">
        <Loader2 size={18} className="animate-spin text-primary/40" />
        <span className="text-sm">טוען נתוני חיוב...</span>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
        <CreditCard size={28} className="text-gray-200" />
        <p className="text-sm">אין היסטוריית חיובים עדיין</p>
      </div>
    )
  }

  const effBlockPrice = client.blockPrice ?? settings.DEFAULT_BLOCK_PRICE
  const effBlockSize  = settings.DEFAULT_BLOCK_SIZE

  const billing: BillingMonth[] = records.map(r => {
    const blocks = effBlockPrice > 0 ? Math.round(r.block_cost / effBlockPrice) : 0
    return {
      month:      fmtBillingMonth(r.month, r.year),
      fixed:      r.package_price,
      otpCount:   r.otp_count,
      otpTotal:   r.otp_cost,
      usersCount: r.user_count,
      extraUsers: blocks * effBlockSize,
      blocks,
      usersTotal: r.block_cost,
      total:      r.package_price + r.variable_total,
      paid:       r.cc_status === 'paid',
    }
  })

  return <BillingTable billing={billing} />
}

function WhatsAppTab({ clientId, contacts }: { clientId: string; contacts: Contact[] }) {
  const msgs = WHATSAPP[clientId] ?? []

  const paymentContact = contacts.find(c => c.receivesPayments)
  const updateContacts = contacts.filter(c => c.receivesUpdates)

  const StatusIcon = ({ s }: { s: MsgStatus }) => {
    if (s === 'read')   return <CheckCheck size={13} className="text-secondary-dark shrink-0" />
    if (s === 'sent')   return <Check      size={13} className="text-gray-400 shrink-0" />
    return                     <AlertCircle size={13} className="text-red-400 shrink-0" />
  }

  return (
    <div className="p-5 space-y-4">
      {/* Routing panel */}
      {contacts.length > 0 && (
        <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100 space-y-2 text-xs">
          <p className="font-semibold text-gray-500 mb-1.5">ניתוב הודעות</p>
          <div className="flex items-center gap-2">
            <span className="text-base">💳</span>
            <span className="text-gray-500">דרישות תשלום:</span>
            {paymentContact
              ? <span className="font-medium text-gray-700">
                  {paymentContact.name}{' '}
                  <span className="text-gray-400 font-normal" dir="ltr">({paymentContact.phone})</span>
                </span>
              : <span className="text-amber-600 font-medium">לא הוגדר נמען לתשלומים</span>
            }
          </div>
          <div className="flex items-start gap-2">
            <span className="text-base shrink-0">📢</span>
            <span className="text-gray-500 shrink-0">עדכונים:</span>
            {updateContacts.length > 0
              ? <span className="font-medium text-gray-700">{updateContacts.map(c => c.name).join(', ')}</span>
              : <span className="text-gray-400">לא הוגדרו נמענים לעדכונים</span>
            }
          </div>
        </div>
      )}

      {/* Chat */}
      {msgs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-300">
          <MessageSquare size={32} className="mb-2" />
          <p className="text-sm">אין הודעות</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-80 overflow-y-auto" dir="ltr">
          {msgs.map(m => (
            <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
              <div
                dir="rtl"
                className={`max-w-xs lg:max-w-sm px-4 py-2.5 rounded-2xl text-sm ${
                  m.direction === 'out'
                    ? 'bg-primary text-white rounded-tl-sm'
                    : 'bg-gray-100 text-gray-800 rounded-tr-sm'
                }`}
              >
                <p className="leading-relaxed">{m.content}</p>
                <div className={`flex items-center gap-1 mt-1 text-xs ${m.direction === 'out' ? 'justify-start text-white/60' : 'justify-end text-gray-400'}`}>
                  <span>{m.time}</span>
                  {m.direction === 'out' && <StatusIcon s={m.status} />}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 border-t border-gray-100 pt-4">
        <input placeholder="כתוב הודעה..." className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
        <button className="bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-primary-dark transition-colors">שלח</button>
      </div>
    </div>
  )
}

function TicketsTab({ clientId }: { clientId: string }) {
  const tickets = TICKETS[clientId] ?? []

  if (!tickets.length) return (
    <div className="flex flex-col items-center justify-center h-48 text-gray-300">
      <Ticket size={32} className="mb-2" />
      <p className="text-sm">אין כרטיסי תמיכה</p>
    </div>
  )

  return (
    <div className="p-5 space-y-3">
      {tickets.map(t => (
        <Card key={t.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">{t.subject}</p>
              <p className="text-xs text-gray-400 mt-1">נפתח: {t.createdAt}{t.closedAt && ` · נסגר: ${t.closedAt}`}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge className={TICKET_PRIORITY_COLOR[t.priority]}>{TICKET_PRIORITY_LABEL[t.priority]}</Badge>
              <Badge className={TICKET_STATUS_COLOR[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
            </div>
          </div>
        </Card>
      ))}
      <button className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-primary hover:text-primary transition-colors">
        + פתח כרטיס חדש
      </button>
    </div>
  )
}

// ─── Client detail panel ──────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: 'details',  label: 'פרטים'   },
  { id: 'billing',  label: 'חיוב'    },
  { id: 'whatsapp', label: 'וואטסאפ' },
  { id: 'tickets',  label: 'תמיכה'   },
]

function ClientDetail({ client, onBack, onSave }: { client: Client; onBack: () => void; onSave: (c: Client) => void }) {
  const [tab, setTab] = useState<TabId>('details')

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-400 hover:text-primary mb-5 transition-colors">
        <ArrowRight size={16} />חזרה לרשימה
      </button>

      <Card>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary flex items-center justify-center text-white font-bold text-lg shrink-0">
              {client.name[0]}
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">{client.name}</h2>
              <p className="text-xs text-gray-400">{client.businessName} · {client.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {client.subscriptionMonth >= 11 && (
              <Badge className="bg-accent/10 text-accent">חודש {client.subscriptionMonth} — חדש מנוי</Badge>
            )}
            <Badge className={PKG_COLOR[client.package]}>{client.package}</Badge>
            <Badge className={STATUS_COLOR[client.status]}>{STATUS_LABEL[client.status]}</Badge>
          </div>
        </div>

        <div className="flex gap-1 px-5 pt-3 border-b border-gray-100">
          {TABS.map(({ id, label }) => (
            <button
              key={id} onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
                tab === id ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'details'  && <DetailsTab  client={client} onSave={onSave} />}
        {tab === 'billing'  && <BillingTab  client={client} />}
        {tab === 'whatsapp' && <WhatsAppTab clientId={client.id} contacts={client.contacts} />}
        {tab === 'tickets'  && <TicketsTab  clientId={client.id} />}
      </Card>
    </div>
  )
}

// ─── Clients list view ────────────────────────────────────────────────────────

function ClientsList({ clients, onSelect }: { clients: Client[]; onSelect: (c: Client) => void }) {
  type SortKey = 'name' | 'subscriptionMonth' | 'joinDate' | 'status'

  const [search,    setSearch]    = useState('')
  const [pkgFilter, setPkgFilter] = useState<PackageType | ''>('')
  const [stsFilter, setStsFilter] = useState<ClientStatus | ''>('')
  const [sortKey,   setSortKey]   = useState<SortKey>('name')
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const list = clients.filter(c => {
      const q = search.toLowerCase()
      const matchQ = !q || c.name.includes(q) || c.email.includes(q) || c.phone.includes(q) || c.businessName.includes(q)
      return matchQ && (!pkgFilter || c.package === pkgFilter) && (!stsFilter || c.status === stsFilter)
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name':              return dir * a.name.localeCompare(b.name, 'he')
        case 'subscriptionMonth': return dir * (a.subscriptionMonth - b.subscriptionMonth)
        case 'joinDate':          return dir * a.joinDate.localeCompare(b.joinDate)
        case 'status':            return dir * a.status.localeCompare(b.status)
        default:                  return 0
      }
    })
  }, [clients, search, pkgFilter, stsFilter, sortKey, sortDir])

  const active    = clients.filter(c => c.status === 'active')
  const mrr       = active.reduce((s, c) => s + PACKAGE_PRICE[c.package], 0)
  const onPending = clients.filter(c => c.status === 'pending').length

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'סה"כ לקוחות',  value: clients.length,              icon: Users,       color: 'text-primary',        bg: 'bg-primary/10'   },
          { label: 'לקוחות פעילים', value: active.length,               icon: TrendingUp,  color: 'text-green-600',      bg: 'bg-green-100'    },
          { label: 'הכנסה חודשית',  value: `₪${mrr.toLocaleString()}`, icon: CreditCard,  color: 'text-secondary-dark', bg: 'bg-secondary/15' },
          { label: 'ממתינים',         value: onPending,                   icon: Clock,       color: 'text-yellow-600',     bg: 'bg-yellow-100'   },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${bg}`}>
              <Icon size={18} className={color} />
            </div>
            <div>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-400">{label}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 end-3 text-gray-400 pointer-events-none" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם, אימייל, טלפון..."
            className="w-full bg-surface border border-gray-200 rounded-xl text-sm pe-9 ps-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="relative">
          <select value={pkgFilter} onChange={e => setPkgFilter(e.target.value as PackageType | '')}
            className="appearance-none bg-surface border border-gray-200 rounded-xl text-sm px-4 pe-8 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
            <option value="">כל החבילות</option>
            <option>Solo Pro</option><option>Master Class</option><option>Community Master</option>
          </select>
          <ChevronDown size={13} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select value={stsFilter} onChange={e => setStsFilter(e.target.value as ClientStatus | '')}
            className="appearance-none bg-surface border border-gray-200 rounded-xl text-sm px-4 pe-8 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
            <option value="">כל הסטטוסים</option>
            <option value="active">פעיל</option>
            <option value="on_hold">מושהה</option>
            <option value="cancelled">בוטל</option>
            <option value="pending">ממתין</option>
            <option value="expired">פג תוקף</option>
          </select>
          <ChevronDown size={13} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400 pointer-events-none" />
        </div>
        <span className="text-xs text-gray-400">{filtered.length} לקוחות</span>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {([
                  { label: 'שם לקוח',       key: 'name'             },
                  { label: 'עסק'                                     },
                  { label: 'אימייל'                                  },
                  { label: 'טלפון'                                   },
                  { label: 'חבילה'                                   },
                  { label: 'תאריך הצטרפות', key: 'joinDate'          },
                  { label: 'חודש',           key: 'subscriptionMonth' },
                  { label: 'סטטוס',          key: 'status'            },
                ] as { label: string; key?: SortKey }[]).map(({ label, key }) => (
                  <th
                    key={label}
                    onClick={key ? () => handleSort(key) : undefined}
                    className={`text-right text-xs font-medium px-5 py-3 whitespace-nowrap transition-colors ${
                      key
                        ? `cursor-pointer select-none ${sortKey === key ? 'text-primary' : 'text-gray-400 hover:text-gray-600'}`
                        : 'text-gray-400'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {key && sortKey === key && (
                        sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(client => (
                <tr key={client.id} onClick={() => onSelect(client)}
                  className="hover:bg-gray-50/60 cursor-pointer transition-colors group">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary text-sm font-bold shrink-0 group-hover:bg-primary group-hover:text-white transition-colors">
                        {client.name[0]}
                      </div>
                      <div>
                        <span className="font-medium text-gray-800">{client.name}</span>
                        {client.contacts.length > 0 && (
                          <span className="text-xs text-gray-400 block">{client.contacts.length} אנשי קשר</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500 text-xs">{client.businessName}</td>
                  <td className="px-5 py-3.5 text-gray-500 text-xs hidden md:table-cell">{client.email}</td>
                  <td className="px-5 py-3.5 text-gray-500 text-xs hidden sm:table-cell">{client.phone}</td>
                  <td className="px-5 py-3.5"><Badge className={PKG_COLOR[client.package]}>{client.package}</Badge></td>
                  <td className="px-5 py-3.5 text-gray-400 text-xs hidden lg:table-cell">{client.joinDate}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs font-semibold ${client.subscriptionMonth >= 11 ? 'text-accent' : 'text-gray-400'}`}>
                      {client.subscriptionMonth}/12
                    </span>
                  </td>
                  <td className="px-5 py-3.5"><Badge className={STATUS_COLOR[client.status]}>{STATUS_LABEL[client.status]}</Badge></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-300 text-sm">לא נמצאו לקוחות</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function Clients() {
  const [clients,   setClients]   = useState<Client[]>([])
  const [selected,  setSelected]  = useState<Client | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saveError,  setSaveError]  = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const rows = await getClients()
      setClients(rows.map(dbClientToClient))
    } catch (err) {
      const e = err as { message?: string; details?: string; hint?: string }
      console.error('getClients failed', e.message, e.details, e.hint)
      setFetchError(e.message ?? 'שגיאה בטעינת לקוחות')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSave = async (updated: Client) => {
    setSaveError(null)
    const snapshot = clients
    setClients(prev => prev.map(c => c.id === updated.id ? updated : c))
    setSelected(updated)
    try {
      await dbUpdateClient(updated.id, clientToDbUpdate(updated))
      await dbUpdateClientContacts(updated.id, updated.contacts.map(contactToDbInsert))
      console.log('SAVE SUCCESS', updated.id)
    } catch (err) {
      console.error('SAVE ERROR:', JSON.stringify(err, Object.getOwnPropertyNames(err)))
      const e = err as { message?: string; details?: string; hint?: string }
      setSaveError(e.message ?? 'שגיאה לא ידועה')
      setClients(snapshot)
      setSelected(snapshot.find(c => c.id === updated.id) ?? updated)
    }
  }

  if (fetchError && !selected) return <ErrorScreen message={fetchError} onRetry={load} />

  if (selected) {
    return (
      <>
        {saveError && <SaveErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />}
        <ClientDetail client={selected} onBack={() => { setSelected(null); setSaveError(null) }} onSave={handleSave} />
      </>
    )
  }

  if (loading) return <LoadingScreen />

  return <ClientsList clients={clients} onSelect={setSelected} />
}
