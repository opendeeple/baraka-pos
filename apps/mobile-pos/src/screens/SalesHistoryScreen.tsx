import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { SaleHistoryItem } from '@baraka/data'
import { Badge, Button, Dialog, EmptyState, ListRow, PinConfirmModal, Screen, toast, useTheme } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'

export function SalesHistoryScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos, engine } = getServices()
  const { user, session } = useAuthStore()
  const [sales, setSales] = useState<SaleHistoryItem[]>([])
  const [refundTarget, setRefundTarget] = useState<SaleHistoryItem | null>(null)
  const [pinTarget, setPinTarget] = useState<SaleHistoryItem | null>(null)
  // Same settings key as desktop's owner_expense_pin gate — set once in
  // desktop Settings, synced down, and checked here too (M0's H4 left this
  // refund flow explicitly ungated pending this).
  const [ownerPin] = useState(() => repos.settings.get('owner_expense_pin'))

  const load = useCallback(() => {
    setSales(repos.sales.history({ limit: 100 }))
  }, [])

  useFocusEffect(load)

  function performRefund(sale: SaleHistoryItem) {
    // Refund money is always a current-shift drawer movement, so there must
    // be an open session here to file it under — it must not land on the
    // original (possibly already-closed) shift.
    if (!session) {
      toast.error(t('sales.refundOpenShift'))
      return
    }
    const invoiceNumber =
      engine.nextInvoiceNumber() ?? `RET-${Math.random().toString(16).slice(2, 10).toUpperCase()}`
    try {
      const result = repos.sales.createReturn(sale.id, {
        invoiceNumber,
        userId: user?.id ?? 1,
        userName: user?.name ?? null,
        sessionId: session.id,
      })
      if (!result) {
        toast.error(t('sales.refundAlreadyDone'))
        return
      }
      engine.flushOutbox().catch(() => {})
      load()
      toast.success(t('sales.refundSuccess', { invoice: result.invoiceNumber, amount: fmtUZS(result.total) }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sales.refundFailed'))
    }
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={sales}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const isReturn = item.saleType === 'return'
          const refundable = !isReturn && item.status === 'completed'
          return (
            <ListRow
              title={item.invoiceNumber}
              subtitle={`${String(item.saleTime).slice(0, 16).replace('T', ' ')}${item.contactName ? ` · ${item.contactName}` : ''}`}
              right={
                <View style={styles.right}>
                  <Text style={[typeScale.money, { color: isReturn ? theme.danger : theme.text }]}>
                    {fmtUZS(item.totalAmount)}
                  </Text>
                  <View style={styles.badges}>
                    {isReturn ? <Badge label={t('sales.refund')} tone="info" /> : null}
                    {item.status === 'refunded' ? <Badge label={t('sales.refunded')} tone="neutral" /> : null}
                    {refundable ? (
                      <Button
                        title={t('sales.refund')}
                        variant="danger"
                        size="sm"
                        haptic
                        onPress={() => setRefundTarget(item)}
                      />
                    ) : (
                      <Badge
                        label={item.syncStatus === 'synced' ? t('sales.synced') : t('sales.pending')}
                        tone={item.syncStatus === 'synced' ? 'success' : 'warning'}
                      />
                    )}
                  </View>
                </View>
              }
            />
          )
        }}
        ListEmptyComponent={
          <EmptyState icon="sales" title={t('sales.noSalesYet')} message={t('sales.noSalesHint')} />
        }
      />

      <Dialog
        visible={refundTarget !== null}
        onClose={() => setRefundTarget(null)}
        title={t('sales.refundTitle')}
        message={
          refundTarget
            ? t('sales.refundMessage', { invoice: refundTarget.invoiceNumber, amount: fmtUZS(refundTarget.totalAmount) })
            : ''
        }
        actions={[
          { label: t('common.cancel'), onPress: () => setRefundTarget(null) },
          {
            label: t('sales.refund'),
            tone: 'danger',
            onPress: () => {
              if (!refundTarget) return
              const target = refundTarget
              setRefundTarget(null)
              // Gate only applies once the owner has actually set a PIN —
              // same opt-in convention as every desktop PinConfirmModal site.
              if (ownerPin) setPinTarget(target)
              else performRefund(target)
            },
          },
        ]}
      />

      <PinConfirmModal
        visible={pinTarget !== null}
        expectedPin={ownerPin}
        title={t('sales.ownerPinForRefund')}
        onClose={() => setPinTarget(null)}
        onConfirmed={() => {
          const target = pinTarget
          setPinTarget(null)
          if (target) performRefund(target)
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  right: { alignItems: 'flex-end', gap: spacing.xs },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
})
