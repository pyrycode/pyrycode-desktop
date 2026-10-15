import { test as base, expect } from './fixtures/launchPairedApp'
import type { ElectronApplication } from '@playwright/test'
import { WELCOME_STALL_ATTACHMENT } from './fixtures/welcomeDiagnostics'
import { e2eShowsWindow, LAUNCH_FATE_ATTACHMENT } from './fixtures/desktopIsolation'

// Registered before the launch fixture, so this check runs after its existing teardown/attachments.
const test = base.extend<{ evidenceCheck: void }>({
  evidenceCheck: [async ({}, use, testInfo) => {
    await use()
    const diagnostic = testInfo.attachments.find((a) => a.name === WELCOME_STALL_ATTACHMENT)
    if (!diagnostic) return
    const fate = testInfo.attachments.find((a) => a.name === LAUNCH_FATE_ATTACHMENT)
    expect(fate).toBeDefined()
    const launches = JSON.parse(fate?.body?.toString() ?? '{}').launches
    expect(launches).toHaveLength(2)
    // Explicit app close deliberately exits the first launch before ordinary fixture teardown.
    expect(launches.map((launch: { runningAtOutcome: boolean }) => launch.runningAtOutcome)).toEqual([false, true])
    expect(launches.map((launch: { exitCode: number }) => launch.exitCode)).toEqual([0, 0])
    expect(JSON.parse(fate?.body?.toString() ?? '{}').teardownFailures).toEqual([])
  }, { auto: true }]
})

base('ordinary Welcome pairing stays responsive while its native window is hidden', async ({ launchPairedApp }, testInfo) => {
  const paired = await launchPairedApp({}, { onLaunched: async app => {
    const page = await app.firstWindow()
    const button = page.getByRole('button', { name: 'I already have pyrycode', exact: true })
    await expect(button).toBeVisible()
    const window = await app.browserWindow(page)
    try {
      // Let the normal ready-to-show handler finish before holding the window hidden.
      if (e2eShowsWindow()) await expect.poll(() => window.evaluate(w => w.isVisible())).toBe(true)
      await window.evaluate(w => w.hide())
      expect(await window.evaluate(w => w.isVisible())).toBe(false)
    } finally {
      await window.dispose()
    }
    await button.evaluate(element => {
      const input = { clicks: 0, trusted: 0 }
      ;(window as any).__welcomeInput = input
      element.addEventListener('click', event => {
        input.clicks++
        if (event.isTrusted) input.trusted++
      }, { once: true })
    })
  } })
  // Returning from the fixture proves ordinary Welcome → pairing → confirmation → connected thread.
  await expect(paired.page.getByRole('button', { name: 'Send' })).toBeEnabled()
  expect(await paired.page.evaluate(() => {
    const input = (window as any).__welcomeInput
    delete (window as any).__welcomeInput
    return input
  })).toEqual({ clicks: 1, trusted: 1 })
  const window = await paired.app.browserWindow(paired.page)
  try {
    expect(await window.evaluate(w => ({ visible: w.isVisible(), throttling: w.webContents.getBackgroundThrottling() })))
      .toEqual({ visible: false, throttling: false })
  } finally {
    await window.dispose()
  }
  // Actual frame callbacks must progress despite native invisibility; no timer or synthetic input.
  expect(await paired.page.evaluate(() => new Promise<number>(resolve => {
    let frames = 0
    const tick = () => { if (++frames === 2) resolve(frames); else requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  }))).toBe(2)
  expect(testInfo.attachments.filter(a => a.name === WELCOME_STALL_ATTACHMENT)).toHaveLength(0)
})

test('a controlled real Welcome stall retains progress evidence before teardown and correlates multiple launches', async ({ launchPairedApp }, testInfo) => {
  let stalledApp: ElectronApplication | undefined
  const launched = launchPairedApp({}, { onLaunched: async (app) => {
    stalledApp = app
    const stalledPage = await app.firstWindow()
    await expect(stalledPage.getByRole('button', { name: 'I already have pyrycode', exact: true })).toBeVisible()
    await stalledPage.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('button.welcome__pair')
      if (!button) throw new Error('missing test control')
      button.disabled = true
      // Controlled renderer fault: timers remain real, while the frame callback never runs.
      window.requestAnimationFrame = () => 0
    })
  } })
  // Observe the launch rejection immediately to avoid an unhandled rejection during assertions.
  const outcome = launched.then(() => 'unexpected-success', () => 'click-failed')
  await expect.poll(() => testInfo.attachments.filter((a) => a.name === WELCOME_STALL_ATTACHMENT).length, { timeout: 12_000 }).toBe(1)
  const attachment = testInfo.attachments.find((a) => a.name === WELCOME_STALL_ATTACHMENT)
  const body = attachment?.body?.toString() ?? '{}'
  const report = JSON.parse(body)
  expect(attachment?.contentType).toBe('application/json')
  expect(attachment?.path).toBeUndefined()
  expect(report).toMatchObject({ launchIndex: 1, trigger: 'pending', native: { status: 'available' }, renderer: { status: 'available' } })
  expect(report.native.value[0]).toMatchObject({ visible: expect.any(Boolean), minimized: false, focused: expect.any(Boolean), bounds: { width: expect.any(Number), height: expect.any(Number) } })
  expect(report.renderer.value).toMatchObject({ frames: 0, control: { present: true, enabled: false, bounds: { width: expect.any(Number) } } })
  expect(report.renderer.value.timers).toBeGreaterThan(0)
  expect(report.renderer.value.intervalMs).toBeGreaterThan(0)
  expect(report.renderer.value.intervalMs).toBeLessThanOrEqual(1000)
  expect(report.captureMs).toBeLessThanOrEqual(2000)
  expect(body).not.toMatch(/dummy-token|pyry-e2e|pairing.code|argv|environment|\/fake/)
  if (!stalledApp) throw new Error('missing test app')
  await stalledApp.close()
  expect(await outcome).toBe('click-failed')

  // The second launch drives normal Welcome → pairing → confirmation; it adds no diagnostics.
  await launchPairedApp()
  expect(testInfo.attachments.filter((a) => a.name === WELCOME_STALL_ATTACHMENT)).toHaveLength(1)
})
