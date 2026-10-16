import type { ElectronApplication } from '@playwright/test'
import { isTransientContextLoss, NOT_YET_AVAILABLE, readMainProcess } from './mainProcessRead'

export async function focusVisibleTailWindow(app: Pick<ElectronApplication, 'evaluate'>): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let controlLoss: unknown
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Missing visible-tail window')
        // A late or partially executed callback must not repeat completed fields.
        if (!window.isVisible()) window.show()
        if (!window.isFocused()) window.focus()
      })
    } catch (error) {
      if (!isTransientContextLoss(error)) throw error
      controlLoss = error
    }

    let ready: boolean | typeof NOT_YET_AVAILABLE = NOT_YET_AVAILABLE
    for (let inspection = 0; inspection < 3; inspection++) {
      // Recovery reads only native state; it never shows/focuses the window.
      ready = await readMainProcess<boolean>(app, ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Missing visible-tail window')
        return window.isVisible() && window.isFocused()
      })
      if (ready === true) return
    }
    // Only final conclusive absence after acknowledgement loss permits a resend.
    if (ready === NOT_YET_AVAILABLE) throw new Error('Could not inspect visible-tail window', { cause: controlLoss })
    if (controlLoss === undefined) throw new Error('Visible-tail window is not visible and focused')
    if (attempt === 1) throw new Error('Could not focus visible-tail window', { cause: controlLoss })
  }
}
