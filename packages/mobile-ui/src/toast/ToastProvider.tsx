import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Text } from '../components/Text'
import { Animated, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { motion, radius, spacing, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from '../components/Icon'
import { _getItems, _isTopHost, _registerHost, _subscribe, type ToastItem } from './toast'

const KIND_ICON: Record<ToastItem['kind'], IconName> = {
  success: 'check',
  error: 'alert',
  info: 'refresh',
}

/** Mount once near the app root, AFTER SafeAreaProvider. */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <View style={styles.fill}>
      {children}
      <ToastHost />
    </View>
  )
}

/**
 * Draws the shared toast list — but only while it is the topmost mounted
 * host. Sheet and Dialog mount one inside their Modal so toasts show above
 * an open sheet instead of behind it.
 */
export function ToastHost() {
  const [, force] = useState(0)
  const [hostId, setHostId] = useState(0)
  useEffect(() => {
    const unsub = _subscribe(() => force((n) => n + 1))
    const host = _registerHost()
    setHostId(host.id)
    return () => {
      host.unregister()
      unsub()
    }
  }, [])
  if (!hostId || !_isTopHost(hostId)) return null
  return <ToastStack items={_getItems()} />
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
