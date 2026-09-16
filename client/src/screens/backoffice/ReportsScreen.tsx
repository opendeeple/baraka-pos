import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_SERVER_URL } from '@baraka/shared'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import {
  TrendingUp, ShoppingCart, DollarSign, Package, RefreshCw,
} from 'lucide-react'
import { DatePicker } from '../../components/ui/DatePicker'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useAuthStore } from '../../store/auth.store'
import { fmtUZS } from '../../lib/currency'

const COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#f59e0b']

interface DailySummary {
  date: string
  totalRevenue: number
  totalProfit: number
  netProfit: number
  totalDiscount: number
  transactionCount: number
  totalExpenses: number
  paymentBreakdown: Array<{ method: string; total: number }>
  cashFlow: Array<{ type: string; amount: number; source: string; description?: string }>
}

interface TopProduct { productId: number; name: string; quantitySold: number }
interface CategorySale { category: string; revenue: number; qty: number }
interface HourlySlot { hour: number; label: string; revenue: number; transactions: number }
interface LowStockItem { productId: number; name: string; sku?: string; stock: number; alertQuantity: number }

function today() { return new Date().toISOString().split('T')[0] }
function nDaysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]
}

async function apiFetch<T>(url: string, token: string): Promise<T> {
  return window.electronAPI.reports.fetch(url, token) as Promise<T>
}

// Fixed server (dev override: VITE_SERVER_URL).
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL

export default function ReportsScreen() {
  const { t } = useTranslation()
  const { token } = useAuthStore()

  const [tab, setTab] = useState<'daily' | 'range'>('daily')
  const [date, setDate] = useState(today())
  const [dateFrom, setDateFrom] = useState(nDaysAgo(30))
  const [dateTo, setDateTo] = useState(today())

  const [daily, setDaily] = useState<DailySummary | null>(null)
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [categorySales, setCategorySales] = useState<CategorySale[]>([])
  const [hourly, setHourly] = useState<HourlySlot[]>([])
  const [lowStock, setLowStock] = useState<LowStockItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setError('')
    const base = `${SERVER_URL}/api/reports`
    const authToken = token
    // The Daily-tab summary is for the single `date`; the Range tab's KPI
    // cards (Revenue/Net Profit/Transactions/Expenses) need to reflect the
    // whole dateFrom..dateTo span instead, or they silently keep showing
    // just `date`'s numbers no matter what range is picked.
    const summaryUrl = tab === 'range'
      ? `${base}/daily?date=${dateFrom}&date_to=${dateTo}`
      : `${base}/daily?date=${date}`
    try {
      const [d, tp, cs, h, ls] = await Promise.all([
        apiFetch<DailySummary>(summaryUrl, authToken),
        apiFetch<TopProduct[]>(`${base}/top-products?date_from=${dateFrom}&date_to=${dateTo}&limit=10`, authToken),
        apiFetch<CategorySale[]>(`${base}/category-sales?date_from=${dateFrom}&date_to=${dateTo}`, authToken),
        apiFetch<HourlySlot[]>(`${base}/hourly?date=${date}`, authToken),
        apiFetch<LowStockItem[]>(`${base}/low-stock`, authToken),
      ])
      setDaily(d); setTopProducts(tp); setCategorySales(cs); setHourly(h); setLowStock(ls)
    } catch (e) {
      setError(t('reports.failedToLoad'))
      console.error(e)
    } finally { setLoading(false) }
  }, [token, date, dateFrom, dateTo, tab])

  useEffect(() => { load() }, [load])

  return (
    <BackOfficeLayout>
      <div className="flex items-center justify-between px-6 py-4 border-b border-dark-border shrink-0">
        <div>
          <h1 className="text-white font-bold text-xl">{t('nav.reports')}</h1>
          <p className="text-gray-500 text-xs mt-0.5">{t('reports.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab toggle */}
          <div className="flex bg-dark-card rounded-lg p-0.5 border border-dark-border">
            {(['daily', 'range'] as const).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === tb ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {tb === 'daily' ? t('reports.daily') : t('reports.dateRange')}
              </button>
            ))}
          </div>
          {/* Date pickers */}
          {tab === 'daily' ? (
            <DatePicker value={date} onChange={setDate} max={today()} className="w-36 shrink-0" />
          ) : (
            <div className="flex items-center gap-1.5 shrink-0">
              <DatePicker value={dateFrom} onChange={setDateFrom} max={dateTo} className="w-36" />
              <span className="text-gray-500 text-xs">{t('expenses.to')}</span>
              <DatePicker value={dateTo} onChange={setDateTo} min={dateFrom} max={today()} className="w-36" />
            </div>
          )}
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 bg-dark-card border border-dark-border hover:border-primary/50 text-gray-400 hover:text-white px-3 py-2 rounded-lg text-xs transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-4 text-sm">
            <p className="text-red-400 font-medium">{t('reports.couldNotConnect')}</p>
            <p className="text-red-400/60 text-xs mt-1">{t('reports.checkConnectionHint')}</p>
          </div>
        )}

        {/* Daily KPI cards */}
        {daily && (
          <div className="grid grid-cols-4 gap-4">
            <KPICard icon={DollarSign} label={t('dashboard.revenue')} value={`UZS ${fmtUZS(daily.totalRevenue)}`} color="text-primary" />
            <KPICard icon={TrendingUp} label={t('reports.netProfit')} value={`UZS ${fmtUZS(daily.netProfit)}`}
              color={daily.netProfit >= 0 ? 'text-green-400' : 'text-red-400'} />
            <KPICard icon={ShoppingCart} label={t('session.transactions')} value={daily.transactionCount.toString()} color="text-blue-400" />
            <KPICard icon={Package} label={t('nav.expenses')} value={`UZS ${fmtUZS(daily.totalExpenses)}`} color="text-orange-400" />
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          {/* Hourly sales chart */}
          <div className="col-span-2 bg-dark-surface border border-dark-border rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4">{t('reports.hourlySales', { date })}</h3>
            {hourly.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={hourly}>
                  <defs>
                    <linearGradient id="hourGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#404060" />
                  <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#2a2a3e', border: '1px solid #404060', borderRadius: 8 }}
                    labelStyle={{ color: '#fff' }} itemStyle={{ color: '#f97316' }} />
                  <Area type="monotone" dataKey="revenue" stroke="#f97316" fill="url(#hourGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-gray-600 text-sm">{t('reports.noSalesData')}</div>
            )}
          </div>

          {/* Payment breakdown */}
          <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4">{t('reports.paymentMethods')}</h3>
            {daily?.paymentBreakdown && daily.paymentBreakdown.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={daily.paymentBreakdown} dataKey="total" nameKey="method"
                      cx="50%" cy="50%" innerRadius={40} outerRadius={65}>
                      {daily.paymentBreakdown.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#2a2a3e', border: '1px solid #404060', borderRadius: 8 }}
                      itemStyle={{ color: '#fff' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {daily.paymentBreakdown.map((p, i) => (
                    <div key={p.method} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="text-gray-400">{t(`payment.method${p.method}`, { defaultValue: p.method })}</span>
                      </div>
                      <span className="text-white font-medium">UZS {fmtUZS(p.total)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-gray-600 text-sm">{t('reports.noData')}</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Top products */}
          <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4">{t('reports.topProducts')}
              <span className="text-gray-500 font-normal ml-1.5 text-xs">({dateFrom} → {dateTo})</span>
            </h3>
            {topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topProducts.slice(0, 8)} layout="vertical" margin={{ left: 0, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#404060" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={120}
                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                    tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 18) + '…' : v} />
                  <Tooltip contentStyle={{ background: '#2a2a3e', border: '1px solid #404060', borderRadius: 8 }}
                    labelStyle={{ color: '#fff' }} itemStyle={{ color: '#f97316' }} />
                  <Bar dataKey="quantitySold" fill="#f97316" radius={[0, 4, 4, 0]} name={t('reports.units')} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-gray-600 text-sm">{t('reports.noData')}</div>
            )}
          </div>

          {/* Category sales */}
          <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4">{t('reports.salesByCategory')}</h3>
            {categorySales.length > 0 ? (
              <div className="space-y-3">
                {categorySales.map((cat, i) => {
                  const maxRev = categorySales[0].revenue
                  const pct = maxRev > 0 ? (cat.revenue / maxRev) * 100 : 0
                  return (
                    <div key={cat.category}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-300">{cat.category}</span>
                        <span className="text-white font-medium">UZS {fmtUZS(cat.revenue)}</span>
                      </div>
                      <div className="h-1.5 bg-dark-card rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-gray-600 text-sm">{t('reports.noData')}</div>
            )}
          </div>
        </div>

        {/* Low stock alert */}
        {lowStock.length > 0 && (
          <div className="bg-dark-surface border border-yellow-500/30 rounded-2xl p-5">
            <h3 className="text-yellow-400 font-semibold text-sm mb-3 flex items-center gap-2">
              <Package size={15} /> {t('reports.lowStockAlert', { count: lowStock.length })}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-dark-border">
                    <th className="text-left pb-2">{t('nav.products')}</th>
                    <th className="text-left pb-2">{t('products.sku')}</th>
                    <th className="text-center pb-2">{t('common.stock')}</th>
                    <th className="text-center pb-2">{t('reports.alertAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((item) => (
                    <tr key={item.productId} className="border-b border-dark-card">
                      <td className="py-2 text-white">{item.name}</td>
                      <td className="py-2 text-gray-400">{item.sku ?? '—'}</td>
                      <td className="py-2 text-center">
                        <span className={`font-bold ${item.stock === 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                          {item.stock}
                        </span>
                      </td>
                      <td className="py-2 text-center text-gray-500">{item.alertQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </BackOfficeLayout>
  )
}

function KPICard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string; color: string
}) {
  return (
    <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <span className="text-gray-500 text-xs">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
