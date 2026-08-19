import { useCallback, useEffect, useRef, useState } from 'react'
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
  const { user, profile, loading, canViewPage, isDeactivated, signOut } = useAuth()
  const landingSelectedRef = useRef(false)

  // Setting activePage even when denied is intentional: the render
  // guard below checks canViewPage(activePage) and shows AccessDenied
  // for that specific page id, rather than silently doing nothing.
  const navigate = useCallback((page: string) => setActivePage(page), [])

  useEffect(() => {
    if (!profile) {
      landingSelectedRef.current = false
      return
    }
    if (landingSelectedRef.current) return

    landingSelectedRef.current = true
    const firstAllowed = Object.keys(PAGE_MODULE).find(canViewPage)
    const landingPage = !profile.is_owner && canViewPage('work') ? 'work' : firstAllowed
    if (!landingPage) return

    const timer = window.setTimeout(() => setActivePage(landingPage), 0)
    return () => window.clearTimeout(timer)
  }, [profile, canViewPage])

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

  if (isDeactivated) {
    return (
      <NotificationProvider>
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-center px-6">
          <p className="text-lg font-bold text-gray-700">החשבון שלך הושבת</p>
          <p className="text-sm text-gray-400 max-w-sm">
            הגישה שלך למערכת נחסמה על ידי מנהל. פנה למנהל המערכת אם אתה סבור שזו טעות.
          </p>
          <button
            onClick={() => void signOut()}
            className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            התנתקות
          </button>
        </div>
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
