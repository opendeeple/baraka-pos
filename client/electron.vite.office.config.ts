import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@baraka/shared', '@baraka/db-schema', '@baraka/sync-engine', '@baraka/data', '@baraka/app-core'] })],
    build: {
      outDir: 'out-office/main',
      lib: {
        entry: resolve(__dirname, 'electron/main.office.ts'),
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
    resolve: {
      alias: {
        '@baraka/shared': resolve(__dirname, '../shared/src/index.ts'),
        '@baraka/db-schema': resolve(__dirname, '../packages/db-schema/src/index.ts'),
        '@baraka/sync-engine': resolve(__dirname, '../packages/sync-engine/src/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@baraka/shared', '@baraka/db-schema', '@baraka/sync-engine', '@baraka/data', '@baraka/app-core'] })],
    build: {
      outDir: 'out-office/preload',
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts'),
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/office'),
    build: {
      outDir: 'out-office/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'src/office/index.html'),
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src'),
        '@baraka/shared': resolve(__dirname, '../shared/src/index.ts'),
      },
    },
    plugins: [react()],
  },
})
