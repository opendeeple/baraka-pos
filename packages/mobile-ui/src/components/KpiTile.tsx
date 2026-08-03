import { StyleSheet, Text, View } from 'react-native'
import { radius, spacing, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Sparkline } from './Sparkline'

export interface KpiTileProps {
  label: string
  value: string
  /** Signed percent vs the prior period, e.g. +12.5 → "▲ 12.5%". */
  deltaPct?: number | null
  sparkline?: number[]
}

export function KpiTile({ label, value, deltaPct, sparkline }: KpiTileProps) {
  const theme = useTheme()
  const deltaColor =
    deltaPct == null || deltaPct === 0 ? theme.textFaint : deltaPct > 0 ? theme.success : theme.danger

  return (
    <View style={[styles.base, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
      <Text style={[type.xs, styles.label, { color: theme.textMuted }]}>{label.toUpperCase()}</Text>
      <Text style={[type.moneyLg, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <View style={styles.footer}>
        {deltaPct != null ? (
          <Text style={[type.xs, { color: deltaColor, fontWeight: '700' }]}>
            {deltaPct > 0 ? '▲' : deltaPct < 0 ? '▼' : '—'} {Math.abs(deltaPct).toFixed(1)}%
          </Text>
        ) : (
          <View />
        )}
        {sparkline && sparkline.length > 1 ? <Sparkline data={sparkline} /> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.xs,
    minWidth: 140,
  },
  label: { fontWeight: '700', letterSpacing: 1 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.xs,
  },
})
