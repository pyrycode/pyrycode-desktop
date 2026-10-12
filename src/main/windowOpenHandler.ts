import { allowedLinkHref } from '../shared/externalLink'

/** The slice of Electron's window-open handler this module uses. Kept local so no `electron` import. */
export type WindowOpenDecision = { action: 'deny' }

/**
 * The main window's `setWindowOpenHandler` body. An allowed link (see `allowedLinkHref`, the SAME
 * function the renderer's markdown `a` override uses) is handed to `openExternal`; every other URL,
 * including a `file:` URL and any custom protocol handler, is dropped without a call.
 *
 * `deny` on EVERY path, the allowed one included: the URL goes to the operating system and no in-app
 * window is ever constructed for it, so remote content never loads into a renderer holding the preload
 * bridge. Electron-free, so the node test tier covers it; index.ts passes `shell.openExternal` in.
 */
export function createWindowOpenHandler(
  openExternal: (url: string) => void
): (details: { url: string }) => WindowOpenDecision {
  return ({ url }) => {
    if (allowedLinkHref(url) !== null) openExternal(url)
    return { action: 'deny' }
  }
}
