import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Modal, Button, Input } from '../ui'
import { fmtUZS } from '../../lib/currency'
import { useAuthStore } from '../../store/auth.store'
import { paySupplier, UNPAID_PURCHASES_SQL, type PayMethod } from '../../lib/purchases'

interface Props {
  supplier: { id: number; name: string }
  onClose: () => void
  onPaid: () => void
}

interface Unpaid { id: number; reference_number: string | null; total_amount: number; amount_paid: number; received_at: string | null }

const METHODS: PayMethod[] = ['Cash', 'Card', 'Click', 'Transfer']

/**
 * Paying a supplier for received goods. The amount settles their oldest
 * unpaid deliveries first. Cash can come out of the open till (then it's a
 * paid-out in that shift's Z report) or from elsewhere (the safe).
 */
export function SupplierPayModal({ supplier, onClose, onPaid }: Props) {
  const { t } = useTranslation()
  const { user, store } = useAuthStore()
  const [unpaid, setUnpaid] = useState<Unpaid[]>([])
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PayMethod>('Cash')
  const [hasShift, setHasShift] = useState(false)
  const [fromTill, setFromTill] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.electronAPI.db.query(UNPAID_PURCHASES_SQL, [supplier.id]).then((rows) => {
      const list = (rows as Unpaid[]).map((r) => ({ ...r, total_amount: Number(r.total_amount), amount_paid: Number(r.amount_paid) }))
      setUnpaid(list)
      setAmount(String(Math.round(list.reduce((s, p) => s + p.total_amount - p.amount_paid, 0) * 100) / 100))
    })
    window.electronAPI.session.current().then((s) => { setHasShift(Boolean(s)); setFromTill(Boolean(s)) }).catch(() => {})
  }, [supplier.id])

  const owed = unpaid.reduce((s, p) => s + p.total_amount - p.amount_paid, 0)
  const value = Number(amount)
  const valid = Number.isFinite(value) && value > 0 && value <= owed + 0.001
  const label = (m: PayMethod) => t(`suppliers.method_${m}`)

  async function pay() {
    if (!valid) return
    setSaving(true)
    try {
      const res = await paySupplier(supplier.id, value, method, {
        userId: user?.id ?? null, storeId: store?.id ?? 1, fromTill: method === 'Cash' && fromTill, note,
      })
      toast.success(t('suppliers.paid', { amount: fmtUZS(res.applied), name: supplier.name }))
      onPaid()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('suppliers.payTitle', { name: supplier.name })}
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={pay} loading={saving} disabled={!valid}>{t('suppliers.pay')}</Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        <div className="bg-dark-card rounded-xl p-3 flex justify-between items-center">
          <span className="text-sm text-gray-400">{t('suppliers.weOwe')}</span>
          <span className="text-lg font-bold text-red-400">UZS {fmtUZS(owed)}</span>
        </div>
        {unpaid.length > 0 && (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {unpaid.map((p) => (
              <div key={p.id} className="flex justify-between text-xs">
                <span className="text-gray-400 font-mono">{p.reference_number ?? p.id}{p.received_at ? ` · ${new Date(p.received_at).toLocaleDateString()}` : ''}</span>
                <span className="text-gray-300">UZS {fmtUZS(p.total_amount - p.amount_paid)}</span>
              </div>
            ))}
          </div>
        )}
        <Input label={t('suppliers.amount')} type="number" min={0} step="any" value={amount}
          onChange={(e) => setAmount(e.target.value)} error={amount && !valid ? t('suppliers.amountTooBig') : undefined} />
        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t('suppliers.method')}</label>
          <div className="grid grid-cols-4 gap-2">
            {METHODS.map((m) => (
              <button key={m} onClick={() => setMethod(m)}
                className={`h-11 rounded-xl border text-sm font-medium ${method === m ? 'border-primary bg-primary/15 text-primary' : 'border-dark-border text-gray-300'}`}>
                {label(m)}
              </button>
            ))}
          </div>
        </div>
        {method === 'Cash' && (
          <label className={`flex items-start gap-2 text-sm ${hasShift ? 'text-gray-300' : 'text-gray-600'}`}>
            <input type="checkbox" className="mt-1" checked={fromTill} disabled={!hasShift} onChange={(e) => setFromTill(e.target.checked)} />
            <span>{hasShift ? t('suppliers.fromTill') : t('suppliers.noOpenShift')}</span>
          </label>
        )}
        <Input placeholder={t('suppliers.noteOptional')} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  )
}
