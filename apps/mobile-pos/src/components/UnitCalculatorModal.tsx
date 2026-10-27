import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import type { ProductListItem } from '@baraka/data'
import { Chip, Dialog, Input, useTheme } from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'

/** quantity is in cart-store units (kg fraction for 'kg', box fraction for
 *  'box'); unitPrice is per kg or per box, like every other cart line. */
export interface CalculatorLine { quantity: number; unitPrice: number }

interface Props {
  product: ProductListItem
  onClose: () => void
  onAdd: (lines: CalculatorLine[]) => void
}

type Mode = 'amount' | 'money'

/**
 * Cart lines for `pieces` of a box product. With its own piece price set,
 * whole boxes sell at the box price and only the leftover pieces at the
 * piece price (a separate line, priced per box so quantity stays the box
 * fraction stock moves by). Without one, it's all one line at box price.
 * Mirrors desktop's client/src/components/pos/UnitCalculatorModal.tsx exactly.
 */
function boxLines(pieces: number, boxPrice: number, piecesPerBox: number, piecePrice: number | null): CalculatorLine[] {
  if (!piecePrice) return [{ quantity: pieces / piecesPerBox, unitPrice: boxPrice }]
  const boxes = Math.floor(pieces / piecesPerBox)
  const loose = pieces - boxes * piecesPerBox
  const lines: CalculatorLine[] = []
  if (boxes > 0) lines.push({ quantity: boxes, unitPrice: boxPrice })
  if (loose > 0) lines.push({ quantity: loose / piecesPerBox, unitPrice: piecePrice * piecesPerBox })
  return lines
}

const linesTotal = (lines: CalculatorLine[]) => lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)

/**
 * Opened instead of a flat +1 for kg/box-priced products — lets the cashier
 * enter either a weight/piece-count (to see the price) or a money amount (to
 * see how much weight/how many pieces it buys), in both directions.
 */
export function UnitCalculatorModal({ product, onClose, onAdd }: Props) {
  const theme = useTheme()
  const isBox = product.unit === 'box'
  const basePrice = product.price ?? 0
  const piecesPerBox = isBox ? (product.unitsPerPackage || 1) : 1
  const piecePrice = isBox && Number(product.piecePrice) > 0 ? Number(product.piecePrice) : null

  const [mode, setMode] = useState<Mode>('amount')
  const [amountInput, setAmountInput] = useState('') // grams (kg) or piece count (box)
  const [moneyInput, setMoneyInput] = useState('')

  const { lines, computedPrice, computedAmount } = useMemo(() => {
    if (mode === 'amount') {
      const amount = parseFloat(amountInput.replace(',', '.')) || 0
      const lines = isBox
        ? boxLines(amount, basePrice, piecesPerBox, piecePrice)
        : [{ quantity: amount / 1000, unitPrice: basePrice }]
      return { lines, computedPrice: linesTotal(lines), computedAmount: amount }
    }
    const money = parseFloat(moneyInput.replace(',', '.')) || 0
    if (isBox && piecePrice) {
      const boxes = basePrice > 0 ? Math.floor(money / basePrice) : 0
      const pieces = boxes * piecesPerBox + (money - boxes * basePrice) / piecePrice
      const lines = boxLines(pieces, basePrice, piecesPerBox, piecePrice)
      return { lines, computedPrice: linesTotal(lines), computedAmount: pieces }
    }
    const qty = basePrice > 0 ? money / basePrice : 0
    const amount = isBox ? qty * piecesPerBox : qty * 1000
    return { lines: [{ quantity: qty, unitPrice: basePrice }], computedPrice: money, computedAmount: amount }
  }, [mode, amountInput, moneyInput, basePrice, isBox, piecesPerBox, piecePrice])

  const amountLabel = isBox ? 'Pieces' : 'Grams'
  const addable = lines.filter((l) => l.quantity > 0)
  const canAdd = addable.length > 0

  return (
    <Dialog
      visible
      onClose={onClose}
      title={product.name}
      actions={[
        { label: 'Cancel', onPress: onClose },
        { label: 'Add to cart', tone: 'primary', onPress: () => canAdd && onAdd(addable) },
      ]}
    >
      <View style={styles.body}>
        <Text style={[typeScale.sm, { color: theme.textMuted }]}>
          {isBox
            ? `Box price ${fmtUZS(basePrice)} (${piecesPerBox} pcs)`
            : `Per kg ${fmtUZS(basePrice)}`}
          {piecePrice ? `\nPer piece ${fmtUZS(piecePrice)}` : ''}
        </Text>

        <View style={styles.modeRow}>
          <Chip label={amountLabel} selected={mode === 'amount'} onPress={() => setMode('amount')} />
          <Chip label="Money" selected={mode === 'money'} onPress={() => setMode('money')} />
        </View>

        {mode === 'amount' ? (
          <View>
            <Input
              label={amountLabel}
              value={amountInput}
              onChangeText={setAmountInput}
              keyboardType="decimal-pad"
              autoFocus
            />
            <Text style={[typeScale.sm, { color: theme.textMuted }, styles.gapTop]}>
              Price: <Text style={{ color: theme.text, fontWeight: '700' }}>{fmtUZS(computedPrice)}</Text>
            </Text>
          </View>
        ) : (
          <View>
            <Input
              label="Money (UZS)"
              value={moneyInput}
              onChangeText={setMoneyInput}
              keyboardType="decimal-pad"
              autoFocus
            />
            <Text style={[typeScale.sm, { color: theme.textMuted }, styles.gapTop]}>
              {amountLabel}: <Text style={{ color: theme.text, fontWeight: '700' }}>{computedAmount.toLocaleString()}</Text>
            </Text>
          </View>
        )}
      </View>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm, marginTop: spacing.sm },
  modeRow: { flexDirection: 'row', gap: spacing.xs },
  gapTop: { marginTop: spacing.xs },
})
