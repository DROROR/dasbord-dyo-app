import {
  LayoutDashboard,
  Users,
  CreditCard,
  MessageCircle,
  Target,
  Bot,
  GraduationCap,
  Shield,
  Settings,
  LogOut,
  Briefcase,
} from 'lucide-react'
import logoFull from '../../assets/logo.png'
import logoSymbol from '../../assets/logo-symbol.png'
import type { UserProfile } from '../../hooks/useAuth'

const NAV_ITEMS = [
  { id: 'dashboard',   label: 'לוח בקרה',  icon: LayoutDashboard },
  { id: 'clients',     label: 'לקוחות',    icon: Users           },
  { id: 'billing',     label: 'חיוב',      icon: CreditCard      },
  { id: 'whatsapp',    label: 'וואטסאפ',   icon: MessageCircle   },
  { id: 'leads',       label: 'לידים',     icon: Target          },
  { id: 'agents',      label: 'סוכנים',    icon: Bot             },
  { id: 'bots',        label: 'אימון בוטים', icon: GraduationCap },
  { id: 'work',        label: 'Work',      icon: Briefcase       },
  { id: 'permissions', label: 'הרשאות',    icon: Shield          },
]

const BOTTOM_NAV = [
  { id: 'settings', label: 'הגדרות', icon: Settings },
]

interface Props {
  active: string
  onNavigate: (id: string) => void
  collapsed: boolean
  profile: UserProfile | null
  onSignOut: () => void
}

export function Sidebar({ active, onNavigate, collapsed, profile, onSignOut }: Props) {
  const initial = profile?.name?.charAt(0).toUpperCase() ?? '?'

  return (
    <aside
      className={`h-screen bg-primary flex flex-col shrink-0 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-white/10 shrink-0">
        {collapsed ? (
          <img src={logoSymbol} alt="Logo" className="h-8 w-auto mx-auto" />
        ) : (
          <img src={logoFull} alt="Admin Platform" className="h-8 w-auto" />
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.filter(({ id }) => {
          if (id === 'work' && profile?.role !== 'admin' && profile?.permissions?.['work'] === 'none') return false
          return true
        }).map(({ id, label, icon: Icon }) => {
          const isActive = active === id
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              title={collapsed ? label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-secondary/20 text-secondary'
                  : 'text-white/60 hover:bg-white/8 hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
              {isActive && !collapsed && (
                <span className="me-auto w-1.5 h-1.5 rounded-full bg-secondary" />
              )}
            </button>
          )
        })}
      </nav>

      {/* Bottom nav (settings) */}
      <div className="px-2 pb-1">
        {BOTTOM_NAV.map(({ id, label, icon: Icon }) => {
          const isActive = active === id
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              title={collapsed ? label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-secondary/20 text-secondary'
                  : 'text-white/60 hover:bg-white/8 hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
              {isActive && !collapsed && (
                <span className="me-auto w-1.5 h-1.5 rounded-full bg-secondary" />
              )}
            </button>
          )
        })}
      </div>

      {/* User + sign-out */}
      <div className="p-2 border-t border-white/10 shrink-0">
        <button
          onClick={onSignOut}
          title={collapsed ? 'יציאה' : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/60 hover:bg-white/8 hover:text-white transition-all text-sm ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <div className="w-7 h-7 rounded-full bg-secondary/30 flex items-center justify-center text-secondary text-xs font-bold shrink-0">
            {initial}
          </div>
          {!collapsed && (
            <>
              <div className="flex flex-col items-start min-w-0">
                <span className="text-white text-xs font-medium truncate">
                  {profile?.name ?? '...'}
                </span>
                <span className="text-white/40 text-xs truncate">
                  {profile?.email ?? ''}
                </span>
              </div>
              <LogOut size={15} className="me-auto shrink-0 opacity-50" />
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
