import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from '../ui'
import { NumPad } from './NumPad'
import { fmtUZS } from '../../lib/currency'

export interface DiscountValue {
  /** Percent off (0–100); only offered when `allowPercent`. */
  percent: number
  /** Money off, in UZS. */
  amount: number
}

interface Props {
  title: string
  /** What the discount comes off — the line's or the check's full price. */
  base: number
  /** A cart line takes either kind; the whole check is discounted in money. */
  allowPercent: boolean
  initial: DiscountValue
  onSave: (value: DiscountValue) => void
  onClose: () => void
}

/**
 * Discount entry on the till's on-screen keypad: money (e.g. 85 400 → 85 000
 * is 400 off) or a percentage. Previews the new price; a discount can never
 * exceed what it comes off.
 */
export function DiscountModal({ title, base, allowPercent, initial, onSave, onClose }: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'amount' | 'percent'>(allowPercent && initial.percent > 0 ? 'percent' : 'amount')
  const [draft, setDraft] = useState(String(mode === 'percent' ? initial.percent : initial.amount || 0))

  const value = parseFloat(draft) || 0
  const off = mode === 'percent' ? (base * value) / 100 : value
  const invalid = value < 0 || (mode === 'percent' ? value > 100 : value > base)

  function switchMode(next: 'amount' | 'percent') {
    setMode(next)
    setDraft('0')
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      maxWidth="max-w-xs"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={() => onSave({ percent: 0, amount: 0 })}>
            {t('discount.remove')}
          </Button>
          <Button
            className="flex-1"
            disabled={invalid}
            onClick={() => onSave(mode === 'percent' ? { percent: value, amount: 0 } : { percent: 0, amount: value })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="p-4 space-y-3">
        {allowPercent && (
          <div className="flex bg-dark-card border border-dark-border rounded-lg p-1 text-sm">
            {(['amount', 'percent'] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`flex-1 py-1.5 rounded-md transition-colors ${mode === m ? 'bg-primary text-white' : 'text-gray-400'}`}
              >
                {m === 'amount' ? t('discount.inMoney') : t('discount.inPercent')}
              </button>
            ))}
          </div>
        )}
        <NumPad
          value={draft}
          onChange={setDraft}
          maxDecimals={mode === 'percent' ? 2 : 0}
          label={mode === 'percent' ? t('discount.percentLabel') : t('discount.amountLabel')}
        />
        <div className="text-sm space-y-1">
          <div className="flex justify-between text-gray-400">
            <span>{t('discount.before')}</span>
            <span>UZS {fmtUZS(base)}</span>
          </div>
          <div className={`flex justify-between font-semibold ${invalid ? 'text-red-400' : 'text-green-400'}`}>
            <span>{invalid ? t('discount.tooMuch') : t('discount.after')}</span>
            <span>UZS {fmtUZS(Math.max(0, base - off))}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
