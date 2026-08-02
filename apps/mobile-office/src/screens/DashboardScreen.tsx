import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import { getServices } from '../platform/services'
import { colors } from '../theme'

export function DashboardScreen() {
  const { repos, engine } = getServices()
  const [refreshing, setRefreshing] = useState(false)
  const [summary, setSummary] = useState(() => repos.reports.dailySummary(today()))
  const [top, setTop] = useState(() => repos.reports.topProducts(daysAgo(7), today()))
  const [low, setLow] = useState(() => repos.reports.lowStock(10))

  function today() {
    return new Date().toISOString().split('T')[0]
  }
  function daysAgo(n: number) {
    return new Date(Date.now() - n * 86400_000).toISOString().split('T')[0]
  }

  const load = useCallback(() => {
    setSummary(repos.reports.dailySummary(today()))
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
    >
      <Text style={styles.heading}>Today</Text>
      <View style={styles.tiles}>
        <Tile label="Sales" value={String(summary.salesCount)} />
        <Tile label="Revenue" value={fmtUZS(summary.grossSales)} />
        <Tile label="Discounts" value={fmtUZS(summary.discounts)} />
      </View>

      <Text style={styles.heading}>By payment method</Text>
      <View style={styles.card}>
        {summary.byMethod.length === 0 && <Text style={styles.muted}>No sales yet today</Text>}
        {summary.byMethod.map((m) => (
          <Row key={m.paymentMethod} left={m.paymentMethod} right={fmtUZS(m.total)} />
        ))}
      </View>

      <Text style={styles.heading}>Top products (7 days)</Text>
      <View style={styles.card}>
        {top.length === 0 && <Text style={styles.muted}>No sales in the last week</Text>}
        {top.map((p) => (
          <Row key={p.productId} left={p.name} right={fmtUZS(p.revenue)} sub={`${p.quantity} sold`} />
        ))}
      </View>

      <Text style={styles.heading}>Low stock</Text>
      <View style={styles.card}>
        {low.length === 0 && <Text style={styles.muted}>All stocked up</Text>}
        {low.map((p) => (
          <Row key={p.productId} left={p.name} right={`${p.stock} left`} warn />
        ))}
      </View>
    </ScrollView>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  )
}

function Row({ left, right, sub, warn }: { left: string; right: string; sub?: string; warn?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLeft} numberOfLines={1}>{left}</Text>
        {sub ? <Text style={styles.muted}>{sub}</Text> : null}
      </View>
      <Text style={[styles.rowRight, warn && { color: colors.danger }]}>{right}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  heading: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: 14, padding: 14 },
  tileValue: { color: colors.text, fontSize: 17, fontWeight: '800' },
  tileLabel: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLeft: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowRight: { color: colors.text, fontSize: 14, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 12 },
})
