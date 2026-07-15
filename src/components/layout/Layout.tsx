import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import type { UserProfile } from '../../hooks/useAuth'

interface Props {
  children: ReactNode
  activePage: string
  onNavigate: (id: string) => void
  profile: UserProfile | null
  onSignOut: () => void
}

export function Layout({ children, activePage, onNavigate, profile, onSignOut }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        active={activePage}
        onNavigate={onNavigate}
        collapsed={collapsed}
        profile={profile}
        onSignOut={onSignOut}
      />

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Topbar
          activePage={activePage}
          onToggleSidebar={() => setCollapsed(c => !c)}
        />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
