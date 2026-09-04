import {
  test as base,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expectDesktopIsolated, launchIsolatedApp } from './fixtures/desktopIsolation'

// Smoke: the whole assembled app boots and its shell renders. On a genuinely-unpaired boot the
// #80/#84 app-shell router sends the launch to the WelcomeScreen (#662 relocated that root off the
// PairingScreen), so the shell that renders is the welcome screen (`.welcome`) — the conversation
// screen never mounts unpaired. The real UI scenarios (pairing, send, stream) live in
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
// #1067: the fixture yields the app alongside the page. This file is the tier's SECOND launch site (the
// paired fixture is the other), so it is also the only place that can prove the shared isolation is in
// effect on this one — hence the app handle, and the third test at the bottom.
const test = base.extend<{ launched: { page: Page; app: ElectronApplication } }>({
  launched: async ({}, use) => {
    // Mirror electronApp.ts's hardening: stripping ELECTRON_RENDERER_URL keeps createWindow on the
    // built-renderer path (loadFile) instead of loadURL-ing a dead dev-server URL and hanging.
    const env = { ...process.env }
    delete env.ELECTRON_RENDERER_URL
    // `--user-data-dir` is the Electron switch that overrides app.getPath('userData'); `.` stays the
    // first non-switch arg (the app path). Isolating it guarantees a genuinely unpaired start.
    const userDataDir = await mkdtemp(join(tmpdir(), 'pyry-e2e-smoke-'))
    try {
      // #1067: through the shared launch, not `electron.launch` directly — the desktop isolation must be
      // identical at both of the tier's launch sites, and this is the one that used to be easy to forget.
      const app = await launchIsolatedApp({ args: ['.', `--user-data-dir=${userDataDir}`], env })
      try {
        const page = await app.firstWindow()
        await use({ page, app })
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

test('the app shell renders the unpaired-boot screen in the launched window', async ({
  launched: { page }
}) => {
  // `.welcome` is the WelcomeScreen root (App.tsx routes every non-paired launch to it since #662).
  // The locator auto-waits through the async pending→welcome route transition (App starts `pending` →
  // null, then pairingStatus() resolves not-paired → setRoute('welcome')); presence proves the shell
  // rendered in the real launched window. Assert the container, not a specific control, to stay robust
  // to copy.
  await expect(page.locator('.welcome')).toBeVisible()
})

// #662 AC3/AC4 in the real launched window. The unit tier cannot reach this: renderer tests are
// server-render only (renderToStaticMarkup), so no callback can fire and no route can flip. The ten
// pairingArrival drives prove the welcome→pairing hop, but NOTHING else exercises Cancel — before this
// test, AC4 shipped with no executable coverage at all. Reusing the same isolated unpaired launch (no
// fake relay, no daemon) keeps it in this file: the round trip touches only App-level route state, so
// it needs no pairing plumbing and nothing secret-bearing is typed, filled, or asserted on.
test('the welcome CTA opens pairing and Cancel returns to welcome', async ({
  launched: { page }
}) => {
  const welcome = page.locator('.welcome')
  const pairing = page.locator('.pairing')

  await expect(welcome).toBeVisible()

  // AC3: the primary CTA is a user action into the pairing screen, and welcome unmounts behind it.
  await page.getByRole('button', { name: 'I already have pyrycode', exact: true }).click()
  await expect(pairing).toBeVisible()
  await expect(welcome).toHaveCount(0)

  // AC4: Cancel on the entry card (the phase an unpaired launch arrives in) lands back on welcome —
  // never the conversation screen, which the count-0 assertion below pins alongside the return.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(welcome).toBeVisible()
  await expect(pairing).toHaveCount(0)
  await expect(page.locator('.conversation')).toHaveCount(0)
})

// #1067 AC1 for the tier's SECOND launch site. The paired fixture's site is covered by
// desktop-isolation.spec.ts; this file's local fixture is the other one, and covering only the first
// would leave exactly the asymmetry the shared module exists to remove — one site isolated, one site
// still stealing the operator's focus 1 launch in 49.
//
// Reads what the launch ACTUALLY applied from inside the running app (Chromium's own parsed command line
// plus the windows' real visibility), never this file's source text — so deleting the isolation from
// `launchIsolatedApp` reddens here even though this file would still read exactly as it does now.
test('the launch is isolated from the operator desktop', async ({ launched: { app } }) => {
  await expectDesktopIsolated(app)
})
