import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from '@baraka/mobile-i18n'
import { radius, spacing, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'

export type SyncState = 'synced' | 'pending' | 'offline' | 'error'

export interface SyncStatusBadgeProps {
  state: SyncState
  pendingCount?: number
  /**
   * Icon-only round indicator (+ a small count bubble when items are
   * pending). Use this in navigation headers: the full text pill was wide
   * enough to collide with the header title on narrow phones.
   */
  compact?: boolean
}

const META: Record<SyncState, { icon: IconName; key: string }> = {
  synced: { icon: 'wifi', key: 'syncStatus.online' },
  pending: { icon: 'refresh', key: 'syncStatus.syncing' },
  offline: { icon: 'wifiOff', key: 'syncStatus.offline' },
  error: { icon: 'alert', key: 'syncStatus.error' },
}

/** Presentational — feed it state from a useSyncStatus hook in the app shell. */
export function SyncStatusBadge({ state, pendingCount = 0, compact = false }: SyncStatusBadgeProps) {
  const theme = useTheme()
  const { t } = useTranslation()
  const color =
    state === 'synced' ? theme.success
    : state === 'pending' ? theme.info
    : state === 'offline' ? theme.warning
    : theme.danger
  const meta = META[state]
  const text = t(meta.key)
  const label = pendingCount > 0 ? `${text} · ${pendingCount}` : text
  const a11y = t('syncStatus.statusA11y', { label })

  if (compact) {
    return (
      <View
        accessible
        accessibilityLabel={a11y}
        style={[styles.compact, { backgroundColor: `${color}1d`, borderColor: `${color}55` }]}
      >
        <Icon name={meta.icon} size={16} color={color} />
        {pendingCount > 0 ? (
          <View style={[styles.count, { backgroundColor: color, borderColor: theme.surface }]}>
            <Text style={[styles.countText, { color: theme.onPrimary }]} maxFontSizeMultiplier={1}>
              {pendingCount > 99 ? '99+' : pendingCount}
            </Text>
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View
      accessible
      accessibilityLabel={a11y}
      style={[styles.base, { backgroundColor: `${color}1d`, borderColor: `${color}55` }]}
    >
      <Icon name={meta.icon} size={14} color={color} />
      <Text style={[type.xs, { color, fontWeight: '700' }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  compact: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    position: 'absolute',
    top: -5,
    right: -7,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontSize: 10, lineHeight: 12, fontWeight: '800' },
})
