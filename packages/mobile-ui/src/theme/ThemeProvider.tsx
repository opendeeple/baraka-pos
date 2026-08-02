import { createContext, useContext, type ReactNode } from 'react'
import { themes, type Theme } from '@baraka/ui-tokens'

const ThemeContext = createContext<Theme>(themes.dark)

/**
 * Theming seam: today always dark, but every mobile-ui component reads colors
 * through useTheme(), so a light theme is a provider value away.
 */
export function ThemeProvider({ theme = themes.dark, children }: { theme?: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
