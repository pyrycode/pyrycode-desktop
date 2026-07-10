import { defineConfig } from '@playwright/test'

// The real-claude e2e config (#252) — run ONLY via `npm run e2e:real-claude`, part of the operator's
// pre-ship gate. It matches the single real-claude spec, which the default playwright.config.ts (the
// agent-pipeline `npm run e2e`) deliberately ignores: that spec needs a real `pyry` daemon, real claude,
// and real credentials the pipeline lacks.
//
// The shape mirrors the default config (serialized, list reporter) but with a generous per-test `timeout`
// for a cold PTY claude across two turns, and NO retries (a real-stack failure is a genuine liveness
// signal to inspect, not a flake to paper over). It intentionally enables NO screenshot / trace / video:
// a trace could capture more than DOM text, and the transport is log-free by construction (#62).
export default defineConfig({
  testDir: './e2e',
  testMatch: /real-claude\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 300_000
})
