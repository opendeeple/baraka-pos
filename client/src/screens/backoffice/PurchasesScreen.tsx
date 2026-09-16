import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Truck, Check, X } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import { Modal, Button, Input, EmptyState, PageHeader, Select } from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface Purchase {
  id: number; reference_number: string; vendor_name: string | null
  total_amount: number; status: string; created_at: string; note: string | null
}

interface PurchaseItem { product_id: number; product_name: string; batch_id: number; quantity: number; unit_cost: number }

interface Product { id: number; name: string; batch_id: number; cost: number }

export default function PurchasesScreen() {
  const { t } = useTranslation()
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [selected, setSelected] = useState<Purchase | null>(null)
  const [poItems, setPoItems] = useState<PurchaseItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [vendorName, setVendorName] = useState('')
  const [refNumber, setRefNumber] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Array<{ id: string; productId: string; batchId: string; qty: string; cost: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [confirmReceive, setConfirmReceive] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { loadPurchases() }, [debouncedSearch])
  useEffect(() => { if (showForm) loadProducts() }, [showForm])
  useEffect(() => { setConfirmReceive(false) }, [selected?.id])

  async function loadPurchases() {
    let sql = `
      SELECT p.id, p.reference_number, c.name as vendor_name, p.total_amount, p.status, p.created_at, p.note
      FROM purchases p LEFT JOIN contacts c ON c.id=p.vendor_id
      WHERE p.deleted_at IS NULL`
    const params: unknown[] = []
    if (debouncedSearch.trim()) { sql += ` AND (p.reference_number LIKE ? OR c.name LIKE ?)`; const q = `%${debouncedSearch}%`; params.push(q, q) }
    sql += ` ORDER BY p.created_at DESC LIMIT 50`
    setPurchases(await window.electronAPI.db.query(sql, params) as Purchase[])
  }

  async function loadProducts() {
    const rows = await window.electronAPI.db.query(
      `SELECT p.id, p.name, pb.id as batch_id, pb.cost FROM products p
       JOIN product_batches pb ON pb.id = (
         SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
       )
       WHERE p.deleted_at IS NULL ORDER BY p.name`, []
    )
    setProducts(rows as Product[])
  }

  async function loadPoItems(id: number) {
    const rows = await window.electronAPI.db.query(
      `SELECT pi.product_id, p.name as product_name, pi.batch_id, pi.quantity, pi.unit_cost
       FROM purchase_items pi JOIN products p ON p.id=pi.product_id WHERE pi.purchase_id=?`, [id]
    )
    setPoItems(rows as PurchaseItem[])
  }

  function addLine() { setLines((prev) => [...prev, { id: crypto.randomUUID(), productId: '', batchId: '', qty: '1', cost: '', name: '' }]) }

  function setLine(i: number, k: string, v: string) {
    setLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const updated = { ...l, [k]: v }
      if (k === 'productId') {
        const prod = products.find((p) => p.id === Number(v))
        if (prod) { updated.batchId = String(prod.batch_id); updated.cost = String(prod.cost); updated.name = prod.name }
      }
      return updated
    }))
  }

  async function savePO() {
    if (!lines.length || lines.some((l) => !l.productId || !l.qty)) return
    setSaving(true)
    const now = new Date().toISOString()
    const total = lines.reduce((s, l) => s + Number(l.qty) * Number(l.cost || 0), 0)
    try {
      await window.electronAPI.db.exec(
        `INSERT INTO purchases (reference_number,note,total_amount,status,created_at,updated_at) VALUES (?,?,?,'pending',?,?)`,
        [refNumber || `PO-${Date.now()}`, note || null, total, now, now]
      )
      const rows = await window.electronAPI.db.query(`SELECT last_insert_rowid() as id`, []) as Array<{id:number}>
      const pid = rows[0].id
      for (const l of lines) {
        await window.electronAPI.db.exec(
          `INSERT INTO purchase_items (purchase_id,product_id,batch_id,quantity,unit_cost,total_cost,created_at) VALUES (?,?,?,?,?,?,?)`,
          [pid, Number(l.productId), Number(l.batchId), Number(l.qty), Number(l.cost || 0), Number(l.qty) * Number(l.cost || 0), now]
        )
      }
      setShowForm(false); setLines([]); setVendorName(''); setRefNumber(''); setNote(''); loadPurchases()
    } finally { setSaving(false) }
  }

  async function receivePO(purchase: Purchase) {
    setReceiving(true)
    const now = new Date().toISOString()
    try {
      const items = await window.electronAPI.db.query(
        `SELECT product_id, batch_id, quantity FROM purchase_items WHERE purchase_id=?`, [purchase.id]
      ) as Array<{product_id:number; batch_id:number; quantity:number}>
      for (const item of items) {
        await window.electronAPI.db.exec(
          `UPDATE product_stocks SET quantity=quantity+?,updated_at=? WHERE product_id=? AND batch_id=?`,
          [item.quantity, now, item.product_id, item.batch_id]
        )
      }
      await window.electronAPI.db.exec(`UPDATE purchases SET status='received',updated_at=? WHERE id=?`, [now, purchase.id])
      setConfirmReceive(false)
      setSelected(null); loadPurchases()
    } finally { setReceiving(false) }
  }

  return (
    <BackOfficeLayout>
      <PageHeader
        title={t('nav.purchases')}
        actions={
          <Button icon={Plus} onClick={() => { setShowForm(true); setLines([{ id: crypto.randomUUID(), productId: '', batchId: '', qty: '1', cost: '', name: '' }]) }}>
            {t('purchases.newPurchaseOrder')}
          </Button>
        }
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
              <tr>{[t('purchases.poNumber'), t('purchases.vendor'), t('common.total'), t('common.status'), t('common.date'), ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-dark-border">
              {purchases.map((po) => (
                <tr key={po.id} onClick={() => { setSelected(po); loadPoItems(po.id) }} className="hover:bg-dark-card/40 cursor-pointer group">
                  <td className="px-4 py-3 text-primary text-sm font-mono font-medium">{po.reference_number}</td>
                  <td className="px-4 py-3 text-gray-300 text-sm">{po.vendor_name ?? '—'}</td>
                  <td className="px-4 py-3 text-white text-sm font-semibold">UZS {fmtUZS(Number(po.total_amount))}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      po.status === 'received' ? 'bg-green-500/15 text-green-400'
                      : po.status === 'pending' ? 'bg-yellow-500/15 text-yellow-400'
                      : 'bg-gray-500/15 text-gray-400'}`}>{po.status === 'received' ? t('purchases.received') : po.status === 'pending' ? t('purchases.pending') : po.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-sm">{new Date(po.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-gray-600 group-hover:text-gray-300">›</td>
                </tr>
              ))}
            </tbody>
          </table>
          {purchases.length === 0 && (
            <EmptyState icon={Truck} title={t('purchases.noPurchaseOrdersYet')} />
          )}
        </div>

        {selected && (
          <div className="w-72 border-l border-dark-border bg-dark-surface overflow-y-auto shrink-0">
            <div className="p-4 border-b border-dark-border flex items-center justify-between">
              <div>
                <p className="text-white font-mono font-semibold text-sm">{selected.reference_number}</p>
                <p className="text-gray-500 text-xs">{selected.vendor_name ?? t('purchases.noVendor')}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              {poItems.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <div className="flex-1 mr-2">
                    <p className="text-white text-xs">{item.product_name}</p>
                    <p className="text-gray-500 text-xs">{item.quantity} × UZS {fmtUZS(Number(item.unit_cost))}</p>
                  </div>
                  <p className="text-primary text-xs font-semibold">UZS {fmtUZS(item.quantity * Number(item.unit_cost))}</p>
                </div>
              ))}
              <div className="border-t border-dark-border pt-3 flex justify-between font-bold">
                <span className="text-white text-sm">{t('common.total')}</span>
                <span className="text-primary text-sm">UZS {fmtUZS(Number(selected.total_amount))}</span>
              </div>
            </div>
            {selected.status === 'pending' && (
              <div className="p-4 border-t border-dark-border space-y-2">
                {confirmReceive ? (
                  <>
                    <p className="text-gray-400 text-xs text-center">{t('purchases.addStockConfirm')}</p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmReceive(false)}
                        className="flex-1 border border-dark-border text-gray-400 rounded-xl py-2 text-sm">
                        {t('common.cancel')}
                      </button>
                      <button onClick={() => receivePO(selected)} disabled={receiving}
                        className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-xl py-2 text-sm font-semibold">
                        {receiving ? t('purchases.receiving') : t('common.confirm')}
                      </button>
                    </div>
                  </>
                ) : (
                  <button onClick={() => setConfirmReceive(true)}
                    className="w-full flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-xl py-2.5 text-sm transition-colors">
                    <Check size={14} /> {t('purchases.receiveStock')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t('purchases.newPurchaseOrder')}
        maxWidth="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button className="flex-1" onClick={savePO} loading={saving} disabled={lines.length === 0}>
              {saving ? t('common.saving') : t('purchases.createPo')}
            </Button>
          </>
        }
      >
            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('purchases.poNumber')} placeholder={t('products.auto')} value={refNumber}
                  onChange={(e) => setRefNumber(e.target.value)} />
                <Input label={t('purchases.vendor')} placeholder={t('purchases.vendorName')} value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)} />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-400">{t('purchases.itemsRequired')}</label>
                  <button onClick={addLine} className="text-xs text-primary hover:text-orange-400">{t('purchases.addItem')}</button>
                </div>
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-5">
                        <Select
                          value={l.productId}
                          onChange={(v) => setLine(i, 'productId', v)}
                          placeholder={t('purchases.selectProduct')}
                          options={products.map((p) => ({ value: String(p.id), label: p.name }))}
                        />
                      </div>
                      <div className="col-span-2">
                        <input type="number" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} placeholder={t('common.quantity')}
                          className="w-full bg-dark-card border border-dark-border rounded-lg px-2 py-2 text-white text-xs focus:outline-none focus:border-primary" />
                      </div>
                      <div className="col-span-3">
                        <input type="number" value={l.cost} onChange={(e) => setLine(i, 'cost', e.target.value)} placeholder={t('purchases.unitCost')}
                          className="w-full bg-dark-card border border-dark-border rounded-lg px-2 py-2 text-white text-xs focus:outline-none focus:border-primary" />
                      </div>
                      <div className="col-span-2 text-right">
                        <p className="text-primary text-xs font-semibold">
                          {l.qty && l.cost ? `UZS ${fmtUZS(Number(l.qty) * Number(l.cost))}` : '—'}
                        </p>
                      </div>
                      <button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300 col-span-1 flex items-center justify-center text-base leading-none">×</button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 pt-2 border-t border-dark-border flex justify-between">
                  <span className="text-gray-400 text-sm">{t('common.total')}</span>
                  <span className="text-primary font-bold text-sm">
                    UZS {fmtUZS(lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.cost || 0), 0))}
                  </span>
                </div>
              </div>

              <Input label={t('purchases.note')} placeholder={t('purchases.optionalNote')} value={note}
                onChange={(e) => setNote(e.target.value)} />
            </div>
      </Modal>
    </BackOfficeLayout>
  )
}
