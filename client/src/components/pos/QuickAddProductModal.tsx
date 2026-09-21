import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Modal, Button, Input } from '../ui'
import { LocalProduct } from './ProductGrid'

interface Props {
  /** Barcode that failed to match any product — prefilled, still editable in
   *  case the scan itself was misread. */
  barcode: string
  onClose: () => void
  /** Fires once the product is actually created, with enough fields to add
   *  straight to the cart. */
  onCreated: (product: LocalProduct) => void
}

interface SimilarMatch { id: number; name: string; barcode: string | null }

/**
 * Opened the moment a barcode scan or search-enter finds nothing — lets the
 * cashier create the missing product on the spot instead of losing the sale.
 * A confirm step sits between the form and the actual insert specifically to
 * catch the failure mode that prompted this: a misread barcode creating a
 * second row for a product that already exists, splitting its stock across
 * two ids and throwing off every report that joins on product_id.
 */
export function QuickAddProductModal({ barcode, onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [barcodeValue, setBarcodeValue] = useState(barcode)
  const [similar, setSimilar] = useState<SimilarMatch[]>([])
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)

  async function goToConfirm() {
    if (!name.trim() || !price) return
    const q = `%${name.trim()}%`
    const rows = await window.electronAPI.db.query(
      `SELECT id, name, barcode FROM products
       WHERE deleted_at IS NULL AND (name LIKE ? OR (barcode IS NOT NULL AND barcode = ?))
       LIMIT 5`,
      [q, barcodeValue.trim()]
    ) as SimilarMatch[]
    setSimilar(rows)
    setStep('confirm')
  }

  async function confirmCreate() {
    if (submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    const now = new Date().toISOString()
    try {
      const productSyncId = uuidv4()
      const batchSyncId = uuidv4()
      await window.electronAPI.db.exec(
        `INSERT INTO products (sync_id,name,barcode,is_stock_managed,alert_quantity,is_active,product_type,created_at,updated_at)
         VALUES (?,?,?,1,5,1,'simple',?,?)`,
        [productSyncId, name.trim(), barcodeValue.trim() || null, now, now]
      )
      const rows = await window.electronAPI.db.query(`SELECT last_insert_rowid() as id`, []) as Array<{ id: number }>
      const pid = rows[0].id
      await window.electronAPI.db.exec(
        `INSERT INTO product_batches (sync_id,product_id,price,cost,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`,
        [batchSyncId, pid, Number(price), Number(cost) || 0, now, now]
      )
      const bRows = await window.electronAPI.db.query(`SELECT id FROM product_batches WHERE product_id=? LIMIT 1`, [pid]) as Array<{ id: number }>
      const stockSyncId = uuidv4()
      await window.electronAPI.db.exec(
        `INSERT INTO product_stocks (sync_id,product_id,batch_id,quantity,updated_at) VALUES (?,?,?,0,?)`,
        [stockSyncId, pid, bRows[0].id, now]
      )
      await window.electronAPI.sync.enqueue('products', productSyncId, 'upsert')
      await window.electronAPI.sync.enqueue('product_batches', batchSyncId, 'upsert')
      window.electronAPI.sync.pushPending().catch(() => {})

      onCreated({
        id: pid,
        name: name.trim(),
        barcode: barcodeValue.trim() || undefined,
        is_stock_managed: 1,
        is_active: 1,
        alert_quantity: 5,
        batch_id: bRows[0].id,
        price: Number(price),
        cost: Number(cost) || 0,
        stock: 0,
      })
    } finally {
      setSaving(false)
      submittingRef.current = false
    }
  }

  useEffect(() => { setBarcodeValue(barcode) }, [barcode])

  if (step === 'confirm') {
    return (
      <Modal
        open
        onClose={onClose}
        title={t('pos.confirmNewProductTitle')}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setStep('form')}>
              {t('common.back')}
            </Button>
            <Button className="flex-1" onClick={confirmCreate} loading={saving}>
              {t('pos.confirmNewProductYes')}
            </Button>
          </>
        }
      >
        <div className="p-5 space-y-3">
          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-200">{t('pos.confirmNewProductWarning')}</p>
          </div>
          {similar.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-400">{t('pos.similarProductsFound')}</p>
              {similar.map((p) => (
                <div key={p.id} className="text-sm bg-dark-card border border-dark-border rounded-lg px-3 py-2">
                  <span className="text-white">{p.name}</span>
                  {p.barcode && <span className="text-gray-500 text-xs ml-2">{p.barcode}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="text-sm bg-dark-card border border-dark-border rounded-lg px-3 py-2">
            <p className="text-gray-400 text-xs mb-1">{t('pos.newProductLabel')}</p>
            <p className="text-white font-medium">{name}</p>
            <p className="text-gray-500 text-xs">{barcodeValue || '—'} · UZS {price}</p>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('pos.quickAddProductTitle')}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={goToConfirm} disabled={!name.trim() || !price}>
            {t('common.continue')}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-3">
        <p className="text-sm text-gray-400">{t('pos.productNotFound', { barcode })}</p>
        <Input label={t('products.nameRequired')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Input label={t('products.barcode')} value={barcodeValue} onChange={(e) => setBarcodeValue(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('common.price')} value={price} onChange={(e) => setPrice(e.target.value)} />
          <Input label={t('common.cost')} value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}
