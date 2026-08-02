import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import { opacity, radius, spacing, touch, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'

export interface ButtonProps {
  title: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
  haptic?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
}

const HEIGHTS = { sm: touch.minTarget, md: 48, lg: 54 } as const
const FONTS = { sm: type.sm, md: type.md, lg: type.lg } as const

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  haptic = true,
  style,
  testID,
}: ButtonProps) {
  const theme = useTheme()
  const filled = variant === 'primary' || variant === 'danger' || variant === 'success'
  const bg =
    variant === 'primary' ? theme.primary
    : variant === 'danger' ? theme.danger
    : variant === 'success' ? theme.success
    : variant === 'secondary' ? theme.surfaceRaised
    : 'transparent'
  const label = filled ? theme.onPrimary : variant === 'ghost' ? theme.textMuted : theme.text
  const inactive = disabled || loading

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={size === 'sm' ? touch.hitSlop : undefined}
      onPress={() => {
        if (haptic) Haptics.selectionAsync().catch(() => {})
        onPress()
      }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed && variant === 'primary' ? theme.primaryPressed : bg,
          minHeight: HEIGHTS[size],
          borderColor: variant === 'secondary' ? theme.border : 'transparent',
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: inactive ? opacity.disabled : pressed && variant !== 'primary' ? opacity.pressed : 1,
          alignSelf: fullWidth ? 'stretch' : 'auto',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={label} />
      ) : (
        <>
          {icon && <Icon name={icon} size={size === 'lg' ? 24 : 20} color={label} />}
          <Text style={[FONTS[size], styles.label, { color: label }]}>{title}</Text>
        </>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  label: { fontWeight: '700' },
})
