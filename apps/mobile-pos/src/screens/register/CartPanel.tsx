import { FlatList, StyleSheet, Text, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import { Button, EmptyState, IconButton, toast, useTheme } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { radius, spacing, touch, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../../platform/services'

interface CartPanelProps {
  onPay: () => void
  onHold: () => void
  onDiscountPress: () => void
}

/**
 * Cart contents + totals + actions. Subscribes to the cart store with
 * selectors so product-grid interactions don't re-render it (and vice versa).
 */
export function CartPanel({ onPay, onHold, onDiscountPress }: CartPanelProps) {
  const theme = useTheme()
  const { t } = useTranslation()
  const { useCartStore } = getServices()
  const items = useCartStore((s) => s.items)
  const discount = useCartStore((s) => s.discount)
  const heldCarts = useCartStore((s) => s.heldCarts)
  const setQuantity = useCartStore((s) => s.setQuantity)
  const restoreHeld = useCartStore((s) => s.restoreHeld)
  const getFinalTotal = useCartStore((s) => s.getFinalTotal)

  const total = getFinalTotal()
  const itemCount = items.reduce((s, i) => s + i.quantity, 0)

  return (
    <View style={styles.body}>
      <Text style={[typeScale.lg, styles.title, { color: theme.text }]}>{t('pos.cart', { count: itemCount })}</Text>
      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.listInner}
        renderItem={({ item, index }) => (
          <View style={[styles.row, { backgroundColor: theme.surfaceRaised }]}>
            <View style={styles.rowMid}>
              <Text style={[typeScale.sm, { color: theme.text, fontWeight: '600' }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[typeScale.xs, { color: theme.textFaint }]}>{fmtUZS(item.unitPrice)} each</Text>
            </View>
            <View style={styles.qtyControls}>
              <IconButton
                icon="minus"
                size={20}
                accessibilityLabel={`Decrease ${item.name} quantity`}
                onPress={() => {
                  // Floors at 1 for whole-unit quantities, but never floors
                  // ABOVE the current quantity — a weighed kg/box line
                  // already under 1 (0.35 kg) doesn't jump up to 1 on a tap;
                  // it just stays put (remove the line instead to clear it).
                  const next = Math.max(item.quantity - 1, Math.min(1, item.quantity))
                  if (setQuantity(index, next)) {
                    toast.info(t('pos.onlyInStock', { stock: item.maxStock, name: item.name }))
                  }
                }}
                variant="filled"
              />
              <Text style={[typeScale.money, styles.qtyText, { color: theme.text }]}>{item.quantity}</Text>
              <IconButton
                icon="plus"
                size={20}
                accessibilityLabel={`Increase ${item.name} quantity`}
                onPress={() => {
                  if (setQuantity(index, item.quantity + 1)) {
                    toast.info(t('pos.onlyInStock', { stock: item.maxStock, name: item.name }))
                  }
                }}
                variant="filled"
              />
            </View>
          </View>
        )}
        ListEmptyComponent={<EmptyState icon="cart" title={t('pos.cartEmpty')} message={t('pos.cartEmptyHint')} />}
      />
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Button
          title={discount > 0 ? t('pos.discountApplied', { amount: fmtUZS(discount) }) : t('pos.addDiscount')}
          variant="ghost"
          size="sm"
          onPress={onDiscountPress}
        />
        <View style={styles.totalRow}>
          <Text style={[typeScale.md, { color: theme.textMuted }]}>{t('pos.total')}</Text>
          <Text style={[typeScale.moneyLg, { color: theme.text }]}>{fmtUZS(total)}</Text>
        </View>
        {heldCarts.length > 0 && (
          <Button
            title={t('pos.heldRestore', { count: heldCarts.length })}
            variant="secondary"
            size="sm"
            icon="pause"
            onPress={() => restoreHeld(heldCarts[heldCarts.length - 1].id)}
            style={styles.heldBtn}
          />
        )}
        <View style={styles.actions}>
          <Button title={t('pos.hold')} variant="secondary" disabled={items.length === 0} onPress={onHold} style={styles.flex1} />
          <Button
            title={t('pos.pay', { amount: fmtUZS(total) })}
            disabled={items.length === 0}
            onPress={onPay}
            style={styles.flex2}
            testID="cart-pay"
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, flexShrink: 1 },
  title: { marginBottom: spacing.sm },
  listInner: { gap: spacing.xs, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.sm,
    paddingLeft: spacing.md,
    gap: spacing.sm,
  },
  rowMid: { flex: 1, gap: 1 },
  qtyControls: { flexDirection: 'row', alignItems: 'center' },
  qtyText: { minWidth: touch.minTarget - 16, textAlign: 'center' },
  footer: { borderTopWidth: 1, paddingTop: spacing.sm, marginTop: spacing.sm, gap: spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heldBtn: { alignSelf: 'stretch' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
