import { type ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { radius, spacing, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Button } from './Button'

export interface DialogAction {
  label: string
  onPress: () => void
  tone?: 'default' | 'danger' | 'primary'
}

export interface DialogProps {
  visible: boolean
  onClose: () => void
  title: string
  message?: string
  /** Rendered between message and actions (e.g. a NumPad or receipt). */
  children?: ReactNode
  actions: DialogAction[]
  maxWidth?: number
}

/**
 * Centered dialog — the styled replacement for `Alert.alert` confirmations.
 * Destructive actions use tone: 'danger'.
 */
export function Dialog({ visible, onClose, title, message, children, actions, maxWidth = 400 }: DialogProps) {
  const theme = useTheme()
  if (!visible) return null
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.overlay, { backgroundColor: theme.overlay }]}
      >
        <Pressable style={styles.scrimTouch} accessibilityLabel="Dismiss" onPress={onClose} />
        <View style={[styles.box, { backgroundColor: theme.surface, maxWidth }]}>
          <Text style={[type.lg, { color: theme.text }]} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
            {title}
          </Text>
          {/* Body scrolls so tall content (NumPad + inputs) can't push the
              action buttons off a small screen. */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollInner}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {message ? <Text style={[type.md, { color: theme.textMuted }]}>{message}</Text> : null}
            {children}
          </ScrollView>
          {/* 3+ actions (or 2 with long labels on a narrow phone) don't fit
              side by side — stack them full-width instead of squashing. */}
          <View style={actions.length > 2 ? styles.actionsStacked : styles.actions}>
            {actions.map((a) => (
              <Button
                key={a.label}
                title={a.label}
                onPress={a.onPress}
                variant={a.tone === 'danger' ? 'danger' : a.tone === 'primary' ? 'primary' : 'secondary'}
                style={actions.length > 2 ? undefined : styles.actionBtn}
              />
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  scrimTouch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  box: {
    width: '100%',
    maxHeight: '92%',
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollInner: { gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionsStacked: { gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { flex: 1 },
})
