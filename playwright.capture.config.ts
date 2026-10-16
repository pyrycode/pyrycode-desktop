import { defineConfig } from '@playwright/test'

// Explicit capture-only tier. No discovery by the normal or real-* suites.
export default defineConfig({
  testDir: './e2e/recordings', testMatch: /(^|\/)capture-[^/]*\.spec\.ts$/,
  globalSetup: './e2e/fixtures/runDisplay.ts', workers: 1, retries: 0,
  forbidOnly: true, timeout: 240_000,
  reporter: [['list'], ['./e2e/reporters/zeroExecutedGate.ts']]
})
