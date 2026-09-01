import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  is_active: boolean
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
  /** True once a profile has loaded and is_active is explicitly false — deactivated, real server-side enforcement is independent of this (RLS/has_permission also check is_active), this only drives the UI's own "you're deactivated" state. */
  isDeactivated: boolean
  refreshProfile: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
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
  is_active: true,
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(DEV_BYPASS ? DEV_USER : null)
  const [profile, setProfile] = useState<UserProfile | null>(DEV_BYPASS ? DEV_PROFILE : null)
  const [loading, setLoading] = useState(!DEV_BYPASS)
  const authRequestRef = useRef(0)
  const authenticatedUserRef = useRef<User | null>(DEV_BYPASS ? DEV_USER : null)
  const hydratedUserIdRef = useRef<string | null>(DEV_BYPASS ? DEV_USER.id : null)

  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) throw error
    // Pre-migration compatibility: profiles.is_active doesn't exist on
    // the live DB yet, so `data.is_active` comes back `undefined`
    // (key absent from the row), not `false`. Treat anything other
    // than an explicit `false` as active — once the column exists,
    // real deactivations always write an explicit `false`, so this
    // expression keeps working correctly after the migration too; it
    // isn't code to remove later.
    return data ? { ...(data as UserProfile), is_active: (data as { is_active?: boolean }).is_active !== false } : null
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!user) return
    const nextProfile = await fetchProfile(user.id)
    setProfile(nextProfile)
  }, [user, fetchProfile])

  const hydrateUser = useCallback(async (nextUser: User | null) => {
    const requestId = ++authRequestRef.current
    setUser(nextUser)

    if (!nextUser) {
      hydratedUserIdRef.current = null
      setProfile(null)
      setLoading(false)
      return
    }

    // TOKEN_REFRESHED and focus-triggered auth events for the SAME user are
    // background profile syncs. Blocking the whole app here would unmount an
    // open task dialog and make returning to the browser tab look like a page
    // refresh. Only the initial/new-user hydration gets the global spinner.
    const requiresBlockingLoad = hydratedUserIdRef.current !== nextUser.id
    if (requiresBlockingLoad) setLoading(true)
    try {
      const nextProfile = await fetchProfile(nextUser.id)
      if (requestId === authRequestRef.current) {
        hydratedUserIdRef.current = nextUser.id
        setProfile(nextProfile)
      }
    } catch (error) {
      console.error('Failed to load authenticated user profile:', error)
      // A transient background refresh failure must not tear down an already
      // authenticated UI. Initial/new-user hydration still fails closed.
      if (requestId === authRequestRef.current && requiresBlockingLoad) setProfile(null)
    } finally {
      if (requestId === authRequestRef.current && requiresBlockingLoad) setLoading(false)
    }
  }, [fetchProfile])

  useEffect(() => {
    if (DEV_BYPASS) return

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // onAuthStateChange emits INITIAL_SESSION when this provider mounts,
      // so it is the single session authority. A separate getSession()
      // request can resolve later with a stale null snapshot and overwrite a
      // login that just succeeded, sending the user back to the login screen.
      // A Supabase query inside this callback can block the auth event, so
      // defer profile hydration until after the callback returns.
      const eventUser = session?.user ?? null
      if (eventUser) authenticatedUserRef.current = eventUser
      if (event === 'SIGNED_OUT') authenticatedUserRef.current = null

      setTimeout(() => {
        // INITIAL_SESSION may have captured `null` before a fast successful
        // password sign-in, then run after signIn() has already committed the
        // returned user. Never let that stale initial snapshot log the fresh
        // session back out in React; a real SIGNED_OUT event still clears it.
        if (event === 'INITIAL_SESSION' && !eventUser && authenticatedUserRef.current) return
        void hydrateUser(eventUser)
      }, 0)
    })

    return () => {
      authRequestRef.current += 1
      subscription.unsubscribe()
    }
  }, [hydrateUser])

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (!data.session?.user) throw new Error('Sign-in succeeded without a user session')
    authenticatedUserRef.current = data.session.user
    await hydrateUser(data.session.user)
  }

  async function signOut() {
    authenticatedUserRef.current = null
    hydratedUserIdRef.current = null
    await supabase.auth.signOut()
  }

  const isOwner = profile?.is_owner === true
  // Kept for existing call sites; no longer implies full access on
  // its own — see hasPermission/canManagePermissions below.
  const isAdmin = isOwner || profile?.role === 'admin'
  const isDeactivated = profile != null && profile.is_active === false

  // Client-side UX mirror only — the real gate is server-side (every
  // RLS-facing function this app relies on now also checks is_active,
  // see 20260810101000_rls_rpc_identity_and_queue.sql). Checked here
  // too so the UI itself stops offering actions immediately, without
  // waiting for a failed request to find out.
  const hasPermission = useCallback((module: PermissionModule, minLevel: PermissionLevel = 'view'): boolean => {
    if (!profile) return false
    // Owner bypass is unconditional — checked before is_active so it can
    // never be accidentally gated by that flag (the Owner can never
    // actually be deactivated server-side anyway; this is belt-and-suspenders).
    if (profile.is_owner) return true
    if (!profile.is_active) return false
    const held = rankOf(profile.permissions?.[module])
    const required = rankOf(minLevel)
    if (held === null || required === null) return false
    return held >= required
  }, [profile])

  const canManagePermissions = useMemo(() =>
    isOwner || (!!profile?.is_active && profile?.role === 'admin' && rankOf(profile.permissions?.permissions) === 3),
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
    hasPermission, canViewPage, canManagePermissions, isDeactivated, refreshProfile, signOut,
    signIn,
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
