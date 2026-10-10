import { defineConfig } from '@playwright/test'
import { availableParallelism } from 'node:os'

// E2E harness config. Playwright only scans `e2e/` — never `src/` — which is one
// half of the two-way separation from the vitest unit run (the other half is the
// `include` glob in vitest.config.ts). `_electron.launch` (used by the fixture)
// drives the project's own Electron binary, so there is no browser project here
// and no `npx playwright install` step.

const REAL_TIER = /(^|\/)real-[^/]*\.spec\.ts$/

// The specs that write or read the operating system clipboard, which every Electron process on the
// machine shares. Two of them overlapping would read each other's text. A new spec that copies or pastes
// belongs in this list.
const CLIPBOARD_SPECS = [
  'chat-history-recording',
  'code-block-copy',
  'composer-paste-image',
  'markdown-reader-menu',
  'message-copy',
  'message-side-actions',
  'offline-conversation-actions',
  'thread-items'
].map((name) => new RegExp(`(^|/)${name}\\.spec\\.ts$`))

// Four, or half the machine's cores when that is fewer. Measured on a 10-core Mac, 2026-10-06: the run
// went from 5.1 min serial to about 3.3 min at four workers, and six or eight were no faster, because
// concurrent Electron launches contend with each other rather than with the tests.
const DEFAULT_WORKERS = Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2)))

function workerCount(): number {
  const raw = process.env.PW_WORKERS
  if (raw === undefined || raw === '') return DEFAULT_WORKERS
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`PW_WORKERS must be a positive integer, got "${raw}"`)
  }
  return parsed
}

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
  testIgnore: REAL_TIER,
  // Files spread across workers; the tests inside one file still run in order in one worker. Every
  // launch already owns its own resources: a fresh `mkdtemp` user-data dir, fake relay forwarders and
  // daemons on ephemeral loopback ports (`port: 0`), and its own Electron process. The one thing every
  // launch shares is the operating system clipboard, so the specs that write or read it run in their
  // own project, one at a time. The others never touch it, so they can overlap with those.
  //
  // `PW_WORKERS` overrides the worker count, so a slower dispatcher machine can tune it. `1` restores
  // the fully serial run.
  fullyParallel: false,
  workers: workerCount(),
  // The clipboard project is listed first so its single worker starts at once rather than running its
  // specs one after another at the end, after the parallel ones have finished.
  projects: [
    { name: 'clipboard', testMatch: CLIPBOARD_SPECS, workers: 1 },
    { name: 'parallel', testIgnore: [REAL_TIER, ...CLIPBOARD_SPECS] }
  ],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list'
})
