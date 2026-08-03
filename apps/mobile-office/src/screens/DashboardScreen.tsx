import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import { Badge, Card, EmptyState, KpiTile, Row, SectionHeader, useTheme } from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'

function today() {
  return new Date().toISOString().split('T')[0]
}
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400_000).toISOString().split('T')[0]
}

function pctDelta(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}

export function DashboardScreen() {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const [refreshing, setRefreshing] = useState(false)
  const [summary, setSummary] = useState(() => repos.reports.dailySummary(today()))
  const [series, setSeries] = useState(() => repos.reports.revenueSeries(daysAgo(13), today()))
  const [top, setTop] = useState(() => repos.reports.topProducts(daysAgo(7), today()))
  const [low, setLow] = useState(() => repos.reports.lowStock(10))

  const load = useCallback(() => {
    setSummary(repos.reports.dailySummary(today()))
    setSeries(repos.reports.revenueSeries(daysAgo(13), today()))
    setTop(repos.reports.topProducts(daysAgo(7), today()))
    setLow(repos.reports.lowStock(10))
  }, [])

  useFocusEffect(load)

  async function refresh() {
    setRefreshing(true)
    try {
      await engine.flushOutbox()
      for (const table of PULL_TABLE_ORDER) await engine.pullTableV2(table)
    } catch { /* offline — local data is still shown */ }
    load()
    setRefreshing(false)
  }

  const revenueSpark = series.map((d) => d.revenue)
  const salesSpark = series.map((d) => d.salesCount)
  const yesterday = series[series.length - 2]

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.primary} />}
    >
      <SectionHeader title="Today" />
      <View style={styles.tiles}>
        <KpiTile
          label="Sales"
          value={String(summary.salesCount)}
          deltaPct={pctDelta(summary.salesCount, yesterday?.salesCount ?? 0)}
          sparkline={salesSpark}
        />
        <KpiTile
          label="Revenue"
          value={fmtUZS(summary.grossSales)}
          deltaPct={pctDelta(summary.grossSales, yesterday?.revenue ?? 0)}
          sparkline={revenueSpark}
        />
      </View>
      <View style={[styles.tiles, styles.tilesGap]}>
        <KpiTile label="Discounts" value={fmtUZS(summary.discounts)} />
        <KpiTile
          label="Avg sale"
          value={summary.salesCount ? fmtUZS(summary.grossSales / summary.salesCount) : '—'}
        />
      </View>

      <SectionHeader title="By payment method" />
      <Card>
        {summary.byMethod.length === 0 ? (
          <Text style={[typeScale.sm, { color: theme.textFaint }]}>No sales yet today</Text>
        ) : (
          summary.byMethod.map((m) => <Row key={m.paymentMethod} label={m.paymentMethod} value={fmtUZS(m.total)} />)
        )}
      </Card>

      <SectionHeader title="Top products (7 days)" />
      {top.length === 0 ? (
        <Card>
          <EmptyState icon="barChart" title="No sales in the last week" />
        </Card>
      ) : (
        <Card>
          {top.map((p) => (
            <View key={p.productId} style={styles.topRow}>
              <View style={styles.topLeft}>
                <Text style={[typeScale.md, { color: theme.text, fontWeight: '600' }]} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={[typeScale.xs, { color: theme.textFaint }]}>{p.quantity} sold</Text>
              </View>
              <Text style={[typeScale.money, { color: theme.text }]}>{fmtUZS(p.revenue)}</Text>
            </View>
          ))}
        </Card>
      )}

      <SectionHeader title="Low stock" />
      {low.length === 0 ? (
        <Card>
          <View style={styles.stockedUp}>
            <Badge label="All stocked up" tone="success" />
          </View>
        </Card>
      ) : (
        <Card>
          {low.map((p) => (
            <View key={p.productId} style={styles.topRow}>
              <Text style={[typeScale.md, styles.topLeft, { color: theme.text, fontWeight: '600' }]} numberOfLines={1}>
                {p.name}
              </Text>
              <Badge label={`${p.stock} left`} tone={p.stock <= 0 ? 'danger' : 'warning'} />
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.x4l, maxWidth: 720, width: '100%', alignSelf: 'center' },
  tiles: { flexDirection: 'row', gap: spacing.md },
  tilesGap: { marginTop: spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxs },
  topLeft: { flex: 1 },
  stockedUp: { alignItems: 'flex-start' },
})
