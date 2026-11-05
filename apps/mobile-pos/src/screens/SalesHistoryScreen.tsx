import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { SaleHistoryItem } from '@baraka/data'
import { Badge, Button, Dialog, EmptyState, PinConfirmModal, Screen, toast, useTheme } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { radius, spacing, type as typeScale } from '@baraka/ui-tokens'
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
            <View style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
              <View style={styles.topRow}>
                <Text style={[typeScale.md, styles.flex1, { color: theme.text, fontWeight: '600' }]} numberOfLines={1}>
                  {item.invoiceNumber}
                </Text>
                <Text
                  style={[typeScale.money, styles.amount, { color: isReturn ? theme.danger : theme.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {fmtUZS(item.totalAmount)}
                </Text>
              </View>
              <Text style={[typeScale.sm, { color: theme.textMuted }]} numberOfLines={1}>
                {String(item.saleTime).slice(0, 16).replace('T', ' ')}
                {item.contactName ? ` · ${item.contactName}` : ''}
              </Text>
              <View style={styles.bottomRow}>
                <View style={styles.badges}>
                  {isReturn ? <Badge label={t('sales.refund')} tone="info" /> : null}
                  {item.status === 'refunded' ? <Badge label={t('sales.refunded')} tone="neutral" /> : null}
                  <Badge
                    label={item.syncStatus === 'synced' ? t('sales.synced') : t('sales.pending')}
                    tone={item.syncStatus === 'synced' ? 'success' : 'warning'}
                  />
                </View>
                {refundable ? (
                  <Button
                    title={t('sales.refund')}
                    variant="danger"
                    size="sm"
                    icon="refund"
                    onPress={() => setRefundTarget(item)}
                  />
                ) : null}
              </View>
            </View>
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
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  amount: { flexShrink: 0, maxWidth: '55%' },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.xxs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, flex: 1 },
  flex1: { flex: 1 },
})
