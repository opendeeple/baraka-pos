/**
 * Raw color ramps — never import these in app code. Screens and components
 * consume the semantic theme (`theme.dark.ts`); the palette exists so themes
 * can be composed from one set of physical colors.
 */
export const palette = {
  orange: {
    300: '#fdba74',
    500: '#f97316',
    600: '#ea580c',
  },
  // The desktop Tailwind values are canonical (the mobile theme had drifted).
  neutral: {
    bg: '#1e1e2e',
    surface: '#2a2a3e',
    raised: '#313145',
    border: '#404060',
    borderStrong: '#565685',
  },
  white: '#ffffff',
  gray: {
    400: '#9ca3af',
    500: '#6b7280',
  },
  red: { 500: '#ef4444' },
  green: { 500: '#22c55e' },
  amber: { 500: '#f59e0b' },
  blue: { 500: '#3b82f6' },
  black: '#000000',
} as const
