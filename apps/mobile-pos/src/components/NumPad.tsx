import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { colors } from '../theme'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'] as const

export function NumPad({ onKey }: { onKey: (key: string) => void }) {
  return (
    <View style={styles.grid}>
      {KEYS.map((key) => (
        <TouchableOpacity
          key={key}
          style={styles.key}
          activeOpacity={0.6}
          onPress={() => onKey(key)}
        >
          <Text style={styles.keyText}>{key}</Text>
        </TouchableOpacity>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  key: {
    width: '31%',
    aspectRatio: 1.6,
    minHeight: 56,
    backgroundColor: colors.card,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyText: { color: colors.text, fontSize: 24, fontWeight: '600' },
})
