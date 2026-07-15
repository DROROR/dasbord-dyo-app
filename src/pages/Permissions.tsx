import { useState } from 'react'
import { UserPlus, Shield, ShieldCheck, Check, Trash2, Mail, Lock } from 'lucide-react'

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

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_USERS: AppUser[] = [
  {
    id: '1', name: 'דרור יוסף', email: 'droryosef1@gmail.com',
    role: 'admin', permissions: FULL_PERMISSIONS, joinedAt: '01/01/2025',
  },
  {
    id: '2', name: 'נועה ברק', email: 'noabarak@dyo.co.il',
    role: 'staff',
    permissions: {
      dashboard: 'view', clients: 'edit', billing: 'view',
      whatsapp: 'send', leads: 'full', agents: 'view',
      work: 'edit', pricing: 'none', permissions: 'none',
    },
    joinedAt: '15/03/2025',
  },
]

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
  onSave: (id: string, role: Role, perms: ModulePermission) => void
  onRemove: (id: string) => void
}) {
  const [draftRole, setDraftRole] = useState<Role>(user.role)
  const [draftPerms, setDraftPerms] = useState<ModulePermission>(user.permissions)
  const [saved, setSaved] = useState(false)

  const isDirty =
    draftRole !== user.role ||
    JSON.stringify(draftPerms) !== JSON.stringify(user.permissions)

  const setPermission = (key: keyof ModulePermission, value: string) =>
    setDraftPerms(p => ({ ...p, [key]: value } as ModulePermission))

  const handleSave = () => {
    onSave(user.id, draftRole, draftRole === 'admin' ? FULL_PERMISSIONS : draftPerms)
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

// ─── Add user panel ───────────────────────────────────────────────────────────

function AddUserPanel({
  onAdd, onCancel,
}: {
  onAdd: (u: Omit<AppUser, 'id' | 'joinedAt'>) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('staff')
  const [permissions, setPermissions] = useState<ModulePermission>(DEFAULT_STAFF_PERMISSIONS)
  const [sent, setSent] = useState(false)

  const setPermission = (key: keyof ModulePermission, value: string) =>
    setPermissions(p => ({ ...p, [key]: value } as ModulePermission))

  const canCreate = name.trim().length > 0 && email.trim().length > 0

  const handleCreate = () => {
    if (!canCreate || sent) return
    onAdd({
      name: name.trim(), email: email.trim(), role,
      permissions: role === 'admin' ? FULL_PERMISSIONS : permissions,
    })
    setSent(true)
    setTimeout(() => onCancel(), 1500)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-primary">הוסף משתמש חדש</h2>
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          ביטול
        </button>
      </div>

      {/* Basic fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">שם מלא</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="ישראל ישראלי"
            className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">אימייל</label>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="user@dyo.co.il"
            className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
        </div>
      </div>

      {/* Role selector */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">תפקיד</p>
        <div className="grid grid-cols-2 gap-3">
          {([
            { r: 'admin' as Role, title: 'מנהל', desc: 'גישה מלאה לכל המערכת', Icon: ShieldCheck },
            { r: 'staff' as Role, title: 'צוות', desc: 'גישה מוגבלת — הגדר הרשאות למטה', Icon: Shield },
          ]).map(({ r, title, desc, Icon }) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`text-right p-4 rounded-2xl border-2 transition-all ${
                role === r
                  ? r === 'admin'
                    ? 'border-primary bg-primary/5'
                    : 'border-secondary bg-secondary/10'
                  : 'border-gray-100 hover:border-gray-200 bg-gray-50/40'
              }`}
            >
              <Icon size={20} className={
                role === r
                  ? r === 'admin' ? 'text-primary mb-2' : 'text-teal-600 mb-2'
                  : 'text-gray-300 mb-2'
              } />
              <p className={`text-sm font-semibold ${
                role === r ? (r === 'admin' ? 'text-primary' : 'text-teal-700') : 'text-gray-500'
              }`}>{title}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-snug">{desc}</p>
              {role === r && (
                <div className={`w-4 h-4 rounded-full flex items-center justify-center mt-2.5 ${
                  r === 'admin' ? 'bg-primary' : 'bg-secondary'
                }`}>
                  <Check size={10} className="text-white" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Permissions grid — staff only */}
      {role === 'staff' && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">הרשאות מודולים</p>
          <PermissionsGrid permissions={permissions} onChange={setPermission} />
        </div>
      )}

      {/* Admin note */}
      {role === 'admin' && (
        <div className="flex items-center gap-2.5 p-4 bg-primary/5 border border-primary/10 rounded-2xl">
          <ShieldCheck size={16} className="text-primary shrink-0" />
          <p className="text-sm text-primary">המשתמש יקבל גישה מלאה לכל המערכת</p>
        </div>
      )}

      {/* Action */}
      <div className="flex items-center gap-3 border-t border-gray-50 pt-4">
        <button
          onClick={handleCreate}
          disabled={!canCreate || sent}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
            sent
              ? 'bg-green-500 text-white'
              : canCreate
                ? 'bg-primary text-white hover:bg-primary-dark'
                : 'bg-gray-100 text-gray-400 cursor-default'
          }`}
        >
          {sent ? <Check size={14} /> : <Mail size={14} />}
          {sent ? 'הזמנה נשלחה!' : 'צור משתמש ושלח הזמנה'}
        </button>
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          ביטול
        </button>
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function Permissions() {
  const [users, setUsers] = useState<AppUser[]>(MOCK_USERS)
  const [selectedId, setSelectedId] = useState<string | null>('1')
  const [showAdd, setShowAdd] = useState(false)

  const selectedUser = users.find(u => u.id === selectedId) ?? null

  const handleSave = (id: string, role: Role, perms: ModulePermission) =>
    setUsers(prev => prev.map(u => u.id === id ? { ...u, role, permissions: perms } : u))

  const handleRemove = (id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id))
    setSelectedId(null)
  }

  const handleAdd = (data: Omit<AppUser, 'id' | 'joinedAt'>) => {
    const newUser: AppUser = {
      ...data,
      id: String(Date.now()),
      joinedAt: new Date().toLocaleDateString('he-IL'),
    }
    setUsers(prev => [...prev, newUser])
    setShowAdd(false)
    setSelectedId(newUser.id)
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
          <button
            onClick={() => { setShowAdd(true); setSelectedId(null) }}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border-2 border-dashed text-sm font-medium transition-all ${
              showAdd
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-gray-200 text-gray-400 hover:border-primary/40 hover:text-primary hover:bg-primary/3'
            }`}
          >
            <UserPlus size={15} />הוסף משתמש
          </button>

          {users.map(u => (
            <UserCard
              key={u.id}
              user={u}
              selected={!showAdd && selectedId === u.id}
              onClick={() => { setSelectedId(u.id); setShowAdd(false) }}
            />
          ))}
        </div>

        {/* Right: detail / add panel */}
        <div className="flex-1 min-w-0">
          {showAdd && (
            <AddUserPanel onAdd={handleAdd} onCancel={() => setShowAdd(false)} />
          )}
          {!showAdd && selectedUser && (
            <UserDetailPanel
              key={selectedUser.id}
              user={selectedUser}
              isMainAdmin={selectedUser.email === MAIN_ADMIN_EMAIL}
              onSave={handleSave}
              onRemove={handleRemove}
            />
          )}
          {!showAdd && !selectedUser && (
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
