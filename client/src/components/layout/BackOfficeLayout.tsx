import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Home, Package, Receipt as ReceiptIcon, Users, Truck, Wallet, Settings, ArrowLeft, BarChart2,
  UserCog, LogOut, HandCoins, Warehouse, ScrollText, Factory, Landmark, type LucideIcon,
} from 'lucide-react'
import { useAuthStore } from '../../store/auth.store'
import { SyncStatusBadge } from './SyncStatusBadge'
import { useAppMode } from '../../contexts/AppModeContext'
import { EXPIRING_DAYS } from '../../lib/expiry'
import { CREDITORS_ATTENTION_SQL } from '../../lib/creditors'

type BadgeKey = 'pendingOrders' | 'debtors' | 'creditors' | 'suppliersOwed' | 'expiring'
type BadgeTone = 'yellow' | 'red'

interface NavItem {
  to: string
  labelKey: string
  hintKey: string
  icon: LucideIcon
  end?: boolean
  badge?: { key: BadgeKey; tone: BadgeTone }
  /** Pages reached from inside this one that keep it highlighted. */
  alsoActive?: string[]
}

// Grouped by what the owner is trying to do, each item with a one-line
// "what's in here" (the tooltip and the page's subtitle say the same).
const SECTIONS: Array<{ titleKey: string | null; items: NavItem[] }> = [
  {
    titleKey: null,
    items: [{ to: '/backoffice', labelKey: 'nav.dashboard', hintKey: 'pageHints.dashboard', icon: Home, end: true }],
  },
  {
    titleKey: 'navGroups.sales',
    items: [
      { to: '/backoffice/sales', labelKey: 'nav.sales', hintKey: 'pageHints.sales', icon: ReceiptIcon },
      { to: '/backoffice/debtors', labelKey: 'nav.debtors', hintKey: 'pageHints.debtors', icon: HandCoins, badge: { key: 'debtors', tone: 'red' } },
      // Badge: open creditors whose due date is within their reminder window or past.
      { to: '/backoffice/creditors', labelKey: 'nav.creditors', hintKey: 'pageHints.creditors', icon: Landmark, badge: { key: 'creditors', tone: 'yellow' } },
      { to: '/backoffice/customers', labelKey: 'nav.customers', hintKey: 'pageHints.customers', icon: Users },
    ],
  },
  {
    titleKey: 'navGroups.goods',
    items: [
      // Categories are opened from the Products page (rarely needed, so not a menu item of their own).
      { to: '/backoffice/products', labelKey: 'nav.products', hintKey: 'pageHints.products', icon: Package, alsoActive: ['/backoffice/categories'] },
      { to: '/backoffice/warehouse', labelKey: 'nav.warehouse', hintKey: 'pageHints.warehouse', icon: Warehouse, badge: { key: 'expiring', tone: 'red' } },
      { to: '/backoffice/purchases', labelKey: 'nav.purchases', hintKey: 'pageHints.purchases', icon: Truck, badge: { key: 'pendingOrders', tone: 'yellow' } },
      { to: '/backoffice/suppliers', labelKey: 'nav.suppliers', hintKey: 'pageHints.suppliers', icon: Factory, badge: { key: 'suppliersOwed', tone: 'yellow' } },
    ],
  },
  {
    titleKey: 'navGroups.money',
    items: [
      { to: '/backoffice/expenses', labelKey: 'nav.expenses', hintKey: 'pageHints.expenses', icon: Wallet },
      { to: '/backoffice/reports', labelKey: 'nav.reports', hintKey: 'pageHints.reports', icon: BarChart2 },
      { to: '/backoffice/journal', labelKey: 'nav.journal', hintKey: 'pageHints.journal', icon: ScrollText },
    ],
  },
  {
    titleKey: 'navGroups.admin',
    items: [
      { to: '/backoffice/employees', labelKey: 'nav.employees', hintKey: 'pageHints.employees', icon: UserCog },
      { to: '/backoffice/settings', labelKey: 'nav.settings', hintKey: 'pageHints.settings', icon: Settings },
    ],
  },
]

const BADGE_SQL: Record<BadgeKey, string> = {
  pendingOrders: `SELECT COUNT(*) AS n FROM purchases WHERE status != 'received' AND deleted_at IS NULL`,
  debtors: `SELECT COUNT(*) AS n FROM contacts WHERE type IN ('customer','both') AND deleted_at IS NULL AND balance > 0`,
  creditors: CREDITORS_ATTENTION_SQL,
  suppliersOwed: `SELECT COUNT(DISTINCT vendor_id) AS n FROM purchases
                  WHERE vendor_id IS NOT NULL AND status = 'received' AND deleted_at IS NULL AND COALESCE(amount_paid, 0) < total_amount`,
  expiring: `SELECT COUNT(DISTINCT pb.product_id) AS n FROM product_batches pb
             JOIN products p ON p.id = pb.product_id AND p.deleted_at IS NULL
             WHERE pb.expiry_date IS NOT NULL AND substr(pb.expiry_date, 1, 10) <= date('now', 'localtime', '+${EXPIRING_DAYS} days')
               AND COALESCE((SELECT SUM(quantity) FROM product_stocks s WHERE s.batch_id = pb.id), 0) > 0`,
}

/** Counts shown next to menu items — things waiting for someone. */
function useNavBadges(): Partial<Record<BadgeKey, number>> {
  const location = useLocation()
  const [counts, setCounts] = useState<Partial<Record<BadgeKey, number>>>({})
  useEffect(() => {
    let alive = true
    async function load() {
      const next: Partial<Record<BadgeKey, number>> = {}
      for (const key of Object.keys(BADGE_SQL) as BadgeKey[]) {
        try {
          const [row] = await window.electronAPI.db.query(BADGE_SQL[key], []) as Array<{ n: number }>
          next[key] = Number(row?.n ?? 0)
        } catch { /* a badge never breaks the menu */ }
      }
      if (alive) setCounts(next)
    }
    load()
    const timer = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(timer) }
  }, [location.pathname])
  return counts
}

const TONE: Record<BadgeTone, string> = {
  yellow: 'bg-yellow-500/20 text-yellow-300',
  red: 'bg-red-500/20 text-red-300',
}

export function BackOfficeLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const { user, store, logout } = useAuthStore()
  const appMode = useAppMode()
  const { t } = useTranslation()
  const badges = useNavBadges()
  const location = useLocation()

  return (
    <div className="h-screen flex bg-dark overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 bg-dark-surface border-r border-dark-border flex flex-col shrink-0">
        {/* Store + connection status (kept compact so the whole menu fits a 768px screen) */}
        <div className="px-3 py-2.5 border-b border-dark-border flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <span className="text-white font-bold">B</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white font-bold text-sm leading-tight truncate" title={t('nav.backOffice')}>{store?.name ?? 'BarakaPOS'}</p>
            <div className="mt-1 inline-flex"><SyncStatusBadge /></div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-1.5 px-2">
          {SECTIONS.map((section, i) => (
            <div key={section.titleKey ?? i} className={i > 0 ? 'mt-2' : ''}>
              {section.titleKey && (
                <p className="px-3 pb-0.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{t(section.titleKey)}</p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const count = item.badge ? badges[item.badge.key] ?? 0 : 0
                  const also = item.alsoActive?.some((p) => location.pathname.startsWith(p)) ?? false
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      title={t(item.hintKey)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 min-h-[36px] rounded-xl text-sm font-medium transition-colors group ${
                          isActive || also
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-gray-300 hover:text-white hover:bg-dark-card active:bg-dark-card'
                        }`
                      }
                    >
                      {({ isActive: own }) => { const isActive = own || also; return (
                        <>
                          <item.icon size={18} className={isActive ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'} />
                          <span className="flex-1 truncate">{t(item.labelKey)}</span>
                          {count > 0 && (
                            <span className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                              isActive ? 'bg-white/25 text-white' : TONE[item.badge!.tone]
                            }`}>
                              {count > 99 ? '99+' : count}
                            </span>
                          )}
                        </>
                      ) }}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Who's signed in */}
        <div className="p-2 border-t border-dark-border">
          <div className="flex items-center gap-2 px-1">
            <div className="w-8 h-8 rounded-full bg-dark-card border border-dark-border flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-gray-300">{user?.name?.charAt(0)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white truncate">{user?.name}</p>
              <p className="text-[11px] text-gray-500 truncate">{t(`roles.${user?.role}`, { defaultValue: user?.role ?? '' })}</p>
            </div>
            {appMode === 'pos' ? (
              <button
                onClick={() => navigate('/pos')}
                title={t('nav.backToPos')}
                className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-dark-card"
              >
                <ArrowLeft size={16} />
              </button>
            ) : (
              <button
                onClick={() => { logout(); navigate('/login') }}
                title={t('nav.logout')}
                className="flex items-center gap-1.5 h-10 px-2.5 rounded-lg text-xs text-gray-400 hover:text-red-400 hover:bg-dark-card"
              >
                <LogOut size={15} /> {t('nav.logout')}
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  )
}
