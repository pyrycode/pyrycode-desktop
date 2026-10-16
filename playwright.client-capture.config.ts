import { defineConfig } from '@playwright/test'
process.env.PYRY_CLIENT_MODE = 'capture'
export default defineConfig({
  testDir: './e2e', testMatch: /(^|\/)real-[^/]*\.spec\.ts$/,
  globalSetup: './e2e/fixtures/runDisplay.ts', workers: 1, retries: 0, forbidOnly: true,
  reporter: [['list'], ['./e2e/reporters/zeroExecutedGate.ts']], timeout: 300_000
})
