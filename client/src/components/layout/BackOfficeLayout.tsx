import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard, Package, Tags, ShoppingBag, Users, Truck,
  Receipt, Settings, ArrowLeft, ChevronRight, BarChart2, UserCog, LogOut, Users2,
} from 'lucide-react'
import { useAuthStore } from '../../store/auth.store'
import { SyncStatusBadge } from './SyncStatusBadge'
import { useAppMode } from '../../contexts/AppModeContext'

const NAV = [
  { to: '/backoffice', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/backoffice/products', labelKey: 'nav.products', icon: Package },
  { to: '/backoffice/categories', labelKey: 'nav.categories', icon: Tags },
  { to: '/backoffice/sales', labelKey: 'nav.sales', icon: ShoppingBag },
  { to: '/backoffice/customers', labelKey: 'nav.customers', icon: Users },
  { to: '/backoffice/debtors', labelKey: 'nav.debtors', icon: Users2 },
  { to: '/backoffice/purchases', labelKey: 'nav.purchases', icon: Truck },
  { to: '/backoffice/expenses', labelKey: 'nav.expenses', icon: Receipt },
  { to: '/backoffice/reports', labelKey: 'nav.reports', icon: BarChart2 },
  { to: '/backoffice/employees', labelKey: 'nav.employees', icon: UserCog },
  { to: '/backoffice/settings', labelKey: 'nav.settings', icon: Settings },
]

export function BackOfficeLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const { user, store, logout } = useAuthStore()
  const appMode = useAppMode()
  const { t } = useTranslation()

  return (
    <div className="h-screen flex bg-dark overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 bg-dark-surface border-r border-dark-border flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-dark-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
              <span className="text-white font-bold text-sm">B</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-none">{store?.name ?? 'BarakaPOS'}</p>
              <p className="text-gray-500 text-xs mt-0.5">{t('nav.backOffice')}</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-gray-400 hover:text-white hover:bg-dark-card'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={16} className={isActive ? 'text-primary' : 'text-gray-500 group-hover:text-gray-300'} />
                  {t(item.labelKey)}
                  {isActive && <ChevronRight size={13} className="ml-auto text-primary" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-dark-border space-y-2">
          <SyncStatusBadge />
          <div className="flex items-center gap-2 px-1">
            <div className="w-7 h-7 rounded-full bg-dark-card border border-dark-border flex items-center justify-center">
              <span className="text-xs font-medium text-gray-300">{user?.name?.charAt(0)}</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-white truncate">{user?.name}</p>
              <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
            </div>
          </div>
          {appMode === 'pos' ? (
            <button
              onClick={() => navigate('/pos')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-dark-card transition-colors"
            >
              <ArrowLeft size={14} />
              {t('nav.backToPos')}
            </button>
          ) : (
            <button
              onClick={() => { logout(); navigate('/login') }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-red-400 hover:bg-dark-card transition-colors"
            >
              <LogOut size={14} />
              {t('nav.logout')}
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  )
}
