import { useEffect, useRef, type ReactNode } from 'react'
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { motion, radius, spacing, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { IconButton } from './IconButton'

export interface SheetProps {
  visible: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Cap sheet height as a fraction of the screen (default 0.85). */
  maxHeightRatio?: number
  /** Lets the grabber be dragged up to expand the sheet to near-full-screen. */
  expandable?: boolean
  /** Fires after a drag settles, with the new expanded state. */
  onExpandChange?: (expanded: boolean) => void
}

/**
 * Bottom sheet: animated slide-up, token scrim, keyboard avoidance and
 * safe-area bottom padding built in. Replaces the app's four hand-rolled
 * `Modal animationType="slide"` sheets whose inputs the keyboard covered.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  maxHeightRatio = 0.85,
  expandable = false,
  onExpandChange,
}: SheetProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const slide = useRef(new Animated.Value(0)).current
  // Separate from `slide` (open/close) — 0 is the normal capped height, 1 is
  // the dragged-open full-screen height. Only used when expandable.
  const expand = useRef(new Animated.Value(0)).current
  const expandedRef = useRef(false)
  const expandLiveRef = useRef(0)

  const collapsedHeight = Math.round(windowHeight * maxHeightRatio)
  const expandedHeight = Math.round(windowHeight - Math.max(insets.top, spacing.lg) - spacing.lg)
  const dragRange = Math.max(expandedHeight - collapsedHeight, 1)

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_, g) => {
        const base = expandedRef.current ? 1 : 0
        const next = Math.min(1, Math.max(0, base - g.dy / dragRange))
        expandLiveRef.current = next
        expand.setValue(next)
      },
      onPanResponderRelease: () => {
        const next = expandLiveRef.current > 0.4
        expandedRef.current = next
        onExpandChange?.(next)
        Animated.timing(expand, { toValue: next ? 1 : 0, duration: motion.base, useNativeDriver: false }).start()
      },
    })
  ).current

  useEffect(() => {
    if (visible) {
      slide.setValue(0)
      expand.setValue(0)
      expandedRef.current = false
      expandLiveRef.current = 0
      onExpandChange?.(false)
      Animated.timing(slide, { toValue: 1, duration: motion.base, useNativeDriver: true }).start()
    }
  }, [visible, slide])

  if (!visible) return null

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <Pressable style={styles.scrimTouch} accessibilityLabel="Close" onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.surface,
                paddingBottom: Math.max(insets.bottom, spacing.lg),
                maxHeight: expandable
                  ? expand.interpolate({ inputRange: [0, 1], outputRange: [collapsedHeight, expandedHeight] })
                  : (`${Math.round(maxHeightRatio * 100)}%` as `${number}%`),
                transform: [
                  {
                    translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }),
                  },
                ],
                opacity: slide,
              },
            ]}
          >
            <View style={styles.grabberHit} {...(expandable ? panResponder.panHandlers : {})}>
              <View style={styles.grabber} />
            </View>
            {title ? (
              <View style={styles.header}>
                <Text style={[type.lg, { color: theme.text }]}>{title}</Text>
                <IconButton icon="x" size={20} accessibilityLabel="Close" onPress={onClose} />
              </View>
            ) : null}
            {children}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  scrimTouch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabberHit: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginBottom: -spacing.sm,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
})
