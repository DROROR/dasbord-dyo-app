import { useCallback, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Layout } from './components/layout/Layout'
import { Dashboard } from './pages/Dashboard'
import { Clients } from './pages/Clients'
import { Settings } from './pages/Settings'
import { Billing } from './pages/Billing'
import { WhatsApp } from './pages/WhatsApp'
import { Leads } from './pages/Leads'
import { Agents } from './pages/Agents'
import { BotTraining } from './pages/BotTraining'
import { Permissions } from './pages/Permissions'
import { Work } from './pages/Work'
import { Login } from './pages/Login'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AccessDenied } from './components/AccessDenied'
import { useAuth } from './hooks/useAuth'
import { NotificationProvider } from './contexts/NotificationContext'
import { TimerProvider } from './contexts/TimerContext'
import { LanguageProvider } from './contexts/LanguageContext'
import { FloatingTimerWidget } from './components/work/FloatingTimerWidget'
import { PAGE_MODULE } from './lib/permissions'

// Lazy — a denied page's element must never even be constructed,
// not just left unrendered, so a denied module's data-fetching
// effects can never fire either.
const buildPages = (navigate: (page: string) => void): Record<string, () => React.ReactNode> => ({
  dashboard:   () => <Dashboard onNavigate={navigate} />,
  clients:     () => <Clients />,
  billing:     () => <Billing />,
  whatsapp:    () => <WhatsApp />,
  leads:       () => <Leads />,
  agents:      () => <Agents />,
  bots:        () => <BotTraining />,
  permissions: () => <Permissions />,
  work:        () => <Work />,
  settings:    () => <Settings />,
})

export default function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const { user, profile, loading, canViewPage, signOut } = useAuth()

  // Setting activePage even when denied is intentional: the render
  // guard below checks canViewPage(activePage) and shows AccessDenied
  // for that specific page id, rather than silently doing nothing.
  const navigate = useCallback((page: string) => setActivePage(page), [])

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

  const allowed = canViewPage(activePage)
  const landing = Object.keys(PAGE_MODULE).find(canViewPage)

  return (
    <LanguageProvider>
      <NotificationProvider>
        <TimerProvider>
          <Layout
            activePage={activePage}
            onNavigate={navigate}
            profile={profile}
            onSignOut={signOut}
          >
            <ErrorBoundary key={activePage}>
              {allowed
                ? buildPages(navigate)[activePage]?.()
                : <AccessDenied onBack={landing ? () => navigate(landing) : undefined} />}
            </ErrorBoundary>
          </Layout>
          <FloatingTimerWidget onNavigate={navigate} />
        </TimerProvider>
      </NotificationProvider>
    </LanguageProvider>
  )
}
