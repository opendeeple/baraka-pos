import { useEffect, useRef, type ReactNode } from 'react'
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
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
}

/**
 * Bottom sheet: animated slide-up, token scrim, keyboard avoidance and
 * safe-area bottom padding built in. Replaces the app's four hand-rolled
 * `Modal animationType="slide"` sheets whose inputs the keyboard covered.
 */
export function Sheet({ visible, onClose, title, children, maxHeightRatio = 0.85 }: SheetProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const slide = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      slide.setValue(0)
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
                maxHeight: `${Math.round(maxHeightRatio * 100)}%` as `${number}%`,
                transform: [
                  {
                    translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }),
                  },
                ],
                opacity: slide,
              },
            ]}
          >
            <View style={styles.grabber} />
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
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
})
