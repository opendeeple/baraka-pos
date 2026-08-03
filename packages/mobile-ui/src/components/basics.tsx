import { type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { opacity, radius, spacing, touch, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'

/* ---------------------------------------------------------------- Card */

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme()
  return (
    <View style={[cardStyles.base, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }, style]}>
      {children}
    </View>
  )
}

const cardStyles = StyleSheet.create({
  base: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
})

/* ------------------------------------------------------------- ListRow */

export interface ListRowProps {
  title: string
  subtitle?: string
  left?: ReactNode
  right?: ReactNode
  onPress?: () => void
  testID?: string
}

export function ListRow({ title, subtitle, left, right, onPress, testID }: ListRowProps) {
  const theme = useTheme()
  const body = (
    <>
      {left}
      <View style={rowStyles.mid}>
        <Text style={[type.md, { color: theme.text, fontWeight: '600' }]} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={[type.sm, { color: theme.textMuted }]} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </>
  )
  const frame = [rowStyles.base, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]
  if (!onPress) return <View style={frame}>{body}</View>
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [...frame, pressed && { opacity: opacity.pressed }]}
    >
      {body}
    </Pressable>
  )
}

const rowStyles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.lg,
    minHeight: touch.minTarget + spacing.md,
  },
  mid: { flex: 1, gap: spacing.xxs },
})

/* ----------------------------------------------------------------- Row */

/** Label/value line inside cards (totals, Z-report rows, summaries). */
export function Row({
  label,
  value,
  accent,
  big,
  valueColor,
}: {
  label: string
  value: string
  accent?: boolean
  big?: boolean
  valueColor?: string
}) {
  const theme = useTheme()
  return (
    <View style={kvStyles.base}>
      <Text style={[big ? type.lg : type.sm, { color: theme.textMuted }]}>{label}</Text>
      <Text
        style={[
          big ? type.moneyLg : type.money,
          { color: valueColor ?? (accent ? theme.primary : theme.text) },
        ]}
      >
        {value}
      </Text>
    </View>
  )
}

const kvStyles = StyleSheet.create({
  base: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
})

/* ---------------------------------------------------------------- Chip */

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  testID,
}: {
  label: string
  selected?: boolean
  onPress: () => void
  icon?: IconName
  testID?: string
}) {
  const theme = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={touch.hitSlop}
      onPress={onPress}
      style={({ pressed }) => [
        chipStyles.base,
        {
          backgroundColor: selected ? theme.primary : theme.surfaceRaised,
          borderColor: selected ? theme.primary : theme.border,
          opacity: pressed ? opacity.pressed : 1,
        },
      ]}
    >
      {icon && <Icon name={icon} size={14} color={selected ? theme.onPrimary : theme.textMuted} />}
      <Text style={[type.sm, { color: selected ? theme.onPrimary : theme.textMuted, fontWeight: '600' }]}>
        {label}
      </Text>
    </Pressable>
  )
}

const chipStyles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 36,
  },
})

/* --------------------------------------------------------------- Badge */

export type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral'

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const theme = useTheme()
  const color =
    tone === 'success' ? theme.success
    : tone === 'danger' ? theme.danger
    : tone === 'warning' ? theme.warning
    : tone === 'info' ? theme.info
    : theme.textMuted
  return (
    <View style={[badgeStyles.base, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
      <Text style={[type.xs, { color, fontWeight: '700' }]}>{label}</Text>
    </View>
  )
}

const badgeStyles = StyleSheet.create({
  base: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
})

/* ------------------------------------------------------- SectionHeader */

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={sectionStyles.base}>
      <Text style={[type.xs, sectionStyles.title, { color: theme.textMuted }]}>{title.toUpperCase()}</Text>
      {right}
    </View>
  )
}

const sectionStyles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  title: { fontWeight: '700', letterSpacing: 1 },
})

/* ---------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName
  title: string
  message?: string
  action?: { label: string; onPress: () => void }
}) {
  const theme = useTheme()
  return (
    <View style={emptyStyles.base} accessibilityRole="summary" accessibilityLabel={title}>
      <View style={emptyStyles.iconWrap}>
        <Icon name={icon} size={32} color={theme.textFaint} />
      </View>
      <Text style={[type.lg, { color: theme.textMuted, textAlign: 'center' }]}>{title}</Text>
      {message ? (
        <Text style={[type.sm, { color: theme.textFaint, textAlign: 'center' }]}>{message}</Text>
      ) : null}
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={touch.hitSlop}
          style={({ pressed }) => [emptyStyles.action, { opacity: pressed ? opacity.pressed : 1 }]}
        >
          <Text style={[type.md, { color: theme.primary, fontWeight: '700' }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const emptyStyles = StyleSheet.create({
  base: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.x4l, paddingHorizontal: spacing.xl },
  iconWrap: { opacity: 0.6, marginBottom: spacing.xs },
  action: { marginTop: spacing.sm, minHeight: touch.minTarget, justifyContent: 'center' },
})
