import type { ElectronApplication } from '@playwright/test'
import { isTransientContextLoss, NOT_YET_AVAILABLE, readMainProcess } from './mainProcessRead'

type WindowState = { size: number[]; content: number[]; zoom: number }

export async function configureComposerWindow(
  app: Pick<ElectronApplication, 'evaluate'>,
  size: { width: number; height: number },
  zoom: number
): Promise<number[]> {
  // Single consumer: controls never enter the read-only recovery helper.
  for (let attempt = 0; attempt < 2; attempt++) {
    let controlLoss: unknown
    try {
      await app.evaluate(({ BrowserWindow }, target) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Missing composer window')
        const [width, height] = window.getSize()
        // Guard each field: a late original callback or partial application must not replay it.
        if (width !== target.width || height !== target.height) window.setSize(target.width, target.height)
        if (window.webContents.getZoomFactor() !== target.zoom) window.webContents.setZoomFactor(target.zoom)
      }, { ...size, zoom })
    } catch (error) {
      if (!isTransientContextLoss(error)) throw error
      controlLoss = error
    }

    let state: WindowState | typeof NOT_YET_AVAILABLE = NOT_YET_AVAILABLE
    for (let inspection = 0; inspection < 3; inspection++) {
      if (inspection > 0) await new Promise<void>(resolve => setTimeout(resolve, 100))
      state = await readMainProcess<WindowState>(app, ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Missing composer window')
        return { size: window.getSize(), content: window.getContentSize(), zoom: window.webContents.getZoomFactor() }
      })
      if (state !== NOT_YET_AVAILABLE && state.size[0] === size.width && state.size[1] === size.height && state.zoom === zoom) {
        return state.content
      }
    }
    // Only the FINAL conclusive absence plus ambiguous control acknowledgement allows a resend.
    if (state === NOT_YET_AVAILABLE) throw new Error('Could not inspect composer window', { cause: controlLoss })
    if (controlLoss === undefined) throw new Error('Composer window state did not match requested size and zoom')
    if (attempt === 1) throw new Error('Could not configure composer window', { cause: controlLoss })
  }
  throw new Error('Unreachable composer window setup state')
}
