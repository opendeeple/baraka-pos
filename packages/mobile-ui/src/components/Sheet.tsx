import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
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
  /**
   * Rendered below the body, pinned to the bottom (e.g. Cancel/Save buttons)
   * so it stays reachable regardless of how long the body is. When set,
   * `children` scrolls internally instead of being clipped by maxHeightRatio
   * — forms with many fields were otherwise cutting off their own save
   * button with no way to reach it.
   */
  footer?: ReactNode
  /** Scrolls `children` internally even without a `footer` — for bodies
   * (e.g. a detail view with a growing list) that have no action row of
   * their own but can still outgrow maxHeightRatio. */
  scrollBody?: boolean
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
  footer,
  scrollBody = false,
}: SheetProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const [topChromeHeight, setTopChromeHeight] = useState(0)
  const [footerHeight, setFooterHeight] = useState(0)
  // Measured height of the scrollable body's content. The ScrollView gets
  // an EXPLICIT height (content, capped) — left to flex inside this
  // auto-height sheet, Yoga collapsed it to ~0 and forms/lists rendered as
  // a thin sliver above the footer.
  const [contentHeight, setContentHeight] = useState(0)
  // Top edge of the soft keyboard in window coordinates, null when hidden.
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null)
  const slide = useRef(new Animated.Value(0)).current
  // Separate from `slide` (open/close) — 0 is the normal capped height, 1 is
  // the dragged-open full-screen height. Only used when expandable.
  const expand = useRef(new Animated.Value(0)).current
  const expandedRef = useRef(false)
  const expandLiveRef = useRef(0)

  const collapsedHeight = Math.round(windowHeight * maxHeightRatio)
  const expandedHeight = Math.round(windowHeight - Math.max(insets.top, spacing.lg) - spacing.lg)
  const dragRange = Math.max(expandedHeight - collapsedHeight, 1)
  const verticalPadding = spacing.sm + Math.max(insets.bottom, spacing.lg)
  const available =
    keyboardTop != null
      ? Math.min(collapsedHeight, keyboardTop - Math.max(insets.top, spacing.lg) - spacing.lg)
      : collapsedHeight
  const bodyCapHeight = Math.max(available - topChromeHeight - footerHeight - verticalPadding, 96)
  const bodyHeight = contentHeight > 0 ? Math.min(contentHeight, bodyCapHeight) : undefined

  useEffect(() => {
    if (!visible || !(footer || scrollBody)) return
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardTop(e.endCoordinates.screenY))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null))
    return () => { show.remove(); hide.remove() }
  }, [visible, !!(footer || scrollBody)])

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
        {/* 'padding' lifts the sheet above the keyboard; 'height' (the old
            Android choice) shrank a bottom-anchored sheet by the keyboard's
            height and clipped it. The scroll body's cap already accounts
            for the keyboard, so the lifted sheet fits. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' || footer || scrollBody ? 'padding' : 'height'}
        >
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
            <View
              onLayout={
                footer || scrollBody ? (e) => setTopChromeHeight(e.nativeEvent.layout.height) : undefined
              }
            >
              <View style={styles.grabberHit} {...(expandable ? panResponder.panHandlers : {})}>
                <View style={styles.grabber} />
              </View>
              {title ? (
                <View style={styles.header}>
                  <Text style={[type.lg, styles.title, { color: theme.text }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                    {title}
                  </Text>
                  <IconButton icon="x" size={20} accessibilityLabel="Close" onPress={onClose} />
                </View>
              ) : null}
            </View>
            {footer || scrollBody ? (
              <ScrollView
                style={[styles.scroll, bodyHeight != null ? { height: bodyHeight } : { maxHeight: bodyCapHeight }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                nestedScrollEnabled
                onContentSizeChange={(_, h) => setContentHeight(Math.ceil(h))}
              >
                {children}
              </ScrollView>
            ) : (
              children
            )}
            {footer ? (
              <View onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}>{footer}</View>
            ) : null}
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
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: { flex: 1 },
  scroll: { flexGrow: 0, flexShrink: 0 },
})
