import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}', './electron/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#f97316', // orange-500
          dark: '#ea580c',    // orange-600
          light: '#fdba74',   // orange-300
        },
        dark: {
          DEFAULT: '#1e1e2e',
          surface: '#2a2a3e',
          card: '#313145',
          border: '#404060',
        },
      },
    },
  },
  plugins: [],
}

export default config
