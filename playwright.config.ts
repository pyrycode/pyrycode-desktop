import { defineConfig } from '@playwright/test'

// E2E harness config. Playwright only scans `e2e/` — never `src/` — which is one
// half of the two-way separation from the vitest unit run (the other half is the
// `include` glob in vitest.config.ts). `_electron.launch` (used by the fixture)
// drives the project's own Electron binary, so there is no browser project here
// and no `npx playwright install` step.
export default defineConfig({
  testDir: './e2e',
  // Every `real-*` spec (starting with real-claude, #252) needs a real pyry daemon + real claude +
  // credentials the agent pipeline lacks; they run only under playwright.real-claude.config.ts
  // (`npm run e2e:real-claude`). A filename testIgnore is structural — it can't be forgotten the way a
  // per-test grep tag can.
  testIgnore: /real-.*\.spec\.ts$/,
  // One Electron app process at a time: launches are serialized, so future
  // multi-file scenarios never contend for the same window or port.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list'
})
