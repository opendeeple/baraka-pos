import { useEffect, useState } from 'react'
import { Search, Printer, XCircle, Eye, ShoppingBag, RotateCcw } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { useAuthStore } from '../../store/auth.store'
import { v4 as uuidv4 } from 'uuid'
import { fmtUZS } from '../../lib/currency'
import { toast } from 'sonner'
import { Select } from '../../components/ui/Select'
import { DatePicker } from '../../components/ui/DatePicker'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface Sale {
  id: number; invoice_number: string; total_amount: number; subtotal: number
  discount: number; total_charge_amount: number; amount_received: number
  change_amount: number; payment_status: string; status: string; sale_type: string
  sale_date: string; created_at: string; contact_name: string | null; user_name: string | null
  store_id?: number; contact_id?: number
}

interface SaleItem {
  id: number; description: string; quantity: number; unit_price: number
  unit_cost: number; discount: number; is_free: number
  product_id: number | null; batch_id: number | null
}

interface SaleDetail extends Sale {
  items: SaleItem[]
  payments: Array<{ payment_method: string; amount: number }>
}

interface ReturnItem {
  saleItemId: number; productId: number | null; batchId: number | null
  name: string; maxQty: number; returnQty: number; unitPrice: number; unitCost: number
}

export default function SalesScreen() {
  const [sales, setSales] = useState<Sale[]>([])
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [statusFilter, setStatusFilter] = useState('')
  const [detail, setDetail] = useState<SaleDetail | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([])
  const [returnMethod, setReturnMethod] = useState('Cash')
  const [processingReturn, setProcessingReturn] = useState(false)
  const { user, store } = useAuthStore()
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { loadSales() }, [debouncedSearch, dateFrom, dateTo, statusFilter])
  useEffect(() => { setConfirmVoid(false) }, [detail?.id])

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
    if (debouncedSearch.trim()) {
      sql += ` AND (s.invoice_number LIKE ? OR c.name LIKE ?)`;
      const q = `%${debouncedSearch}%`; params.push(q, q)
    }
    sql += ` ORDER BY s.created_at DESC LIMIT 100`
    setSales(await window.electronAPI.db.query(sql, params) as Sale[])
  }

  async function loadDetail(id: number) {
    const saleRows = await window.electronAPI.db.query(
      `SELECT s.*, c.name as contact_name, u.name as user_name FROM sales s
       LEFT JOIN contacts c ON c.id=s.contact_id LEFT JOIN users u ON u.id=s.user_id WHERE s.id=?`, [id]
    ) as SaleDetail[]
    if (!saleRows[0]) return
    const [items, payments] = await Promise.all([
      window.electronAPI.db.query(
        `SELECT si.id, si.description, si.quantity, si.unit_price, si.unit_cost,
                si.discount, si.is_free, si.product_id, si.batch_id
         FROM sale_items si WHERE si.sale_id=? AND si.item_type='product'`, [id]
      ),
      window.electronAPI.db.query(`SELECT payment_method,amount FROM payment_transactions WHERE sale_id=?`, [id]),
    ])
    setDetail({ ...saleRows[0], items: items as SaleItem[], payments: payments as SaleDetail['payments'] })
  }

  async function voidSale(id: number) {
    setVoiding(true)
    const now = new Date().toISOString()
    await window.electronAPI.db.exec(`UPDATE sales SET status='cancelled',updated_at=? WHERE id=?`, [now, id])
    setVoiding(false); setConfirmVoid(false); setDetail(null); loadSales()
  }

  async function reprintReceipt(sale: SaleDetail) {
    await window.electronAPI.printer.print({
      lines: [], invoiceNumber: sale.invoice_number, storeName: store?.name ?? 'Store',
      items: sale.items.map((i) => ({ name: i.description, quantity: i.quantity, price: i.unit_price, discount: i.discount })),
      subtotal: Number(sale.subtotal), charges: [], discount: Number(sale.discount), total: Number(sale.total_amount),
      payments: sale.payments.map((p) => ({ method: p.payment_method, amount: Number(p.amount) })),
      change: Number(sale.change_amount), cashierName: sale.user_name ?? user?.name ?? '',
      customerName: sale.contact_name ?? undefined, timestamp: sale.created_at,
    })
  }

  function openReturnModal() {
    if (!detail) return
    setReturnItems(
      detail.items
        .filter((i) => i.quantity > 0)
        .map((i) => ({
          saleItemId: i.id,
          productId: i.product_id,
          batchId: i.batch_id,
          name: i.description,
          maxQty: Number(i.quantity),
          returnQty: Number(i.quantity),
          unitPrice: Number(i.unit_price),
          unitCost: Number(i.unit_cost),
        }))
    )
    setReturnMethod('Cash')
    setShowReturnModal(true)
  }

  async function processReturn() {
    if (!detail) return
    const returnableItems = returnItems.filter((i) => i.returnQty > 0)
    if (!returnableItems.length) return
    setProcessingReturn(true)
    const now = new Date().toISOString()
    const syncId = uuidv4()
    const refundTotal = returnableItems.reduce((s, i) => s + i.unitPrice * i.returnQty, 0)

    try {
      await window.electronAPI.db.exec(
        `INSERT INTO sales (sync_id, store_id, contact_id, user_id, invoice_number, sale_type,
           reference_id, subtotal, total_amount, amount_received, status, payment_status,
           sale_date, sale_time, created_at, updated_at, sync_status)
         VALUES (?,?,?,?,?,'return',?,?,?,?,'completed','fully_paid',?,?,?,?,'pending')`,
        [syncId, detail.store_id ?? store?.id ?? 1, detail.contact_id ?? null, user?.id ?? 1,
         `RET-${syncId.slice(0, 8).toUpperCase()}`, detail.id,
         refundTotal, refundTotal, refundTotal,
         now.split('T')[0], now.split('T')[1].slice(0, 8), now, now]
      )

      const retRows = await window.electronAPI.db.query(
        `SELECT id FROM sales WHERE sync_id=? LIMIT 1`, [syncId]
      ) as Array<{ id: number }>
      const retSaleId = retRows[0].id

      for (const item of returnableItems) {
        await window.electronAPI.db.exec(
          `INSERT INTO sale_items (sale_id, item_type, product_id, batch_id, description,
             quantity, unit_price, unit_cost, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [retSaleId, 'product', item.productId, item.batchId, item.name,
           item.returnQty * -1, item.unitPrice, item.unitCost, now]
        )
        if (item.productId) {
          await window.electronAPI.db.exec(
            `UPDATE product_stocks SET quantity = quantity + ? WHERE product_id=? AND batch_id=?`,
            [item.returnQty, item.productId, item.batchId ?? 0]
          )
        }
      }

      await window.electronAPI.db.exec(
        `INSERT INTO payment_transactions (sale_id, store_id, transaction_date, amount,
           payment_method, transaction_type, charge_state, created_at, sync_status)
         VALUES (?,?,?,?,?,'return','FULLY_CHARGED',?,'pending')`,
        [retSaleId, detail.store_id ?? store?.id ?? 1, now, refundTotal * -1, returnMethod, now]
      )

      setShowReturnModal(false)
      toast.success(`Return processed. Refund: UZS ${fmtUZS(refundTotal)}`)
      loadSales()
      setDetail(null)
    } finally { setProcessingReturn(false) }
  }

  const totalRevenue = sales
    .filter((s) => s.status !== 'cancelled' && s.sale_type === 'sale')
    .reduce((sum, s) => sum + Number(s.total_amount), 0)

  return (
    <BackOfficeLayout>
      <div className="shrink-0 px-6 py-3 border-b border-dark-border bg-dark-surface flex items-center gap-2">
        <div className="mr-auto min-w-0">
          <h1 className="text-base font-bold text-white leading-tight">Sales History</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Total: <span className="text-primary font-semibold">UZS {fmtUZS(totalRevenue)}</span>
          </p>
        </div>
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Invoice or customer…"
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
            { value: '', label: 'All Status' },
            { value: 'completed', label: 'Completed' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
              <tr>{['Invoice', 'Date', 'Customer', 'Cashier', 'Total', 'Status', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-dark-border">
              {sales.map((sale) => (
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
                      {sale.sale_type === 'return' ? 'Return' : sale.status}
                    </span>
                  </td>
                  <td className="px-4 py-3"><Eye size={14} className="text-gray-600 group-hover:text-gray-300 transition-colors" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {sales.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-600">
              <ShoppingBag size={40} className="mb-3 opacity-30" /><p className="text-sm">No sales found</p>
            </div>
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
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Items</p>
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
                <div className="flex justify-between"><span className="text-gray-400">Subtotal</span><span className="text-white">UZS {fmtUZS(Number(detail.subtotal))}</span></div>
                {Number(detail.total_charge_amount) > 0 && <div className="flex justify-between"><span className="text-gray-400">Charges</span><span className="text-white">UZS {fmtUZS(Number(detail.total_charge_amount))}</span></div>}
                {Number(detail.discount) > 0 && <div className="flex justify-between"><span className="text-gray-400">Discount</span><span className="text-green-400">-UZS {fmtUZS(Number(detail.discount))}</span></div>}
                <div className="flex justify-between font-bold"><span className="text-white">Total</span><span className="text-primary">UZS {fmtUZS(Number(detail.total_amount))}</span></div>
              </div>
              <div className="border-t border-dark-border pt-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Payments</p>
                {detail.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-400">{p.payment_method}</span>
                    <span className="text-white">UZS {fmtUZS(Number(p.amount))}</span>
                  </div>
                ))}
                {Number(detail.change_amount) > 0 && (
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-400">Change</span>
                    <span className="text-yellow-400">UZS {fmtUZS(Number(detail.change_amount))}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 space-y-2 border-t border-dark-border">
              <button onClick={() => reprintReceipt(detail)}
                className="w-full flex items-center justify-center gap-2 border border-dark-border text-gray-300 hover:text-white rounded-xl py-2.5 text-sm transition-colors">
                <Printer size={14} /> Reprint
              </button>
              {detail.status === 'completed' && detail.sale_type === 'sale' && (
                <>
                  <button onClick={openReturnModal}
                    className="w-full flex items-center justify-center gap-2 bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 rounded-xl py-2.5 text-sm transition-colors">
                    <RotateCcw size={14} /> Return Items
                  </button>
                  {confirmVoid ? (
                    <div className="space-y-2">
                      <p className="text-gray-400 text-xs text-center">This cannot be undone.</p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmVoid(false)}
                          className="flex-1 border border-dark-border text-gray-400 rounded-xl py-2 text-sm">
                          Cancel
                        </button>
                        <button onClick={() => voidSale(detail.id)} disabled={voiding}
                          className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl py-2 text-sm font-semibold">
                          {voiding ? 'Voiding…' : 'Confirm Void'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmVoid(true)}
                      className="w-full flex items-center justify-center gap-2 bg-red-500/15 hover:bg-red-500/25 text-red-400 rounded-xl py-2.5 text-sm">
                      <XCircle size={14} /> Void Sale
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Return Items Modal */}
      {showReturnModal && detail && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-dark-border">
              <div>
                <h2 className="text-white font-semibold">Return Items</h2>
                <p className="text-gray-500 text-xs mt-0.5">From {detail.invoice_number}</p>
              </div>
              <button onClick={() => setShowReturnModal(false)} className="text-gray-400 hover:text-white">
                <XCircle size={18} />
              </button>
            </div>
            <div className="p-5">
              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-dark-border">
                    <th className="text-left pb-2">Product</th>
                    <th className="text-center pb-2 w-16">Ordered</th>
                    <th className="text-center pb-2 w-24">Return Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-card">
                  {returnItems.map((item, i) => (
                    <tr key={item.saleItemId}>
                      <td className="py-2.5 text-gray-300">{item.name}</td>
                      <td className="py-2.5 text-center text-gray-500">{item.maxQty}</td>
                      <td className="py-2.5 text-center">
                        <input
                          type="number"
                          min={0}
                          max={item.maxQty}
                          value={item.returnQty}
                          onChange={(e) => {
                            const val = Math.min(item.maxQty, Math.max(0, Number(e.target.value)))
                            setReturnItems((prev) => prev.map((x, idx) => idx === i ? { ...x, returnQty: val } : x))
                          }}
                          className="w-16 text-center bg-dark-card border border-dark-border text-white rounded-lg py-1 text-sm focus:outline-none focus:border-primary"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="border-t border-dark-border pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Refund method</span>
                  <div className="flex gap-2">
                    {['Cash', 'Credit'].map((m) => (
                      <button
                        key={m}
                        onClick={() => setReturnMethod(m)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          returnMethod === m
                            ? 'bg-primary border-primary text-white'
                            : 'border-dark-border text-gray-400 hover:text-white'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Refund total</span>
                  <span className="text-white font-bold text-lg">
                    UZS {fmtUZS(returnItems.filter((i) => i.returnQty > 0).reduce((s, i) => s + i.unitPrice * i.returnQty, 0))}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-3 p-5 pt-0">
              <button onClick={() => setShowReturnModal(false)}
                className="flex-1 border border-dark-border text-gray-400 rounded-xl py-2.5 text-sm">
                Cancel
              </button>
              <button
                onClick={processReturn}
                disabled={processingReturn || returnItems.every((i) => i.returnQty === 0)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <RotateCcw size={14} />
                {processingReturn ? 'Processing…' : 'Process Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </BackOfficeLayout>
  )
}
