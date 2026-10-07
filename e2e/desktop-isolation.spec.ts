import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { ElectronApplication } from '@playwright/test'
import { electron } from './fixtures/electronLaunch'
import { join, relative } from 'node:path'
import { test, expect } from './fixtures/launchPairedApp'
import { e2eShowsWindow, expectDesktopIsolated, readDesktopIsolation } from './fixtures/desktopIsolation'

// #1067's cover. The tier reddened one spec per run, a different one each run, always at
// `pairFromUnpairedLaunch`'s fingerprint-card wait — a step with no socket and no handshake in it, so the
// only reading that fits a 5000 ms miss is that the renderer was stopped. Every launch used to show and
// focus a window, 49 times per `workers: 1` run, which is precisely the state Chromium backgrounds and
// throttles once the operator clicks away.
//
// THERE IS NO FAILS-ON-MAIN TEST FOR THE FLAKE ITSELF and this file does not pretend otherwise: it
// reproduces about once per 77 tests, non-deterministically, and only under operator interference. What
// is provable is that the isolation is applied and that the whole pairing drive completes under it, and
// that is what the tests below hold down.
//
// The two tests split AC1's two consequences, because no single check can see both:
//  - dropping the isolation → the in-app read-backs (here and in smoke.spec.ts, one per launch site);
//  - adding a launch site that skips it → the source guard at the bottom, which is the only thing that
//    can see a launch this file never runs.

test('the full pairing drive completes with the app never shown', async ({ launchPairedApp }) => {
  // The fixture RESOLVING is the drive: welcome CTA → paste → Pair → fingerprint card → Confirm → the
  // seeded row click → Send enabled. So by this line the whole arrival has run against a window that was
  // never shown, which is AC2 — and it is a real proof rather than a restatement, because the drive's
  // gates are the product's own (the row cannot render before `connected`, and Send cannot enable before
  // it either).
  const { app, page } = await launchPairedApp()

  // Send-enabled is the fixture's completion signal; re-asserting it here is what makes this test's
  // subject the DRIVE rather than the launch, so a future fixture that stopped short would redden here.
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()

  await expectDesktopIsolated(app)
})

test('the isolation is read back from the launched app, not from fixture source', async ({
  launchPairedApp
}) => {
  const { app } = await launchPairedApp()
  const state = await readDesktopIsolation(app)

  // Chromium's own parsed command line — not a string this repo wrote and then matched against itself.
  expect(state.switchesApplied).toEqual([
    'disable-renderer-backgrounding',
    'disable-backgrounding-occluded-windows',
    'disable-background-timer-throttling'
  ])
  // A window EXISTS and is not visible. Asserted as two facts on purpose: `visibleWindows === 0` alone is
  // trivially true of a launch that lost its window entirely, and would read as a pass. Under the
  // harness's show-window opt-out (Xvfb in the dispatcher container) the window is shown on purpose.
  expect(state.windows).toBeGreaterThan(0)
  if (!e2eShowsWindow()) expect(state.visibleWindows).toBe(0)
})

// The deterministic detector for AC1's second consequence. An in-app read-back structurally cannot see a
// launch site it never runs, so a new fixture that called `electron.launch` itself would ship with every
// existing spec green — which is exactly how the last shared launch primitive died: `electronApp.ts` was
// optional, drifted to zero importers, and #546 deleted it. This makes the shared place non-optional.
//
// Deliberately a SOURCE check and deliberately not the proof that the isolation works: it answers "does
// every default-tier launch go through the one place?", while the two tests above answer "does that place
// actually isolate?". Neither substitutes for the other.
test('every default-tier Electron launch goes through the shared module', async () => {
  // `__dirname`, not `import.meta.url`: the repo has no `"type": "module"`, so Playwright transpiles
  // specs to CommonJS and `import.meta` is not available in one.
  const e2eDir = __dirname

  // `fixtures/desktopIsolation.ts` owns the default tier's launch. `fixtures/realDaemon.ts` is the
  // `real-*` tier, which keeps its own launch on purpose — routing it through here would put a change
  // provable without a live daemon behind a live gate. It applies the same isolation itself (#1672).
  // This spec is excluded from its own scan because the needle appears in its own source, below.
  const ALLOWED = ['fixtures/desktopIsolation.ts', 'fixtures/realDaemon.ts']
  // This spec's independent input-enabled cover intentionally bypasses launch isolation.
  const SELF = 'desktop-isolation.spec.ts'
  const LAUNCH_CALL = /electron\.launch\(/

  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true })
    const found = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return walk(path)
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
      })
    )
    return found.flat()
  }

  const launchSites: string[] = []
  for (const path of await walk(e2eDir)) {
    const rel = relative(e2eDir, path)
    if (rel === SELF) continue
    if (LAUNCH_CALL.test(await readFile(path, 'utf-8'))) launchSites.push(rel)
  }

  expect(launchSites.sort()).toEqual([...ALLOWED].sort())
})

type PointerWindow = Window & { displayPointerExits: number }

// An independent process retains display input, unlike windows created inside the protected app.
// Deleting initial-window protection must lose hover and record a native crossing (mutation check).
test('an independent input-enabled cover preserves isolated hover', async ({
  launchPairedApp
}) => {
  test.skip(!e2eShowsWindow(), 'a never-shown window receives no pointer from the display')
  const { app, page } = await launchPairedApp()
  const control = page
    .locator('.channel-list__actions')
    .getByRole('button', { name: 'Pair new host', exact: true })
  const pill = control.locator('.channel-list__control-name')
  const scratch = await mkdtemp(join(tmpdir(), 'pyry-independent-cover-'))
  let coverApp: ElectronApplication | undefined
  try {
    const entry = join(scratch, 'cover.cjs')
    await writeFile(entry, `
      const { app, BrowserWindow, screen } = require('electron')
      app.whenReady().then(() => {
        const { x, y } = screen.getCursorScreenPoint()
        const window = new BrowserWindow({
          x: x - 100, y: y - 100, width: 200, height: 200, show: false,
          webPreferences: { backgroundThrottling: false }
        })
        // Fixed content only; the driver waits for this navigation before mapping the cover.
        void window.loadURL('data:text/html,<p>independent cover</p>')
      })
    `)
    const env: Record<string, string> = {}
    for (const [name, value] of Object.entries(process.env)) {
      if (value !== undefined) env[name] = value
    }
    delete env.ELECTRON_RENDERER_URL
    coverApp = await electron.launch({ args: [entry, `--user-data-dir=${join(scratch, 'profile')}`], env })
    const coverPage = await coverApp.firstWindow()
    await expect(coverPage.locator('p')).toHaveText('independent cover')

    await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const { x, y } = screen.getCursorScreenPoint()
      const { width, height } = window.getBounds()
      window.setPosition(x - Math.floor(width / 2), y - Math.floor(height / 2))
      window.setAlwaysOnTop(true, 'screen-saver')
      window.moveTop()
    })
    await control.hover()
    await expect(pill).toBeVisible()
    await page.evaluate(() => {
      (window as unknown as PointerWindow).displayPointerExits = 0
      document.addEventListener('pointerout', () => {
        (window as unknown as PointerWindow).displayPointerExits++
      }, { once: true })
    })
    await coverApp.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const { x, y } = screen.getCursorScreenPoint()
      window.setPosition(x - 100, y - 100)
      window.setIgnoreMouseEvents(false)
      window.setAlwaysOnTop(true, 'screen-saver')
      window.show()
      window.moveTop()
    })
    await coverPage.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    ))
    await page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    ))
    expect(await control.evaluate((el) => ({
      hovered: el.matches(':hover'),
      displayPointerExits: (window as unknown as PointerWindow).displayPointerExits
    }))).toEqual({ hovered: true, displayPointerExits: 0 })
    await expect(pill).toBeVisible()
  } finally {
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setIgnoreMouseEvents(true)
        window.setAlwaysOnTop(false)
      })
    } finally {
      try {
        await coverApp?.close()
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    }
  }
})
