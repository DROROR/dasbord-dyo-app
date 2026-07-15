import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface UserProfile {
  id: string
  name: string
  email: string
  role: 'admin' | 'staff' | 'viewer'
  permissions: Record<string, string | boolean>
}

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'

const DEV_USER = { id: 'dev-local', email: 'dev@local' } as User
const DEV_PROFILE: UserProfile = {
  id: 'dev-local',
  name: 'Dev (Local)',
  email: 'dev@local',
  role: 'admin',
  permissions: {},
}

export function useAuth() {
  const [user, setUser]       = useState<User | null>(DEV_BYPASS ? DEV_USER : null)
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

  return { user, profile, loading, isAdmin: profile?.role === 'admin', signOut }
}
