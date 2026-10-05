import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Search, Truck, PackageCheck, Printer, X, Banknote } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import { Button, EmptyState, PageHeader } from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { PurchaseOrderModal } from '../../components/backoffice/PurchaseOrderModal'
import { ReceivePurchaseModal } from '../../components/backoffice/ReceivePurchaseModal'
import { SupplierPayModal } from '../../components/backoffice/SupplierPayModal'
import { printPurchaseOrder } from '../../lib/purchases'

interface Purchase {
  id: number; reference_number: string; vendor_name: string | null; vendor_id: number | null
  total_amount: number; amount_paid: number; status: string; created_at: string; note: string | null
  received_location: string | null; received_at: string | null
}

interface PurchaseItem {
  product_name: string; quantity: number; unit_cost: number
  received_quantity: number | null; discrepancy_note: string | null; expiry_date: string | null
}

/**
 * Purchase orders: placed (PurchaseOrderModal — prints the order slip and
 * waits), then received against the delivery (ReceivePurchaseModal). Orders
 * sync through the server, so one placed here can be received on any device.
 */
export default function PurchasesScreen() {
  const { t } = useTranslation()
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [selected, setSelected] = useState<Purchase | null>(null)
  const [poItems, setPoItems] = useState<PurchaseItem[]>([])
  const [showOrder, setShowOrder] = useState(false)
  const [receiving, setReceiving] = useState<Purchase | null>(null)
  const [paying, setPaying] = useState<{ id: number; name: string } | null>(null)
  const [printing, setPrinting] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { loadPurchases() }, [debouncedSearch])
  useEffect(() => {
    // Orders and receipts also arrive from other devices through sync.
    const timer = setInterval(() => { loadPurchases() }, 15_000)
    return () => clearInterval(timer)
  }, [debouncedSearch])

  async function loadPurchases() {
    let sql = `
      SELECT p.id, p.reference_number, c.name as vendor_name, p.vendor_id, p.total_amount,
             COALESCE(p.amount_paid, 0) AS amount_paid, p.status, p.created_at, p.note,
             p.received_location, p.received_at
      FROM purchases p LEFT JOIN contacts c ON c.id=p.vendor_id
      WHERE p.deleted_at IS NULL`
    const params: unknown[] = []
    if (debouncedSearch.trim()) { sql += ` AND (p.reference_number LIKE ? OR c.name LIKE ?)`; const q = `%${debouncedSearch}%`; params.push(q, q) }
    sql += ` ORDER BY p.created_at DESC LIMIT 100`
    const rows = await window.electronAPI.db.query(sql, params) as Purchase[]
    setPurchases(rows)
    setSelected((prev) => (prev ? rows.find((r) => r.id === prev.id) ?? null : null))
  }

  async function openPurchase(po: Purchase) {
    setSelected(po)
    setPoItems(await window.electronAPI.db.query(
      `SELECT p.name as product_name, pi.quantity, pi.unit_cost, pi.received_quantity, pi.discrepancy_note, pi.expiry_date
       FROM purchase_items pi JOIN products p ON p.id=pi.product_id WHERE pi.purchase_id=? ORDER BY pi.id`, [po.id]
    ) as PurchaseItem[])
  }

  async function reprint(po: Purchase) {
    setPrinting(true)
    try {
      const res = await printPurchaseOrder(po.id)
      if (res.success) toast.success(t('purchases.printed'))
      else toast.error(t('purchases.printFailed', { error: res.error ?? '' }))
    } finally { setPrinting(false) }
  }

  const placeName = (loc: string | null) =>
    loc === 'shop' ? t('purchases.toShop') : loc === 'warehouse' ? t('purchases.toWarehouse') : '—'

  // What's still owed on a received order (an open one isn't owed yet).
  const dueOf = (po: Purchase) => Number(po.total_amount) - Number(po.amount_paid)
  // Payables are tracked per supplier: an order without one (bought at the
  // market and paid on the spot) owes nobody.
  function paymentLabel(po: Purchase) {
    if (po.status !== 'received' || !po.vendor_id) return <span className="text-gray-600">—</span>
    const due = dueOf(po)
    if (due <= 0.001) return <span className="text-green-400">{t('suppliers.paidFull')}</span>
    return <span className="text-red-400">{t('suppliers.dueAmount', { amount: fmtUZS(due) })}</span>
  }

  return (
    <BackOfficeLayout>
      <PageHeader
        title={t('nav.purchases')}
        subtitle={t('pageHints.purchases')}
        actions={<Button icon={Plus} onClick={() => setShowOrder(true)}>{t('purchases.newOrder')}</Button>}
      />
      <div className="shrink-0 px-6 py-3 border-b border-dark-border">
        <div className="relative max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('purchases.searchPoOrVendor')}
            className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
              <tr>{[t('purchases.poNumber'), t('suppliers.supplier'), t('purchases.amount'), t('common.status'), t('suppliers.payment'), t('common.date'), ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-dark-border">
              {purchases.map((po) => (
                <tr key={po.id} onClick={() => openPurchase(po)} className="hover:bg-dark-card/40 cursor-pointer group">
                  <td className="px-4 py-3 text-primary text-sm font-mono font-medium">{po.reference_number}</td>
                  <td className="px-4 py-3 text-gray-300 text-sm">{po.vendor_name ?? '—'}</td>
                  <td className="px-4 py-3 text-white text-sm font-semibold">UZS {fmtUZS(Number(po.total_amount))}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      po.status === 'received' ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'}`}>
                      {po.status === 'received'
                        ? po.received_location ? `${t('purchases.received')} · ${placeName(po.received_location)}` : t('purchases.received')
                        : t('purchases.pending')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">{paymentLabel(po)}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm">{new Date(po.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-right">
                    {po.status !== 'received' ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setReceiving(po) }}
                        className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white rounded-lg px-3 py-2 text-xs font-semibold"
                      >
                        <PackageCheck size={14} /> {t('purchases.receiveShort')}
                      </button>
                    ) : (
                      <span className="text-gray-600 group-hover:text-gray-300">›</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {purchases.length === 0 && (
            <EmptyState icon={Truck} title={t('purchases.noPurchaseOrdersYet')} />
          )}
        </div>

        {selected && (
          <div className="w-80 border-l border-dark-border bg-dark-surface flex flex-col shrink-0">
            <div className="p-4 border-b border-dark-border flex items-center justify-between">
              <div>
                <p className="text-white font-mono font-semibold text-sm">{selected.reference_number}</p>
                <p className="text-gray-500 text-xs">
                  {selected.status === 'received'
                    ? `${t('purchases.received')}${selected.received_location ? ` · ${placeName(selected.received_location)}` : ''}${selected.received_at ? ` · ${new Date(selected.received_at).toLocaleString()}` : ''}`
                    : t('purchases.pending')}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {poItems.map((item, i) => {
                const got = item.received_quantity == null ? null : Number(item.received_quantity)
                const differs = got != null && got !== Number(item.quantity)
                return (
                  <div key={i} className="text-sm">
                    <div className="flex justify-between">
                      <div className="flex-1 mr-2 min-w-0">
                        <p className="text-white text-xs truncate">{item.product_name}</p>
                        <p className="text-gray-500 text-xs">{Number(item.quantity)} × UZS {fmtUZS(Number(item.unit_cost))}</p>
                      </div>
                      <p className="text-primary text-xs font-semibold">UZS {fmtUZS(Number(item.quantity) * Number(item.unit_cost))}</p>
                    </div>
                    {got != null && (
                      <p className={`text-xs mt-0.5 ${differs ? 'text-yellow-400' : 'text-green-400'}`}>
                        {t('purchases.receivedQty', { qty: got })}{differs && item.discrepancy_note ? ` — ${item.discrepancy_note}` : ''}
                      </p>
                    )}
                    {item.expiry_date && (
                      <p className="text-xs text-gray-500">{t('purchases.expiresOn', { date: new Date(item.expiry_date).toLocaleDateString() })}</p>
                    )}
                  </div>
                )
              })}
              <div className="border-t border-dark-border pt-3 flex justify-between font-bold">
                <span className="text-white text-sm">{selected.status === 'received' ? t('purchases.invoiceTotal') : t('purchases.estimatedTotal')}</span>
                <span className="text-primary text-sm">UZS {fmtUZS(Number(selected.total_amount))}</span>
              </div>
              {selected.vendor_name && (
                <p className="text-xs text-gray-400">{t('suppliers.supplier')}: <span className="text-white">{selected.vendor_name}</span></p>
              )}
              {selected.status === 'received' && selected.vendor_id && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">{t('suppliers.paidSoFar', { amount: fmtUZS(Number(selected.amount_paid)) })}</span>
                  {paymentLabel(selected)}
                </div>
              )}
              {selected.note && <p className="text-xs text-gray-400">{selected.note}</p>}
            </div>
            <div className="p-4 border-t border-dark-border space-y-2">
              {selected.status === 'received' && selected.vendor_id && dueOf(selected) > 0.001 && (
                <button onClick={() => setPaying({ id: selected.vendor_id!, name: selected.vendor_name ?? '' })}
                  className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                  <Banknote size={15} /> {t('suppliers.pay')}
                </button>
              )}
              {selected.status !== 'received' && (
                <button onClick={() => setReceiving(selected)}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                  <PackageCheck size={15} /> {t('purchases.receiveOrder')}
                </button>
              )}
              <button onClick={() => reprint(selected)} disabled={printing}
                className="w-full flex items-center justify-center gap-2 border border-dark-border text-gray-300 hover:text-white rounded-xl py-2.5 text-sm transition-colors disabled:opacity-40">
                <Printer size={14} /> {t('purchases.reprint')}
              </button>
            </div>
          </div>
        )}
      </div>

      {showOrder && (
        <PurchaseOrderModal
          onClose={() => setShowOrder(false)}
          onCreated={() => { loadPurchases() }}
        />
      )}
      {paying && (
        <SupplierPayModal supplier={paying} onClose={() => setPaying(null)} onPaid={() => {
          loadPurchases()
          if (selected) openPurchase(selected)
        }} />
      )}
      {receiving && (
        <ReceivePurchaseModal
          purchaseId={receiving.id}
          reference={receiving.reference_number}
          onClose={() => setReceiving(null)}
          onReceived={() => {
            const po = receiving
            setReceiving(null)
            loadPurchases()
            if (po) openPurchase({ ...po, status: 'received' })
          }}
        />
      )}
    </BackOfficeLayout>
  )
}
