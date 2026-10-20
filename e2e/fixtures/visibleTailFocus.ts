import type { ElectronApplication } from '@playwright/test'
import type { BrowserWindow } from 'electron'
import { isTransientContextLoss, NOT_YET_AVAILABLE, readMainProcess } from './mainProcessRead'

export async function focusVisibleTailWindow(app: Pick<ElectronApplication, 'evaluate'>): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let controlLoss: unknown
    try {
      await app.evaluate(({ BrowserWindow, app }) => {
        const owner = app as typeof app & { visibleTailFocusWindow?: BrowserWindow }
        const window = owner.visibleTailFocusWindow ?? BrowserWindow.getAllWindows()[0]
        if (!window || window.isDestroyed()) throw new Error('Missing visible-tail window')
        owner.visibleTailFocusWindow = window
        // A late or partially executed callback must not repeat completed fields.
        if (!window.isVisible()) window.show()
        if (!window.isFocused()) window.focus()
      })
    } catch (error) {
      if (!isTransientContextLoss(error)) throw error
      controlLoss = error
    }

    let ready: boolean | typeof NOT_YET_AVAILABLE = NOT_YET_AVAILABLE
    for (let inspection = 0; inspection < 21; inspection++) {
      if (inspection) await new Promise(resolve => setTimeout(resolve, 100))
      // Recovery reads only native state; it never shows/focuses the window.
      ready = await readMainProcess<boolean>(app, ({ BrowserWindow, app }) => {
        const window = (app as typeof app & { visibleTailFocusWindow?: BrowserWindow }).visibleTailFocusWindow
        if (!window) {
          if (!BrowserWindow.getAllWindows().length) throw new Error('Missing visible-tail window')
          return false // The lost control has not selected a native window yet.
        }
        if (window.isDestroyed()) throw new Error('Missing visible-tail window')
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
