// @baraka/ui-tokens — single source of truth for design tokens.
// Plain TS, zero dependencies: consumed by the RN apps (via Metro source
// resolution), by packages/mobile-ui, and by client/tailwind.config.ts.
export { palette } from './palette'
export { darkTheme, themes, type Theme } from './theme.dark'
/** Ergonomic default: the active (dark) semantic theme. */
export { darkTheme as colors } from './theme.dark'
export { spacing, radius, type, touch, motion, opacity, breakpoints, type TypeStyle } from './scales'
