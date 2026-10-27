import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { ProductListItem } from '@baraka/data'
import { Button, Icon, Input, Sheet, toast, useTheme } from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'

interface Props {
  /** Barcode that failed to match any product — prefilled, still editable in
   *  case the scan itself was misread. */
  barcode: string
  onClose: () => void
  /** Fires once the product is actually created, with enough fields to add
   *  straight to the cart. */
  onCreated: (product: ProductListItem) => void
}

function isExactDuplicate(p: ProductListItem, name: string, barcode: string): boolean {
  return p.name.trim().toLowerCase() === name.trim().toLowerCase() ||
    (barcode.trim() !== '' && p.barcode === barcode.trim())
}

/**
 * Opened the moment a barcode scan or search-enter finds nothing — lets the
 * cashier create the missing product on the spot instead of losing the sale.
 * A confirm step sits between the form and the actual insert specifically to
 * catch the failure mode that prompted this: a misread barcode creating a
 * second row for a product that already exists, splitting its stock across
 * two ids. Mirrors desktop's client/src/components/pos/QuickAddProductModal.tsx
 * (category picking is skipped — mobile has nowhere to set a product's
 * category yet, not even in Office's edit form).
 */
export function QuickAddProductModal({ barcode, onClose, onCreated }: Props) {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const { user } = useAuthStore()
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [barcodeValue, setBarcodeValue] = useState(barcode)
  const [similar, setSimilar] = useState<ProductListItem[]>([])
  // How many are on hand: the product enters the system with its stock (the
  // one exception to "stock only via a delivery"), then it's sold.
  const [qty, setQty] = useState('')
  const qtyNum = Number(qty.replace(',', '.'))
  const [saving, setSaving] = useState(false)

  function goToConfirm() {
    if (!name.trim() || !price || !(qtyNum > 0)) return
    const byName = repos.products.list({ search: name.trim(), limit: 5 })
    const byBarcode = barcodeValue.trim() ? repos.products.list({ search: barcodeValue.trim(), limit: 5 }) : []
    const merged = [...byName, ...byBarcode].filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
    setSimilar(merged)
    setStep('confirm')
  }

  function confirmCreate() {
    if (saving) return
    setSaving(true)
    try {
      const { productId, batchId } = repos.products.create({
        name: name.trim(),
        barcode: barcodeValue.trim() || null,
        price: Number(price),
        cost: Number(cost) || 0,
      })
      // The stock it arrives with, as a receipt document (pushed after the
      // product and batch — the outbox flushes those first).
      repos.warehouse.moveStock({
        productId, batchId, location: 'shop', delta: qtyNum,
        kind: 'receipt', reason: 'Quick add on the register', userId: user?.id ?? 1,
      })
      engine.flushOutbox().catch(() => {})

      const created = barcodeValue.trim()
        ? repos.products.findByBarcode(barcodeValue.trim())
        : repos.products.list({ search: name.trim(), limit: 1 })[0]
      if (created) onCreated(created)
      else toast.error('Product created but could not be found — check the list')
    } finally {
      setSaving(false)
    }
  }

  if (step === 'confirm') {
    const exactDup = similar.find((p) => isExactDuplicate(p, name, barcodeValue))
    return (
      <Sheet visible onClose={onClose} title="Confirm new product">
        <View style={styles.body}>
          <View style={[styles.banner, { backgroundColor: exactDup ? theme.danger + '1a' : theme.warning + '1a', borderColor: exactDup ? theme.danger : theme.warning }]}>
            <Icon name="alert" size={16} color={exactDup ? theme.danger : theme.warning} />
            <Text style={[typeScale.sm, { color: exactDup ? theme.danger : theme.warning, flex: 1 }]}>
              {exactDup
                ? `A product named "${exactDup.name}" already exists — pick it from the grid instead.`
                : 'Make sure this product really is new, not a misread barcode for one you already have.'}
            </Text>
          </View>

          {similar.length > 0 && (
            <View style={styles.similarList}>
              <Text style={[typeScale.xs, { color: theme.textFaint }]}>Similar products found</Text>
              {similar.map((p) => (
                <View key={p.id} style={[styles.similarRow, { borderColor: theme.border }]}>
                  <Text style={[typeScale.sm, { color: theme.text }]}>{p.name}</Text>
                  {p.barcode ? <Text style={[typeScale.xs, { color: theme.textFaint }]}>{p.barcode}</Text> : null}
                </View>
              ))}
            </View>
          )}

          <View style={[styles.summary, { borderColor: theme.border }]}>
            <Text style={[typeScale.xs, { color: theme.textFaint }]}>New product</Text>
            <Text style={[typeScale.md, { color: theme.text, fontWeight: '700' }]}>{name}</Text>
            <Text style={[typeScale.sm, { color: theme.textMuted }]}>
              {barcodeValue || '—'} · {price} UZS · qty {qtyNum}
            </Text>
          </View>

          <View style={styles.actions}>
            <Button title="Back" variant="secondary" onPress={() => setStep('form')} style={styles.flex1} />
            <Button title="Create" onPress={confirmCreate} loading={saving} disabled={!!exactDup} style={styles.flex2} />
          </View>
        </View>
      </Sheet>
    )
  }

  return (
    <Sheet visible onClose={onClose} title="New product">
      <View style={styles.body}>
        <Text style={[typeScale.sm, { color: theme.textMuted }]}>No product matches barcode {barcode}</Text>
        <Input label="Name" value={name} onChangeText={setName} autoFocus />
        <Input label="Barcode" value={barcodeValue} onChangeText={setBarcodeValue} />
        <View style={styles.row2}>
          <Input label="Price" value={price} onChangeText={setPrice} keyboardType="numeric" containerStyle={styles.flex1} />
          <Input label="Cost" value={cost} onChangeText={setCost} keyboardType="numeric" containerStyle={styles.flex1} />
        </View>
        <Input label="Quantity on hand" value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="0" />
        <View style={styles.actions}>
          <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.flex1} />
          <Button
            title="Continue"
            onPress={goToConfirm}
            disabled={!name.trim() || !price || !(qtyNum > 0)}
            style={styles.flex2}
          />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm, paddingBottom: spacing.sm },
  row2: { flexDirection: 'row', gap: spacing.sm },
  banner: { flexDirection: 'row', gap: spacing.sm, borderWidth: 1, borderRadius: 8, padding: spacing.sm, alignItems: 'flex-start' },
  similarList: { gap: spacing.xs },
  similarRow: { borderWidth: 1, borderRadius: 8, padding: spacing.sm },
  summary: { borderWidth: 1, borderRadius: 8, padding: spacing.sm, gap: 2 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
