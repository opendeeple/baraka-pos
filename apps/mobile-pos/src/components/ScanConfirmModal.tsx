import { useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import type { ProductListItem } from '@baraka/data'
import { Button, Icon, IconButton, Sheet, toast, useTheme, Text } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { radius, spacing, touch, type as typeScale } from '@baraka/ui-tokens'

interface Props {
  product: ProductListItem
  /** Items of this product+batch already in the cart — caps how much more fits. */
  inCartQty: number
  onClose: () => void
  onConfirm: (qty: number) => void
}

/**
 * Shown the moment a barcode scan matches a piece-priced product — product
 * photo, name and price up front, plus a quantity stepper, instead of
 * silently dropping one unit in the cart. Kg/box products keep going
 * straight to UnitCalculatorModal (which already covers this same need:
 * product info + an amount to enter) — this is for everything else.
 */
export function ScanConfirmModal({ product, inCartQty, onClose, onConfirm }: Props) {
  const theme = useTheme()
  const { t } = useTranslation()
  const [qty, setQty] = useState(1)

  const room = product.isStockManaged ? Math.max(0, product.stock - inCartQty) : undefined
  const overStock = room !== undefined && qty > room

  function confirm() {
    if (qty <= 0) return
    if (overStock) {
      toast.error(t('pos.onlyInStock', { stock: room, name: product.name }))
      return
    }
    onConfirm(qty)
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={t('pos.confirmNewProduct')}
      footer={
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} style={styles.flex1} />
          <Button title={t('pos.addToCart')} onPress={confirm} disabled={overStock} style={styles.flex2} />
        </View>
      }
    >
      <View style={styles.body}>
        <View style={styles.productRow}>
          <View style={[styles.thumb, { backgroundColor: theme.surface }]}>
            {product.imageUrl ? (
              <Image source={{ uri: product.imageUrl }} style={styles.thumbImg} resizeMode="cover" />
            ) : (
              <Icon name="package" size={28} color={theme.textFaint} />
            )}
          </View>
          <View style={styles.flex1}>
            <Text style={[typeScale.md, { color: theme.text, fontWeight: '700' }]} numberOfLines={2}>
              {product.name}
            </Text>
            <Text style={[typeScale.md, { color: theme.primary, fontWeight: '700' }]}>{fmtUZS(product.price)}</Text>
            {product.isStockManaged && (
              <Text style={[typeScale.xs, { color: theme.textFaint }]}>{t('pos.stock', { stock: product.stock })}</Text>
            )}
          </View>
        </View>

        <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('warehouse.quantity')}</Text>
        <View style={styles.stepperRow}>
          <IconButton
            icon="minus"
            variant="filled"
            accessibilityLabel={t('common.minus')}
            onPress={() => setQty((q) => Math.max(1, q - 1))}
          />
          <Text style={[typeScale.moneyDisplay, styles.qtyText, { color: theme.text }]}>{qty}</Text>
          <IconButton
            icon="plus"
            variant="filled"
            accessibilityLabel={t('common.plus')}
            onPress={() => setQty((q) => q + 1)}
          />
        </View>
        {overStock && (
          <Text style={[typeScale.sm, { color: theme.danger }]}>
            {t('pos.onlyInStock', { stock: room, name: product.name })}
          </Text>
        )}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm, paddingBottom: spacing.sm },
  productRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  qtyText: { minWidth: touch.minTarget, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
