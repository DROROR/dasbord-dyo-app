import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Layout } from './components/layout/Layout'
import { Dashboard } from './pages/Dashboard'
import { Clients } from './pages/Clients'
import { Settings } from './pages/Settings'
import { Billing } from './pages/Billing'
import { WhatsApp } from './pages/WhatsApp'
import { Leads } from './pages/Leads'
import { Agents } from './pages/Agents'
import { Permissions } from './pages/Permissions'
import { Work } from './pages/Work'
import { Login } from './pages/Login'
import { useAuth } from './hooks/useAuth'
import { NotificationProvider } from './contexts/NotificationContext'
import { TimerProvider } from './contexts/TimerContext'
import { FloatingTimerWidget } from './components/work/FloatingTimerWidget'

const PAGES: Record<string, React.ReactNode> = {
  dashboard:   <Dashboard />,
  clients:     <Clients />,
  billing:     <Billing />,
  whatsapp:    <WhatsApp />,
  leads:       <Leads />,
  agents:      <Agents />,
  permissions: <Permissions />,
  work:        <Work />,
  settings:    <Settings />,
}

export default function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const { user, profile, loading, signOut } = useAuth()

  if (loading) {
    return (
      <NotificationProvider>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 size={28} className="text-primary animate-spin" />
        </div>
      </NotificationProvider>
    )
  }

  if (!user) {
    return (
      <NotificationProvider>
        <Login />
      </NotificationProvider>
    )
  }

  return (
    <NotificationProvider>
      <TimerProvider>
        <Layout
          activePage={activePage}
          onNavigate={setActivePage}
          profile={profile}
          onSignOut={signOut}
        >
          {PAGES[activePage]}
        </Layout>
        <FloatingTimerWidget onNavigate={setActivePage} />
      </TimerProvider>
    </NotificationProvider>
  )
}
