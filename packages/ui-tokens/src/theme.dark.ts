import { palette } from './palette'

/**
 * Semantic dark theme. Keys are meanings, not colors — a future light theme
 * reuses the same keys with different palette entries (`themes.light`).
 *
 * Legacy aliases (`card`, `primaryDark`) are kept so the pre-refactor screen
 * code compiles unchanged; new code should prefer the semantic names.
 */
export const darkTheme = {
  // Surfaces
  bg: palette.neutral.bg,
  surface: palette.neutral.surface,
  surfaceRaised: palette.neutral.raised,
  /** @deprecated alias of surfaceRaised (pre-refactor name) */
  card: palette.neutral.raised,
  border: palette.neutral.border,
  borderStrong: palette.neutral.borderStrong,
  overlay: 'rgba(0, 0, 0, 0.6)',

  // Text
  text: palette.white,
  textMuted: palette.gray[400],
  textFaint: palette.gray[500],
  /** Text/icons placed on a primary/danger/success-filled background. */
  onPrimary: palette.white,

  // Brand
  primary: palette.orange[500],
  primaryPressed: palette.orange[600],
  /** @deprecated alias of primaryPressed (pre-refactor name) */
  primaryDark: palette.orange[600],
  primaryTint: palette.orange[300],

  // Status
  danger: palette.red[500],
  success: palette.green[500],
  warning: palette.amber[500],
  info: palette.blue[500],

  focusRing: palette.orange[500],
} as const

export type Theme = { [K in keyof typeof darkTheme]: string }

export const themes: { dark: Theme } = { dark: darkTheme }
