import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect, type PairedApp } from './fixtures/launchPairedApp'

const scratch = '/tmp/builder-1775'
const bundle = `${scratch}/controller.cjs`
test.beforeAll(async () => {
  await mkdir(scratch, { recursive: true })
  await build({ entryPoints: [resolve('src/main/appUpdate.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs' })
})
async function inject(app: PairedApp, state: 'ready' | 'failed') {
  await app.app.evaluate(({ ipcMain, BrowserWindow }, { bundle, state }) => {
    const require = process.getBuiltinModule('module').createRequire(bundle)
    const { EventEmitter } = require('node:events')
    const { createAppUpdateController, registerAppUpdate } = require(bundle)
    const updater = Object.assign(new EventEmitter(), {
      checkForUpdates: async () => null,
      quitAndInstall: (silent: boolean, relaunch: boolean) => { calls.push([silent, relaunch]) }
    })
    const calls: boolean[][] = []
    const controller = createAppUpdateController({ isPackaged: true, platform: 'win32', construct: () => updater,
      beforeInstall: async () => {}, onInstallFailure: () => {}, log: { event: () => {} } })
    ipcMain.removeHandler('pyry:app-update-state'); ipcMain.removeAllListeners('pyry:app-update-action')
    registerAppUpdate(ipcMain, controller,
      (event: any) => event.senderFrame === event.sender.mainFrame && BrowserWindow.fromWebContents(event.sender) !== null,
      (value: unknown) => BrowserWindow.getAllWindows().forEach(window => window.webContents.send('pyry:app-update-state', value)))
    ;(globalThis as any).updateFake = { updater, calls }
    void controller.start().then(() => {
      updater.emit('update-available')
      updater.emit(state === 'ready' ? 'update-downloaded' : 'error', state === 'ready' ? { version: '1.2.3' } : Error('PRIVATE'))
    })
  }, { bundle, state })
}
async function duplicate(app: PairedApp, failed = false) {
  await app.app.evaluate((_electron, failed) => {
    const fake = (globalThis as any).updateFake
    fake.updater.emit(failed ? 'error' : 'update-downloaded', failed ? Error('PRIVATE') : { version: '1.2.3' })
  }, failed)
}
async function remount(app: PairedApp) {
  await app.page.reload()
  await expect(app.page.locator('section[aria-label="Conversations"]')).toBeVisible()
}

test('verified update row is pinned; Restart now crosses preload and installs once', async ({ launchPairedApp }) => {
  const app = await launchPairedApp()
  await expect(app.page.locator('.app-update')).toHaveCount(0)
  await app.page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await app.page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await inject(app, 'ready')
  await app.page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(app.page.getByText('Version 1.2.3 installs when you restart.')).toBeVisible()
  // Late subscription must recover completion via the production preload snapshot.
  await remount(app)
  await expect(app.page.getByText('Update ready', { exact: true })).toBeVisible()
  for (const [width, height] of [[1280, 800], [800, 600]]) {
    await app.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height])
    const row = app.page.locator('.app-update')
    expect(await row.evaluate(node => node.closest('.channel-list__tree'))).toBeNull()
    await expect(row.getByRole('button', { name: 'Restart now' })).toBeVisible()
    const icon = row.locator('.app-update__icon')
    expect(await icon.evaluate(async node => {
      const source = /url\("(.+)"\)/.exec(getComputedStyle(node).maskImage)?.[1]
      if (source === undefined) return null
      const glyph = new Image(); glyph.src = source
      await glyph.decode()
      const box = node.getBoundingClientRect()
      return [glyph.naturalWidth, glyph.naturalHeight, box.width, box.height]
    })).toEqual([20, 20, 20, 20])
    expect(await icon.evaluate(node => {
      const element = node as HTMLElement
      element.style.setProperty('--color-primary', 'rgb(31, 151, 71)')
      const colour = getComputedStyle(element).backgroundColor
      element.style.removeProperty('--color-primary')
      return colour
    })).toBe('rgb(31, 151, 71)')
    const geometry = await row.evaluate(node => {
      const row = node.getBoundingClientRect(), sidebar = node.closest('.channel-list')!.getBoundingClientRect()
      return { inset: sidebar.bottom - row.bottom, width: row.width }
    })
    expect(geometry).toEqual({ inset: 20, width: 360 })
    await app.page.screenshot({ path: `${scratch}/ready-${width}x${height}.png`, animations: 'disabled' })
  }
  await app.page.getByRole('button', { name: 'Restart now' }).click()
  await app.page.getByRole('button', { name: 'Restart now' }).click()
  await expect.poll(() => app.app.evaluate(() => (globalThis as any).updateFake.calls)).toEqual([[true, true]])
})
test('Later stays hidden after repeat delivery, navigation and renderer remount', async ({ launchPairedApp }) => {
  const app = await launchPairedApp(); await inject(app, 'ready')
  await app.page.getByRole('button', { name: 'Later', exact: true }).click()
  await expect(app.page.locator('.app-update')).toHaveCount(0)
  await duplicate(app); await remount(app)
  await expect(app.page.locator('.app-update')).toHaveCount(0)
  await app.page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await app.page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await app.page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(app.page.locator('.app-update')).toHaveCount(0)
  expect(await app.app.evaluate(() => (globalThis as any).updateFake.updater.autoInstallOnAppQuit)).toBe(true)
})
test('download failure shows one quiet line; Dismiss survives duplicate error and remount', async ({ launchPairedApp }) => {
  const app = await launchPairedApp(); await inject(app, 'failed')
  await expect(app.page.getByText('Pyrycode will try again next launch.')).toBeVisible()
  await duplicate(app, true); await expect(app.page.locator('.app-update')).toHaveCount(1)
  await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
  await app.page.screenshot({ path: `${scratch}/failed-1280x800.png`, animations: 'disabled' })
  await app.page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await duplicate(app, true); await remount(app)
  await expect(app.page.locator('.app-update')).toHaveCount(0)
})
