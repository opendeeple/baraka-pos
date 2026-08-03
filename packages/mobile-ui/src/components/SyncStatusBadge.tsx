import { StyleSheet, Text, View } from 'react-native'
import { radius, spacing, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'

export type SyncState = 'synced' | 'pending' | 'offline' | 'error'

export interface SyncStatusBadgeProps {
  state: SyncState
  pendingCount?: number
}

const META: Record<SyncState, { icon: IconName; label: string }> = {
  synced: { icon: 'wifi', label: 'Online' },
  pending: { icon: 'refresh', label: 'Syncing' },
  offline: { icon: 'wifiOff', label: 'Offline' },
  error: { icon: 'alert', label: 'Sync error' },
}

/** Presentational — feed it state from a useSyncStatus hook in the app shell. */
export function SyncStatusBadge({ state, pendingCount = 0 }: SyncStatusBadgeProps) {
  const theme = useTheme()
  const color =
    state === 'synced' ? theme.success
    : state === 'pending' ? theme.info
    : state === 'offline' ? theme.warning
    : theme.danger
  const meta = META[state]
  const label = pendingCount > 0 ? `${meta.label} · ${pendingCount}` : meta.label

  return (
    <View
      accessibilityLabel={`Sync status: ${label}`}
      style={[styles.base, { backgroundColor: `${color}1d`, borderColor: `${color}55` }]}
    >
      <Icon name={meta.icon} size={14} color={color} />
      <Text style={[type.xs, { color, fontWeight: '700' }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    borderWidth: 1,
  },
})
