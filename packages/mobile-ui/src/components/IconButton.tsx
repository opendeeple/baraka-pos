import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import { opacity, radius, touch } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'

export interface IconButtonProps {
  icon: IconName
  onPress: () => void
  /** Required: icon-only controls are invisible to screen readers without it. */
  accessibilityLabel: string
  size?: 20 | 24 | 28
  color?: string
  variant?: 'plain' | 'filled' | 'outline'
  disabled?: boolean
  haptic?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
}

/** Always ≥44dp with hitSlop — the fix for the app's sub-target tap areas. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 24,
  color,
  variant = 'plain',
  disabled = false,
  haptic = true,
  style,
  testID,
}: IconButtonProps) {
  const theme = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={touch.hitSlop}
      onPress={() => {
        if (haptic) Haptics.selectionAsync().catch(() => {})
        onPress()
      }}
      style={({ pressed }) => [
        styles.base,
        variant === 'filled' && { backgroundColor: theme.surfaceRaised },
        variant === 'outline' && { borderWidth: 1, borderColor: theme.border },
        { opacity: disabled ? opacity.disabled : pressed ? opacity.pressed : 1 },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={color ?? theme.text} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minWidth: touch.minTarget,
    minHeight: touch.minTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
