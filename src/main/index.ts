import { app, BrowserWindow, dialog, ipcMain, Notification, session, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { hostname } from 'os'
import { createSecureStore } from './secureStore'
import { electronSecretEncryption } from './electronSecretEncryption'
import { selectSecretEncryption } from './secretBackend'
import { fileSecretPersistence } from './fileSecretPersistence'
import { createPairedServerStore } from './pairedServerStore'
import { createHostLabelStore } from './hostLabelStore'
import { createPairingConfirmation } from './pairingConfirmation'
import { parsePairingPayload } from './pairingPayload'
import { selectRelayPolicy } from './relayPolicy'
import { registerPairingHandler } from './pairingHandler'
import { registerPairingStatusHandler } from './pairingStatusHandler'
import { registerUnpairHandler } from './unpairHandler'
import { registerServerInfoHandler } from './serverInfoHandler'
import { registerHostLabelHandler } from './hostLabelHandler'
import { createDeviceKeypairStore } from './deviceKeypair'
import { noiseKeyPairGenerator } from './noiseKeyPairGenerator'
import { createDaemonConnection } from './daemonConnection'
import { createDebugBundleDownload } from './debugBundleDownload'
import { saveDebugBundle } from './saveDebugBundle'
import { emitDaemonEvent } from './emitDaemonEvent'
import { createLiveWindow } from './liveWindow'
import { fireNotification, activateWindow, windowHasFocus } from './fireNotification'
import { createDiagnosticLog } from './diagnosticLog'
import { fileRotatingSink, stdoutSink } from './diagnosticLogSinks'
import { logSessionStart } from './sessionBanner'
import { onCommand } from './receiveCommand'
import { onDiagnostic } from './receiveDiagnostic'
import { uploadAttachmentFile, type AttachmentUploadDeps } from './attachmentUpload'
import { createAttachmentRetrieval } from './attachmentRetrieval'
import { ATTACHMENT_DIR_NAME, storeAttachment } from './attachmentStore'
import {
  ATTACHMENT_UPLOAD_CHANNEL,
  ATTACHMENT_UPLOAD_EVENT_CHANNEL,
  isAttachmentUploadRequest
} from '../shared/ipc/attachmentUpload'
import {
  ATTACHMENT_RETRIEVAL_CHANNEL,
  ATTACHMENT_RETRIEVAL_EVENT_CHANNEL,
  isAttachmentRetrievalRequest
} from '../shared/ipc/attachmentRetrieval'
import { createAttachmentSave } from './attachmentSave'
import { createAttachmentBytes } from './attachmentBytes'
import { ATTACHMENT_OPEN_DIR_NAME, createAttachmentOpen } from './attachmentOpen'
import {
  ATTACHMENT_SAVE_CHANNEL,
  ATTACHMENT_SAVE_EVENT_CHANNEL,
  isAttachmentSaveRequest
} from '../shared/ipc/attachmentSave'
import {
  ATTACHMENT_BYTES_CHANNEL,
  ATTACHMENT_BYTES_EVENT_CHANNEL,
  isAttachmentBytesRequest
} from '../shared/ipc/attachmentBytes'
import {
  ATTACHMENT_OPEN_CHANNEL,
  ATTACHMENT_OPEN_EVENT_CHANNEL,
  isAttachmentOpenRequest
} from '../shared/ipc/attachmentOpen'

// The relay socket, the Noise_IK handshake, the frame codec, and event parsing
// all live in this background process. See docs/knowledge/decisions/0001. The
// renderer receives already-typed events over IPC and never sees raw bytes or keys.

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    // #670: the two-pane shell's floor. The sidebar is a fixed 400px, so below this the chat pane is
    // squeezed to nothing; 800 leaves it 340px (800 − 20 gutter − 400 sidebar − 20 gap − 20 gutter).
    // Width only — the ticket sets no height floor.
    minWidth: 800,
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
  // Deny every renderer permission request except the one the app actually needs (camera, microphone,
  // geolocation, notifications, and the rest stay denied). A compromised renderer cannot prompt its way
  // to anything not on this list.
  //
  // #969 opened the list, which until then was empty. Electron routes `navigator.clipboard.writeText`
  // through this handler as `clipboard-sanitized-write`, so the message bubble's copy control was
  // silently a no-op under the blanket deny — MEASURED, not assumed: e2e/message-copy.spec.ts wrote a
  // sentinel, clicked the control, and read the OS clipboard back through the main process to find the
  // sentinel still there. That spec is now the regression guard for this line.
  //
  // AN ALLOWLIST OF EXACTLY ONE STRING, and deliberately not a denylist: a denylist would grant every
  // permission Chromium adds in a future version by default, which is the opposite of the posture this
  // handler exists to hold. Two things it must never grow into. It must not cover `clipboard-read` or
  // `clipboard-sanitized-read` — reading is a categorically worse capability than writing, since it
  // exfiltrates whatever the user last copied (routinely a password-manager secret), and nothing in
  // this app needs it. And it must not become a general "allow what the renderer asks for".
  //
  // Granting rather than routing the write through IPC is the narrower change, not the looser one: an
  // ipcMain handler that writes the clipboard on the renderer's behalf grants the SAME capability
  // through more code, and adds a channel that has to be validated. The marginal risk here is small —
  // a renderer compromised badly enough to reach this already holds the `window.pyry` bridge, which
  // sends to the daemon and unpairs. `clipboard-sanitized-write` is text/plain only, so no HTML flavour
  // reaches the clipboard either.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write')
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
  // The host label the operator types at pairing time (#822, wired here by #823): reuse the SAME
  // secureStore — do not construct a second one — and pass NO `name` override, so the label stays
  // under the fixed HOST_LABEL_NAME, distinct from `pyrycode.paired_server` and
  // `pyrycode.device_static`. The label is only ever a VALUE handed to `save`, never a persistence
  // key, so no caller-supplied string can reach the store name. The pairing handler below receives
  // only this store's `save`, so it can neither read the label back nor erase it; the read path is
  // the host-label handler registered below, which gets a `load`-only handle; and the unpair handler
  // gets a `clear`-only one. Three seams over one store, three disjoint `Pick`s, none able to do
  // another's job.
  const hostLabelStore = createHostLabelStore({ secureStore })

  // The launch-time pairing-status query (#79): reuse the same pairedServerStore — do not construct
  // a second store — so the renderer can learn before first paint whether a pairing exists (#80),
  // without inferring it from a late, error-shaped connection event. Registered synchronously here,
  // before createWindow() and the renderer document load, so the handler is present when the
  // renderer's first invoke arrives. Only the value-free enum crosses back — never a record field.
  // `will-quit` removes the handler, symmetric with unregisterPairing.
  const unregisterPairingStatus = registerPairingStatusHandler(ipcMain, { store: pairedServerStore })
  app.on('will-quit', () => unregisterPairingStatus())

  // The paired-server-info query (#339): reuse the same pairedServerStore — do not construct a second
  // store — so a Settings screen (#340/#334) can read the paired server's non-secret identity (its
  // server id + relay URL) from the at-rest record, including while disconnected. Grouped with the
  // pairing-status registration (needs only the store — no `connection`, no did-finish-load gate;
  // the unpair handler left this group in #504, which gave it a `connection` dependency). Only the
  // two non-secret fields cross back — never the token / server_static_pubkey; every non-readable
  // case collapses to a value-free `unavailable`. No caller races it — the consumer is #340.
  // `will-quit` removes the handler, symmetric with unregisterPairingStatus.
  const unregisterServerInfo = registerServerInfoHandler(ipcMain, { store: pairedServerStore })
  app.on('will-quit', () => unregisterServerInfo())

  // The stored-host-label query (#824): reuse the SAME hostLabelStore constructed above — do not
  // build a second store — so a surface can render the host's own name (#826) from at-rest state,
  // including while disconnected. Grouped with the two registrations above (needs only a store — no
  // `connection`, no did-finish-load gate). The handler gets a `load`-only handle, so this read
  // channel structurally cannot overwrite or erase the label. Only the three-outcome union crosses
  // back — never the token / server key / keychain path, and never a truncated label; never-stored
  // and unreadable stay distinct. The erase path is the unpair handler below (#827), holding the
  // third, `clear`-only handle. No caller races it — the consumer is #826. `will-quit` removes the
  // handler, symmetric with unregisterServerInfo.
  const unregisterHostLabel = registerHostLabelHandler(ipcMain, { store: hostLabelStore })
  app.on('will-quit', () => unregisterHostLabel())

  // The transport consumer (#62): reuse the paired-server store, add a device-keypair store over
  // the same secret chain, and drive the Noise relay driver — emitting typed daemon events to the
  // window. Keys, the token, and raw frames stay in this process; only the typed event crosses.
  const deviceKeypairStore = createDeviceKeypairStore({
    secureStore,
    generator: noiseKeyPairGenerator()
  })
  // The live-window holder (#519), constructed before the connection because the connection captures
  // its sink for the process lifetime. It replaces the single captured `const mainWindow =
  // createWindow()` this line used to hold: on macOS the app outlives its window and the connection
  // keeps running, so a captured reference goes stale the moment the window is closed and every
  // window-bound call quietly reaches the destroyed original instead of the dock-reopened
  // replacement. After this line no BrowserWindow reference survives in this scope at all — the only
  // `mainWindow` binding left in the file is createWindow's own local — so there is nothing left that
  // CAN go stale. Window creation moves down to `openWindow` below, which needs `connection`.
  const live = createLiveWindow()
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
    sink: live.sink,
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
    onPaired: () => connection.reconnect(),
    hostLabel: hostLabelStore
  })
  app.on('will-quit', () => unregisterPairing())

  // The unpair request (#173): reuse the same pairedServerStore — do not construct a second store —
  // so the renderer can ask to erase the stored pairing and return to a clean, not-paired state. Its
  // ClearablePairedServerStore.clear() (#172) is fail-closed; the handler maps every throw to a
  // value-free `error`, never reporting success while a live token may remain on disk. Registered
  // here, below `connection` and beside the pairing handler, because #504 gave it the mirror-image
  // dependency: `onUnpaired` fires only after the erase succeeds and tears the live daemon session
  // down, so an authenticated session can never outlive the record that authorised it. The same
  // `reconnect()` — synchronous, void, non-throwing — serves both callbacks; with the record gone it
  // stops the driver, fences its in-flight events, and settles at failed(not-paired) without
  // constructing a replacement. It never sets the permanent `stopped` flag, so a later re-pair still
  // connects. Registering this late is safe for the same reason the pairing handler is (above): the
  // whole whenReady callback runs to completion in one tick, and no caller races it — the visible
  // unpair UI is #166/#167, many ticks later, after first paint. `will-quit` removes the handler,
  // symmetric with unregisterPairing.
  // #827 adds the label erase here: reuse the SAME hostLabelStore constructed above — do not build a
  // second store — so unpairing takes the host's name with it rather than leaving it to describe a
  // record that no longer exists. A `clear`-only handle, so this handler can neither read the label
  // back nor overwrite it. The erase is ordered after the record's and outside the fail-closed catch,
  // and a failure to erase it still resolves `ok`: the result reports on the RECORD, and by then the
  // record is gone — see the listener's comment for the full argument.
  const unregisterUnpair = registerUnpairHandler(ipcMain, {
    store: pairedServerStore,
    onUnpaired: () => connection.reconnect(),
    hostLabel: hostLabelStore
  })
  app.on('will-quit', () => unregisterUnpair())

  // Every window this app opens goes through here (#519): the first one below, and each dock-reopened
  // replacement from the `activate` handler at the bottom. The two halves of #519 meet in this one
  // function — routing (make the new window the live target) and convergence (bring it up to date).
  //
  // Attached at CREATION, not at load: between here and did-finish-load the new window is already the
  // current one, so a notification click landing in that gap activates it. Daemon events arriving in
  // the gap are forwarded into a renderer that has not subscribed yet and are dropped there —
  // identical to the pre-existing behaviour of the very first window, and the reason the connect
  // waits for the load in the first place. Status is not among the losses: replayStatus() runs at the
  // load. (Recovering the non-status events dropped while no window existed is explicitly out of
  // scope; the seam for it, when a ticket is filed, is replayStatus().)
  const openWindow = (): void => {
    const window = createWindow()
    live.attach(window)
    // Defer the connect until the renderer document + scripts have loaded, so its daemon-event
    // subscription (#19) is in place before the load-bearing `connected` event (which arrives only
    // after a network round-trip). ONE uniform path per window, with no "is this the first one?"
    // branch: the first window has nothing recorded and dials, while a reopened window replays the
    // live connection's status and start() returns at daemonConnection.ts:1479. The replay is what
    // makes AC2 work — connection state reaches the renderer only as discrete events and a fresh
    // session store starts at `{ type: 'disconnected' }`, so on a stable connection a merely
    // subscribed window would sit at "disconnected" while this process holds a healthy session.
    // `reconnect()` is deliberately NOT called here (AC4): it tears the session down and re-dials,
    // which would kill an in-flight turn. `start()` is the idempotent one.
    // `.on`, not the `.once` this used to be: the listener is registered per window on a fresh
    // webContents, so the dev-HMR-reload concern `.once` guarded against is now answered by start()'s
    // proven idempotence instead — and `.on` additionally converges a window that reloads (HMR, or
    // Cmd-R via the default View menu), whose renderer store is just as empty as a new window's.
    window.webContents.on('did-finish-load', () => {
      live.replayStatus()
      connection.start()
    })
  }
  openWindow()
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
    emit: (event) => emitDaemonEvent(live.sink, event)
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
      case 'requestSessionSettings':
        // Direct to the connection method (mirrors sendMessage), no facade — a run-config read
        // has no orchestrator/consumer. The optional conversation id is unwrapped here rather than
        // passing the payload object on: the connection takes the scalar, and the builder rebuilds a
        // fresh literal, so no renderer-supplied key reaches the wire (#945).
        connection.requestSessionSettings(command.payload?.conversation_id)
        return
      case 'requestConversations':
        // Direct to the connection method (mirrors sendMessage), no orchestrator — a list request
        // has no consumer/reassembler. Inert no-op when not connected (#139).
        connection.requestConversations()
        return
      case 'requestRecentWorkspaces':
        // Direct to the connection method (mirrors requestConversations), no orchestrator — a bare
        // recent-workspaces request has no consumer/reassembler. Sends recent_workspaces; the daemon
        // replies with one recent_workspaces_list → recentWorkspacesReceived event (consumed by #382).
        // Inert no-op when not connected (#380).
        connection.requestRecentWorkspaces()
        return
      case 'answerModal':
        // Direct to the connection method (mirrors sendMessage), no orchestrator. The method
        // mints the answer_token main-side and sends modal_answer. Inert no-op when not connected (#236).
        connection.answerModal(command.payload)
        return
      case 'cancelModal':
        // Direct to the connection method, sends modal_cancel. Inert no-op when not connected (#236).
        connection.cancelModal(command.payload)
        return
      case 'answerQuestions':
        // Direct to the connection method (mirrors answerModal), no orchestrator. The method mints the
        // answer_token main-side and sends question_answer. No reply is correlated — the daemon emits
        // nothing for a rejected question answer. Inert no-op when not connected (#920).
        connection.answerQuestions(command.payload)
        return
      case 'refuseQuestions':
        // Direct to the connection method, sends question_refused. It mints a token too, unlike the
        // cancelModal it otherwise mirrors. Inert no-op when not connected (#920).
        connection.refuseQuestions(command.payload)
        return
      case 'createConversation':
        // Direct to the connection method (mirrors sendMessage), no orchestrator — a create request
        // has no consumer/reassembler. Sends create_conversation; the daemon replies with one
        // conversation_created → conversationCreated event. Inert no-op when not connected (#241).
        connection.createConversation(command.payload)
        return
      case 'createWorkspaceFolder':
        // Direct to the connection method (mirrors createConversation), no orchestrator — a create-folder
        // request has no consumer/reassembler. Sends create_workspace_folder; the daemon replies with one
        // workspace_folder_created → workspaceFolderCreated event (consumed by #157). Inert no-op when not
        // connected (#381).
        connection.createWorkspaceFolder(command.payload)
        return
      case 'dequeueMessage':
        // Direct to the connection method (mirrors sendMessage), no orchestrator — a dequeue is
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
        // Direct to the connection method (mirrors sendMessage), no orchestrator. Sends
        // set_session_settings; the daemon replies with one session_settings_updated (decoded by #264,
        // correlated by #261). The renderer-minted `changeId` rides through so main can match the reply
        // back to this change (never onto the wire). Inert no-op when not connected (#263).
        connection.setSessionSettings(command.payload, command.changeId)
        return
      case 'requestDebugBundle':
        downloader.request()
        return
      case 'notify':
        // Main-local side effect, no connection method: raise an OS notification only when the window
        // is unfocused. Focus is queried at fire-time (one synchronous isFocused(), no stateful
        // tracker); the kind→copy mapping is owned by the module, so no command field supplies text.
        // Live since #392 shipped (pushNotifyBridge.ts sends it). The click path is reachable in one
        // sequence: a notification raised while the window is open but unfocused, the window then
        // closed, the notification clicked afterwards. The focus query with no window at all stays
        // effectively unreachable, since the producer is a renderer bridge that cannot run without a
        // window. Closes the live-window faces and Electron's Notification, exactly as the root closes
        // downloadsDir into saveDebugBundle.
        // #393: the click is composed HERE (the sole composition site) — on click, activate the window
        // (AC1) and emit the nullary notificationActivated event (AC2/AC3) so the renderer navigates to
        // the thread.
        // #518: all three window touches in this closure are destroyed-safe — the guard lives in
        // each callee (windowHasFocus, activateWindow, emitDaemonEvent), so a `notify` arriving after
        // the window is closed is a no-op rather than an uncaught exception.
        // #519: they now point at whichever window is CURRENT, so a click after a dock reopen
        // activates the new window instead of no-oping on the destroyed original. `live.window`
        // satisfies FocusableWindow + ActivatableWindow and answers isDestroyed() honestly, which is
        // what keeps the no-window case the total no-op #518 made it (creating a window from a click
        // is out of scope); the paired emit rides the same sink as every other event.
        fireNotification(command.payload.kind, {
          isWindowFocused: () => windowHasFocus(live.window),
          Notification,
          onClick: () => {
            activateWindow(live.window)
            emitDaemonEvent(live.sink, { type: 'notificationActivated' })
          }
        })
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

  // The attach flow's composition-root edge (#862) — the ONE Electron touch the feature needs, and
  // the reason it is here rather than in attachmentUpload.ts, which stays Electron-free and
  // unit-testable on either side of this seam.
  //
  // Registered on its OWN channel pair, not on the command/daemon-event channels: the outcome must
  // carry more than one message per intent, which an invoke reply cannot express, and a new
  // DaemonEvent member would be a compile-forced edit in four renderer bridges that each end their
  // switch in assertNever. That "more than one" is live as of #864 — a transfer over
  // ATTACHMENT_PROGRESS_MIN_CHUNKS pushes a report per chunk ahead of its terminal.
  //
  // TWO ENTRIES, ONE LISTENER, TOLD APART BY PRESENCE (#890). An argument-free send is #862's bare
  // intent: the renderer names an intent and nothing else, so that arm still reaches no untrusted
  // request field and no renderer-supplied string can get near a path, a declared filename or the wire.
  // A send CARRYING a request is a dropped file, and its path is untrusted at this boundary regardless
  // of the declared type — `isAttachmentUploadRequest` is the guard the header promised when the door
  // was left value-free, and a failing ask is DROPPED: no filesystem call, no event, matching every
  // sibling attachment channel. Nothing an operator can physically do produces one, so there is nothing
  // to report. Presence rather than a discriminator field, because the shipped picker sender cannot be
  // given one without changing what a conforming renderer puts on the wire.
  //
  // The path is a CLAIM, NOT A CAPABILITY, which is what makes the drop arm safe to have at all: the
  // background process does not trust that the path names what the window says it does, it OPENS it —
  // `readChosenFile` refuses anything that is not a regular file (so a dropped FOLDER answers the
  // `unreadable` this flow already produces) and drops the errno unexamined because it carries the host
  // path. The containment property lives in the preload: `webUtils.getPathForFile` answers the empty
  // string for a page-constructed File, so only a file an operator gesture delivered is backed by a path.
  //
  // `event.sender` — the window that asked — is closed into `emit`, so the answer goes back to the
  // asker rather than to a process-lifetime reference that #519 would have to keep current. The
  // isDestroyed() guard is emitDaemonEvent's (#518): a window closed mid-upload drops the outcome
  // instead of throwing, the same loss the daemon-event channel already takes in that gap. It cannot
  // route through `live.sink`, whose send re-supplies DAEMON_EVENT_CHANNEL and ignores the channel
  // it is given.
  //
  // One picker at a time (debugBundleDownload's single-in-flight posture), scoped to the DIALOG and
  // cleared as soon as it settles — so a double-clicked button cannot stack pickers, while a second
  // file may still be picked while the first uploads (two concurrent transfers, distinct ids).
  //
  // `pickerOpen` STAYS SCOPED TO THE DIALOG and the drop arm neither reads nor sets it (#890): a drop
  // opens no dialog, so gating it on that flag would refuse a legitimate second file for a reason that
  // does not apply to it. Repetition on the drop arm is therefore unbounded here by design — it is
  // bounded by the per-upload byte guard below and, host-side, by the daemon's own concurrency answer
  // (`attachment-too-many-uploads`, which arrives as a `failed`). A client-side concurrency cap belongs
  // with that bound rather than here.
  //
  // The bare `void` is safe because uploadAttachmentFile never rejects — a property of that module
  // and of connection.uploadAttachment, not of a `.catch()` anyone must remember (AC4).
  let pickerOpen = false
  const attachmentUploadListener = (event: Electron.IpcMainEvent, request?: unknown): void => {
    const sender = event.sender
    // ONE deps object for both entries rather than one per arm: the two must not be able to drift into
    // reporting on different channels or forwarding progress differently. `sender` — the window that
    // asked — is closed in, and the isDestroyed() guard is emitDaemonEvent's (#518).
    const deps: AttachmentUploadDeps = {
      // The progress seam is forwarded, never swallowed: the flow module owns the threshold that
      // decides whether a report becomes a message, and this arrow owns nothing but the join.
      upload: (input, onProgress) => connection.uploadAttachment(input, onProgress),
      emit: (uploadEvent) => {
        if (sender.isDestroyed()) return
        sender.send(ATTACHMENT_UPLOAD_EVENT_CHANNEL, uploadEvent)
      },
      diagnosticLog
    }

    // The DROPPED-FILE arm (#890). `request !== undefined` is the whole discriminator, and the guard
    // decides the rest: a malformed ask returns here, having made no filesystem call and emitted no
    // event.
    if (request !== undefined) {
      if (!isAttachmentUploadRequest(request)) return
      void uploadAttachmentFile(request.path, deps)
      return
    }

    // The PICKER arm (#862), unchanged.
    if (pickerOpen) return
    pickerOpen = true
    void dialog
      .showOpenDialog({ properties: ['openFile'] })
      .then((choice) => {
        // Cancelling is a TOTAL no-op: nothing read, nothing sent, no outcome reported (AC1).
        if (choice.canceled || choice.filePaths.length === 0) return
        void uploadAttachmentFile(choice.filePaths[0], deps)
      })
      .finally(() => {
        pickerOpen = false
      })
  }
  ipcMain.on(ATTACHMENT_UPLOAD_CHANNEL, attachmentUploadListener)
  app.on('will-quit', () => ipcMain.removeListener(ATTACHMENT_UPLOAD_CHANNEL, attachmentUploadListener))

  // The retrieval flow's composition-root edge (#996) — the mirror image of the attach edge above,
  // and the ONE place the attachment directory is named. `app.getPath('userData')` is this slice's
  // only Electron touch: ATTACHMENT_DIR_NAME is joined onto it HERE and closed into the store, so
  // attachmentStore.ts stays Electron-free and unit-testable (the downloadsDir / saveDebugBundle seam),
  // and no path is ever derived from anything the window sent.
  //
  // Registered on its OWN channel pair for the upload leg's reason: the outcome must not reach the
  // daemon-event bridges, and a new DaemonEvent member would be a compile-forced edit in four renderer
  // bridges that each end their switch in assertNever, for four no-op arms.
  // ONE driver for the app lifetime, not one per ask: its concurrency cap and its coalescing are
  // state that only means anything ACROSS asks, so rebuilding it per ask would silently disable both.
  const attachmentDir = join(app.getPath('userData'), ATTACHMENT_DIR_NAME)
  const retrieveAttachment = createAttachmentRetrieval({
    requestAttachment: (payload, consumer) => connection.requestAttachment(payload, consumer),
    store: (attachmentId, bytes) => storeAttachment(attachmentDir, attachmentId, bytes),
    diagnosticLog
  })

  // UNLIKE THE ATTACH LISTENER, THIS ONE READS ITS IPC ARGUMENT, so it owes the boundary check the
  // bare intent above does not: two identifiers arrive from an untrusted renderer. A malformed ask is
  // DROPPED — no request frame, no filesystem call, no event — the isRendererCommand / onCommand
  // posture, and the only sound answer when there is no identifier to address a reply to.
  //
  // `event.sender` — the window that asked — is passed PER ASK rather than closed in at construction,
  // which is what lets one process-lifetime driver still answer the right window; the driver holds it
  // with the in-flight entry. The isDestroyed() guard is the upload edge's: a window closed
  // mid-retrieval drops the outcome instead of throwing. It cannot route through `live.sink`, whose
  // send re-supplies DAEMON_EVENT_CHANNEL and ignores the channel it is given.
  const attachmentRetrievalListener = (event: Electron.IpcMainEvent, request: unknown): void => {
    if (!isAttachmentRetrievalRequest(request)) return
    const sender = event.sender
    retrieveAttachment(request, (retrievalEvent) => {
      if (sender.isDestroyed()) return
      sender.send(ATTACHMENT_RETRIEVAL_EVENT_CHANNEL, retrievalEvent)
    })
  }
  ipcMain.on(ATTACHMENT_RETRIEVAL_CHANNEL, attachmentRetrievalListener)
  app.on('will-quit', () =>
    ipcMain.removeListener(ATTACHMENT_RETRIEVAL_CHANNEL, attachmentRetrievalListener)
  )

  // The save-to-Downloads edge (#814) — the consumer of what the retrieval edge above puts on this
  // machine. It ADDS NO Electron path call: `downloadsDir` is the one already read for the debug bundle
  // and `attachmentDir` the one already joined for the retrieval store, so the two directories the copy
  // is confined between are named once each in this file and never derived from anything the window
  // sent. Its own Electron touch is the reveal — `shell.showItemInFolder`, which SELECTS the file;
  // `shell.openPath` would open the folder without selecting it and does not satisfy AC4. Closing both
  // in here is what keeps attachmentSave.ts Electron-free and unit-testable against a temp dir.
  //
  // setWindowOpenHandler's `file:` deny is deliberately UNTOUCHED, and is why this feature needs its own
  // channel: the reveal runs in this process on a path this process computed, never on a URL the window
  // supplied, so the window-open path stays closed to local files.
  const saveAttachment = createAttachmentSave({
    attachmentDir,
    downloadsDir,
    reveal: (path) => shell.showItemInFolder(path),
    diagnosticLog
  })

  // The retrieval listener's posture, one field wider: this ask carries an untrusted display name as
  // well as an untrusted identifier, so it owes the same boundary check. A malformed ask is DROPPED —
  // no filesystem call, no folder opened, no event (AC1) — the only sound answer when there is no
  // identifier to address a reply to. The raw name is NOT sanitised here: attachmentSave re-runs
  // sanitizeAttachmentFilename on the value it actually builds the path from, which is the one place
  // that transform may live.
  //
  // The bare `void` is safe because the driver never rejects — a property of that module, not of a
  // `.catch()` anyone must remember. `event.sender` is closed into the reply so the answer goes back to
  // the window that asked, behind the upload edge's isDestroyed() guard for a window closed mid-save.
  const attachmentSaveListener = (event: Electron.IpcMainEvent, request: unknown): void => {
    if (!isAttachmentSaveRequest(request)) return
    const sender = event.sender
    void saveAttachment(request).then((saveEvent) => {
      if (sender.isDestroyed()) return
      sender.send(ATTACHMENT_SAVE_EVENT_CHANNEL, saveEvent)
    })
  }
  ipcMain.on(ATTACHMENT_SAVE_CHANNEL, attachmentSaveListener)
  app.on('will-quit', () => ipcMain.removeListener(ATTACHMENT_SAVE_CHANNEL, attachmentSaveListener))

  // The display edge (#866) — the second consumer of what the retrieval edge puts on this machine,
  // and the THIRD READER of the one `attachmentDir` joined above. It adds no Electron path call and no
  // second join, so the directory these bytes are confined to is still named exactly once in this
  // file and never derived from anything the window sent.
  //
  // ONE DRIVER FOR THE APP LIFETIME, not one per ask: its in-flight count is state that only means
  // anything ACROSS asks, so rebuilding it per ask would silently disable the concurrency cap.
  //
  // setWindowOpenHandler's `file:` and custom-protocol denies are deliberately UNTOUCHED, and are why
  // this feature needs its own channel: the window addresses an attachment by IDENTIFIER and never
  // holds a path or a URL, and a privileged-scheme registration would additionally be unable to tell
  // a refused identifier from a missing file — a protocol handler's only failure surface is a
  // response status, so both would reach the window as one indistinguishable image error.
  const readAttachmentBytes = createAttachmentBytes({ attachmentDir, diagnosticLog })

  // The save listener's posture, one field narrower: this ask carries an untrusted identifier and
  // nothing else, and still owes the same boundary check. A malformed ask is DROPPED — no filesystem
  // call, no event — the only sound answer when there is no identifier to address a reply to.
  //
  // The bare `void` is safe because the driver never rejects — a property of that module, not of a
  // `.catch()` anyone must remember. `event.sender` is closed into the reply so the bytes go back to
  // the window that asked, behind the upload edge's isDestroyed() guard for a window closed mid-read.
  const attachmentBytesListener = (event: Electron.IpcMainEvent, request: unknown): void => {
    if (!isAttachmentBytesRequest(request)) return
    const sender = event.sender
    void readAttachmentBytes(request).then((bytesEvent) => {
      if (sender.isDestroyed()) return
      sender.send(ATTACHMENT_BYTES_EVENT_CHANNEL, bytesEvent)
    })
  }
  ipcMain.on(ATTACHMENT_BYTES_CHANNEL, attachmentBytesListener)
  app.on('will-quit', () =>
    ipcMain.removeListener(ATTACHMENT_BYTES_CHANNEL, attachmentBytesListener)
  )

  // The open-in-the-OS-viewer edge (#867) — the third consumer of what the retrieval edge puts on
  // this machine, and the FOURTH READER of the one `attachmentDir` joined above. It adds the only
  // new directory this file has needed since #996: `openDir`, where the suffixed derived copies
  // live. Both are joined onto `app.getPath('userData')` here and closed into the driver, so neither
  // is ever derived from anything the window sent, and attachmentOpen.ts stays Electron-free and
  // unit-testable against a temp directory.
  //
  // setWindowOpenHandler's `file:` and custom-protocol denies are deliberately UNTOUCHED, and matter
  // more here than on any sibling: the open runs in THIS process, on a path this process computed
  // from bytes this process read, never on a URL or a path the window supplied. That is what lets
  // the app hand a file to the operating system without reopening the window-open path to local
  // files.
  //
  // THE `openPath` SEAM IS NARROWED TO A BOOLEAN HERE, AND THAT IS LOAD-BEARING. `shell.openPath`
  // does not throw — it resolves with the operating system's error MESSAGE, empty on success, and
  // that message carries the path. Collapsing it to a bit at this boundary means the driver, which
  // builds the reasons and the log records, never holds the string at all (AC 5). This is the repo's
  // first `shell.openPath` call; `shell.showItemInFolder` above is the save leg's reveal and is a
  // different API for a different job.
  const openDir = join(app.getPath('userData'), ATTACHMENT_OPEN_DIR_NAME)
  const openAttachment = createAttachmentOpen({
    attachmentDir,
    openDir,
    open: async (path) => (await shell.openPath(path)).length === 0,
    diagnosticLog
  })

  // The bytes listener's posture verbatim — the ask carries an untrusted identifier and nothing
  // else, and owes the same boundary check. A malformed ask is DROPPED: no filesystem call, no file
  // opened, no event — the only sound answer when there is no identifier to address a reply to.
  //
  // The bare `void` is safe because the driver never rejects — a property of that module, not of a
  // `.catch()` anyone must remember. `event.sender` is closed into the reply so the outcome goes
  // back to the window that asked, behind the upload edge's isDestroyed() guard for a window closed
  // mid-open.
  const attachmentOpenListener = (event: Electron.IpcMainEvent, request: unknown): void => {
    if (!isAttachmentOpenRequest(request)) return
    const sender = event.sender
    void openAttachment(request).then((openEvent) => {
      if (sender.isDestroyed()) return
      sender.send(ATTACHMENT_OPEN_EVENT_CHANNEL, openEvent)
    })
  }
  ipcMain.on(ATTACHMENT_OPEN_CHANNEL, attachmentOpenListener)
  app.on('will-quit', () => ipcMain.removeListener(ATTACHMENT_OPEN_CHANNEL, attachmentOpenListener))

  // macOS reopens the app from the dock without relaunching the process, so the replacement window
  // goes through openWindow() (#519) rather than a bare createWindow() whose result was discarded.
  // That is what makes the new window the live target and brings it up to date on the connection that
  // has been running the whole time. The count condition is unchanged — at most one window exists, so
  // there is no fan-out of duplicate deliveries. Never fires on non-darwin: `window-all-closed` quits
  // there, so no reopen path is introduced.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
