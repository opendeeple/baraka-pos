import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { TrendingUp, ShoppingBag, Users, Package, AlertTriangle, RefreshCw } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'

interface DashStats {
  todayRevenue: number
  todaySales: number
  todayCustomers: number
  lowStockCount: number
  recentSales: Array<{ id: number; invoice_number: string; total_amount: number; payment_status: string; created_at: string }>
  topProducts: Array<{ name: string; qty: number; revenue: number }>
  weeklyRevenue: Array<{ day: string; revenue: number }>
  lowStockItems: Array<{ name: string; stock: number; alert_quantity: number }>
}

function StatCard({
  label, value, icon: Icon, sub, color = 'text-primary',
}: {
  label: string; value: string; icon: React.ElementType; sub?: string; color?: string
}) {
  return (
    <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-gray-400 text-sm">{label}</p>
        <div className="w-9 h-9 rounded-xl bg-dark-card flex items-center justify-center">
          <Icon size={18} className={color} />
        </div>
      </div>
      <p className="text-white text-2xl font-bold">{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

const TOOLTIP_STYLE = {
  backgroundColor: '#2a2a3e',
  border: '1px solid #404060',
  borderRadius: 8,
  color: '#fff',
  fontSize: 12,
}

export default function DashboardScreen() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<DashStats>({
    todayRevenue: 0, todaySales: 0, todayCustomers: 0, lowStockCount: 0,
    recentSales: [], topProducts: [], weeklyRevenue: [], lowStockItems: [],
  })
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'today' | '7d' | '30d'>('7d')

  useEffect(() => {
    loadStats()
  }, [period])

  async function loadStats() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const daysBack = period === 'today' ? 0 : period === '7d' ? 7 : 30
    const chartFrom = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0]

    const [todaySalesRows, weekRows, topRows, lowRows, recentRows] = await Promise.all([
      window.electronAPI.db.query(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount),0) as revenue,
                COUNT(DISTINCT contact_id) as customers
         FROM sales WHERE sale_date = ? AND status != 'cancelled'`,
        [today]
      ) as Promise<Array<{ cnt: number; revenue: number; customers: number }>>,

      window.electronAPI.db.query(
        `SELECT sale_date as day, COALESCE(SUM(total_amount),0) as revenue
         FROM sales WHERE sale_date >= ? AND status != 'cancelled'
         GROUP BY sale_date ORDER BY sale_date`,
        [chartFrom]
      ) as Promise<Array<{ day: string; revenue: number }>>,

      window.electronAPI.db.query(
        `SELECT p.name, SUM(si.quantity) as qty, SUM(si.quantity * si.unit_price) as revenue
         FROM sale_items si
         JOIN products p ON p.id = si.product_id
         JOIN sales s ON s.id = si.sale_id
         WHERE s.sale_date >= ? AND s.status != 'cancelled'
         GROUP BY p.id ORDER BY qty DESC LIMIT 6`,
        [chartFrom]
      ) as Promise<Array<{ name: string; qty: number; revenue: number }>>,

      window.electronAPI.db.query(
        `SELECT p.name, COALESCE(ps.quantity, 0) as stock, p.alert_quantity
         FROM products p
         LEFT JOIN product_batches pb ON pb.id = (
           SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
         )
         LEFT JOIN product_stocks ps ON ps.id = (
           SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id ORDER BY id DESC LIMIT 1
         )
         WHERE p.is_stock_managed = 1 AND p.deleted_at IS NULL AND COALESCE(ps.quantity, 0) <= p.alert_quantity
         ORDER BY stock ASC LIMIT 8`,
        []
      ) as Promise<Array<{ name: string; stock: number; alert_quantity: number }>>,

      window.electronAPI.db.query(
        `SELECT id, invoice_number, total_amount, payment_status, created_at
         FROM sales WHERE status != 'cancelled'
         ORDER BY created_at DESC LIMIT 8`,
        []
      ) as Promise<Array<{ id: number; invoice_number: string; total_amount: number; payment_status: string; created_at: string }>>,
    ])

    const today0 = (todaySalesRows as Array<{ cnt: number; revenue: number; customers: number }>)[0]
    setStats({
      todayRevenue: Number(today0?.revenue ?? 0),
      todaySales: Number(today0?.cnt ?? 0),
      todayCustomers: Number(today0?.customers ?? 0),
      lowStockCount: (lowRows as Array<unknown>).length,
      recentSales: recentRows as Array<{ id: number; invoice_number: string; total_amount: number; payment_status: string; created_at: string }>,
      topProducts: topRows as Array<{ name: string; qty: number; revenue: number }>,
      weeklyRevenue: (weekRows as Array<{ day: string; revenue: number }>).map((r) => ({
        day: new Date(r.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }),
        revenue: Number(r.revenue),
      })),
      lowStockItems: lowRows as Array<{ name: string; stock: number; alert_quantity: number }>,
    })
    setLoading(false)
  }

  return (
    <BackOfficeLayout>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">{t('nav.dashboard')}</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-dark-card rounded-lg p-0.5 border border-dark-border">
              {(['today', '7d', '30d'] as const).map((p) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    period === p ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
                  }`}>
                  {p === 'today' ? t('dashboard.today') : p === '7d' ? t('dashboard.days7') : t('dashboard.days30')}
                </button>
              ))}
            </div>
            <button onClick={loadStats} className="p-2 rounded-lg border border-dark-border text-gray-400 hover:text-white transition-colors">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard label={t('dashboard.todaysRevenue')} value={`UZS ${fmtUZS(stats.todayRevenue)}`} icon={TrendingUp} sub={t('dashboard.today')} />
          <StatCard label={t('dashboard.todaysSales')} value={String(stats.todaySales)} icon={ShoppingBag} sub={t('session.transactions')} color="text-blue-400" />
          <StatCard label={t('dashboard.customersServed')} value={String(stats.todayCustomers)} icon={Users} sub={t('dashboard.today')} color="text-green-400" />
          <StatCard
            label={t('dashboard.lowStockItems')}
            value={String(stats.lowStockCount)}
            icon={AlertTriangle}
            sub={t('dashboard.needsRestock')}
            color={stats.lowStockCount > 0 ? 'text-red-400' : 'text-gray-400'}
          />
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          {/* Weekly Revenue Chart */}
          <div className="col-span-2 bg-dark-surface border border-dark-border rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-4 text-sm">{t('dashboard.revenue')} — {period === 'today' ? t('dashboard.today') : period === '7d' ? t('dashboard.last7Days') : t('dashboard.last30Days')}</h3>
            {loading || stats.weeklyRevenue.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-gray-600 text-sm">{t('dashboard.noDataYet')}</div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={stats.weeklyRevenue}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#404060" />
                  <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={60}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`UZS ${fmtUZS(v as number)}`, t('dashboard.revenue')]} />
                  <Area type="monotone" dataKey="revenue" stroke="#f97316" strokeWidth={2} fill="url(#revGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Low Stock Alerts */}
          <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-4 text-sm flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-400" />
              {t('dashboard.lowStock')}
            </h3>
            {stats.lowStockItems.length === 0 ? (
              <div className="text-gray-600 text-sm text-center py-8">{t('dashboard.allStockedUp')}</div>
            ) : (
              <div className="space-y-2">
                {stats.lowStockItems.map((item, i) => {
                  const isOut = item.stock === 0
                  const pct = item.alert_quantity > 0 ? Math.min(100, (item.stock / item.alert_quantity) * 100) : 0
                  return (
                    <div key={i} className="flex items-center gap-3 bg-dark-card border border-dark-border/60 rounded-xl px-3 py-2.5">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isOut ? 'bg-red-500/15' : 'bg-yellow-500/15'}`}>
                        <Package size={16} className={isOut ? 'text-red-400' : 'text-yellow-400'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-medium truncate">{item.name}</p>
                        <div className="h-1 bg-dark-border rounded-full mt-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${isOut ? 'bg-red-500' : 'bg-yellow-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-sm font-bold ${isOut ? 'text-red-400' : 'text-yellow-400'}`}>
                          {item.stock}
                        </span>
                        <p className="text-gray-600 text-[10px] leading-none mt-0.5">/{item.alert_quantity}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Top Products */}
          <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-4 text-sm">{t('dashboard.topProducts7Days')}</h3>
            {stats.topProducts.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-gray-600 text-sm">{t('dashboard.noSalesYet')}</div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={stats.topProducts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#404060" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={90}
                    tickFormatter={(v: string) => v.length > 12 ? v.slice(0, 12) + '…' : v} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="qty" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Recent Sales */}
          <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-4 text-sm">{t('dashboard.recentSales')}</h3>
            {stats.recentSales.length === 0 ? (
              <div className="text-gray-600 text-sm text-center py-8">{t('dashboard.noSalesYet')}</div>
            ) : (
              <div className="space-y-2">
                {stats.recentSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between py-1.5 border-b border-dark-border/50 last:border-0">
                    <div>
                      <p className="text-white text-xs font-medium">{sale.invoice_number}</p>
                      <p className="text-gray-500 text-xs">
                        {new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-primary text-xs font-semibold">UZS {fmtUZS(Number(sale.total_amount))}</p>
                      <span className={`text-xs ${sale.payment_status === 'fully_paid' ? 'text-green-400' : 'text-yellow-400'}`}>
                        {sale.payment_status === 'fully_paid' ? t('sales.fullyPaid') : t('sales.partiallyPaid')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </BackOfficeLayout>
  )
}
