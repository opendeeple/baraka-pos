import { forwardRef, useState, type ReactNode } from 'react'
import { StyleSheet, Text, TextInput, View, type TextInputProps, type StyleProp, type ViewStyle } from 'react-native'
import { radius, spacing, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'

export interface InputProps extends TextInputProps {
  label?: string
  error?: string | null
  helperText?: string
  left?: ReactNode
  right?: ReactNode
  containerStyle?: StyleProp<ViewStyle>
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, helperText, left, right, containerStyle, style, onFocus, onBlur, ...rest },
  ref
) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const borderColor = error ? theme.danger : focused ? theme.focusRing : theme.border

  return (
    <View style={containerStyle}>
      {label ? <Text style={[type.sm, styles.label, { color: theme.textMuted }]}>{label}</Text> : null}
      <View style={[styles.frame, { backgroundColor: theme.surfaceRaised, borderColor }]}>
        {left}
        <TextInput
          ref={ref}
          accessibilityLabel={label ?? rest.placeholder}
          placeholderTextColor={theme.textFaint}
          style={[type.md, styles.input, { color: theme.text }, style]}
          onFocus={(e) => { setFocused(true); onFocus?.(e) }}
          onBlur={(e) => { setFocused(false); onBlur?.(e) }}
          {...rest}
        />
        {right}
      </View>
      {error ? (
        <Text style={[type.xs, styles.helper, { color: theme.danger }]}>{error}</Text>
      ) : helperText ? (
        <Text style={[type.xs, styles.helper, { color: theme.textFaint }]}>{helperText}</Text>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  label: { marginBottom: spacing.xs, fontWeight: '600' },
  frame: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    gap: spacing.sm,
  },
  input: { flex: 1, paddingVertical: spacing.md },
  helper: { marginTop: spacing.xs },
})
