import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from '../ui'
import { fmtUZS } from '../../lib/currency'
import { LocalProduct } from './ProductGrid'

interface Props {
  product: LocalProduct
  onClose: () => void
  /** quantity is already in cart-store units (kg fraction for 'kg', box
   *  fraction for 'box') — unitPrice stays the product's existing per-kg or
   *  per-box price, nothing else about the cart model changes. */
  onAdd: (quantity: number) => void
}

type Mode = 'amount' | 'money'

/**
 * Opened instead of a flat +1 for kg/box-priced products — lets the cashier
 * enter either a weight/piece-count (to see the price) or a money amount (to
 * see how much weight/how many pieces it buys), in both directions, per the
 * owner's request ("1kg kalbasa 50000 bo'lsa 200 gr qancha bo'ladi... va
 * 20000 so'mlik necha gr bo'ladi").
 */
export function UnitCalculatorModal({ product, onClose, onAdd }: Props) {
  const { t } = useTranslation()
  const isBox = product.unit === 'box'
  const basePrice = product.price ?? 0
  const piecesPerBox = isBox ? (product.units_per_package || 1) : 1

  const [mode, setMode] = useState<Mode>('amount')
  const [amountInput, setAmountInput] = useState('') // grams (kg) or piece count (box)
  const [moneyInput, setMoneyInput] = useState('')

  // Everything derives from whichever field the cashier is actively typing —
  // no separate "confirm" step, the preview updates live.
  const { quantity, computedPrice, computedAmount } = useMemo(() => {
    if (mode === 'amount') {
      const amount = parseFloat(amountInput.replace(',', '.')) || 0
      const qty = isBox ? amount / piecesPerBox : amount / 1000
      return { quantity: qty, computedPrice: basePrice * qty, computedAmount: amount }
    }
    const money = parseFloat(moneyInput.replace(',', '.')) || 0
    const qty = basePrice > 0 ? money / basePrice : 0
    const amount = isBox ? qty * piecesPerBox : qty * 1000
    return { quantity: qty, computedPrice: money, computedAmount: amount }
  }, [mode, amountInput, moneyInput, basePrice, isBox, piecesPerBox])

  const amountLabel = isBox ? t('pos.calcPieces') : t('pos.calcGrams')
  const canAdd = quantity > 0

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={() => canAdd && onAdd(quantity)} disabled={!canAdd}>
            {t('pos.addToCart')}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        <p className="text-sm text-gray-400">
          {isBox
            ? t('pos.calcBoxBasePrice', { price: fmtUZS(basePrice), pieces: piecesPerBox })
            : t('pos.calcKgBasePrice', { price: fmtUZS(basePrice) })}
        </p>

        <div className="flex bg-dark-card border border-dark-border rounded-lg p-1 text-sm">
          <button
            onClick={() => setMode('amount')}
            className={`flex-1 py-1.5 rounded-md transition-colors ${mode === 'amount' ? 'bg-primary text-white' : 'text-gray-400'}`}
          >
            {amountLabel}
          </button>
          <button
            onClick={() => setMode('money')}
            className={`flex-1 py-1.5 rounded-md transition-colors ${mode === 'money' ? 'bg-primary text-white' : 'text-gray-400'}`}
          >
            {t('pos.calcMoney')}
          </button>
        </div>

        {mode === 'amount' ? (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{amountLabel}</label>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-lg focus:outline-none focus:border-primary"
            />
            <p className="text-sm text-gray-400 mt-2">
              {t('pos.calcResultPrice')}: <span className="text-white font-semibold">UZS {fmtUZS(computedPrice)}</span>
            </p>
          </div>
        ) : (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{t('pos.calcMoney')} (UZS)</label>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={moneyInput}
              onChange={(e) => setMoneyInput(e.target.value)}
              className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-lg focus:outline-none focus:border-primary"
            />
            <p className="text-sm text-gray-400 mt-2">
              {amountLabel}: <span className="text-white font-semibold">{computedAmount.toLocaleString()}</span>
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
