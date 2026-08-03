import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { opacity, radius, spacing } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon } from './Icon'

// '⌫' stays the wire value so existing applyNumKey call sites keep working;
// it renders as a proper icon, not a glyph.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'] as const

export function NumPad({ onKey }: { onKey: (key: string) => void }) {
  const theme = useTheme()
  return (
    <View style={styles.grid}>
      {KEYS.map((key) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={key === '⌫' ? 'Backspace' : key}
          onPress={() => {
            Haptics.performAndroidHapticsAsync?.(Haptics.AndroidHaptics.Keyboard_Press).catch(() => {})
            onKey(key)
          }}
          style={({ pressed }) => [
            styles.key,
            { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
            pressed && { opacity: opacity.pressed, transform: [{ scale: 0.97 }] },
          ]}
        >
          {key === '⌫' ? (
            <Icon name="backspace" size={24} color={theme.text} />
          ) : (
            <Text style={[styles.keyText, { color: theme.text }]}>{key}</Text>
          )}
        </Pressable>
      ))}
    </View>
  )
}

/** Applies a numpad key to a numeric string. */
export function applyNumKey(value: string, key: string): string {
  if (key === '⌫') return value.slice(0, -1)
  if (key === '00') return value === '' ? '' : value + '00'
  return value + key
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  key: {
    width: '31%',
    aspectRatio: 1.6,
    minHeight: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  keyText: { fontSize: 24, fontWeight: '600' },
})
