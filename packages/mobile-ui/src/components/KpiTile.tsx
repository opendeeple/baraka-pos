import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { radius, spacing, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Sparkline } from './Sparkline'
import { Text } from './Text'

export interface KpiTileProps {
  label: string
  value: string
  /** Signed percent vs the prior period, e.g. +12.5 → "▲ 12.5%". */
  deltaPct?: number | null
  sparkline?: number[]
}

const SPARK_HEIGHT = 28

/**
 * Label, big value, then delta and trend line each on their own row. The
 * sparkline is sized to the tile's MEASURED inner width — it used to be a
 * fixed 72px beside the delta text and ran out of the tile on phones.
 */
export function KpiTile({ label, value, deltaPct, sparkline }: KpiTileProps) {
  const theme = useTheme()
  const [sparkWidth, setSparkWidth] = useState(0)
  const deltaColor =
    deltaPct == null || deltaPct === 0 ? theme.textFaint : deltaPct > 0 ? theme.success : theme.danger
  const hasSpark = !!sparkline && sparkline.length > 1

  return (
    <View style={[styles.base, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
      <Text style={[type.xs, styles.label, { color: theme.textMuted }]} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
      <Text
        style={[type.moneyLg, { color: theme.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}
      </Text>
      {deltaPct != null ? (
        <Text style={[type.xs, { color: deltaColor, fontWeight: '700' }]} numberOfLines={1}>
          {deltaPct > 0 ? '▲' : deltaPct < 0 ? '▼' : '—'} {Math.abs(deltaPct).toFixed(1)}%
        </Text>
      ) : null}
      {hasSpark ? (
        <View
          style={styles.spark}
          onLayout={(e) => setSparkWidth(Math.floor(e.nativeEvent.layout.width))}
        >
          {sparkWidth > 0 ? <Sparkline data={sparkline!} width={sparkWidth} height={SPARK_HEIGHT} /> : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
    overflow: 'hidden',
  },
  label: { fontWeight: '700', letterSpacing: 0.5 },
  spark: { alignSelf: 'stretch', height: SPARK_HEIGHT, marginTop: spacing.xxs },
})
