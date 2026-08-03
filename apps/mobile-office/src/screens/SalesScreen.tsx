import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { SaleHistoryItem } from '@baraka/data'
import { Badge, EmptyState, ListRow, Screen, useTheme } from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'

export function SalesScreen() {
  const theme = useTheme()
  const { repos } = getServices()
  const [sales, setSales] = useState<SaleHistoryItem[]>([])

  const load = useCallback(() => {
    setSales(repos.sales.history({ limit: 100 }))
  }, [])

  useFocusEffect(load)

  return (
    <Screen padded={false}>
      <FlatList
        data={sales}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ListRow
            title={item.invoiceNumber}
            subtitle={`${String(item.saleTime).slice(0, 16).replace('T', ' ')}${item.contactName ? ` · ${item.contactName}` : ''}`}
            right={
              <View style={styles.right}>
                <Text
                  style={[
                    typeScale.money,
                    { color: item.totalAmount < 0 ? theme.danger : theme.text },
                  ]}
                >
                  {fmtUZS(item.totalAmount)}
                </Text>
                <View style={styles.badges}>
                  {item.saleType === 'return' ? <Badge label="Refund" tone="info" /> : null}
                  <Badge
                    label={item.syncStatus === 'synced' ? 'Synced' : 'Pending'}
                    tone={item.syncStatus === 'synced' ? 'success' : 'warning'}
                  />
                </View>
              </View>
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState icon="sales" title="No sales yet" message="Completed sales appear here as they sync" />
        }
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  right: { alignItems: 'flex-end', gap: spacing.xs },
  badges: { flexDirection: 'row', gap: spacing.xs },
})
