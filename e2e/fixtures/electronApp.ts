import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

// The scenario-agnostic launch/teardown primitive that follow-up e2e scenarios
// (pairing, send, stream) import. Built on Playwright's `test.extend` so teardown
// runs through the runner's fixture lifecycle — it fires on pass *and* fail, so a
// failing test can never orphan an Electron process (no manual afterEach needed).

type ElectronFixtures = {
  // The launched app; closed automatically after each test.
  electronApp: ElectronApplication
  // The main renderer window (electronApp.firstWindow()).
  page: Page
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    // `args: ['.']` resolves via package.json `main` → out/main/index.js, so this
    // launches the *built* app.
    //
    // Strip ELECTRON_RENDERER_URL from the child env: when set (e.g. leaking from a
    // dev shell), createWindow would loadURL a non-running dev server instead of
    // loadFile the built renderer, hanging the smoke test. `app.isPackaged` is false
    // in this launch mode, so the built-renderer path is gated purely on that var.
    const env = { ...process.env }
    delete env.ELECTRON_RENDERER_URL
    const app = await electron.launch({ args: ['.'], env })
    await use(app)
    await app.close()
  },
  page: async ({ electronApp }, use) => {
    // Resolves when the first BrowserWindow is created (even though it opens with
    // show: false; it shows on ready-to-show).
    const page = await electronApp.firstWindow()
    await use(page)
  }
})

export { expect }
