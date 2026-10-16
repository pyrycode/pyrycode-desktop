import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', testMatch: /(^|\/)recorded-[^/]*\.spec\.ts$/,
  globalSetup: './e2e/fixtures/runDisplay.ts', workers: 1, retries: 0,
  forbidOnly: !!process.env.CI, reporter: [['list'], ['./e2e/reporters/zeroExecutedGate.ts']]
})
