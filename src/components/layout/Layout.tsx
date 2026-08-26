import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import type { UserProfile } from '../../hooks/useAuth'
import { useWorkLang } from '../../contexts/WorkLanguageContext'

interface Props {
  children: ReactNode
  activePage: string
  onNavigate: (id: string) => void
  profile: UserProfile | null
  onSignOut: () => void
}

export function Layout({ children, activePage, onNavigate, profile, onSignOut }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const { lang: workLang } = useWorkLang()

  return (
    <div dir={workLang === 'he' ? 'rtl' : 'ltr'} className="flex h-screen overflow-hidden bg-background">
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
          onNavigate={onNavigate}
        />
        <main className={activePage === 'work'
          ? 'min-h-0 min-w-0 flex-1 overflow-hidden p-0'
          : 'min-h-0 min-w-0 flex-1 overflow-y-auto p-6'}>
          {children}
        </main>
      </div>
    </div>
  )
}
