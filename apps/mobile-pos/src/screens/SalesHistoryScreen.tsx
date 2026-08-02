import { useCallback, useState } from 'react'
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { SaleHistoryItem } from '@baraka/data'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { colors } from '../theme'

export function SalesHistoryScreen() {
  const { repos, engine } = getServices()
  const user = useAuthStore((s) => s.user)
  const [sales, setSales] = useState<SaleHistoryItem[]>([])

  const load = useCallback(() => {
    setSales(repos.sales.history({ limit: 100 }))
  }, [])

  useFocusEffect(load)

  function confirmRefund(sale: SaleHistoryItem) {
    Alert.alert(
      'Refund sale?',
      `${sale.invoiceNumber} — ${fmtUZS(sale.totalAmount)}\nStock is restored and payments are reversed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Refund',
          style: 'destructive',
          onPress: () => {
            const invoiceNumber =
              engine.nextInvoiceNumber() ?? `RET-${Math.random().toString(16).slice(2, 10).toUpperCase()}`
            const result = repos.sales.createReturn(sale.id, { invoiceNumber, userId: user?.id ?? 1 })
            if (!result) {
              Alert.alert('Cannot refund', 'This sale was already refunded or is not refundable.')
              return
            }
            engine.flushOutbox().catch(() => {})
            load()
            Alert.alert('Refunded', `${result.invoiceNumber}\nAmount: ${fmtUZS(result.total)}`)
          },
        },
      ]
    )
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={sales}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => {
          const isReturn = item.saleType === 'return'
          const refundable = !isReturn && item.status === 'completed'
          return (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.invoice}>
                  {isReturn ? '↩ ' : ''}{item.invoiceNumber}
                </Text>
                <Text style={styles.meta}>
                  {String(item.saleTime).slice(0, 16).replace('T', ' ')}
                  {item.contactName ? ` · ${item.contactName}` : ''}
                  {item.status === 'refunded' ? ' · refunded' : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={[styles.amount, isReturn && { color: colors.danger }]}>
                  {fmtUZS(item.totalAmount)}
                </Text>
                {refundable ? (
                  <TouchableOpacity style={styles.refundBtn} onPress={() => confirmRefund(item)}>
                    <Text style={styles.refundText}>Refund</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={[styles.sync, item.syncStatus === 'synced' ? { color: colors.success } : { color: colors.primary }]}>
                    {item.syncStatus}
                  </Text>
                )}
              </View>
            </View>
          )
        }}
        ListEmptyComponent={<Text style={styles.empty}>No sales yet</Text>}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.border,
  },
  invoice: { color: colors.text, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  amount: { color: colors.text, fontSize: 15, fontWeight: '700' },
  sync: { fontSize: 11, fontWeight: '600' },
  refundBtn: {
    borderWidth: 1, borderColor: colors.danger, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  refundText: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 40 },
})
