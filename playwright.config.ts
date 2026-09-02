import { defineConfig } from '@playwright/test'

// E2E harness config. Playwright only scans `e2e/` — never `src/` — which is one
// half of the two-way separation from the vitest unit run (the other half is the
// `include` glob in vitest.config.ts). `_electron.launch` (used by the fixture)
// drives the project's own Electron binary, so there is no browser project here
// and no `npx playwright install` step.
export default defineConfig({
  testDir: './e2e',
  // `.spec.ts` ONLY. Playwright's default testMatch also collects `*.test.ts`, and since #933 there
  // is one of those under e2e/ (the vitest cover for the capability-gate decision, kept beside the
  // fixture that calls it). Without this it would be collected here too, where its `describe`/`it`
  // are not Playwright's and the run would error at load time. This is one half of the suffix
  // invariant — `.spec.ts` is Playwright's, `.test.ts` is vitest's — whose other half is the
  // `include` glob in vitest.config.ts.
  testMatch: /(^|\/)[^/]*\.spec\.ts$/,
  // Every `real-*` spec (starting with real-claude, #252) needs a real pyry daemon + real claude +
  // credentials the agent pipeline lacks; they run only under playwright.real-claude.config.ts
  // (`npm run e2e:real-claude`). A filename testIgnore is structural — it can't be forgotten the way a
  // per-test grep tag can.
  //
  // ANCHORED TO THE FILENAME, and that is load-bearing (#928). Playwright matches a RegExp testIgnore /
  // testMatch against the ABSOLUTE file path, so the older unanchored `/real-.*\.spec\.ts$/` matched every
  // spec in the tree whenever any ancestor DIRECTORY name contained `real-` — `.*` happily spans `/`. The
  // dispatcher's live gate checks this branch out into a worktree literally named `real-claude-gate-<N>`,
  // which flipped the whole partition: the real-claude config collected all 66 specs instead of 10, and
  // this default config would have ignored every one of them and exited 0 on a suite that never ran.
  // `(^|\/)` pins the match to a path boundary and `[^/]*` keeps it inside one segment, so the partition
  // now depends on the FILENAME alone — which is what both configs always claimed.
  testIgnore: /(^|\/)real-[^/]*\.spec\.ts$/,
  // One Electron app process at a time: launches are serialized, so future
  // multi-file scenarios never contend for the same window or port.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list'
})
