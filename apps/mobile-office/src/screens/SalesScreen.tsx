import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { SaleHistoryItem } from '@baraka/data'
import { getServices } from '../platform/services'
import { colors } from '../theme'

export function SalesScreen() {
  const { repos } = getServices()
  const [sales, setSales] = useState<SaleHistoryItem[]>([])

  const load = useCallback(() => {
    setSales(repos.sales.history({ limit: 100 }))
  }, [])

  useFocusEffect(load)

  return (
    <View style={styles.container}>
      <FlatList
        data={sales}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.invoice}>{item.invoiceNumber}</Text>
              <Text style={styles.meta}>
                {String(item.saleTime).slice(0, 16).replace('T', ' ')}
                {item.contactName ? ` · ${item.contactName}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.amount}>{fmtUZS(item.totalAmount)}</Text>
              <Text style={[styles.sync, item.syncStatus === 'synced' ? { color: colors.success } : { color: colors.primary }]}>
                {item.syncStatus}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No sales recorded on this device</Text>}
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
  sync: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 40 },
})
