import { Text } from './Text'
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
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
// Narrower side padding for small buttons — they usually sit 2-3 abreast.
const PAD_X = { sm: spacing.sm, md: spacing.md, lg: spacing.lg } as const
const ICONS = { sm: 16, md: 20, lg: 24 } as const

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
          paddingHorizontal: PAD_X[size],
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
          {icon && <Icon name={icon} size={ICONS[size]} color={label} />}
          {/* One line, shrinks to fit: long uz/ru labels in side-by-side
              buttons used to wrap and squash the button. */}
          <Text
            style={[FONTS[size], styles.label, { color: label }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            maxFontSizeMultiplier={1.25}
          >
            {title}
          </Text>
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
    paddingVertical: spacing.sm,
  },
  label: { fontWeight: '700', flexShrink: 1, textAlign: 'center' },
})
