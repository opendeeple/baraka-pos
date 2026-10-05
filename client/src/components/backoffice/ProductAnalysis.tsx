import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, Snail, TrendingDown } from 'lucide-react'
import { fmtUZS } from '../../lib/currency'
import { Select } from '../ui'

interface ProductSales { id: number; name: string; qty: number; revenue: number; profit: number }
interface DeadRow { id: number; name: string; stock: number; value: number; last_sold: string | null }
interface LossRow { reason: string; value: number; count: number }

type AbcClass = 'A' | 'B' | 'C'

// Net of refunds: a return line counts against the product (quantities on
// returns are positive since the integrity round, negative on older rows).
const SIGNED_QTY = `CASE WHEN s.sale_type = 'return' THEN -ABS(si.quantity) ELSE si.quantity END`

/**
 * Product analysis from this device's synced data:
 * - ABC: which products bring 80% of revenue (A), the next 15% (B), the rest (C).
 * - Dead stock: goods on hand that haven't sold for N days — money frozen on the shelf.
 * - Losses: write-offs by reason and stocktake shortages/surpluses (from the journal).
 */
export function ProductAnalysis({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const { t } = useTranslation()
  const [sales, setSales] = useState<ProductSales[]>([])
  const [dead, setDead] = useState<DeadRow[]>([])
  const [deadDays, setDeadDays] = useState('30')
  const [losses, setLosses] = useState<LossRow[]>([])
  const [stocktake, setStocktake] = useState({ shortage: 0, surplus: 0, count: 0 })
  const [abcFilter, setAbcFilter] = useState<AbcClass | 'all'>('all')
  const [abcLimit, setAbcLimit] = useState(30)
  const [deadLimit, setDeadLimit] = useState(15)

  useEffect(() => {
    window.electronAPI.db.query(
      `SELECT p.id, p.name,
              SUM(${SIGNED_QTY}) AS qty,
              SUM(${SIGNED_QTY} * ABS(si.unit_price) - COALESCE(si.discount, 0)) AS revenue,
              SUM(${SIGNED_QTY} * (ABS(si.unit_price) - ABS(COALESCE(si.unit_cost, 0))) - COALESCE(si.discount, 0)) AS profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.status != 'cancelled' AND si.item_type = 'product' AND s.sale_date BETWEEN ? AND ?
       GROUP BY p.id HAVING revenue > 0 ORDER BY revenue DESC`,
      [dateFrom, dateTo]
    ).then((rows) => setSales((rows as ProductSales[]).map((r) => ({ ...r, qty: Number(r.qty), revenue: Number(r.revenue), profit: Number(r.profit) }))))

    const from = `${dateFrom}T00:00:00`
    const to = `${dateTo}T23:59:59.999`
    window.electronAPI.db.query(
      `SELECT action, details FROM audit_logs WHERE action IN ('writeoff', 'stocktake') AND occurred_at BETWEEN ? AND ?`, [from, to]
    ).then((rows) => {
      const byReason = new Map<string, LossRow>()
      let shortage = 0, surplus = 0, count = 0
      for (const r of rows as Array<{ action: string; details: string | null }>) {
        let d: Record<string, any> = {}
        try { d = r.details ? JSON.parse(r.details) : {} } catch { /* skip */ }
        if (r.action === 'writeoff') {
          const key = String(d.reason ?? 'other')
          const row = byReason.get(key) ?? { reason: key, value: 0, count: 0 }
          row.value += Number(d.value) || 0
          row.count += 1
          byReason.set(key, row)
        } else {
          shortage += Number(d.shortageValue) || 0
          surplus += Number(d.surplusValue) || 0
          count += 1
        }
      }
      setLosses([...byReason.values()].sort((a, b) => b.value - a.value))
      setStocktake({ shortage, surplus, count })
    })
  }, [dateFrom, dateTo])

  useEffect(() => {
    window.electronAPI.db.query(
      `SELECT p.id, p.name,
              COALESCE((SELECT SUM(quantity) FROM product_stocks ps WHERE ps.product_id = p.id), 0) AS stock,
              COALESCE((SELECT SUM(quantity) FROM product_stocks ps WHERE ps.product_id = p.id), 0)
                * COALESCE((SELECT cost FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1), 0) AS value,
              (SELECT MAX(s.sale_date) FROM sale_items si JOIN sales s ON s.id = si.sale_id
               WHERE si.product_id = p.id AND s.status != 'cancelled' AND s.sale_type = 'sale') AS last_sold
       FROM products p
       WHERE p.deleted_at IS NULL AND COALESCE(p.is_stock_managed, 1) = 1`, []
    ).then((rows) => {
      const limit = new Date(); limit.setDate(limit.getDate() - Number(deadDays))
      const cutoff = limit.toISOString().slice(0, 10)
      setDead((rows as DeadRow[])
        .map((r) => ({ ...r, stock: Number(r.stock), value: Number(r.value) }))
        .filter((r) => r.stock > 0 && (!r.last_sold || r.last_sold < cutoff))
        .sort((a, b) => b.value - a.value))
    })
  }, [deadDays])

  const abc = useMemo(() => {
    const total = sales.reduce((s, r) => s + r.revenue, 0)
    let running = 0
    const rows = sales.map((r) => {
      running += r.revenue
      const share = total > 0 ? running / total : 1
      const cls: AbcClass = share <= 0.8 || running === r.revenue ? 'A' : share <= 0.95 ? 'B' : 'C'
      return { ...r, cls, pct: total > 0 ? (r.revenue / total) * 100 : 0 }
    })
    const summary = (['A', 'B', 'C'] as AbcClass[]).map((c) => {
      const list = rows.filter((r) => r.cls === c)
      return { cls: c, count: list.length, revenue: list.reduce((s, r) => s + r.revenue, 0), profit: list.reduce((s, r) => s + r.profit, 0) }
    })
    return { rows, summary, total }
  }, [sales])

  const tone: Record<AbcClass, string> = { A: 'bg-green-500/15 text-green-400', B: 'bg-yellow-500/15 text-yellow-400', C: 'bg-gray-500/15 text-gray-400' }
  const writeoffTotal = losses.reduce((s, l) => s + l.value, 0)
  const deadValue = dead.reduce((s, r) => s + r.value, 0)
  const shown = abc.rows.filter((r) => abcFilter === 'all' || r.cls === abcFilter)

  return (
    <div className="space-y-6">
      {/* ABC */}
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Layers size={15} className="text-primary" /> {t('analysis.abcTitle')}</h3>
        <p className="text-xs text-gray-500 mt-1 mb-4">{t('analysis.abcHint')}</p>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {abc.summary.map((s) => (
            <button key={s.cls} onClick={() => setAbcFilter(abcFilter === s.cls ? 'all' : s.cls)}
              className={`text-left rounded-xl p-4 border ${abcFilter === s.cls ? 'border-primary' : 'border-dark-border'} bg-dark-card`}>
              <div className="flex items-center gap-2">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold ${tone[s.cls]}`}>{s.cls}</span>
                <span className="text-white text-sm font-semibold">{t('analysis.productsCount', { count: s.count })}</span>
              </div>
              <p className="text-gray-400 text-xs mt-2">{t(`analysis.class${s.cls}`)}</p>
              <p className="text-white text-sm mt-1">UZS {fmtUZS(s.revenue)} <span className="text-gray-500 text-xs">({abc.total > 0 ? Math.round((s.revenue / abc.total) * 100) : 0}%)</span></p>
              <p className="text-green-400 text-xs">{t('analysis.profit')}: UZS {fmtUZS(s.profit)}</p>
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-6">{t('dashboard.noSalesYet')}</p>
        ) : (
          // No inner scroll box: on a touchscreen a scroll area inside the
          // scrolling page catches the swipe. Longer lists grow on request.
          <div>
            <table className="w-full">
              <thead className="bg-dark-surface">
                <tr>{['', t('common.name'), t('analysis.sold'), t('dashboard.revenue'), t('analysis.share'), t('analysis.profit')].map((h, i) => (
                  <th key={i} className="text-left px-3 py-2 text-xs text-gray-400 font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-dark-border">
                {shown.slice(0, abcLimit).map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs font-bold ${tone[r.cls]}`}>{r.cls}</span></td>
                    <td className="px-3 py-2 text-white text-sm">{r.name}</td>
                    <td className="px-3 py-2 text-gray-300 text-sm">{Math.round(r.qty * 1000) / 1000}</td>
                    <td className="px-3 py-2 text-white text-sm">UZS {fmtUZS(r.revenue)}</td>
                    <td className="px-3 py-2 text-gray-400 text-sm">{r.pct.toFixed(1)}%</td>
                    <td className={`px-3 py-2 text-sm ${r.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>UZS {fmtUZS(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > abcLimit && (
              <button onClick={() => setAbcLimit((n) => n + 30)} className="w-full h-11 mt-2 rounded-xl border border-dark-border text-sm text-gray-300 hover:text-white">
                {t('analysis.showMore', { count: shown.length - abcLimit })}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Dead stock */}
        <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Snail size={15} className="text-yellow-400" /> {t('analysis.deadTitle')}</h3>
              <p className="text-xs text-gray-500 mt-1">{t('analysis.deadHint')}</p>
            </div>
            <div className="w-36 shrink-0">
              <Select value={deadDays} onChange={setDeadDays} options={['30', '60', '90'].map((d) => ({ value: d, label: t('analysis.days', { count: Number(d) }) }))} />
            </div>
          </div>
          <p className="text-sm mt-3 mb-2"><span className="text-gray-400">{t('analysis.frozen')} </span><span className="text-yellow-400 font-bold">UZS {fmtUZS(deadValue)}</span>
            <span className="text-gray-500"> · {t('analysis.productsCount', { count: dead.length })}</span></p>
          <div className="divide-y divide-dark-border">
            {dead.length === 0 && <p className="text-gray-600 text-sm text-center py-6">{t('analysis.noDead')}</p>}
            {dead.slice(0, deadLimit).map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0 mr-3">
                  <p className="text-white truncate">{r.name}</p>
                  <p className="text-gray-500 text-xs">{r.last_sold ? t('analysis.lastSold', { date: new Date(r.last_sold).toLocaleDateString() }) : t('analysis.neverSold')}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-gray-300">{r.stock}</p>
                  <p className="text-yellow-400 text-xs">UZS {fmtUZS(r.value)}</p>
                </div>
              </div>
            ))}
          </div>
          {dead.length > deadLimit && (
            <button onClick={() => setDeadLimit((n) => n + 15)} className="w-full h-11 mt-2 rounded-xl border border-dark-border text-sm text-gray-300 hover:text-white">
              {t('analysis.showMore', { count: dead.length - deadLimit })}
            </button>
          )}
        </div>

        {/* Losses */}
        <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2"><TrendingDown size={15} className="text-red-400" /> {t('analysis.lossTitle')}</h3>
          <p className="text-xs text-gray-500 mt-1 mb-3">{t('analysis.lossHint')}</p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-dark-card rounded-xl p-3">
              <p className="text-xs text-gray-500">{t('writeoff.title')}</p>
              <p className="text-red-400 font-bold">UZS {fmtUZS(writeoffTotal)}</p>
            </div>
            <div className="bg-dark-card rounded-xl p-3">
              <p className="text-xs text-gray-500">{t('analysis.stocktakeNet', { count: stocktake.count })}</p>
              <p className={`font-bold ${stocktake.surplus - stocktake.shortage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                UZS {fmtUZS(stocktake.surplus - stocktake.shortage)}
              </p>
              <p className="text-[11px] text-gray-500">−{fmtUZS(stocktake.shortage)} / +{fmtUZS(stocktake.surplus)}</p>
            </div>
          </div>
          {losses.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-4">{t('analysis.noLosses')}</p>
          ) : losses.map((l) => (
            <div key={l.reason} className="flex justify-between py-1.5 text-sm">
              <span className="text-gray-300">{t(`writeoff.reason_${l.reason}`, { defaultValue: l.reason })} <span className="text-gray-600 text-xs">×{l.count}</span></span>
              <span className="text-red-400">UZS {fmtUZS(l.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
