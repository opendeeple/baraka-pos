import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    viewport: { width: 1366, height: 768 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm exec serve out/renderer --listen 4173 --no-clipboard',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      command: 'pnpm exec serve out-office/renderer --listen 4174 --no-clipboard',
      url: 'http://localhost:4174',
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { channel: 'chromium' } },
  ],
})
