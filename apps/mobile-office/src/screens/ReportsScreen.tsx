import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { DeadStockRow, LossRow, ProductSalesRow } from '@baraka/data'
import { Badge, Chip, Screen, useTheme } from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'

type AbcClass = 'A' | 'B' | 'C'

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoYmd(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

const RANGE_PRESETS: Array<{ label: string; days: number }> = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]
const DEAD_STOCK_PRESETS = [30, 60, 90]
const ABC_TONE: Record<AbcClass, 'success' | 'warning' | 'neutral'> = { A: 'success', B: 'warning', C: 'neutral' }

/**
 * Local-data product analysis — ABC classification, dead stock, and
 * write-off/stocktake losses. Mirrors desktop's "Analysis" tab in
 * client/src/components/backoffice/ProductAnalysis.tsx. Desktop's other two
 * Reports tabs (Daily, Date Range) hit the server's /api/reports/* endpoints
 * directly rather than local SQLite, and cover ground DashboardScreen
 * already shows locally (today's KPIs, a 14-day series, top products, low
 * stock) — skipped here as redundant, plus desktop's charts need a charting
 * library mobile doesn't have.
 */
export function ReportsScreen() {
  const theme = useTheme()
  const { repos } = getServices()
  const [rangeDays, setRangeDays] = useState(30)
  const [deadDays, setDeadDays] = useState(30)
  const [abcFilter, setAbcFilter] = useState<AbcClass | 'all'>('all')
  const [sales, setSales] = useState<ProductSalesRow[]>([])
  const [dead, setDead] = useState<DeadStockRow[]>([])
  const [losses, setLosses] = useState<{ byReason: LossRow[]; stocktakeShortage: number; stocktakeSurplus: number; stocktakeCount: number }>({
    byReason: [], stocktakeShortage: 0, stocktakeSurplus: 0, stocktakeCount: 0,
  })

  const load = useCallback(() => {
    const dateFrom = daysAgoYmd(rangeDays - 1)
    const dateTo = todayYmd()
    setSales(repos.reports.productSales(dateFrom, dateTo))
    setLosses(repos.reports.losses(dateFrom, dateTo))
    setDead(repos.reports.deadStock(deadDays))
  }, [rangeDays, deadDays])

  useFocusEffect(load)

  const abc = useMemo(() => {
    const total = sales.reduce((s, r) => s + r.revenue, 0)
    let running = 0
    const rows = sales.map((r) => {
      running += r.revenue
      const share = total > 0 ? running / total : 1
      const cls: AbcClass = share <= 0.8 || running === r.revenue ? 'A' : share <= 0.95 ? 'B' : 'C'
      return { ...r, cls, pct: total > 0 ? (r.revenue / total) * 100 : 0 }
    })
    const summary = (['A', 'B', 'C'] as AbcClass[]).map((cls) => {
      const list = rows.filter((r) => r.cls === cls)
      return { cls, count: list.length, revenue: list.reduce((s, r) => s + r.revenue, 0), profit: list.reduce((s, r) => s + r.profit, 0) }
    })
    return { rows, summary, total }
  }, [sales])

  const shown = abc.rows.filter((r) => abcFilter === 'all' || r.cls === abcFilter)
  const writeoffTotal = losses.byReason.reduce((s, l) => s + l.value, 0)
  const deadValue = dead.reduce((s, r) => s + r.value, 0)

  return (
    <Screen scroll>
      <View style={styles.chipRow}>
        {RANGE_PRESETS.map((p) => (
          <Chip key={p.days} label={p.label} selected={rangeDays === p.days} onPress={() => setRangeDays(p.days)} />
        ))}
      </View>

      <Text style={[typeScale.lg, { color: theme.text, fontWeight: '700' }, styles.sectionTitle]}>ABC analysis</Text>
      <Text style={[typeScale.sm, { color: theme.textMuted }]}>Which products bring 80% of revenue (A), the next 15% (B), the rest (C).</Text>
      <View style={styles.abcRow}>
        {abc.summary.map((s) => (
          <Pressable
            key={s.cls}
            accessibilityRole="button"
            accessibilityLabel={`Class ${s.cls}`}
            style={[
              styles.abcCard,
              { borderColor: abcFilter === s.cls ? theme.primary : theme.border },
            ]}
            onPress={() => setAbcFilter(abcFilter === s.cls ? 'all' : s.cls)}
          >
            <Badge label={`${s.cls} · ${s.count}`} tone={ABC_TONE[s.cls]} />
            <Text style={[typeScale.sm, { color: theme.text, fontWeight: '700' }]}>{fmtUZS(s.revenue)}</Text>
            <Text style={[typeScale.xs, { color: theme.success }]}>profit {fmtUZS(s.profit)}</Text>
          </Pressable>
        ))}
      </View>
      {shown.length === 0 ? (
        <Text style={[typeScale.sm, { color: theme.textFaint }]}>No sales in this range</Text>
      ) : (
        shown.slice(0, 50).map((r) => (
          <View key={r.productId} style={[styles.rowItem, { borderColor: theme.border }]}>
            <View style={styles.flex1}>
              <View style={styles.rowBetween}>
                <Badge label={r.cls} tone={ABC_TONE[r.cls]} />
                <Text style={[typeScale.sm, { color: theme.text, flex: 1, marginLeft: spacing.sm }]} numberOfLines={1}>{r.name}</Text>
              </View>
              <Text style={[typeScale.xs, { color: theme.textFaint }]}>sold {Math.round(r.qty * 1000) / 1000} · {r.pct.toFixed(1)}%</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[typeScale.sm, { color: theme.text, fontWeight: '700' }]}>{fmtUZS(r.revenue)}</Text>
              <Text style={[typeScale.xs, { color: r.profit >= 0 ? theme.success : theme.danger }]}>{fmtUZS(r.profit)}</Text>
            </View>
          </View>
        ))
      )}

      <Text style={[typeScale.lg, { color: theme.text, fontWeight: '700' }, styles.sectionTitle]}>Dead stock</Text>
      <Text style={[typeScale.sm, { color: theme.textMuted }]}>On the shelf, hasn't sold in a while — money frozen there.</Text>
      <View style={styles.chipRow}>
        {DEAD_STOCK_PRESETS.map((d) => (
          <Chip key={d} label={`${d} days`} selected={deadDays === d} onPress={() => setDeadDays(d)} />
        ))}
      </View>
      <Text style={[typeScale.sm, { color: theme.textMuted }]}>
        Frozen: <Text style={{ color: theme.warning, fontWeight: '700' }}>{fmtUZS(deadValue)}</Text> · {dead.length} product(s)
      </Text>
      {dead.length === 0 ? (
        <Text style={[typeScale.sm, { color: theme.textFaint }]}>Nothing frozen</Text>
      ) : (
        dead.slice(0, 30).map((r) => (
          <View key={r.productId} style={[styles.rowItem, { borderColor: theme.border }]}>
            <View style={styles.flex1}>
              <Text style={[typeScale.sm, { color: theme.text }]} numberOfLines={1}>{r.name}</Text>
              <Text style={[typeScale.xs, { color: theme.textFaint }]}>{r.lastSold ? `Last sold ${r.lastSold}` : 'Never sold'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[typeScale.sm, { color: theme.text }]}>{r.stock}</Text>
              <Text style={[typeScale.xs, { color: theme.warning }]}>{fmtUZS(r.value)}</Text>
            </View>
          </View>
        ))
      )}

      <Text style={[typeScale.lg, { color: theme.text, fontWeight: '700' }, styles.sectionTitle]}>Losses</Text>
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={[typeScale.xs, { color: theme.textFaint }]}>Write-offs</Text>
          <Text style={[typeScale.md, { color: theme.danger, fontWeight: '700' }]}>{fmtUZS(writeoffTotal)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[typeScale.xs, { color: theme.textFaint }]}>Stocktake net ({losses.stocktakeCount})</Text>
          <Text style={[typeScale.md, { color: losses.stocktakeSurplus - losses.stocktakeShortage >= 0 ? theme.success : theme.danger, fontWeight: '700' }]}>
            {fmtUZS(losses.stocktakeSurplus - losses.stocktakeShortage)}
          </Text>
        </View>
      </View>
      {losses.byReason.length === 0 ? (
        <Text style={[typeScale.sm, { color: theme.textFaint }]}>No write-offs in this range</Text>
      ) : (
        losses.byReason.map((l) => (
          <View key={l.reason} style={styles.rowBetween}>
            <Text style={[typeScale.sm, { color: theme.textMuted }]}>{l.reason} ×{l.count}</Text>
            <Text style={[typeScale.sm, { color: theme.danger, fontWeight: '700' }]}>{fmtUZS(l.value)}</Text>
          </View>
        ))
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.xs },
  abcRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  abcCard: { flex: 1, borderWidth: 1, borderRadius: 8, padding: spacing.sm, gap: spacing.xs },
  rowItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderRadius: 8, padding: spacing.sm, marginBottom: spacing.xs,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  statCard: { flex: 1, borderRadius: 8, padding: spacing.sm, backgroundColor: 'rgba(255,255,255,0.04)' },
  flex1: { flex: 1 },
})
