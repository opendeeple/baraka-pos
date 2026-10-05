import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Printer, XCircle, Eye, ShoppingBag, RotateCcw } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { useAuthStore } from '../../store/auth.store'
import { fmtUZS } from '../../lib/currency'
import { toast } from 'sonner'
import { Modal, Button, EmptyState, SkeletonRow, Select, DatePicker } from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { voidSale as voidSaleOp, refundSale, REFUND_NEEDS_SESSION } from '../../lib/salesOps'

interface Sale {
  id: number; invoice_number: string; total_amount: number; subtotal: number
  discount: number; total_charge_amount: number; amount_received: number
  change_amount: number; payment_status: string; status: string; sale_type: string
  sale_date: string; created_at: string; contact_name: string | null; user_name: string | null
  store_id?: number; contact_id?: number; session_id?: number | null
}

interface SaleItem {
  id: number; description: string; quantity: number; unit_price: number
  unit_cost: number; discount: number; is_free: number
  product_id: number | null; batch_id: number | null
}

interface SaleDetail extends Sale {
  items: SaleItem[]
  payments: Array<{ payment_method: string; amount: number }>
  sync_id: string | null
  /** State of the till session the sale was rung up in; a void is only allowed while it's still open. */
  session_state: string | null
  /** Already returned per product+batch ("pid:bid") across earlier returns of this sale. */
  returned: Record<string, number>
}

interface ReturnItem {
  saleItemId: number; productId: number | null; batchId: number | null
  name: string; sold: number; maxQty: number; returnQty: number
  /** What one unit actually cost the customer: item discount and the sale-level discount/charges spread in. */
  refundEach: number; unitCost: number
}

const lineKey = (productId: number | null, batchId: number | null) => `${productId ?? 0}:${batchId ?? 0}`

export default function SalesScreen() {
  const { t } = useTranslation()
  const [sales, setSales] = useState<Sale[]>([])
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('')
  const [totalExpensesInRange, setTotalExpensesInRange] = useState(0)
  const [detail, setDetail] = useState<SaleDetail | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([])
  const [returnMethod, setReturnMethod] = useState('Cash')
  const [processingReturn, setProcessingReturn] = useState(false)
  const [loading, setLoading] = useState(true)
  const { user, store } = useAuthStore()
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { loadSales() }, [debouncedSearch, dateFrom, dateTo, statusFilter, paymentMethodFilter])
  useEffect(() => { loadExpensesTotal() }, [dateFrom, dateTo])
  useEffect(() => { setConfirmVoid(false); setVoidReason('') }, [detail?.id])

  async function loadSales() {
    let sql = `
      SELECT s.id, s.invoice_number, s.total_amount, s.subtotal, s.discount,
             s.total_charge_amount, s.amount_received, s.change_amount,
             s.payment_status, s.status, s.sale_type, s.sale_date, s.created_at,
             s.store_id, s.contact_id,
             c.name as contact_name, u.name as user_name
      FROM sales s LEFT JOIN contacts c ON c.id=s.contact_id LEFT JOIN users u ON u.id=s.user_id WHERE 1=1`
    const params: unknown[] = []
    if (dateFrom) { sql += ` AND s.sale_date >= ?`; params.push(dateFrom) }
    if (dateTo) { sql += ` AND s.sale_date <= ?`; params.push(dateTo) }
    if (statusFilter) { sql += ` AND s.status = ?`; params.push(statusFilter) }
    if (paymentMethodFilter) {
      sql += ` AND EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.sale_id = s.id AND pt.payment_method = ?)`
      params.push(paymentMethodFilter)
    }
    if (debouncedSearch.trim()) {
      sql += ` AND (s.invoice_number LIKE ? OR c.name LIKE ?)`;
      const q = `%${debouncedSearch}%`; params.push(q, q)
    }
    sql += ` ORDER BY s.created_at DESC LIMIT 100`
    setLoading(true)
    try {
      setSales(await window.electronAPI.db.query(sql, params) as Sale[])
    } finally { setLoading(false) }
  }

  /** Same date range as the sales list, so the header can show sold vs.
   *  spent side by side for whatever period/payment-method is selected. */
  async function loadExpensesTotal() {
    const rows = await window.electronAPI.db.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
       WHERE expense_date >= ? AND expense_date <= ? AND deleted_at IS NULL`,
      [dateFrom, dateTo]
    ) as Array<{ total: number }>
    setTotalExpensesInRange(Number(rows[0]?.total ?? 0))
  }

  async function loadDetail(id: number) {
    const saleRows = await window.electronAPI.db.query(
      `SELECT s.*, c.name as contact_name, u.name as user_name FROM sales s
       LEFT JOIN contacts c ON c.id=s.contact_id LEFT JOIN users u ON u.id=s.user_id WHERE s.id=?`, [id]
    ) as SaleDetail[]
    if (!saleRows[0]) return
    const [items, payments, sessionRows, returnedRows] = await Promise.all([
      window.electronAPI.db.query(
        `SELECT si.id, si.description, si.quantity, si.unit_price, si.unit_cost,
                si.discount, si.is_free, si.product_id, si.batch_id
         FROM sale_items si WHERE si.sale_id=? AND si.item_type='product'`, [id]
      ),
      window.electronAPI.db.query(`SELECT payment_method,amount FROM payment_transactions WHERE sale_id=?`, [id]),
      window.electronAPI.db.query(`SELECT state FROM pos_sessions WHERE id=?`, [saleRows[0].session_id ?? -1]),
      // Returns may store their lines as negative quantities (older desktop
      // builds) or positive ones (Android) — counted by magnitude.
      window.electronAPI.db.query(
        `SELECT si.product_id, si.batch_id, SUM(ABS(si.quantity)) AS qty
         FROM sale_items si JOIN sales r ON r.id = si.sale_id
         WHERE r.reference_id=? AND r.sale_type='return' AND r.status != 'cancelled'
         GROUP BY si.product_id, si.batch_id`, [id]
      ),
    ])
    const returned: Record<string, number> = {}
    for (const r of returnedRows as Array<{ product_id: number | null; batch_id: number | null; qty: number }>) {
      returned[lineKey(r.product_id, r.batch_id)] = Number(r.qty)
    }
    setDetail({
      ...saleRows[0],
      items: items as SaleItem[],
      payments: payments as SaleDetail['payments'],
      session_state: (sessionRows as Array<{ state: string }>)[0]?.state ?? null,
      returned,
    })
  }

  // Void only while the sale's till session is open (once a shift is closed
  // and its Z report printed, a refund is the way); always with a reason.
  async function voidSale(id: number) {
    if (!detail || detail.id !== id || !voidReason.trim()) return
    setVoiding(true)
    try {
      await voidSaleOp(detail, voidReason)
      toast.success(t('sales.voided', { invoice: detail.invoice_number }))
      setConfirmVoid(false); setDetail(null); loadSales()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setVoiding(false)
    }
  }

  async function reprintReceipt(sale: SaleDetail) {
    // Same store block and receipt template as the original (PaymentScreen).
    const [storeRow] = await window.electronAPI.db.query(
      `SELECT name, address, phone FROM stores LIMIT 1`, []
    ) as Array<{ name: string; address: string | null; phone: string | null }>
    const [templateRow] = await window.electronAPI.db.query(
      `SELECT meta_value FROM settings WHERE meta_key='receipt_template' LIMIT 1`, []
    ) as Array<{ meta_value: string }>
    const template = templateRow ? JSON.parse(templateRow.meta_value) as { header?: string; footer?: string } : {}
    await window.electronAPI.printer.print({
      lines: [], invoiceNumber: sale.invoice_number, storeName: storeRow?.name ?? store?.name ?? 'Store',
      storeAddress: storeRow?.address, storePhone: storeRow?.phone, header: template.header, footer: template.footer,
      items: sale.items.map((i) => ({ name: i.description, quantity: i.quantity, price: i.unit_price, discount: i.discount })),
      subtotal: Number(sale.subtotal), charges: [], discount: Number(sale.discount), total: Number(sale.total_amount),
      payments: sale.payments.map((p) => ({ method: p.payment_method, amount: Number(p.amount) })),
      change: Number(sale.change_amount), cashierName: sale.user_name ?? user?.name ?? '',
      customerName: sale.contact_name ?? undefined, timestamp: sale.created_at,
    })
  }

  function openReturnModal() {
    if (!detail) return
    // What each unit actually cost the customer: its own discount, then the
    // sale-level discount/charges spread over all lines.
    const lineNet = (i: SaleItem) => Number(i.unit_price) * (1 - Number(i.discount || 0) / 100)
    const itemsNet = detail.items.reduce((s, i) => s + lineNet(i) * Math.abs(Number(i.quantity)), 0)
    const ratio = itemsNet > 0 ? Number(detail.total_amount) / itemsNet : 1
    setReturnItems(
      detail.items
        .filter((i) => Number(i.quantity) > 0)
        .map((i) => {
          const sold = Number(i.quantity)
          const left = Math.max(0, sold - (detail.returned[lineKey(i.product_id, i.batch_id)] ?? 0))
          return {
            saleItemId: i.id,
            productId: i.product_id,
            batchId: i.batch_id,
            name: i.description,
            sold,
            maxQty: left,
            returnQty: left,
            refundEach: Math.round(lineNet(i) * ratio * 100) / 100,
            unitCost: Number(i.unit_cost),
          }
        })
    )
    // Refund the way it was paid, by default.
    const main = [...detail.payments].sort((a, b) => Number(b.amount) - Number(a.amount))[0]?.payment_method
    setReturnMethod(main && ['Cash', 'Card', 'Click', 'Debt'].includes(main) ? main : 'Cash')
    setShowReturnModal(true)
  }

  async function processReturn() {
    if (!detail) return
    const lines = returnItems.filter((i) => i.returnQty > 0 && i.returnQty <= i.maxQty)
    if (!lines.length) return
    setProcessingReturn(true)
    try {
      const { refundTotal } = await refundSale(
        detail,
        lines.map((l) => ({ productId: l.productId, batchId: l.batchId, name: l.name, qty: l.returnQty, refundEach: l.refundEach, unitCost: l.unitCost })),
        returnMethod,
        { userId: user?.id ?? null, storeId: store?.id ?? 1 }
      )
      setShowReturnModal(false)
      toast.success(t('sales.returnProcessed', { amount: `UZS ${fmtUZS(refundTotal)}` }))
      loadSales()
      setDetail(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(msg === REFUND_NEEDS_SESSION ? t('sales.refundNeedsSession') : msg)
    } finally { setProcessingReturn(false) }
  }

  // Net of refunds (by magnitude — older returns were stored positive).
  const totalRevenue = sales
    .filter((s) => s.status !== 'cancelled')
    .reduce((sum, s) => sum + (s.sale_type === 'return' ? -Math.abs(Number(s.total_amount)) : Number(s.total_amount)), 0)

  return (
    <BackOfficeLayout>
      <div className="shrink-0 px-6 py-3 border-b border-dark-border bg-dark-surface flex items-center gap-2">
        <div className="mr-auto min-w-0">
          <h1 className="text-base font-bold text-white leading-tight" title={t('pageHints.sales')}>{t('nav.sales')}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {t('common.total')}: <span className="text-primary font-semibold">UZS {fmtUZS(totalRevenue)}</span>
            <span className="mx-1.5 text-gray-600">·</span>
            {t('nav.expenses')}: <span className="text-red-400 font-semibold">UZS {fmtUZS(totalExpensesInRange)}</span>
          </p>
        </div>
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sales.invoiceOrCustomer')}
            className="bg-dark-card border border-dark-border rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary w-44"
          />
        </div>
        <DatePicker value={dateFrom} onChange={setDateFrom} className="w-36 shrink-0" />
        <DatePicker value={dateTo} onChange={setDateTo} className="w-36 shrink-0" />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          className="w-32 shrink-0"
          options={[
            { value: '', label: t('sales.allStatus') },
            { value: 'completed', label: t('sales.completed') },
            { value: 'cancelled', label: t('sales.cancelled') },
          ]}
        />
        <Select
          value={paymentMethodFilter}
          onChange={setPaymentMethodFilter}
          className="w-32 shrink-0"
          options={[
            { value: '', label: t('sales.allPaymentMethods') },
            { value: 'Cash', label: t('payment.methodCash') },
            { value: 'Card', label: t('payment.methodCard') },
            { value: 'Click', label: t('payment.methodClick') },
            { value: 'Debt', label: t('payment.methodDebt') },
          ]}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
              <tr>{[t('sales.invoice'), t('common.date'), t('sales.customer'), t('sales.cashier'), t('common.total'), t('common.status'), ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-dark-border">
              {loading && Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} cols={7} />)}
              {!loading && sales.map((sale) => (
                <tr key={sale.id} onClick={() => loadDetail(sale.id)} className="hover:bg-dark-card/40 cursor-pointer group">
                  <td className="px-4 py-3 text-primary text-sm font-mono font-medium">{sale.invoice_number}</td>
                  <td className="px-4 py-3 text-gray-400 text-sm">{sale.sale_date} <span className="text-gray-600 text-xs">
                    {new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></td>
                  <td className="px-4 py-3 text-gray-300 text-sm">{sale.contact_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-sm">{sale.user_name ?? '—'}</td>
                  <td className="px-4 py-3 text-white text-sm font-semibold">UZS {fmtUZS(Number(sale.total_amount))}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      sale.status === 'completed' && sale.sale_type === 'return'
                        ? 'bg-blue-500/15 text-blue-400'
                        : sale.status === 'completed' ? 'bg-green-500/15 text-green-400'
                        : sale.status === 'cancelled' ? 'bg-red-500/15 text-red-400'
                        : 'bg-gray-500/15 text-gray-400'}`}>
                      {sale.sale_type === 'return' ? t('sales.return') : (sale.status === 'completed' ? t('sales.completed') : sale.status === 'cancelled' ? t('sales.cancelled') : sale.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3"><Eye size={14} className="text-gray-600 group-hover:text-gray-300 transition-colors" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && sales.length === 0 && (
            <EmptyState icon={ShoppingBag} title={t('sales.noSalesFound')} />
          )}
        </div>

        {detail && (
          <div className="w-72 border-l border-dark-border bg-dark-surface overflow-y-auto shrink-0">
            <div className="p-4 border-b border-dark-border flex items-center justify-between">
              <div>
                <p className="text-white font-mono font-semibold text-sm">{detail.invoice_number}</p>
                <p className="text-gray-500 text-xs">{detail.sale_date}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-white"><XCircle size={16} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{t('sales.items')}</p>
                <div className="space-y-2">
                  {detail.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-300 flex-1 mr-2 truncate">
                        {item.quantity}× {item.description}
                        {item.discount > 0 && <span className="text-green-400 ml-1">-{item.discount}%</span>}
                      </span>
                      <span className="text-white whitespace-nowrap">
                        UZS {fmtUZS(item.unit_price * item.quantity * (1 - item.discount / 100))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-dark-border pt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">{t('sales.subtotal')}</span><span className="text-white">UZS {fmtUZS(Number(detail.subtotal))}</span></div>
                {Number(detail.total_charge_amount) > 0 && <div className="flex justify-between"><span className="text-gray-400">{t('sales.charges')}</span><span className="text-white">UZS {fmtUZS(Number(detail.total_charge_amount))}</span></div>}
                {Number(detail.discount) > 0 && <div className="flex justify-between"><span className="text-gray-400">{t('sales.discount')}</span><span className="text-green-400">-UZS {fmtUZS(Number(detail.discount))}</span></div>}
                <div className="flex justify-between font-bold"><span className="text-white">{t('common.total')}</span><span className="text-primary">UZS {fmtUZS(Number(detail.total_amount))}</span></div>
              </div>
              <div className="border-t border-dark-border pt-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{t('sales.payments')}</p>
                {detail.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-400">{t(`payment.method${p.payment_method}`, { defaultValue: p.payment_method })}</span>
                    <span className="text-white">UZS {fmtUZS(Number(p.amount))}</span>
                  </div>
                ))}
                {Number(detail.change_amount) > 0 && (
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-400">{t('payment.change')}</span>
                    <span className="text-yellow-400">UZS {fmtUZS(Number(detail.change_amount))}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 space-y-2 border-t border-dark-border">
              <button onClick={() => reprintReceipt(detail)}
                className="w-full flex items-center justify-center gap-2 border border-dark-border text-gray-300 hover:text-white rounded-xl py-2.5 text-sm transition-colors">
                <Printer size={14} /> {t('sales.reprint')}
              </button>
              {detail.status === 'completed' && detail.sale_type === 'sale' && (
                <>
                  <button onClick={openReturnModal}
                    className="w-full flex items-center justify-center gap-2 bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 rounded-xl py-2.5 text-sm transition-colors">
                    <RotateCcw size={14} /> {t('sales.returnItems')}
                  </button>
                  {detail.session_state !== 'opened' ? (
                    <p className="text-xs text-gray-500 text-center">{t('sales.voidOnlyOpenShift')}</p>
                  ) : confirmVoid ? (
                    <div className="space-y-2">
                      <p className="text-gray-400 text-xs text-center">{t('sales.voidExplain')}</p>
                      <input
                        value={voidReason}
                        onChange={(e) => setVoidReason(e.target.value)}
                        placeholder={t('sales.voidReason')}
                        autoFocus
                        className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmVoid(false)}
                          className="flex-1 border border-dark-border text-gray-400 rounded-xl py-2.5 text-sm">
                          {t('common.cancel')}
                        </button>
                        <button onClick={() => voidSale(detail.id)} disabled={voiding || !voidReason.trim()}
                          className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold">
                          {voiding ? t('sales.voiding') : t('sales.confirmVoid')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmVoid(true)}
                      className="w-full flex items-center justify-center gap-2 bg-red-500/15 hover:bg-red-500/25 text-red-400 rounded-xl py-2.5 text-sm">
                      <XCircle size={14} /> {t('sales.voidSale')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Return Items Modal */}
      {detail && (
        <Modal
          open={showReturnModal}
          onClose={() => setShowReturnModal(false)}
          maxWidth="max-w-lg"
          title={
            <div>
              <h2 className="text-white font-semibold">{t('sales.returnItems')}</h2>
              <p className="text-gray-500 text-xs mt-0.5">{t('sales.fromInvoice', { invoice: detail.invoice_number })}</p>
            </div>
          }
          footer={
            <>
              <Button variant="secondary" className="flex-1" onClick={() => setShowReturnModal(false)}>
                {t('common.cancel')}
              </Button>
              <button
                onClick={processReturn}
                disabled={processingReturn || returnItems.every((i) => i.returnQty === 0)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <RotateCcw size={14} />
                {processingReturn ? t('sales.processing') : t('sales.processReturn')}
              </button>
            </>
          }
        >
            <div className="p-5">
              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-dark-border">
                    <th className="text-left pb-2">{t('nav.products')}</th>
                    <th className="text-center pb-2 w-16">{t('sales.sold')}</th>
                    <th className="text-center pb-2 w-20">{t('sales.canReturn')}</th>
                    <th className="text-center pb-2 w-24">{t('sales.returnQty')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-card">
                  {returnItems.map((item, i) => (
                    <tr key={item.saleItemId} className={item.maxQty === 0 ? 'opacity-40' : ''}>
                      <td className="py-2.5 text-gray-300">
                        {item.name}
                        <p className="text-xs text-gray-500">UZS {fmtUZS(item.refundEach)}</p>
                      </td>
                      <td className="py-2.5 text-center text-gray-500">{item.sold}</td>
                      <td className="py-2.5 text-center text-gray-300">{item.maxQty}</td>
                      <td className="py-2.5 text-center">
                        <input
                          type="number"
                          min={0}
                          max={item.maxQty}
                          disabled={item.maxQty === 0}
                          value={item.returnQty}
                          onChange={(e) => {
                            const val = Math.min(item.maxQty, Math.max(0, Number(e.target.value)))
                            setReturnItems((prev) => prev.map((x, idx) => idx === i ? { ...x, returnQty: val } : x))
                          }}
                          className="w-16 h-10 text-center bg-dark-card border border-dark-border text-white rounded-lg text-sm focus:outline-none focus:border-primary"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="border-t border-dark-border pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">{t('sales.refundMethod')}</span>
                  <div className="flex gap-2">
                    {(['Cash', 'Card', 'Click', 'Debt'] as const)
                      // Refund to debt only lowers what a known customer owes.
                      .filter((m) => m !== 'Debt' || detail.contact_id)
                      .map((m) => (
                        <button
                          key={m}
                          onClick={() => setReturnMethod(m)}
                          className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                            returnMethod === m
                              ? 'bg-primary border-primary text-white'
                              : 'border-dark-border text-gray-400 hover:text-white'
                          }`}
                        >
                          {t(`payment.method${m}`)}
                        </button>
                      ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">{t('sales.refundTotal')}</span>
                  <span className="text-white font-bold text-lg">
                    UZS {fmtUZS(returnItems.filter((i) => i.returnQty > 0).reduce((s, i) => s + i.refundEach * i.returnQty, 0))}
                  </span>
                </div>
              </div>
            </div>
        </Modal>
      )}
    </BackOfficeLayout>
  )
}
