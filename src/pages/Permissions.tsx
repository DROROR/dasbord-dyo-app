import { useEffect, useState } from 'react'
import { UserPlus, Shield, ShieldCheck, Check, Trash2, Lock, LifeBuoy, Loader2 } from 'lucide-react'
import { getProfiles, updateProfile } from '../lib/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'admin' | 'staff'

interface ModulePermission {
  dashboard:   'none' | 'view'
  clients:     'none' | 'view' | 'edit' | 'full'
  billing:     'none' | 'view' | 'full'
  whatsapp:    'none' | 'view' | 'send' | 'full'
  leads:       'none' | 'view' | 'edit' | 'full'
  agents:      'none' | 'view' | 'full'
  work:        'none' | 'view' | 'edit' | 'full'
  pricing:     'none' | 'full'
  permissions: 'none' | 'full'
}

interface AppUser {
  id: string
  name: string
  email: string
  role: Role
  permissions: ModulePermission
  joinedAt: string
  isTechnicalSupport: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_ADMIN_EMAIL = 'droryosef1@gmail.com'

const FULL_PERMISSIONS: ModulePermission = {
  dashboard: 'view', clients: 'full', billing: 'full',
  whatsapp: 'full', leads: 'full', agents: 'full',
  work: 'full', pricing: 'full', permissions: 'full',
}

const DEFAULT_STAFF_PERMISSIONS: ModulePermission = {
  dashboard: 'view', clients: 'view', billing: 'none',
  whatsapp: 'none', leads: 'view', agents: 'none',
  work: 'edit', pricing: 'none', permissions: 'none',
}

const MODULES: Array<{
  id: keyof ModulePermission
  label: string
  options: string[]
  adminOnly?: boolean
}> = [
  { id: 'dashboard',   label: 'דשבורד',       options: ['none', 'view'] },
  { id: 'clients',     label: 'לקוחות',        options: ['none', 'view', 'edit', 'full'] },
  { id: 'billing',     label: 'חיובים',        options: ['none', 'view', 'full'] },
  { id: 'whatsapp',    label: 'וואטסאפ',       options: ['none', 'view', 'send', 'full'] },
  { id: 'leads',       label: 'לידים',         options: ['none', 'view', 'edit', 'full'] },
  { id: 'agents',      label: 'סוכנים',        options: ['none', 'view', 'full'] },
  { id: 'work',        label: 'עבודה',         options: ['none', 'view', 'edit', 'full'] },
  { id: 'pricing',     label: 'הגדרות תמחור', options: ['none', 'full'] },
  { id: 'permissions', label: 'הרשאות',        options: ['none', 'full'], adminOnly: true },
]

const OPTION_LABEL: Record<string, string> = {
  none: 'ללא', view: 'צפייה', edit: 'עריכה', send: 'שליחה', full: 'מלא',
}

const OPTION_ACTIVE: Record<string, string> = {
  none: 'bg-gray-200 text-gray-600',
  view: 'bg-blue-100 text-blue-700',
  edit: 'bg-amber-100 text-amber-700',
  send: 'bg-teal-100 text-teal-700',
  full: 'bg-primary text-white',
}

// ─── Shared small components ──────────────────────────────────────────────────

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('')
  const sz = {
    sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base',
  }[size]
  return (
    <div className={`${sz} rounded-xl bg-primary flex items-center justify-center text-white font-bold shrink-0`}>
      {initials}
    </div>
  )
}

function RoleBadge({ role }: { role: Role }) {
  return role === 'admin' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
      <ShieldCheck size={10} />מנהל
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary/20 text-teal-700">
      <Shield size={10} />צוות
    </span>
  )
}

// ─── Permissions grid ─────────────────────────────────────────────────────────

function PermissionsGrid({
  permissions, onChange,
}: {
  permissions: ModulePermission
  onChange?: (key: keyof ModulePermission, value: string) => void
}) {
  return (
    <div className="rounded-2xl border border-gray-100 overflow-hidden">
      {MODULES.map((mod, i) => {
        const current = permissions[mod.id]
        return (
          <div
            key={mod.id}
            className={`flex items-center gap-4 px-4 py-3 ${
              i < MODULES.length - 1 ? 'border-b border-gray-50' : ''
            } ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}
          >
            <div className="w-36 shrink-0 flex items-center gap-1.5">
              <span className="text-sm text-gray-700">{mod.label}</span>
              {mod.adminOnly && (
                <span className="text-[10px] text-gray-300 font-medium">(Admin)</span>
              )}
            </div>
            <div dir="ltr" className="flex items-center gap-1 flex-wrap">
              {mod.options.map(opt => (
                <button
                  key={opt}
                  onClick={() => onChange?.(mod.id, opt)}
                  disabled={!onChange}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    current === opt
                      ? OPTION_ACTIVE[opt]
                      : onChange
                        ? 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 border border-gray-100'
                        : 'bg-gray-50 text-gray-300 border border-gray-100 cursor-default'
                  }`}
                >
                  {OPTION_LABEL[opt]}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── User card (sidebar) ──────────────────────────────────────────────────────

function UserCard({
  user, selected, onClick,
}: {
  user: AppUser; selected: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-right flex items-center gap-3 p-3.5 rounded-2xl border transition-all ${
        selected
          ? 'border-primary/30 bg-primary/5 shadow-sm'
          : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/60 shadow-sm'
      }`}
    >
      <Avatar name={user.name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-sm font-semibold text-gray-800 truncate">{user.name}</span>
          <RoleBadge role={user.role} />
        </div>
        <p className="text-xs text-gray-400 truncate">{user.email}</p>
      </div>
    </button>
  )
}

// ─── User detail panel ────────────────────────────────────────────────────────

function UserDetailPanel({
  user, isMainAdmin, onSave, onRemove,
}: {
  user: AppUser; isMainAdmin: boolean
  onSave: (id: string, role: Role, perms: ModulePermission, isSupport: boolean) => void
  onRemove: (id: string) => void
}) {
  const [draftRole, setDraftRole] = useState<Role>(user.role)
  const [draftPerms, setDraftPerms] = useState<ModulePermission>(user.permissions)
  const [draftSupport, setDraftSupport] = useState(user.isTechnicalSupport)
  const [saved, setSaved] = useState(false)

  // No reset effect needed: the panel is keyed on the user id, so selecting a
  // different user remounts it with fresh drafts.

  const isDirty =
    draftRole !== user.role ||
    draftSupport !== user.isTechnicalSupport ||
    JSON.stringify(draftPerms) !== JSON.stringify(user.permissions)

  const setPermission = (key: keyof ModulePermission, value: string) =>
    setDraftPerms(p => ({ ...p, [key]: value } as ModulePermission))

  const handleSave = () => {
    onSave(user.id, draftRole, draftRole === 'admin' ? FULL_PERMISSIONS : draftPerms, draftSupport)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={user.name} size="lg" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-primary">{user.name}</h2>
              {isMainAdmin && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-medium">
                  <Lock size={10} />מנהל ראשי
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>
            <p className="text-xs text-gray-300 mt-0.5">הצטרף: {user.joinedAt}</p>
          </div>
        </div>
        {!isMainAdmin && (
          <button
            onClick={() => onRemove(user.id)}
            className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 border border-red-100 hover:border-red-200 bg-red-50/50 hover:bg-red-50 px-3 py-1.5 rounded-xl transition-colors"
          >
            <Trash2 size={13} />הסר משתמש
          </button>
        )}
      </div>

      {/* Role selector */}
      {!isMainAdmin && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">תפקיד</p>
          <div className="grid grid-cols-2 gap-2">
            {(['admin', 'staff'] as Role[]).map(r => (
              <button
                key={r}
                onClick={() => setDraftRole(r)}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border transition-all text-sm font-medium ${
                  draftRole === r
                    ? r === 'admin'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-secondary bg-secondary/10 text-teal-700'
                    : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
                }`}
              >
                {r === 'admin'
                  ? <ShieldCheck size={16} className={draftRole === r ? 'text-primary' : 'text-gray-300'} />
                  : <Shield      size={16} className={draftRole === r ? 'text-teal-600' : 'text-gray-300'} />
                }
                {r === 'admin' ? 'מנהל' : 'צוות'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Technical Support — drives who gets unclaimed support tickets */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">תמיכה טכנית</p>
        <button
          onClick={() => setDraftSupport(v => !v)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-right ${
            draftSupport
              ? 'border-teal-300 bg-teal-50 text-teal-800'
              : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
          }`}
        >
          <LifeBuoy size={16} className={draftSupport ? 'text-teal-600 shrink-0' : 'text-gray-300 shrink-0'} />
          <span className="flex-1 text-sm font-medium">
            {draftSupport ? 'מקבל פניות תמיכה' : 'לא מקבל פניות תמיכה'}
          </span>
          <span className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${draftSupport ? 'bg-teal-500' : 'bg-gray-200'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${draftSupport ? 'right-0.5' : 'left-0.5'}`} />
          </span>
        </button>
        <p className="text-xs text-gray-400 mt-1.5">
          כרטיסי תמיכה חדשים שטרם נלקחו יופיעו בלוח האישי רק של משתמשים עם תפקיד זה
        </p>
      </div>

      {/* Permissions */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          הרשאות מודולים
        </p>
        {draftRole === 'admin' ? (
          <div className="flex items-center gap-2.5 p-4 bg-primary/5 border border-primary/10 rounded-2xl">
            <ShieldCheck size={18} className="text-primary shrink-0" />
            <p className="text-sm text-primary font-medium">גישה מלאה לכל המערכת</p>
          </div>
        ) : (
          <PermissionsGrid
            permissions={draftPerms}
            onChange={isMainAdmin ? undefined : setPermission}
          />
        )}
      </div>

      {/* Actions */}
      {isMainAdmin ? (
        <p className="text-xs text-gray-300 border-t border-gray-50 pt-4">
          המנהל הראשי אינו ניתן לעריכה או הסרה
        </p>
      ) : (
        <div className="flex items-center gap-3 border-t border-gray-50 pt-4">
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
            {saved ? <Check size={14} /> : null}
            {saved ? 'נשמר' : 'שמור שינויים'}
          </button>
          {isDirty && !saved && (
            <button
              onClick={() => { setDraftRole(user.role); setDraftPerms(user.permissions) }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              בטל שינויים
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function Permissions() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // The user list is whoever has registered in the panel, read live from the
  // database — there is no hardcoded team.
  useEffect(() => {
    void (async () => {
      try {
        const profiles = await getProfiles()
        const mapped: AppUser[] = profiles.map(p => ({
          id: p.id,
          name: p.name,
          email: p.email,
          role: p.role,
          permissions: {
            ...(p.role === 'admin' ? FULL_PERMISSIONS : DEFAULT_STAFF_PERMISSIONS),
            ...(p.permissions as Partial<ModulePermission>),
          },
          joinedAt: new Date(p.created_at).toLocaleDateString('he-IL'),
          isTechnicalSupport: p.is_technical_support,
        }))
        setUsers(mapped)
        setSelectedId(prev => prev ?? mapped[0]?.id ?? null)
      } catch (err) {
        console.error('Failed to load users:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const selectedUser = users.find(u => u.id === selectedId) ?? null

  const handleSave = (id: string, role: Role, perms: ModulePermission, isSupport: boolean) => {
    setUsers(prev => prev.map(u =>
      u.id === id ? { ...u, role, permissions: perms, isTechnicalSupport: isSupport } : u,
    ))
    void updateProfile(id, { role, permissions: perms, is_technical_support: isSupport })
      .catch(err => console.error('Failed to save user:', err))
  }

  const handleRemove = (id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id))
    setSelectedId(null)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-primary">הרשאות</h1>
        <p className="text-sm text-gray-400 mt-1">ניהול משתמשים ורמות גישה למערכת</p>
      </div>

      <div className="flex gap-5 items-start">
        {/* Left: user list */}
        <div className="w-64 shrink-0 space-y-2">
          {/* Accounts are created by registering, not from here. */}
          <div className="w-full flex items-start gap-2 py-3 px-3 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400">
            <UserPlus size={15} className="shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-right">
              משתמשים נוספים מופיעים כאן לאחר שנרשמו למערכת. כאן קובעים להם תפקיד והרשאות.
            </p>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" />טוען משתמשים...
            </div>
          )}
          {!loading && users.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6 leading-relaxed">
              אין עדיין משתמשים רשומים.<br />משתמשים יופיעו כאן לאחר ההרשמה למערכת.
            </p>
          )}

          {users.map(u => (
            <UserCard
              key={u.id}
              user={u}
              selected={selectedId === u.id}
              onClick={() => { setSelectedId(u.id); setShowAdd(false) }}
            />
          ))}
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 min-w-0">
          {selectedUser && (
            <UserDetailPanel
              key={selectedUser.id}
              user={selectedUser}
              isMainAdmin={selectedUser.email === MAIN_ADMIN_EMAIL}
              onSave={handleSave}
              onRemove={handleRemove}
            />
          )}
          {!selectedUser && (
            <div className="flex flex-col items-center justify-center h-52 text-gray-300 gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
              <Shield size={36} />
              <p className="text-sm">בחר משתמש לעריכה</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
