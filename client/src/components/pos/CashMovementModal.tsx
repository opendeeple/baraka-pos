import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { Modal, Button, Input, PinConfirmModal } from '../ui'
import { fmtUZS } from '../../lib/currency'
import { useAuthStore } from '../../store/auth.store'
import { autoOpenDrawer } from '../../lib/drawer'
import { logAudit } from '../../lib/audit'

export type MovementType = 'cash_in' | 'cash_out'

// 'Customer debt payment' and 'Supplier payment' are deliberately not here —
// both already have their own dedicated, better flows (DebtHistoryDrawer,
// SupplierPayModal) that tie into balances correctly; offering them again
// here would just be a second, worse way to do the same thing.
const REASON_KEYS: Record<MovementType, string[]> = {
  cash_in: ['floatTopUp', 'other'],
  cash_out: ['ownerDraw', 'bankDrop', 'correction', 'other'],
}

interface Props {
  type: MovementType
  onClose: () => void
  onDone: () => void
}

/**
 * Cash in/out with nothing behind it but the till itself — topping up the
 * float, the owner taking cash, a bank drop, a correction. Needs an open
 * shift (it's recorded against the session so the Z report's expected-cash
 * figure already accounts for it — see sessionReport.service.ts). Gated
 * behind the owner PIN same as other sensitive actions, but only when both
 * a PIN is set AND this specific gate is left on in Settings.
 */
export function CashMovementModal({ type, onClose, onDone }: Props) {
  const { t } = useTranslation()
  const { user, store } = useAuthStore()
  // Read straight from this terminal's own open session rather than the POS
  // cart store's useSessionStore — Office never populates that store (it has
  // no cart screen to keep it current for), but this modal opens from both.
  const [session, setSession] = useState<{ id: number } | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState(REASON_KEYS[type][0])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [ownerPin, setOwnerPin] = useState('')
  const [pinGateEnabled, setPinGateEnabled] = useState(true)
  const [showPin, setShowPin] = useState(false)

  useEffect(() => {
    window.electronAPI.session.current().then((s) => setSession(s as { id: number } | null))
    window.electronAPI.db.query(
      `SELECT meta_value FROM settings WHERE meta_key='owner_expense_pin' LIMIT 1`, []
    ).then((rows) => setOwnerPin((rows as Array<{ meta_value: string }>)[0]?.meta_value ?? ''))
    window.electronAPI.db.query(
      `SELECT meta_value FROM settings WHERE meta_key='cash_movement_pin_config' LIMIT 1`, []
    ).then((rows) => {
      try { setPinGateEnabled(Boolean(JSON.parse((rows as Array<{ meta_value: string }>)[0]?.meta_value ?? '{}').enabled ?? true)) }
      catch { setPinGateEnabled(true) }
    })
  }, [])

  function submit() {
    if (!amount || Number(amount) <= 0) return
    if (ownerPin && pinGateEnabled) { setShowPin(true); return }
    save()
  }

  async function save() {
    const value = Number(amount) || 0
    if (value <= 0) { toast.error(t('cashMovement.enterAmount')); return }
    if (!session) { toast.error(t('cashMovement.noSession')); return }
    setSaving(true)
    try {
      if (type === 'cash_out') {
        const report = await window.electronAPI.session.report(session.id) as { expectedCash: number }
        if (value > report.expectedCash) {
          toast.error(t('cashMovement.notEnoughCash', { amount: `UZS ${fmtUZS(report.expectedCash)}` }))
          setSaving(false)
          return
        }
      }
      const now = new Date().toISOString()
      const syncId = uuidv4()
      const reasonLabel = t(`cashMovement.reason_${reason}`)
      const description = note.trim() ? `${reasonLabel}: ${note.trim()}` : reasonLabel
      await window.electronAPI.db.transaction([
        {
          sql: `INSERT INTO cash_logs (sync_id, store_id, session_id, transaction_type, amount, source, description, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [syncId, store?.id ?? 1, session.id, type, value, type === 'cash_in' ? 'deposit' : 'withdrawal', description, user?.id ?? 1, now, now],
        },
        {
          sql: `INSERT INTO sync_queue_local (entity_type, table_name, op, payload, sync_id, created_at, status)
                VALUES ('cash_logs', 'cash_logs', 'upsert', '{}', ?, ?, 'pending')`,
          params: [syncId, now],
        },
      ])
      await logAudit(type === 'cash_in' ? 'cash_in' : 'cash_out', {
        entity: 'cash_logs', entityId: syncId, details: { amount: value, reason: reasonLabel, note: note.trim() || null },
      })
      window.electronAPI.sync.pushPending().catch(() => {})
      autoOpenDrawer('cashMovement', (msg) => toast.error(msg || t('settings.drawerFailed')))
      toast.success(type === 'cash_in'
        ? t('cashMovement.inRecorded', { amount: `UZS ${fmtUZS(value)}` })
        : t('cashMovement.outRecorded', { amount: `UZS ${fmtUZS(value)}` }))
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={type === 'cash_in' ? t('cashMovement.cashInTitle') : t('cashMovement.cashOutTitle')}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
            <Button className="flex-1" onClick={submit} loading={saving} disabled={!amount || Number(amount) <= 0}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {REASON_KEYS[type].map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className={`h-10 rounded-lg border text-sm transition-colors ${
                  reason === r ? 'bg-primary/15 border-primary text-primary' : 'border-dark-border text-gray-300'
                }`}>
                {t(`cashMovement.reason_${r}`)}
              </button>
            ))}
          </div>
          <Input type="number" min={0} step="any" label={t('cashMovement.amount')} value={amount}
            onChange={(e) => setAmount(e.target.value)} autoFocus />
          <Input placeholder={t('cashMovement.noteOptional')} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Modal>

      {showPin && (
        <PinConfirmModal
          expectedPin={ownerPin}
          title={type === 'cash_in' ? t('cashMovement.cashInTitle') : t('cashMovement.cashOutTitle')}
          onClose={() => setShowPin(false)}
          onConfirmed={() => { setShowPin(false); save() }}
        />
      )}
    </>
  )
}
