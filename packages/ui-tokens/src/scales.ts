/**
 * Non-color design scales. Values are density-independent pixels (RN dp /
 * CSS px). Every magic number in a screen should trace back to one of these.
 */

/** 4-base spacing scale. Use `spacing.md` for default gaps/padding. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  x3l: 32,
  x4l: 40,
  x5l: 48,
} as const

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const

export interface TypeStyle {
  fontSize: number
  lineHeight: number
  fontWeight: '400' | '500' | '600' | '700' | '800'
}

/** Type scale. `money*` variants are for tabular amounts. */
export const type: Record<
  'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'title' | 'display' | 'money' | 'moneyLg' | 'moneyDisplay',
  TypeStyle
> = {
  xs: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  sm: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  md: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  lg: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  xl: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  display: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  money: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  moneyLg: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  moneyDisplay: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
}

/** Minimum touch-target rules (Android/Apple guidance is 44–48dp). */
export const touch = {
  minTarget: 44,
  hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
} as const

/** Motion durations in ms. */
export const motion = {
  fast: 120,
  base: 200,
  slow: 300,
} as const

export const opacity = {
  disabled: 0.45,
  pressed: 0.7,
} as const

/** Layout breakpoints (dp). `twoPane` gates tablet split layouts. */
export const breakpoints = {
  twoPane: 768,
} as const
