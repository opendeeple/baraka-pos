import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { radius } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'

export interface SkeletonProps {
  width?: number | `${number}%`
  height?: number
  round?: boolean
  style?: StyleProp<ViewStyle>
}

/** Pulsing placeholder block for content that is loading. */
export function Skeleton({ width = '100%', height = 16, round = false, style }: SkeletonProps) {
  const theme = useTheme()
  const pulse = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])

  return (
    <Animated.View
      style={[
        styles.base,
        {
          width,
          height,
          borderRadius: round ? radius.full : radius.sm,
          backgroundColor: theme.surfaceRaised,
          opacity: pulse,
        },
        style,
      ]}
    />
  )
}

const styles = StyleSheet.create({ base: {} })
