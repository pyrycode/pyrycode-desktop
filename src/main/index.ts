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
import { registerUnpairHandler } from './unpairHandler'
import { registerServerInfoHandler } from './serverInfoHandler'
import { createDeviceKeypairStore } from './deviceKeypair'
import { noiseKeyPairGenerator } from './noiseKeyPairGenerator'
import { createDaemonConnection } from './daemonConnection'
import { createDebugBundleDownload } from './debugBundleDownload'
import { saveDebugBundle } from './saveDebugBundle'
import { emitDaemonEvent } from './emitDaemonEvent'
import { createDiagnosticLog } from './diagnosticLog'
import { fileRotatingSink, stdoutSink } from './diagnosticLogSinks'
import { logSessionStart } from './sessionBanner'
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

  // The unpair request (#173): reuse the same pairedServerStore — do not construct a second store —
  // so the renderer can ask to erase the stored pairing and return to a clean, not-paired state. Its
  // ClearablePairedServerStore.clear() (#172) is fail-closed; the handler maps every throw to a
  // value-free `error`, never reporting success while a live token may remain on disk. Grouped with
  // the pairing-status registration (needs only the store — no `connection`, no did-finish-load
  // gate). No caller races it: the visible unpair UI is #166/#167. `will-quit` removes the handler,
  // symmetric with unregisterPairingStatus.
  const unregisterUnpair = registerUnpairHandler(ipcMain, { store: pairedServerStore })
  app.on('will-quit', () => unregisterUnpair())

  // The paired-server-info query (#339): reuse the same pairedServerStore — do not construct a second
  // store — so a Settings screen (#340/#334) can read the paired server's non-secret identity (its
  // server id + relay URL) from the at-rest record, including while disconnected. Grouped with the
  // pairing-status / unpair registrations (needs only the store — no `connection`, no did-finish-load
  // gate). Only the two non-secret fields cross back — never the token / server_static_pubkey; every
  // non-readable case collapses to a value-free `unavailable`. No caller races it — the consumer is
  // #340. `will-quit` removes the handler, symmetric with unregisterUnpair.
  const unregisterServerInfo = registerServerInfoHandler(ipcMain, { store: pairedServerStore })
  app.on('will-quit', () => unregisterServerInfo())

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
  // The once-per-session diagnostics banner (#132), emitted here so it is seq 0 — the first line of
  // every bundle — attributing the bundle to this client build + wire-protocol identity. `whenReady`
  // runs once per process, so the banner is fire-once; it must NOT be re-emitted from the transport
  // start/reconnect/dial paths (AC3), which is why it lives at the root, not inside the connection.
  logSessionStart(diagnosticLog, app.getVersion())
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

  // The debug-bundle download orchestrator (#169): the sole slice that touches Electron + IPC for
  // this feature. `app.getPath('downloads')` — this slice's one Electron touch — is closed into the
  // saver so saveDebugBundle never imports `app` (#117); the transport/persistence slices stay
  // IPC-free. The orchestrator drives request → reassemble → save and emits progress + one terminal
  // result to the window; it enforces single-in-flight so a spammed command cannot orphan an
  // in-flight download's reassembler slot.
  const downloadsDir = app.getPath('downloads')
  const downloader = createDebugBundleDownload({
    requestDebugBundle: (consumer) => connection.requestDebugBundle(consumer),
    save: (bytes) => saveDebugBundle(downloadsDir, bytes),
    emit: (event) => emitDaemonEvent(mainWindow, event)
  })

  // The single onCommand registration for the app lifetime (#17 deferred this wiring). The command
  // is already validated by isRendererCommand at the boundary; route each member to its entry point.
  // A switch on `type` keeps it grow-ready. Registered once via ipcMain.on (additive) — this sole
  // site is what makes "registering twice does not double-dispatch" true. Inert until a driver
  // exists, so a command arriving before the connect is a safe no-op (send is a no-op with no driver;
  // requestDebugBundle fails its consumer `not-connected`, emitting `debugBundleFailed: unavailable`);
  // no need to gate on did-finish-load. `will-quit` removes the exact listener, symmetric with
  // unregisterPairing.
  const unregisterCommands = onCommand(ipcMain, (command) => {
    switch (command.type) {
      case 'sendMessage':
        connection.send(command.payload)
        return
      case 'requestSnapshot':
        // Direct to the connection method (mirrors sendMessage), no facade — a snapshot has no
        // orchestrator/consumer, unlike requestDebugBundle. Inert no-op when not connected (#180).
        connection.requestSnapshot(command.payload)
        return
      case 'requestConversations':
        // Direct to the connection method (mirrors requestSnapshot), no orchestrator — a list request
        // has no consumer/reassembler. Inert no-op when not connected (#139).
        connection.requestConversations()
        return
      case 'answerModal':
        // Direct to the connection method (mirrors requestSnapshot), no orchestrator. The method
        // mints the answer_token main-side and sends modal_answer. Inert no-op when not connected (#236).
        connection.answerModal(command.payload)
        return
      case 'cancelModal':
        // Direct to the connection method, sends modal_cancel. Inert no-op when not connected (#236).
        connection.cancelModal(command.payload)
        return
      case 'createConversation':
        // Direct to the connection method (mirrors requestSnapshot), no orchestrator — a create request
        // has no consumer/reassembler. Sends create_conversation; the daemon replies with one
        // conversation_created → conversationCreated event. Inert no-op when not connected (#241).
        connection.createConversation(command.payload)
        return
      case 'dequeueMessage':
        // Direct to the connection method (mirrors requestSnapshot), no orchestrator — a dequeue is
        // ungated fire-and-forget. Sends dequeue_message; no reply is expected (the daemon re-broadcasts
        // its queue_state as the observable effect, #294). Inert no-op when not connected (#300).
        connection.dequeueMessage(command.payload)
        return
      case 'interrupt':
        // Direct to the connection method (mirrors requestConversations), no orchestrator — a bare
        // fire-and-forget stop-the-turn frame. No reply is expected (the turn stops via the ordinary
        // turn_end / turn_state{idle} events). Inert no-op when not connected (#306).
        connection.interrupt()
        return
      case 'promoteConversation':
        // Direct to the connection method (mirrors createConversation), no orchestrator — a promote
        // request has no consumer/reassembler. Sends promote_conversation; the daemon confirms with one
        // unsolicited conversation_updated broadcast → conversationUpdated event (consumed by #275).
        // Inert no-op when not connected (#273).
        connection.promoteConversation(command.payload)
        return
      case 'archiveConversation':
        // Direct to the connection method (mirrors unarchiveConversation), no orchestrator — a fire-and-
        // forget request has no consumer/reassembler. Sends archive_conversation; the daemon confirms by
        // replying with a conversation_updated record, decoded by the existing path and reflected in the
        // list by #275 (consumed by #366), not correlated here. Inert no-op when not connected (#363).
        connection.archiveConversation(command.payload)
        return
      case 'unarchiveConversation':
        // Direct to the connection method (mirrors promoteConversation), no orchestrator — a fire-and-
        // forget request has no consumer/reassembler. Sends unarchive_conversation; the daemon confirms by
        // replying with a conversation_updated record, not correlated here (#348 reads restored state from
        // the re-list). Inert no-op when not connected (#346).
        connection.unarchiveConversation(command.payload)
        return
      case 'deleteConversation':
        // Direct to the connection method (mirrors unarchiveConversation), no orchestrator — a fire-and-
        // forget request has no consumer/reassembler. Sends delete_conversation; the daemon replies with a
        // distinct conversation_deleted { id } record correlated to the requester (no broadcast), NOT
        // decoded or correlated here — #367 owns the reply decode + explicit re-list. Inert no-op when not
        // connected (#364).
        connection.deleteConversation(command.payload)
        return
      case 'renameConversation':
        // Direct to the connection method (mirrors unarchiveConversation), no orchestrator — a fire-and-
        // forget request has no consumer/reassembler. Sends rename_conversation; the daemon confirms by
        // replying with a conversation_updated record, decoded by the existing path and reflected in the
        // list by #275 (consumed by #360), not correlated here. Inert no-op when not connected (#359).
        connection.renameConversation(command.payload)
        return
      case 'changeWorkspace':
        // Direct to the connection method (mirrors renameConversation), no orchestrator — a fire-and-
        // forget request has no consumer/reassembler. Sends change_workspace; the daemon confirms by
        // replying with the existing conversation_updated record, decoded by the existing path and
        // reflected in the list for free, not correlated here (the Workspace Picker reads the new
        // workspace from the re-list). Inert no-op when not connected (#379).
        connection.changeWorkspace(command.payload)
        return
      case 'setSessionSettings':
        // Direct to the connection method (mirrors requestSnapshot), no orchestrator. Sends
        // set_session_settings; the daemon replies with one session_settings_updated (decoded by #264,
        // correlated by #261). The renderer-minted `changeId` rides through so main can match the reply
        // back to this change (never onto the wire). Inert no-op when not connected (#263).
        connection.setSessionSettings(command.payload, command.changeId)
        return
      case 'requestDebugBundle':
        downloader.request()
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
