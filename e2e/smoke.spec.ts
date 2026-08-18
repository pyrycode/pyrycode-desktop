import {
  test as base,
  expect,
  _electron as electron,
  type Page
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Smoke: the whole assembled app boots and its shell renders. On a genuinely-unpaired boot the
// #80/#84 app-shell router sends the launch to the PairingScreen, so the shell that renders is the
// pairing screen (`.pairing`) — the conversation screen never mounts unpaired. This is the single
// assertion the harness ships with; the real UI scenarios (pairing, send, stream) live in
// pair-to-conversation.spec.ts.
//
// The launch is LOCAL, not the shared ./fixtures/electronApp fixture: that fixture stays
// scenario-agnostic (#40/#93) and deliberately does NOT isolate userData, so it inherits the
// developer's real userData and any stale pairing there — the exact non-hermeticity this test used
// to suffer from (#105). Mirroring pair-to-conversation.spec.ts's isolated launch, stripped to the
// minimum smoke needs (no fake relay/daemon, no pairing env flags), the per-run `--user-data-dir`
// is the whole fix: it overrides app.getPath('userData') so the launch reads an empty secrets store
// and boots genuinely unpaired, regardless of any ambient shared-userData pairing (macOS
// ~/Library/Application Support/pyrycode-desktop/secrets/).
//
// #517: the nested try/finally reaps the app and THEN the dir on every RAISED exit path — pass, test
// failure, and a failure raised after the launch but before use() returns (the last of which the old
// post-use() epilogue could not reach, leaking both for the rest of the `workers: 1` run). Not covered:
// an await that never settles — Playwright kills the worker without unwinding, so no finally runs.
const test = base.extend<{ page: Page }>({
  page: async ({}, use) => {
    // Mirror electronApp.ts's hardening: stripping ELECTRON_RENDERER_URL keeps createWindow on the
    // built-renderer path (loadFile) instead of loadURL-ing a dead dev-server URL and hanging.
    const env = { ...process.env }
    delete env.ELECTRON_RENDERER_URL
    // `--user-data-dir` is the Electron switch that overrides app.getPath('userData'); `.` stays the
    // first non-switch arg (the app path). Isolating it guarantees a genuinely unpaired start.
    const userDataDir = await mkdtemp(join(tmpdir(), 'pyry-e2e-smoke-'))
    try {
      const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env })
      try {
        const page = await app.firstWindow()
        await use(page)
      } finally {
        // Best-effort: a throwing finally would replace the causal error AND abort the unwind before
        // the outer rm, stranding the dir. Discarded without logging — a close error can carry the
        // launch argv, which embeds `--user-data-dir=<path>`.
        try {
          await app.close()
        } catch {
          // best-effort
        }
      }
    } finally {
      try {
        await rm(userDataDir, { recursive: true, force: true })
      } catch {
        // best-effort
      }
    }
  }
})

test('the app shell renders the unpaired-boot screen in the launched window', async ({ page }) => {
  // `.pairing` is the PairingScreen root (App.tsx routes every non-paired launch to it). The locator
  // auto-waits through the async pending→pairing route transition (App starts `pending` → null, then
  // pairingStatus() resolves not-paired → setRoute('pairing')); presence proves the shell rendered in
  // the real launched window. Assert the container, not a specific control, to stay robust to copy.
  await expect(page.locator('.pairing')).toBeVisible()
})
