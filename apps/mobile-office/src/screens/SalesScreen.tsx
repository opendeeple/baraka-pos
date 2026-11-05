import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { SaleHistoryItem, SaleReceiptData } from '@baraka/data'
import { Badge, EmptyState, ListRow, SaleDetailSheet, Screen, toast, useTheme } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'

export function SalesScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos } = getServices()
  const [sales, setSales] = useState<SaleHistoryItem[]>([])
  const [detail, setDetail] = useState<SaleReceiptData | null>(null)

  function openSale(id: number) {
    const data = repos.sales.receiptData(id)
    if (data) setDetail(data)
    else toast.error(t('saleDetail.notFound'))
  }

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
            onPress={() => openSale(item.id)}
            subtitle={`${String(item.saleTime).slice(0, 16).replace('T', ' ')}${item.contactName ? ` · ${item.contactName}` : ''}`}
            meta={
              <>
                {item.saleType === 'return' ? <Badge label={t('sales.refund')} tone="info" /> : null}
                <Badge
                  label={item.syncStatus === 'synced' ? t('sales.synced') : t('sales.pending')}
                  tone={item.syncStatus === 'synced' ? 'success' : 'warning'}
                />
              </>
            }
            right={
              <Text
                style={[typeScale.money, { color: item.totalAmount < 0 ? theme.danger : theme.text }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {fmtUZS(item.totalAmount)}
              </Text>
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState icon="sales" title={t('sales.noSalesYet')} message={t('sales.noSalesOfficeHint')} />
        }
      />
      <SaleDetailSheet data={detail} onClose={() => setDetail(null)} formatMoney={fmtUZS} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },

})