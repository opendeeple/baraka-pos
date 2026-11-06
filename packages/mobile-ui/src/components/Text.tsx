import { forwardRef } from 'react'
import { Text as RNText, type TextProps } from 'react-native'

/**
 * Upper bound for the OS font-size setting. Android users often run the
 * system font at 130%+; uncapped, every fixed-size layout (buttons, tiles,
 * rows, sheets) overflowed. 1.2 still honours a larger font, just not past
 * what the layouts were designed to hold.
 */
export const MAX_FONT_SCALE = 1.2

/** Drop-in for react-native's Text with the app-wide font-scale cap.
 *  Every screen imports Text from @baraka/mobile-ui, never react-native. */
export const Text = forwardRef<RNText, TextProps>(function Text({ maxFontSizeMultiplier, ...rest }, ref) {
  return <RNText ref={ref} maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_FONT_SCALE} {...rest} />
})
