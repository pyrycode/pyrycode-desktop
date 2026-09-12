import { test, expect } from './fixtures/launchPairedApp'
import { PAIRING_CHANNEL } from '../src/shared/ipc/pairing'
import { DIAGNOSTIC_CHANNEL } from '../src/shared/ipc/diagnostics'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'

const fingerprint = 'AA:bb:01:23:45:67:89:ab:complete-fingerprint-with-a-long-unbroken-suffix'

test('modal retry, busy guards, full verification, short viewport and fresh reopening', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp()
  await page.setViewportSize({ width: 800, height: 400 })
  await page.getByPlaceholder('Message…').fill('Held draft')
  await app.evaluate(({ ipcMain }, { channel, fingerprint, diagnosticChannel }) => {
    let submits = 0
    let confirms = 0
    let ignored = 0
    ipcMain.on(diagnosticChannel, (_event, record) => {
      if (record.event === 'pairing-modal' && record.code === 'submit-ignored') ignored++
    })
    let release: (() => void) | undefined
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, request) => {
      if (request.type === 'submit') {
        submits++
        if (submits === 1) return { ok: false, reason: 'invalid-paste' }
        await new Promise<void>(resolve => { release = resolve })
        return { ok: true, fingerprint }
      }
      confirms++
      await new Promise<void>(resolve => { release = resolve })
      return { ok: false, reason: 'persist-failed' }
    })
    ipcMain.handle('test:pairing-counts', () => ({ submits, confirms, ignored }))
    ipcMain.on('test:pairing-release', () => release?.())
  }, { channel: PAIRING_CHANNEL, fingerprint, diagnosticChannel: DIAGNOSTIC_CHANNEL })
  const counts = () => app.evaluate(async ({ ipcMain }) => {
    const handler = (ipcMain as typeof ipcMain & {
      _invokeHandlers: Map<string, () => unknown>
    })._invokeHandlers.get('test:pairing-counts')
    return handler?.()
  })
  const release = () => app.evaluate(({ ipcMain }) => { ipcMain.emit('test:pairing-release') })
  const dialog = page.getByRole('dialog', { name: 'Pair', exact: true })
  const code = page.getByRole('textbox', { name: 'Pairing code', exact: true })
  const name = page.getByRole('textbox', { name: 'Host name', exact: true })
  const pair = dialog.getByRole('button', { name: 'Pair', exact: true })
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true })
  await page.getByRole('button', { name: 'Pair new host' }).first().click()
  await expect(code).toBeFocused()
  expect((await dialog.boundingBox())?.width).toBe(640)
  await expect(pair).toBeDisabled()
  await code.fill('   ')
  await expect(pair).toBeDisabled()
  await code.fill('synthetic-code')
  await name.fill('  Friendly host  ')
  await dialog.screenshot({ path: '/private/tmp/builder-1360-entry.png' })
  await pair.click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(name).toHaveValue('  Friendly host  ')
  await pair.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click() })
  await expect(pair).toBeDisabled()
  await expect(cancel).toBeDisabled()
  await close.click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  // Browser hit-testing proves the overlay intercepts a background pointer.
  expect(await page.locator('button[aria-label="Pair new host"]').first().evaluate(node => {
    const rect = node.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return !node.contains(hit)
  })).toBe(true)
  await page.getByPlaceholder('Message…').evaluate(node => (node as HTMLElement).focus())
  await expect(page.getByPlaceholder('Message…')).not.toBeFocused()
  await expect.poll(counts).toEqual({ submits: 2, confirms: 0, ignored: 0 })
  await release()
  const value = dialog.getByRole('group', { name: 'Server key fingerprint' })
  await expect(value).toHaveText(fingerprint)
  await expect(pair).toBeFocused()
  await pair.press('Tab')
  await expect(close).toBeFocused()
  await close.press('Shift+Tab')
  await expect(pair).toBeFocused()
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await pair.scrollIntoViewIfNeeded()
  await expect(pair).toBeInViewport()
  await dialog.screenshot({ path: '/private/tmp/builder-1360-verification.png' })
  await pair.click()
  await expect(pair).toBeDisabled()
  await close.click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect.poll(counts).toEqual({ submits: 2, confirms: 1, ignored: 0 })
  await release()
  await expect(dialog.getByRole('alert')).toContainText('Couldn’t save')
  await expect(code).toHaveValue('synthetic-code')
  await expect(name).toHaveValue('  Friendly host  ')
  await pair.click()
  await expect(pair).toBeDisabled()
  await expect.poll(counts).toEqual({ submits: 3, confirms: 1, ignored: 0 })
  await release()
  await expect(value).toHaveText(fingerprint)
  await cancel.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Held draft')
  await page.getByRole('button', { name: 'Pair new host' }).first().click()
  await expect(code).toHaveValue('')
  await expect(name).toHaveValue('')
  await code.fill('new-interaction')
  await pair.click()
  await expect(pair).toBeDisabled()
  // A late submit is delivered after asynchronous navigation and a newer opening.
  await app.evaluate(({ BrowserWindow }, channel) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, { type: 'notificationActivated' })
  }, DAEMON_EVENT_CHANNEL)
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Pair new host' }).first().click()
  await expect(code).toHaveValue('')
  await release()
  await expect.poll(counts).toEqual({ submits: 4, confirms: 1, ignored: 1 })
  await expect(code).toHaveValue('')
  await expect(value).toHaveCount(0)
  await close.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pair new host' }).first()).toBeFocused()
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Held draft')
})
