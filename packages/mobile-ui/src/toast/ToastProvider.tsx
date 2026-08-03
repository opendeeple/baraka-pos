import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { motion, radius, spacing, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from '../components/Icon'
import { _attach, type ToastItem } from './toast'

const KIND_ICON: Record<ToastItem['kind'], IconName> = {
  success: 'check',
  error: 'alert',
  info: 'refresh',
}

/** Mount once near the app root, AFTER SafeAreaProvider. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(
    () =>
      _attach((item) => {
        setItems((prev) => [...prev.slice(-2), item])
        setTimeout(() => {
          setItems((prev) => prev.filter((t) => t.id !== item.id))
        }, item.duration)
      }),
    []
  )

  return (
    <View style={styles.fill}>
      {children}
      <ToastStack items={items} />
    </View>
  )
}

function ToastStack({ items }: { items: ToastItem[] }) {
  const insets = useSafeAreaInsets()
  if (!items.length) return null
  return (
    <View pointerEvents="none" style={[styles.stack, { top: insets.top + spacing.md }]}>
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </View>
  )
}

function ToastCard({ item }: { item: ToastItem }) {
  const theme = useTheme()
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: motion.base, useNativeDriver: true }).start()
  }, [anim])

  const color =
    item.kind === 'success' ? theme.success : item.kind === 'error' ? theme.danger : theme.info

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.card,
        { backgroundColor: theme.surfaceRaised, borderColor: `${color}66` },
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
        },
      ]}
    >
      <Icon name={KIND_ICON[item.kind]} size={16} color={color} />
      <Text style={[type.sm, styles.msg, { color: theme.text }]} numberOfLines={2}>
        {item.message}
      </Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stack: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: 480,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  msg: { fontWeight: '600', flexShrink: 1 },
})
