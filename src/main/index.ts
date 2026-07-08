import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { hostname } from 'os'
import { createSecureStore } from './secureStore'
import { electronSecretEncryption } from './electronSecretEncryption'
import { selectSecretEncryption } from './secretBackend'
import { fileSecretPersistence } from './fileSecretPersistence'
import { createPairedServerStore } from './pairedServerStore'
import { createPairingConfirmation } from './pairingConfirmation'
import { parsePairingPayload } from './pairingPayload'
import { selectRelayPolicy } from './relayPolicy'
import { registerPairingHandler } from './pairingHandler'
import { registerPairingStatusHandler } from './pairingStatusHandler'
import { createDeviceKeypairStore } from './deviceKeypair'
import { noiseKeyPairGenerator } from './noiseKeyPairGenerator'
import { createDaemonConnection } from './daemonConnection'
import { createDiagnosticLog } from './diagnosticLog'
import { fileRotatingSink, stdoutSink } from './diagnosticLogSinks'
import { onCommand } from './receiveCommand'
import { onDiagnostic } from './receiveDiagnostic'

// The relay socket, the Noise_IK handshake, the frame codec, and event parsing
// all live in this background process. See docs/knowledge/decisions/0001. The
// renderer receives already-typed events over IPC and never sees raw bytes or keys.

function createWindow(): BrowserWindow {
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

  return mainWindow
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
  // fingerprint/confirm service. The invoke handler behind it is registered further down, after the
  // daemon connection exists, so a successful confirm can trigger the connect-on-pair dial (#82).
  // The token and server_static_pubkey stay in this background process; only the fingerprint or a
  // value-free reason ever crosses back to the renderer (ADR 0002).
  // The secret-encryption backend the store uses (#99). Effectful choice made ONCE, here, false-first
  // on app.isPackaged: a packaged build never consults the env flag and always gets the real, fail-
  // closed OS-keychain backend, byte-identical to today. Only when unpackaged AND
  // PYRY_TEST_SECRET_BACKEND=1 is a keychain-free backend selected — the headless test/dev seam #93
  // drives so secureStore.set stops failing closed with no keychain. `electronSecretEncryption` is
  // passed UNCALLED (a `() => SecretEncryption` factory), so it is constructed only when selected —
  // the keychain-free dev path never loads it. `process.env` structurally satisfies the
  // `Record<string, string | undefined>` param (no cast). Mirrors the #97 selectRelayPolicy call below.
  const secureStore = createSecureStore({
    encryption: selectSecretEncryption({
      isPackaged: app.isPackaged,
      env: process.env,
      real: electronSecretEncryption
    }),
    persistence: fileSecretPersistence(join(app.getPath('userData'), 'secrets'))
  })
  const pairedServerStore = createPairedServerStore({ secureStore })
  const confirmation = createPairingConfirmation({ store: pairedServerStore })

  // The launch-time pairing-status query (#79): reuse the same pairedServerStore — do not construct
  // a second store — so the renderer can learn before first paint whether a pairing exists (#80),
  // without inferring it from a late, error-shaped connection event. Registered synchronously here,
  // before createWindow() and the renderer document load, so the handler is present when the
  // renderer's first invoke arrives. Only the value-free enum crosses back — never a record field.
  // `will-quit` removes the handler, symmetric with unregisterPairing.
  const unregisterPairingStatus = registerPairingStatusHandler(ipcMain, { store: pairedServerStore })
  app.on('will-quit', () => unregisterPairingStatus())

  // The transport consumer (#62): reuse the paired-server store, add a device-keypair store over
  // the same secret chain, and drive the Noise relay driver — emitting typed daemon events to the
  // window. Keys, the token, and raw frames stay in this process; only the typed event crosses.
  const deviceKeypairStore = createDeviceKeypairStore({
    secureStore,
    generator: noiseKeyPairGenerator()
  })
  const mainWindow = createWindow()
  // The one content-free diagnostic logger (#126). Effectful sink chosen ONCE, here, false-first on
  // app.isPackaged: a packaged build rotates records under userData/logs; dev writes JSON lines to
  // stdout. Constructed at the root and injected so #127 (relay leg) and #128 (daemon leg) consume
  // the SAME instance — one seq counter, one file — without depending on each other. The module is
  // Electron-free; the app.isPackaged / getPath selection is the only Electron touch.
  const diagnosticLog = createDiagnosticLog({
    sink: app.isPackaged ? fileRotatingSink(join(app.getPath('userData'), 'logs')) : stdoutSink()
  })
  const connection = createDaemonConnection({
    deviceKeypair: deviceKeypairStore,
    pairedServer: pairedServerStore,
    sink: mainWindow,
    deviceName: hostname(),
    clientVersion: app.getVersion(),
    diagnosticLog
  })

  // The pairing invoke handler (#54), registered now that `connection` exists so a successful
  // confirm can dial the just-persisted pairing with no manual step (#82). ipcMain.handle allows
  // one handler per channel — this is the sole registration site, held for the app lifetime.
  // `onPaired` fires only after a confirm persists the record; `reconnect()` is synchronous, void,
  // and non-throwing (it bumps a fence, stops any live driver, and emits into the must-not-throw
  // sink), so it satisfies onPaired's must-not-throw contract. Registering here is safe: the whole
  // whenReady callback runs to completion in one tick, while an operator-driven pairing invoke
  // (paste + click) arrives many ticks later, after first paint — well after this handler is up.
  // The relay policy the pairing gate runs (#97). Effectful choice made ONCE, here, false-first on
  // app.isPackaged: a packaged build never consults the env flag and dials `wss:` + allowlist only,
  // byte-identical to today. Only when unpackaged AND PYRY_ALLOW_LOOPBACK_RELAY=1 is a loopback `ws://`
  // relay accepted — the test/dev seam #93 drives at the in-process fake relay. `process.env`
  // structurally satisfies the `Record<string, string | undefined>` param (no cast). Mirrors the
  // `app.isPackaged ? … : process.env[…]` renderer-URL idiom above.
  const relayPolicy = selectRelayPolicy({ isPackaged: app.isPackaged, env: process.env })
  const unregisterPairing = registerPairingHandler(ipcMain, {
    parse: (pasted) => parsePairingPayload(pasted, relayPolicy),
    confirmation,
    onPaired: () => connection.reconnect()
  })
  app.on('will-quit', () => unregisterPairing())

  // Defer the connect until the renderer document + scripts have loaded, so its daemon-event
  // subscription (#19) is in place before the load-bearing `connected` event (which arrives only
  // after a network round-trip). `.once`, not `.on`, so a dev HMR reload does not re-fire it.
  mainWindow.webContents.once('did-finish-load', () => connection.start())
  app.on('will-quit', () => connection.stop())

  // The single onCommand registration for the app lifetime (#17 deferred this wiring). The command
  // is already validated by isRendererCommand at the boundary; route its payload to the send entry
  // point. A switch on `type` (single member today) keeps it grow-ready. Registered once via
  // ipcMain.on (additive) — this sole site is what makes "registering twice does not double-
  // dispatch" true. Inert until a driver exists, so a command arriving before the connect is a safe
  // no-op; no need to gate on did-finish-load. `will-quit` removes the exact listener, symmetric
  // with unregisterPairing.
  const unregisterCommands = onCommand(ipcMain, (command) => {
    switch (command.type) {
      case 'sendMessage':
        connection.send(command.payload)
        return
    }
  })
  app.on('will-quit', () => unregisterCommands())

  // The single onDiagnostic registration for the app lifetime (#131). Forwards content-free
  // diagnostic records from the renderer (state store #134, later the render layer) into the SAME
  // diagnosticLog instance constructed above — one seq counter, one file — so renderer-side faults
  // land in the same debug bundle as the transport logs. The main-side projection re-validates at
  // the untrusted boundary; a non-allowlisted field never reaches the logger's spread. Registered
  // once via ipcMain.on (additive); inert until #134 emits — a record arriving before any consumer
  // is simply a logged line. `will-quit` removes the exact listener, symmetric with unregisterCommands.
  const unregisterDiagnostics = onDiagnostic(ipcMain, diagnosticLog)
  app.on('will-quit', () => unregisterDiagnostics())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
