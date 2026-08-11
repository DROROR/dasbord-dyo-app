import { useEffect, useState } from 'react'
import { UserPlus, Shield, ShieldCheck, Check, Trash2, Lock, LifeBuoy, Loader2, X, KeyRound, AlertCircle } from 'lucide-react'
import { getProfiles, type DbProfile } from '../lib/database'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { rankOf, PAGES, type PageEntry, type PermissionModule, type PermissionLevel } from '../lib/permissions'
import { AccessDenied } from '../components/AccessDenied'

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'admin' | 'staff'

// Every module + its available levels comes from the central PAGES
// registry (src/lib/permissions.ts) — this type and the grid rows
// below derive from it, nothing here duplicates that list.
type ModulePermission = Record<PermissionModule, PermissionLevel>

interface AppUser {
  id: string
  name: string
  email: string
  role: Role
  permissions: ModulePermission
  joinedAt: string
  isTechnicalSupport: boolean
  isOwner: boolean
  isActive: boolean
}

interface SaveResult {
  ok: boolean
  error?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

// No permission stored for a module is ever assumed to be more than
// 'none' — the DB (backfilled by migration 001) is the single source
// of truth for what a user actually holds; the UI must never render
// more access than that. Derived from PAGES so a newly-added module
// automatically defaults to 'none' here too, with no extra step.
const NONE_PERMISSIONS: ModulePermission = Object.fromEntries(
  PAGES.filter(p => p.module).map(p => [p.module, 'none']),
) as ModulePermission

// Grid rows — every module in the central registry gets one, in
// registry order, using that registry's Hebrew label and levels.
const MODULES: Array<{
  id: PermissionModule
  label: string
  options: readonly PermissionLevel[]
}> = PAGES
  .filter((p): p is PageEntry & { module: PermissionModule } => p.module !== null)
  .map(p => ({ id: p.module, label: p.labelHe, options: p.levels }))

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

function toModulePermission(raw: Record<string, unknown> | null | undefined): ModulePermission {
  return { ...NONE_PERMISSIONS, ...(raw as Partial<ModulePermission> | null) }
}

function mapProfilesToUsers(profiles: DbProfile[]): AppUser[] {
  return profiles.map(p => ({
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role,
    permissions: toModulePermission(p.permissions),
    joinedAt: new Date(p.created_at).toLocaleDateString('he-IL'),
    isTechnicalSupport: p.is_technical_support,
    isOwner: p.is_owner,
    isActive: p.is_active,
  }))
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
  permissions, onChange, actorIsOwner, actorPermissions,
}: {
  permissions: ModulePermission
  onChange?: (key: keyof ModulePermission, value: string) => void
  actorIsOwner: boolean
  actorPermissions: ModulePermission
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
            </div>
            <div dir="ltr" className="flex items-center gap-1 flex-wrap">
              {mod.options.map(opt => {
                // An admin (non-owner) can never grant a level above what
                // it holds itself for that module — no escalation via
                // delegation, whether or not this option is the one
                // already selected.
                const overCeiling = !actorIsOwner && (rankOf(opt) ?? 0) > (rankOf(actorPermissions[mod.id]) ?? 0)
                const disabled = !onChange || overCeiling
                return (
                  <button
                    key={opt}
                    onClick={() => !disabled && onChange?.(mod.id, opt)}
                    disabled={disabled}
                    title={overCeiling ? 'לא ניתן להעניק הרשאה שאין לך בעצמך' : undefined}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                      current === opt
                        ? OPTION_ACTIVE[opt]
                        : !disabled
                          ? 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 border border-gray-100'
                          : 'bg-gray-50 text-gray-300 border border-gray-100 cursor-default'
                    }`}
                  >
                    {OPTION_LABEL[opt]}
                  </button>
                )
              })}
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
      } ${!user.isActive ? 'opacity-60' : ''}`}
    >
      <Avatar name={user.name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-sm font-semibold text-gray-800 truncate">{user.name}</span>
          <RoleBadge role={user.role} />
          {!user.isActive && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-500">
              מושבת
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 truncate">{user.email}</p>
      </div>
    </button>
  )
}

// ─── User detail panel ────────────────────────────────────────────────────────

function DeactivateConfirmModal({ userName, onConfirm, onClose }: {
  userName: string
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ההשבתה נכשלה')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-amber-600">
          <AlertCircle size={18} />
          <p className="text-sm font-semibold">השבתת {userName}</p>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          המשתמש לא יוכל להתחבר או להשתמש במערכת יותר. כל ההיסטוריה העסקית — משימות, תגובות, מסמכים ורשומות שיוך — תישמר במלואה ותישאר גלויה למנהלים מורשים.
        </p>
        {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40">
            ביטול
          </button>
          <button
            onClick={() => void confirm()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {busy ? 'משבית...' : 'השבת משתמש'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ResetPasswordModal({ userName, onGenerate, onClose }: {
  userName: string
  onGenerate: () => Promise<string>
  onClose: () => void
}) {
  const [password, setPassword] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      const pw = await onGenerate()
      setPassword(pw)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'איפוס הסיסמה נכשל')
    } finally {
      setBusy(false)
    }
  }

  function copy() {
    if (!password) return
    void navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Deliberately never kept in any longer-lived state — this component
  // unmounts on close and the password goes with it, exactly once.
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={password || busy ? undefined : onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        {!password ? (
          <>
            <p className="text-sm font-semibold text-gray-800">יצירת סיסמה חדשה ל{userName}</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              תיווצר סיסמה זמנית אקראית. יש להעביר אותה למשתמש בערוץ מאובטח — היא תוצג כאן פעם אחת בלבד.
            </p>
            {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40">
                ביטול
              </button>
              <button
                onClick={() => void generate()}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                {busy ? 'יוצר...' : 'צור סיסמה'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-green-600">
              <Check size={16} />
              <p className="text-sm font-semibold">הסיסמה נוצרה</p>
            </div>
            <p className="text-xs text-gray-500">מסור למשתמש בערוץ מאובטח — הסיסמה לא תוצג שוב:</p>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <code dir="ltr" className="text-sm font-mono flex-1 text-gray-800">{password}</code>
              <button
                onClick={copy}
                className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
              >
                {copied ? 'הועתק!' : 'העתק'}
              </button>
            </div>
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors self-end"
            >
              סיום
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function UserDetailPanel({
  user, isSelf, actorIsOwner, actorPermissions, onSave, onDeactivate, onGeneratePassword,
}: {
  user: AppUser
  isSelf: boolean
  actorIsOwner: boolean
  actorPermissions: ModulePermission
  onSave: (id: string, role: Role, perms: ModulePermission, isSupport: boolean) => Promise<SaveResult>
  onDeactivate: (id: string) => Promise<void>
  onGeneratePassword: (id: string) => Promise<string>
}) {
  const [draftRole, setDraftRole] = useState<Role>(user.role)
  const [draftPerms, setDraftPerms] = useState<ModulePermission>(user.permissions)
  const [draftSupport, setDraftSupport] = useState(user.isTechnicalSupport)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showDeactivate, setShowDeactivate] = useState(false)
  const [showResetPassword, setShowResetPassword] = useState(false)

  // No reset effect needed: the panel is keyed on the user id, so selecting a
  // different user remounts it with fresh drafts.

  const isDirty =
    draftRole !== user.role ||
    draftSupport !== user.isTechnicalSupport ||
    JSON.stringify(draftPerms) !== JSON.stringify(user.permissions)

  // Nobody may edit the owner's row, and nobody may edit their own role/
  // permissions here (the direct fix for the self-escalation bug) —
  // enforced again server-side by update-member-permissions regardless.
  const canEditPermissions = !user.isOwner && !isSelf
  const canEditRole = actorIsOwner && !user.isOwner && !isSelf

  const setPermission = (key: keyof ModulePermission, value: string) =>
    setDraftPerms(p => ({ ...p, [key]: value } as ModulePermission))

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    const result = await onSave(user.id, draftRole, draftPerms, draftSupport)
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.error ?? 'השמירה נכשלה')
      return
    }
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
              {user.isOwner && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-medium">
                  <Lock size={10} />מנהל ראשי
                </span>
              )}
              {isSelf && !user.isOwner && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-500 font-medium">
                  <Lock size={10} />זה אתה
                </span>
              )}
              {!user.isActive && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 font-medium">
                  מושבת
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>
            <p className="text-xs text-gray-300 mt-0.5">הצטרף: {user.joinedAt}</p>
          </div>
        </div>
        {!user.isOwner && !isSelf && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowResetPassword(true)}
              className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-xl hover:border-primary hover:text-primary transition-colors"
            >
              <KeyRound size={13} />יצירת סיסמה חדשה
            </button>
            {user.isActive && (
              <button
                onClick={() => setShowDeactivate(true)}
                className="flex items-center gap-1.5 text-xs text-red-500 border border-red-100 bg-red-50/50 px-3 py-1.5 rounded-xl hover:bg-red-100 transition-colors"
              >
                <Trash2 size={13} />השבת משתמש
              </button>
            )}
          </div>
        )}
      </div>

      {showDeactivate && (
        <DeactivateConfirmModal
          userName={user.name}
          onConfirm={() => onDeactivate(user.id)}
          onClose={() => setShowDeactivate(false)}
        />
      )}
      {showResetPassword && (
        <ResetPasswordModal
          userName={user.name}
          onGenerate={() => onGeneratePassword(user.id)}
          onClose={() => setShowResetPassword(false)}
        />
      )}

      {/* Role selector — owner only, never for the owner row or yourself */}
      {canEditRole && (
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
          onClick={() => canEditPermissions && setDraftSupport(v => !v)}
          disabled={!canEditPermissions}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-right ${
            draftSupport
              ? 'border-teal-300 bg-teal-50 text-teal-800'
              : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
          } ${!canEditPermissions ? 'cursor-default opacity-70' : ''}`}
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
        {user.isOwner ? (
          <div className="flex items-center gap-2.5 p-4 bg-primary/5 border border-primary/10 rounded-2xl">
            <ShieldCheck size={18} className="text-primary shrink-0" />
            <p className="text-sm text-primary font-medium">מנהל ראשי — גישה מלאה תמיד</p>
          </div>
        ) : (
          <PermissionsGrid
            permissions={draftPerms}
            onChange={canEditPermissions ? setPermission : undefined}
            actorIsOwner={actorIsOwner}
            actorPermissions={actorPermissions}
          />
        )}
      </div>

      {/* Actions */}
      {user.isOwner ? (
        <p className="text-xs text-gray-300 border-t border-gray-50 pt-4">
          המנהל הראשי אינו ניתן לעריכה או הסרה
        </p>
      ) : isSelf ? (
        <p className="text-xs text-gray-300 border-t border-gray-50 pt-4">
          לא ניתן לערוך את התפקיד וההרשאות של עצמך
        </p>
      ) : (
        <div className="flex flex-col gap-2 border-t border-gray-50 pt-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleSave()}
              disabled={(!isDirty && !saved) || saving}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                saved
                  ? 'bg-green-500 text-white'
                  : isDirty
                    ? 'bg-primary text-white hover:bg-primary-dark'
                    : 'bg-gray-100 text-gray-400 cursor-default'
              }`}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
              {saving ? 'שומר...' : saved ? 'נשמר' : 'שמור שינויים'}
            </button>
            {isDirty && !saved && !saving && (
              <button
                onClick={() => { setDraftRole(user.role); setDraftPerms(user.permissions); setSaveError(null) }}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                בטל שינויים
              </button>
            )}
          </div>
          {saveError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>}
        </div>
      )}
    </div>
  )
}

// ─── Add member modal ─────────────────────────────────────────────────────────

function AddMemberModal({ onCreated, onClose }: {
  onCreated: () => void
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  async function submit() {
    if (!emailValid || submitting) return
    setSubmitting(true)
    setError(null)
    const { data, error: invokeError } = await supabase.functions.invoke('create-member', {
      body: { email: email.trim(), name: name.trim() || undefined },
    })
    setSubmitting(false)
    if (invokeError || !data?.password) {
      let msg = 'שגיאה ביצירת המשתמש'
      const ctx = (invokeError as { context?: Response })?.context
      if (ctx) {
        try { msg = (await ctx.json())?.error ?? msg } catch { /* ignore */ }
      }
      setError(data?.error ?? msg)
      return
    }
    setResult({ password: data.password })
  }

  function copyPassword() {
    if (!result) return
    void navigator.clipboard.writeText(result.password)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function finish() {
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={result ? undefined : onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        {!result ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">הוספת חבר צוות</p>
              <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100">
                <X size={14} />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <input
                autoFocus
                dir="ltr"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition"
              />
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="שם (אופציונלי)"
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition text-right"
              />
              <p className="text-xs text-gray-400 leading-relaxed">
                המערכת תייצר סיסמה אקראית ותציג אותה כאן לאחר היצירה. אם לא תזין שם, המשתמש יוכל להגדיר שם לעצמו בעתיד.
              </p>
            </div>
            {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                ביטול
              </button>
              <button
                onClick={submit}
                disabled={!emailValid || submitting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                {submitting ? 'יוצר...' : 'צור משתמש'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-green-600">
              <Check size={16} />
              <p className="text-sm font-semibold">המשתמש נוצר בהצלחה</p>
            </div>
            <p className="text-xs text-gray-500">
              שתפו את הפרטים הבאים עם {email.trim()} כדי שיוכלו להתחבר:
            </p>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <code dir="ltr" className="text-sm font-mono flex-1 text-gray-800">{result.password}</code>
              <button
                onClick={copyPassword}
                className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
              >
                {copied ? 'הועתק!' : 'העתק'}
              </button>
            </div>
            <button
              onClick={finish}
              className="px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors self-end"
            >
              סיום
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function Permissions() {
  const { profile, isOwner, canManagePermissions } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  // The user list is whoever has registered in the panel, read live from the
  // database — there is no hardcoded team. Skipped entirely (not just
  // hidden) when the caller can't manage permissions — defense in depth
  // alongside the route guard in App.tsx, which already prevents this
  // page from ever mounting for anyone else.
  useEffect(() => {
    // Nothing to fetch, and irrelevant anyway — the component returns
    // <AccessDenied/> below before this state is ever rendered.
    if (!canManagePermissions) return
    void (async () => {
      try {
        const profiles = await getProfiles()
        const mapped = mapProfilesToUsers(profiles)
        setUsers(mapped)
        setSelectedId(prev => prev ?? mapped[0]?.id ?? null)
      } catch (err) {
        console.error('Failed to load users:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [canManagePermissions])

  const selectedUser = users.find(u => u.id === selectedId) ?? null

  const refreshUsers = async () => {
    try {
      const profiles = await getProfiles()
      setUsers(mapProfilesToUsers(profiles))
    } catch (err) {
      console.error('Failed to refresh users:', err)
    }
  }

  const handleSave = async (
    id: string, role: Role, perms: ModulePermission, isSupport: boolean,
  ): Promise<SaveResult> => {
    const { data, error } = await supabase.functions.invoke('update-member-permissions', {
      body: { targetId: id, role, permissions: perms, is_technical_support: isSupport },
    })
    if (error || !data?.profile) {
      let msg = 'השמירה נכשלה'
      const ctx = (error as { context?: Response })?.context
      if (ctx) {
        try { msg = (await ctx.json())?.error ?? msg } catch { /* ignore */ }
      }
      return { ok: false, error: data?.error ?? msg }
    }
    // Apply only the server-confirmed row — no optimistic guessing ahead
    // of what the backend actually accepted.
    const saved = data.profile as DbProfile & { is_owner: boolean }
    setUsers(prev => prev.map(u => u.id === id ? {
      ...u,
      role: saved.role,
      permissions: toModulePermission(saved.permissions),
      isTechnicalSupport: saved.is_technical_support,
    } : u))
    return { ok: true }
  }

  const handleDeactivate = async (id: string) => {
    const { data, error } = await supabase.functions.invoke('deactivate-member', {
      body: { targetId: id },
    })
    if (error || !data?.profile) {
      let msg = 'ההשבתה נכשלה'
      const ctx = (error as { context?: Response })?.context
      if (ctx) {
        try { msg = (await ctx.json())?.error ?? msg } catch { /* ignore */ }
      }
      throw new Error(data?.error ?? msg)
    }
    // Apply only the server-confirmed row.
    setUsers(prev => prev.map(u => u.id === id ? { ...u, isActive: false } : u))
  }

  const handleGeneratePassword = async (id: string): Promise<string> => {
    const { data, error } = await supabase.functions.invoke('reset-member-password', {
      body: { targetId: id },
    })
    if (error || !data?.password) {
      let msg = 'איפוס הסיסמה נכשל'
      const ctx = (error as { context?: Response })?.context
      if (ctx) {
        try { msg = (await ctx.json())?.error ?? msg } catch { /* ignore */ }
      }
      throw new Error(data?.error ?? msg)
    }
    return data.password as string
  }

  if (!canManagePermissions) {
    return <AccessDenied />
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
            onClick={() => setShowAdd(true)}
            className="w-full flex items-center justify-center gap-2 py-3 px-3 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-primary hover:text-primary transition-colors"
          >
            <UserPlus size={15} />
            <span className="text-xs font-medium">הוספת חבר צוות</span>
          </button>

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
              isSelf={selectedUser.id === profile?.id}
              actorIsOwner={isOwner}
              actorPermissions={toModulePermission(profile?.permissions)}
              onSave={handleSave}
              onDeactivate={handleDeactivate}
              onGeneratePassword={handleGeneratePassword}
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

      {showAdd && (
        <AddMemberModal
          onCreated={() => { void refreshUsers() }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}
