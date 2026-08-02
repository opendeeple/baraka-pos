import type { Config } from 'tailwindcss'
import { darkTheme, spacing, radius } from '@baraka/ui-tokens'

// Colors come from @baraka/ui-tokens (single source of truth shared with the
// mobile apps). The token values are canonical to THESE desktop values, so
// this refactor changed no desktop pixels.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}', './electron/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: darkTheme.primary,
          dark: darkTheme.primaryPressed,
          light: darkTheme.primaryTint,
        },
        dark: {
          DEFAULT: darkTheme.bg,
          surface: darkTheme.surface,
          card: darkTheme.surfaceRaised,
          border: darkTheme.border,
        },
        warning: darkTheme.warning,
        info: darkTheme.info,
      },
      spacing: {
        'tk-xs': `${spacing.xs}px`,
        'tk-sm': `${spacing.sm}px`,
        'tk-md': `${spacing.md}px`,
        'tk-lg': `${spacing.lg}px`,
        'tk-xl': `${spacing.xl}px`,
      },
      borderRadius: {
        'tk-sm': `${radius.sm}px`,
        'tk-md': `${radius.md}px`,
        'tk-lg': `${radius.lg}px`,
        'tk-xl': `${radius.xl}px`,
      },
    },
  },
  plugins: [],
}

export default config
