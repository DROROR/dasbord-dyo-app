import { ChevronDown, LogOut } from 'lucide-react'
import { useWorkLang, type WorkLang } from '../../contexts/WorkLanguageContext'
import logoFull from '../../assets/logo.png'
import logoSymbol from '../../assets/logo-symbol.png'
import type { UserProfile } from '../../hooks/useAuth'
import { useAuth } from '../../hooks/useAuth'
import { PAGES } from '../../lib/permissions'

// Nav items come from the central PAGES registry (src/lib/permissions.ts)
// — add/remove/rename a page there, not here.
const NAV_ITEMS = PAGES.filter(p => p.nav === 'main')
const BOTTOM_NAV = PAGES.filter(p => p.nav === 'bottom')

interface Props {
  active: string
  onNavigate: (id: string) => void
  collapsed: boolean
  profile: UserProfile | null
  onSignOut: () => void
}

export function Sidebar({ active, onNavigate, collapsed, profile, onSignOut }: Props) {
  const { lang: workLang, setLang: setWorkLang, t } = useWorkLang()
  const { hasPermission, canManagePermissions } = useAuth()
  const initial = profile?.name?.charAt(0).toUpperCase() ?? '?'

  return (
    <aside
      className={`sidebar-shell h-screen border-e border-white/10 bg-primary flex flex-col shrink-0 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Logo */}
      <div className="h-16 flex items-center gap-2 px-3 border-b border-white/10 shrink-0">
        {collapsed ? (
          <img src={logoSymbol} alt="Logo" className="h-8 w-auto mx-auto" />
        ) : (
          <>
            <img src={logoFull} alt="Dyo Planner" className="h-7 w-auto min-w-0 max-w-[124px] object-contain" />
            <div className="relative ms-auto shrink-0">
              <span className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2" aria-hidden="true">
                {workLang === 'he' ? (
                  <svg viewBox="0 0 28 20" className="h-3.5 w-5 overflow-hidden rounded-[2px]" role="img">
                    <rect width="28" height="20" fill="#fff" />
                    <rect y="3" width="28" height="2" fill="#2563eb" />
                    <rect y="15" width="28" height="2" fill="#2563eb" />
                    <path d="M14 6.2 17.3 12H10.7L14 6.2Zm0 7.6L10.7 8h6.6L14 13.8Z" fill="none" stroke="#2563eb" strokeWidth="1" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 28 20" className="h-3.5 w-5 overflow-hidden rounded-[2px]" role="img">
                    <rect width="28" height="20" fill="#1e3a8a" />
                    <path d="M0 0 28 20M28 0 0 20" stroke="#fff" strokeWidth="4" />
                    <path d="M0 0 28 20M28 0 0 20" stroke="#dc2626" strokeWidth="1.5" />
                    <path d="M14 0v20M0 10h28" stroke="#fff" strokeWidth="6" />
                    <path d="M14 0v20M0 10h28" stroke="#dc2626" strokeWidth="3" />
                  </svg>
                )}
              </span>
              <select
                value={workLang}
                onChange={event => setWorkLang(event.target.value as WorkLang)}
                aria-label="Work language"
                title="Work language"
                className="w-[104px] appearance-none rounded-lg border border-white/15 bg-white/10 py-1.5 pl-9 pr-8 text-[11px] font-semibold text-white outline-none focus:border-secondary/60"
              >
                <option value="en" className="text-gray-800">English</option>
                <option value="he" className="text-gray-800">עברית</option>
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-white/60" />
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.filter(item =>
          item.managePermissionsOnly ? canManagePermissions : !!item.module && hasPermission(item.module, 'view'),
        ).map(({ id, labelHe, labelEn, icon: Icon }) => {
          const label = t(labelHe, labelEn)
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
        {BOTTOM_NAV.map(({ id, labelHe, labelEn, icon: Icon }) => {
          const label = t(labelHe, labelEn)
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
          title={collapsed ? t('יציאה', 'Log out') : undefined}
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
