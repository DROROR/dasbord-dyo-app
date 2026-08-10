import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { FULL_PERMISSIONS, PAGE_MODULE, rankOf, type PermissionLevel, type PermissionModule } from '../lib/permissions'

export interface UserProfile {
  id: string
  name: string
  email: string
  role: 'admin' | 'staff'
  permissions: Record<string, string>
  is_owner: boolean
  is_technical_support: boolean
}

interface AuthValue {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  isOwner: boolean
  isAdmin: boolean
  hasPermission: (module: PermissionModule, minLevel?: PermissionLevel) => boolean
  canViewPage: (page: string) => boolean
  canManagePermissions: boolean
  signOut: () => Promise<void>
}

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'

const DEV_USER = { id: 'dev-local', email: 'dev@local' } as User
const DEV_PROFILE: UserProfile = {
  id: 'dev-local',
  name: 'Dev (Local)',
  email: 'dev@local',
  role: 'admin',
  permissions: FULL_PERMISSIONS,
  is_owner: true,
  is_technical_support: false,
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(DEV_BYPASS ? DEV_USER : null)
  const [profile, setProfile] = useState<UserProfile | null>(DEV_BYPASS ? DEV_PROFILE : null)
  const [loading, setLoading] = useState(!DEV_BYPASS)

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    setProfile((data as UserProfile) ?? null)
  }

  useEffect(() => {
    if (DEV_BYPASS) return

    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) {
        fetchProfile(u.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) {
        fetchProfile(u.id)
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  const isOwner = profile?.is_owner === true
  // Kept for existing call sites; no longer implies full access on
  // its own — see hasPermission/canManagePermissions below.
  const isAdmin = isOwner || profile?.role === 'admin'

  const hasPermission = useCallback((module: PermissionModule, minLevel: PermissionLevel = 'view'): boolean => {
    if (!profile) return false
    if (profile.is_owner) return true
    const held = rankOf(profile.permissions?.[module])
    const required = rankOf(minLevel)
    if (held === null || required === null) return false
    return held >= required
  }, [profile])

  const canManagePermissions = useMemo(() =>
    isOwner || (profile?.role === 'admin' && rankOf(profile.permissions?.permissions) === 3),
    [isOwner, profile],
  )

  const canViewPage = useCallback((page: string): boolean => {
    if (!profile) return false
    const mod = PAGE_MODULE[page]
    if (mod === undefined) return false // unknown page id -> deny
    if (mod === null) return true // e.g. settings — own account, always allowed
    if (mod === 'permissions') return canManagePermissions
    return hasPermission(mod, 'view')
  }, [profile, hasPermission, canManagePermissions])

  const value: AuthValue = {
    user, profile, loading, isOwner, isAdmin,
    hasPermission, canViewPage, canManagePermissions, signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Context provider + its consumer hook are intentionally colocated (the
// standard React pattern) — Fast Refresh granularity for this pairing
// isn't worth splitting into two files purely to satisfy the linter.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth() must be used within <AuthProvider>')
  return ctx
}
