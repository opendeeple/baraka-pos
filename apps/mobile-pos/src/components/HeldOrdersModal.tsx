import { useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import type { HeldCart } from '@baraka/data'
import { Button, Dialog, EmptyState, IconButton, Sheet, useTheme } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'

interface Props {
  onClose: () => void
}

/**
 * Browse and restore/discard any held cart — not just the most recent one.
 * Mirrors desktop's client/src/components/pos/HeldOrdersDrawer.tsx.
 */
export function HeldOrdersModal({ onClose }: Props) {
  const theme = useTheme()
  const { t } = useTranslation()
  const { useCartStore } = getServices()
  const heldCarts = useCartStore((s) => s.heldCarts)
  const currentItems = useCartStore((s) => s.items)
  const restoreHeld = useCartStore((s) => s.restoreHeld)
  const discardHeld = useCartStore((s) => s.discardHeld)
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null)

  function doRestore(id: string) {
    restoreHeld(id)
    onClose()
  }

  function handleRestore(cart: HeldCart) {
    if (currentItems.length > 0) {
      setConfirmRestoreId(cart.id)
      return
    }
    doRestore(cart.id)
  }

  return (
    <Sheet visible onClose={onClose} title={t('pos.heldOrders')}>
      <FlatList
        data={[...heldCarts].reverse()}
        keyExtractor={(c) => c.id}
        style={styles.list}
        contentContainerStyle={styles.listInner}
        renderItem={({ item: cart }) => {
          const total = cart.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
          return (
            <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
              <View style={styles.cardHeader}>
                <View style={styles.flex1}>
                  <Text style={[typeScale.md, { color: theme.text, fontWeight: '700' }]}>
                    {cart.label || t('pos.heldDefaultLabel')}
                  </Text>
                  <Text style={[typeScale.xs, { color: theme.textFaint }]}>
                    {new Date(cart.createdAt).toLocaleTimeString()} · {t('pos.itemCount', { count: cart.items.length })}
                  </Text>
                </View>
                <Text style={[typeScale.md, { color: theme.primary, fontWeight: '700' }]}>{fmtUZS(total)}</Text>
              </View>
              {cart.items.slice(0, 3).map((i, idx) => (
                <View key={idx} style={styles.previewRow}>
                  <Text style={[typeScale.sm, { color: theme.textMuted }]} numberOfLines={1}>
                    {i.quantity}× {i.name}
                  </Text>
                  <Text style={[typeScale.sm, { color: theme.textMuted }]}>{fmtUZS(i.quantity * i.unitPrice)}</Text>
                </View>
              ))}
              {cart.items.length > 3 && (
                <Text style={[typeScale.xs, { color: theme.textFaint }]}>{t('pos.moreItems', { count: cart.items.length - 3 })}</Text>
              )}
              <View style={styles.cardActions}>
                <Button title={t('pos.restore')} icon="history" onPress={() => handleRestore(cart)} style={styles.flex1} />
                <IconButton
                  icon="trash"
                  variant="outline"
                  color={theme.danger}
                  accessibilityLabel={t('pos.discard')}
                  onPress={() => discardHeld(cart.id)}
                />
              </View>
            </View>
          )
        }}
        ListEmptyComponent={<EmptyState icon="cart" title={t('pos.noHeldOrders')} />}
      />

      <Dialog
        visible={confirmRestoreId !== null}
        onClose={() => setConfirmRestoreId(null)}
        title={t('pos.heldOrders')}
        message={t('pos.discardAndRestoreConfirm')}
        actions={[
          { label: t('common.cancel'), onPress: () => setConfirmRestoreId(null) },
          {
            label: t('pos.restore'),
            tone: 'primary',
            onPress: () => { if (confirmRestoreId) doRestore(confirmRestoreId); setConfirmRestoreId(null) },
          },
        ]}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  list: { maxHeight: 480 },
  listInner: { gap: spacing.sm, paddingBottom: spacing.sm },
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.xs },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between' },
  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
})
