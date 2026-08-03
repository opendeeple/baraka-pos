import { type ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { spacing } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'

export interface ScreenProps {
  children: ReactNode
  /** Wrap content in a ScrollView (with keyboard-friendly tap handling). */
  scroll?: boolean
  /** Standard screen padding. */
  padded?: boolean
  /** Cap and center content width (tablet-friendly forms). */
  maxWidth?: number
  /** 'avoid' lifts content above the soft keyboard. */
  keyboard?: 'avoid' | 'none'
  /** Extra safe-area edges — 'top' is off by default (navigator headers own it). */
  edges?: Array<'top' | 'bottom' | 'left' | 'right'>
}

/**
 * Standard screen chrome: themed background + safe-area (finally) + optional
 * scroll/keyboard handling. Every screen renders inside one of these, which
 * is what fixes the gesture-bar clipping and keyboard-covered inputs.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  maxWidth,
  keyboard = 'none',
  edges = ['bottom', 'left', 'right'],
}: ScreenProps) {
  const theme = useTheme()

  const inner = (
    <View style={[styles.inner, maxWidth != null && { maxWidth, width: '100%', alignSelf: 'center' }]}>
      {children}
    </View>
  )

  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[padded && styles.padded, styles.grow]}
      keyboardShouldPersistTaps="handled"
    >
      {inner}
    </ScrollView>
  ) : (
    <View style={[styles.fill, padded && styles.padded]}>{inner}</View>
  )

  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: theme.bg }]}>
      {keyboard === 'avoid' ? (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  padded: { padding: spacing.lg },
  inner: { flex: 1 },
})
