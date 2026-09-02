import { defineConfig } from '@playwright/test'

// The real-claude e2e config (#252) — run ONLY via `npm run e2e:real-claude`, part of the operator's
// pre-ship gate. It matches every `real-*` spec, which the default playwright.config.ts (the
// agent-pipeline `npm run e2e`) deliberately ignores: those specs need a real `pyry` daemon, real claude,
// and real credentials the pipeline lacks.
//
// The shape mirrors the default config (serialized, list reporter) but with a generous per-test `timeout`
// for a cold PTY claude across two turns, and NO retries (a real-stack failure is a genuine liveness
// signal to inspect, not a flake to paper over). It intentionally enables NO screenshot / trace / video:
// a trace could capture more than DOM text, and the transport is log-free by construction (#62).
export default defineConfig({
  testDir: './e2e',
  // Anchored to the filename — see the long note on the mirrored `testIgnore` in playwright.config.ts
  // (#928). Unanchored, this matched every spec in the tree whenever an ancestor directory name contained
  // `real-`, which is exactly what the dispatcher's `real-claude-gate-<N>` worktree does: the gate ran all
  // 66 specs under this config, and the 2 fake-tier failures it reported were specs that had no business
  // being collected here at all. Keep this pattern byte-identical to playwright.config.ts's.
  testMatch: /(^|\/)real-[^/]*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 300_000
})
