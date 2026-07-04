import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { createSecureStore } from './secureStore'
import { electronSecretEncryption } from './electronSecretEncryption'
import { fileSecretPersistence } from './fileSecretPersistence'
import { createPairedServerStore } from './pairedServerStore'
import { createPairingConfirmation } from './pairingConfirmation'
import { parsePairingPayload } from './pairingPayload'
import { registerPairingHandler } from './pairingHandler'

// The relay socket, the Noise_IK handshake, the frame codec, and event parsing
// all live in this background process. See docs/knowledge/decisions/0001. The
// renderer receives already-typed events over IPC and never sees raw bytes or keys.

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
    title: 'Pyrycode Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Run the renderer sandboxed. The preload needs nothing privileged — it only exposes a
      // typed IPC bridge via contextBridge/ipcRenderer, both of which work in a sandboxed
      // preload — so there is no reason to widen the attack surface by disabling the sandbox.
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Open external links in the OS browser, never in-app, and only for web schemes. A file:
  // URL or a custom protocol-handler URL is dropped, so a hostile link cannot open a local
  // file or launch a registered protocol handler through the window-open path.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    let scheme = ''
    try {
      scheme = new URL(url).protocol
    } catch {
      return { action: 'deny' }
    }
    if (scheme === 'https:' || scheme === 'http:') {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // In development the renderer is served from the Vite dev server; a packaged app loads the
  // bundled file. The env-var override is honoured only when NOT packaged, so a stray
  // ELECTRON_RENDERER_URL in a shipped build cannot turn the window into a remote-content loader.
  const indexHtmlPath = join(__dirname, '../renderer/index.html')
  const devRendererUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

  // Confine in-place navigation to the app's own document. A dragged link or a
  // window.location write cannot navigate the main window to remote content that would then
  // inherit the preload bridge and the daemon-command path; every other target is blocked.
  const allowedNavigationTarget = devRendererUrl ?? pathToFileURL(indexHtmlPath).toString()
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isSameTarget(url, allowedNavigationTarget)) event.preventDefault()
  })

  if (devRendererUrl) {
    mainWindow.loadURL(devRendererUrl)
  } else {
    mainWindow.loadFile(indexHtmlPath)
  }
}

/** True when `url` targets the app's own loaded document. In dev the dev-server origin is
 *  matched (so HMR client navigations pass); a packaged file: document has an opaque origin,
 *  so the exact URL is compared instead. Any parse failure denies. */
function isSameTarget(url: string, allowed: string): boolean {
  try {
    const target = new URL(url)
    const base = new URL(allowed)
    if (base.protocol === 'file:') return target.href === base.href
    return target.origin === base.origin
  } catch {
    return false
  }
}

app.whenReady().then(() => {
  // Deny every renderer permission request by default (camera, microphone, geolocation,
  // notifications, and the rest). The app needs none, so a compromised renderer cannot
  // prompt its way to one.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )

  // Composition root for the pairing IPC channel (#54): construct the real secret chain —
  // safeStorage-backed encryption + file persistence → secure store → paired-server store →
  // fingerprint/confirm service — and register the single invoke handler behind it. The token and
  // server_static_pubkey stay in this background process; only the fingerprint or a value-free
  // reason ever crosses back to the renderer (ADR 0002). `will-quit` removes the handler.
  const secureStore = createSecureStore({
    encryption: electronSecretEncryption(),
    persistence: fileSecretPersistence(join(app.getPath('userData'), 'secrets'))
  })
  const pairedServerStore = createPairedServerStore({ secureStore })
  const confirmation = createPairingConfirmation({ store: pairedServerStore })
  // ipcMain.handle allows one handler per channel — this is the sole registration site, held for
  // the app lifetime.
  const unregisterPairing = registerPairingHandler(ipcMain, {
    parse: parsePairingPayload,
    confirmation
  })
  app.on('will-quit', () => unregisterPairing())

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
