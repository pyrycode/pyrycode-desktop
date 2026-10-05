import { writeFile } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@playwright/test'

/** Capture the integrated synthetic app through Electron after its requested state paints.
 * Chromium's screenshot protocol can stall on this runner; native capture preserves the same pixels. */
export async function capturePairedApp(app: ElectronApplication, page: Page, path?: string): Promise<Buffer> {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    return image.toPNG().toString('base64')
  })
  const buffer = Buffer.from(png, 'base64')
  if (path) await writeFile(path, buffer)
  return buffer
}
