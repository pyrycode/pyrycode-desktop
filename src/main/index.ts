import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  session,
  shell
} from 'electron'
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
import { selectWindowPresentation, type WindowPresentation } from './windowPresentation'
import { registerPairingHandler } from './pairingHandler'
import { registerPairingStatusHandler } from './pairingStatusHandler'
import { registerUnpairServerHandler } from './unpairHandler'
import { registerServerInfoHandler } from './serverInfoHandler'
import { registerHostLabelHandler, registerHostLabelServerHandler } from './hostLabelHandler'
import { createDeviceKeypairStore } from './deviceKeypair'
import { noiseKeyPairGenerator } from './noiseKeyPairGenerator'
import { createDaemonConnection } from './daemonConnection'
import { createConnectionRegistry } from './connectionRegistry'
import { createConversationRouter } from './conversationRouter'
import { createCorrelationRouter } from './correlationRouter'
import { createServerRouter } from './serverRouter'
import { createDebugBundleDownload, createDebugBundleDownloads } from './debugBundleDownload'
import { saveDebugBundle } from './saveDebugBundle'
import { emitDaemonEvent, bindServerOrigin } from './emitDaemonEvent'
import { createLiveWindow } from './liveWindow'
import { fireNotification, activateWindow, windowHasFocus } from './fireNotification'
import { createDiagnosticLog } from './diagnosticLog'
import { fileRotatingSink, stdoutSink } from './diagnosticLogSinks'
import { logSessionStart } from './sessionBanner'
import { onCommand } from './receiveCommand'
import { onDiagnostic } from './receiveDiagnostic'
import {
  uploadAttachmentFile,
  uploadClipboardImage,
  type AttachmentUploadDeps
} from './attachmentUpload'
import { createAttachmentRetrieval } from './attachmentRetrieval'
import { ATTACHMENT_DIR_NAME, storeAttachment } from './attachmentStore'
import {
  ATTACHMENT_UPLOAD_CHANNEL,
  ATTACHMENT_UPLOAD_EVENT_CHANNEL,
  isAttachmentPasteRequest,
  isAttachmentPickRequest,
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

function createWindow(presentation: WindowPresentation): BrowserWindow {
  // #1067: the default-tier e2e harness asks a non-packaged build not to show its window, so a run can
  // no longer steal the operator's focus 49 times and no window can be clicked away from mid-drive. The
  // decision itself is made once at the composition root and passed in — see selectWindowPresentation,
  // whose false-first isPackaged gate is what keeps a shipped build out of this branch entirely.
  const hidden = presentation === 'hidden'
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
      contextIsolation: true,
      // #1067, and INSEPARABLE from the never-shown branch below rather than an independent knob: a
      // window that is never shown is an occluded window, so hiding it while leaving this at Chromium's
      // default would earn exactly the renderer stalls the affordance exists to remove. This is the one
      // lever that keeps the Page Visibility API reporting *visible*, which is what timers, transitions
      // and Playwright's own rAF-based stability check depend on. `true` is Electron's documented
      // default, so the shown path — every packaged launch — is unchanged in effect.
      backgroundThrottling: !hidden
    }
  })

  if (!hidden) mainWindow.on('ready-to-show', () => mainWindow.show())

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
  // key, so no caller-supplied string can reach the store name. Since #1155 it holds a label PER
  // SERVER inside that one blob, and since #1156 the writers use those keyed members: the pairing
  // handler below receives only `saveFor`, so it can neither read a label back nor erase one; the
  // unpair handler receives only `clearFor`; and the read path is the host-label handler registered
  // below, which keeps a `load`-only handle. Three seams over one store, three disjoint `Pick`s,
  // none able to do another's job. (There were four until #1163: the whole-collection unpair handler
  // held `clear`, which deletes the one blob and so erased every server's label. That handler is
  // deleted, so `clear` now has no production caller at all — see hostLabelStore's header.)
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
  // and unreadable stay distinct. The erase paths are the two unpair handlers below, holding the
  // erase-only handles. No caller races it — the consumer is #826. `will-quit` removes the handler,
  // symmetric with unregisterServerInfo.
  //
  // It keeps its zero-argument shape and its `load`-only handle through #1156, which re-keyed the
  // writers: `load` now recognises the keyed envelope those writers produce and still answers with
  // one label, so this channel needs no change here. #1157 added the KEYED arm below rather than
  // changing this one, so this registration is untouched and its renderer caller unaffected; #1070
  // owns the sidebar's move onto that keyed read.
  const unregisterHostLabel = registerHostLabelHandler(ipcMain, { store: hostLabelStore })
  app.on('will-quit', () => unregisterHostLabel())

  // The PER-SERVER stored-host-label query (#1157): the same question asked of ONE named machine, so
  // the sidebar can label two paired pyryboxes apart instead of showing one name over both. Reuse the
  // SAME hostLabelStore constructed above — do not build a second store — and the same instance the
  // pairing write and both unpair erases already hold, so a label written at pairing confirm is
  // visible on the very next invoke here.
  //
  // Its handle is `loadFor`-only, one level finer than the arm above and still read-only: no `save`,
  // `saveFor`, `clear` or `clearFor` is reachable from it, so this channel — the one host-label seam
  // a compromised renderer can drive with an id of its own choosing — structurally cannot overwrite
  // or erase anything, and cannot reach the un-keyed read either. The untrusted id is guarded at the
  // boundary before any store call and is only ever compared with `===` against a decoded entry's own
  // field, never composed into the persistence name. Only the three-outcome union crosses back, with
  // a guard refusal indistinguishable from an unreadable label. `will-quit` removes the handler,
  // symmetric with unregisterHostLabel. No caller is wired yet — the consumer is #1070.
  const unregisterHostLabelServer = registerHostLabelServerHandler(ipcMain, {
    store: hostLabelStore
  })
  app.on('will-quit', () => unregisterHostLabelServer())

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
  // Read once each and closed into the factory below, rather than per connection: with more than one
  // connection these would otherwise be re-queried per server for a value that cannot differ.
  const deviceName = hostname()
  const clientVersion = app.getVersion()
  logSessionStart(diagnosticLog, clientVersion)
  // The connection registry (#1117): ONE connection per stored paired record, so every machine the
  // operator has paired is connected at once instead of only the one paired most recently. It
  // replaces the single `createDaemonConnection` that stood here — that call is now this factory's
  // body, reached once per record.
  //
  // The `serverId: null` this site used to pass (#1068) survives only for the registry's not-paired
  // STAND-IN: with nothing stored, the registry holds exactly one connection built with a null id
  // over the whole store, which is byte-for-byte the connection built here before, so today's
  // `connecting` → `failed(not-paired)` settle is produced by running the same code rather than
  // re-emitted from somewhere else. Every connection for a real record is stamped with that record's
  // own `server` and reads that record by id, so a second pairing can no longer re-point the first
  // connection at the new record.
  //
  // Constructed SYNCHRONOUSLY, doing its own store read afterwards, so this whole whenReady callback
  // still completes in one tick — the property the two handler-registration comments below lean on.
  //
  // THIS SITE STILL STAMPS NOTHING, and that is unchanged by #1118's observer below:
  // `createDaemonConnection` calls `bindServerOrigin(deps.sink, deps.serverId)` internally, and one
  // binding over the shared sink here would stamp every producer with a single id (see
  // bindServerOrigin's header). The observer sits UNDER that binding, reading the stamp rather than
  // writing one.
  //
  // The conversation router (#1118): a command about a conversation reaches the server that OWNS that
  // conversation, and no other. Declared BEFORE the registry although it reaches into it, because each
  // needs something from the other — the registry's connection factory needs `observe`, the router
  // needs the per-server accessor. The knot is broken by late binding, `downloader`'s
  // `requestDebugBundle` arrow in the same shape: the arrow's body runs on a command, many ticks after
  // `registry` is initialised, so there is no temporal-dead-zone read. That is structural, not lucky —
  // the registry's constructor does call `router.observe` synchronously while building its stand-in,
  // but `observe` only WRAPS, and the recording path it installs reads the event and the index and
  // never reaches `connectionFor`.
  const router = createConversationRouter({
    connectionFor: (serverId) => registry.connectionFor(serverId),
    diagnosticLog
  })
  // The correlation router (#1119): an ANSWER reaches the server that RAISED the thing it answers. Its
  // sibling above routes by a conversation id; these five commands carry none (ADR 0009 — no
  // `conversation_id` rides an answer), so they route by the modal id, the question batch id, or the
  // daemon's own session id, each learned off the stamped event that minted it. Declared here for the
  // same late-binding reason as `router`, and on the same structural argument: its `observe` only WRAPS,
  // and the recording path it installs reads the event and its own maps, never `connectionFor`.
  const correlations = createCorrelationRouter({
    connectionFor: (serverId) => registry.connectionFor(serverId),
    diagnosticLog
  })
  // The server router (#1120): a command about a WHOLE server reaches the server the WINDOW named.
  // Its two siblings learn a server id off a stamped daemon event and can trust what they hold; this
  // one takes an untrusted hint from the renderer, so it resolves against the registry's held entry
  // set and refuses an id no entry matches. It is not a third index — it holds no state at all and
  // installs no observer, so the late binding below is even plainer than theirs: nothing it wires runs
  // before the first command arrives, many ticks after this callback completes.
  const servers = createServerRouter({
    connectionFor: (serverId) => registry.connectionFor(serverId),
    soleConnection: () => registry.soleConnection(),
    diagnosticLog
  })
  const registry = createConnectionRegistry({
    store: pairedServerStore,
    createConnection: ({ serverId, pairedServer }) =>
      createDaemonConnection({
        deviceKeypair: deviceKeypairStore,
        pairedServer,
        // Evaluated once PER CONNECTION, so each producer gets its own wrappers over the one shared
        // sink and the shared indexes. The observers stamp nothing and add no second stamping
        // path: `createDaemonConnection` applies `bindServerOrigin` internally over the sink it is
        // given, so what arrives here is the ALREADY-STAMPED event and each index reads exactly what
        // the renderer reads. They record before they forward, which is what makes "anything the window
        // can name, the index has already seen" true with no race.
        //
        // TWO NESTED WRAPPERS since #1119, and the nesting order is free — both only read the stamp and
        // write their own maps, neither mutates the event, and there is ONE observation point rather
        // than a second stamping path. The extra hop is one function call per daemon event, which is
        // per-frame and not per-byte.
        sink: correlations.observe(router.observe(live.sink)),
        serverId,
        deviceName,
        clientVersion,
        diagnosticLog
      }),
    diagnosticLog
  })
  // ⭐ THE STAND-IN IS RETIRED (#1129). `const connection = registry.active` stood here from #1117
  // so that call sites written for a single connection kept working while the registry held many;
  // it answered for the most recently PAIRED server, which is not a routing decision at all. Four
  // slices emptied it and this line's removal is the last of them:
  //
  //   #1118 — the ten entry points carrying a CONVERSATION id → `router.route(...)`, reaching the
  //           server that owns that conversation. #1092 later moved `interrupt` into this set, once
  //           the frame acquired a conversation to name.
  //   #1119 — the five carrying a modal, question-batch or session id → `correlations.route*(...)`,
  //           reaching the server that RAISED the thing being answered.
  //   #1120 — the six about a WHOLE server, carrying no id of any kind → `servers.route(...)` /
  //           `servers.resolve(...)`, reaching the server the window named. Five of them today.
  //   #1129 — the attachment upload, which arrives on its own IPC channel behind two request guards of
  //           its own rather than through the `onCommand` switch, and now routes through `servers` as
  //           well. See `attachmentUploadListener` below.
  //
  // SO THERE IS NO LONGER A "DEFAULT CONNECTION" IN THIS PROCESS, and nothing new should mint one.
  // Every path to a daemon now resolves through one of the three indexes and REFUSES what it cannot
  // resolve — never "the first" connection, never "the most recent". A new entry point picks its
  // index by what it is ABOUT: if it correlates to something a daemon raised, `correlations`; if it
  // carries a conversation id, `router`; if it is about a whole server, `servers`.
  // `ConnectionRegistry.active` itself survives this slice with no consumer, and retiring the
  // accessor is its own cleanup.

  // The pairing invoke handler (#54), registered now that the registry exists so a successful
  // confirm can dial the just-persisted pairing with no manual step (#82). ipcMain.handle allows
  // one handler per channel — this is the sole registration site, held for the app lifetime.
  // `onPaired` fires only after a confirm persists the record; `reconcile()` is synchronous, void,
  // and non-throwing (it appends to the registry's own chain and returns), so it satisfies onPaired's
  // must-not-throw contract exactly as `connection.reconnect()` did. The signal stays VALUE-FREE
  // (#1117): the callback carries no record, so the registry RE-READS the store and makes the
  // connection set match it — building and dialling one connection for a server that had none, or
  // re-dialling the single connection whose record just changed under it, and leaving every other
  // connection live and un-handshaken either way. Registering here is safe: the whole
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
    onPaired: () => registry.reconcile(),
    hostLabel: hostLabelStore
  })
  app.on('will-quit', () => unregisterPairing())

  // The unpair request (#173, per-server since #1149): forget ONE named machine, leaving every other
  // record on disk and every other connection live. Reuse the SAME pairedServerStore and
  // hostLabelStore constructed above — do not build second ones. The erase (#172) is fail-closed; the
  // handler maps every throw to a value-free `error`, never reporting success while a live token may
  // remain on disk.
  //
  // Registered here, below the registry and beside the pairing handler, because #504 gave it the
  // mirror-image dependency: `onUnpaired` fires only after the erase succeeds and tears the live
  // daemon session down, so an authenticated session can never outlive the record that authorised it.
  // The same `reconcile()` — synchronous, void, non-throwing — serves both callbacks, which is the
  // whole point of reconciling against the store rather than against a value the signal carries
  // (#1117): it reads the store and makes the connection set match, so with one record gone it stops
  // and drops that one connection and leaves every other live and un-handshaken. It never sets the
  // registry's permanent stopped flag, so a later re-pair still connects.
  //
  // #1163 DELETED THE WHOLE-COLLECTION REGISTRATION THAT USED TO SIT ABOVE THIS ONE. It erased every
  // record from a bodiless request and #1149 kept it registered only for its one remaining caller, the
  // composer's Re-pair control, which now names its server and arrives here. So this app registers no
  // whole-collection erase at all. The handler is typed against `clearServer` alone — no
  // whole-collection `clear`, no read of any kind — so a malformed or unknown-id request structurally
  // cannot reach a wipe and no bearer token can be materialised in that module. `pairedServerStore`
  // satisfies the narrow handle structurally; the narrowing lives in the handler, not here.
  //
  // Registering this late is safe for the same reason the pairing handler is (above): the whole
  // whenReady callback runs to completion in one tick and no caller races it — the visible unpair
  // controls are renderer UI, many ticks later, after first paint. `will-quit` removes the handler,
  // symmetric with unregisterPairing.
  //
  // #827 put the label erase here: unpairing takes the host's name with it rather than leaving it to
  // describe a record that no longer exists. It is erase-only, so this handler can neither read the
  // label back nor overwrite it; ordered after the record's erase and outside the fail-closed catch,
  // and a failure to erase it still resolves `ok` — the result reports on the RECORD, and by then the
  // record is gone. See the listener's comment for the full argument.
  //
  // #1156 points the label handle at `clearFor`, so it erases exactly the named machine's name and
  // leaves every still-paired machine's stored — retiring the interim rule that erased the label only
  // once nothing remained, which was the best a single un-keyed slot allowed. Still erase-only:
  // `clearFor` carries no read, so no label text is materialised in that module either.
  const unregisterUnpairServer = registerUnpairServerHandler(ipcMain, {
    store: pairedServerStore,
    onUnpaired: () => registry.reconcile(),
    hostLabel: hostLabelStore
  })
  app.on('will-quit', () => unregisterUnpairServer())

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
  // How every window this app opens presents itself (#1067). Effectful choice made ONCE, here, beside
  // the other two: false-first on app.isPackaged, so a packaged build never consults the env flag and
  // always shows its window. Computed at the root rather than inside createWindow so there is exactly
  // ONE decision site — the dock-reopened window below goes through the same `openWindow`, so it cannot
  // silently diverge from the first one and leave the harness believing a visible window is hidden.
  // `process.env` structurally satisfies the `Record<string, string | undefined>` param (no cast).
  const windowPresentation = selectWindowPresentation({ isPackaged: app.isPackaged, env: process.env })
  const openWindow = (): void => {
    const window = createWindow(windowPresentation)
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
    // Plural since #1117: `registry.start()` dials EVERY held connection, and a connection built
    // later by a pairing reconcile dials as it is built. Its idempotence is what keeps `.on` safe —
    // it is deferred behind the registry's first store read and then latched, so a second window's
    // load, or an HMR reload, re-dials nothing.
    window.webContents.on('did-finish-load', () => {
      live.replayStatus()
      registry.start()
    })
  }
  openWindow()
  // Plural since #1117: quitting must reach every connection, or a second paired server's relay
  // socket outlives the app. It also latches, so a reconcile still in flight builds nothing after.
  app.on('will-quit', () => registry.stop())

  // The debug-bundle download orchestrator (#169): the sole slice that touches Electron + IPC for
  // this feature. `app.getPath('downloads')` — this slice's one Electron touch — is closed into the
  // saver so saveDebugBundle never imports `app` (#117); the transport/persistence slices stay
  // IPC-free. The orchestrator drives request → reassemble → save and emits progress + one terminal
  // result to the window; it enforces single-in-flight so a spammed command cannot orphan an
  // in-flight download's reassembler slot.
  const downloadsDir = app.getPath('downloads')
  // PER SERVER SINCE #1120 (AC3): one orchestrator per server, built on first ask and held for the
  // process lifetime, so two servers can download at once while one server cannot be asked twice.
  //
  // #1068's null binding is what this replaces. The orchestrator's events come from a connection's
  // daemon, so they carry an origin like any other daemon event; the root could not name it while it
  // held one connection bound to null, and now it can. The sink is bound ONCE PER SERVER, here, inside
  // `build` — rather than by wrapping the shared `live.sink` once, which would stamp all three
  // emitters with a single id, precisely what a per-server registry cannot use. The orchestrator
  // itself stays origin-free: it takes an `emit` function, not a sink.
  //
  // `serverId` reaches the SINK and nothing else. It is deliberately NOT in the saved filename:
  // `saveDebugBundle`'s name parts are module constants so that no untrusted input can reach a path
  // segment, and two concurrent saves are already separated by its exclusive-create (`wx`) advance to
  // `… (n).tar.gz`, so a per-server stem would buy nothing and would undo that guarantee in one edit.
  const downloads = createDebugBundleDownloads((serverId) => {
    const sink = bindServerOrigin(live.sink, serverId)
    return createDebugBundleDownload({
      save: (bytes) => saveDebugBundle(downloadsDir, bytes),
      emit: (event) => emitDaemonEvent(sink, event)
    })
  })

  // #1068: the third and last emitter that reaches the channel. Bound separately from `bundleSink`
  // despite both being null today, because the two are null for DIFFERENT and permanent reasons:
  // notificationActivated is window-local and NO DAEMON ORIGINATED IT, so it stays null after #1084,
  // while the bundle's id arrives with the registry. Collapsing them would erase that distinction at
  // exactly the moment it starts to matter.
  const windowLocalSink = bindServerOrigin(live.sink, null)

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
      // ROUTED BY CONVERSATION (#1118). `router.route` answers the connection for the server that owns
      // the named conversation, or `null` HAVING ALREADY REFUSED AND LOGGED — so the `?.` is the
      // refusal, not a silent shrug, and an id no server has claimed puts a frame on no wire at all.
      // The decision itself lives in `conversationRouter.ts`, where a unit test can drive it; these
      // stay the per-case one-liners they were.
      case 'sendMessage':
        router.route(command.payload.conversation_id)?.send(command.payload)
        return
      case 'requestSessionSettings': {
        // Direct to the connection method (mirrors sendMessage), no facade — a run-config read
        // has no orchestrator/consumer. The optional conversation id is unwrapped here rather than
        // passing the payload object on: the connection takes the scalar, and the builder rebuilds a
        // fresh literal, so no renderer-supplied key reaches the wire (#945). ONE local, read twice,
        // so the id routed by and the id sent can never be two different expressions. An absent id is
        // not a known conversation, so it refuses on the ordinary path — no separate branch is owed.
        const conversationId = command.payload?.conversation_id
        router.route(conversationId)?.requestSessionSettings(conversationId)
        return
      }
      case 'requestModelList': {
        // ROUTED BY CONVERSATION, mirroring the case above — a model menu belongs to one conversation,
        // so the frame goes to the server that hosts it or to no wire at all (#1165). ONE local, read
        // twice, so the id routed by and the id sent can never be two different expressions. No `?.` on
        // `payload`: it is required, and `isRequestModelListPayload` has already proven it at the
        // boundary. Direct to the connection method — an on-demand menu ask has no orchestrator and no
        // consumer, and no retry: the reply is one `model_list` the existing inbound path already lands
        // in the model-list store, unchanged and unbranched.
        const conversationId = command.payload.conversation_id
        router.route(conversationId)?.requestModelList(conversationId)
        return
      }
      case 'requestHistory':
        // ROUTED BY CONVERSATION, mirroring the two cases above — a conversation's history belongs to
        // the server that hosts it, so the frame goes there or to no wire at all (#1222). The WHOLE
        // payload is forwarded rather than unwrapped into scalars, unlike its neighbours: this verb
        // carries three fields, and the connection method hands them to a builder that rebuilds a
        // fresh literal, so no renderer-supplied key reaches the wire either way. No `?.` on `payload`:
        // it is required, and `isRequestHistoryPayload` has already proven all three fields at the
        // boundary. The `conversation_id` is read once, as the routing key — the same object the
        // builder then reads it from, so the id routed by and the id sent cannot diverge. Direct to
        // the connection method: an on-demand page ask has no orchestrator and no consumer, and no
        // retry — the reply is one `history_page` the inbound path correlates back to this ask.
        router.route(command.payload.conversation_id)?.requestHistory(command.payload)
        return
      case 'requestConversations':
        // ROUTED BY SERVER (#1120). `servers.route` answers the connection for the server the window
        // NAMED — resolved against the registry's held entries, never trusted as a hint — or, when the
        // command carries no id, the sole connection if the registry holds exactly one entry. Anything
        // else is `null` HAVING ALREADY REFUSED AND LOGGED, so the `?.` is the refusal and no frame
        // reaches any wire. Still inert when not connected (#139): with nothing paired the registry
        // holds exactly one entry — the stand-in — so this resolves and no-ops as it does today.
        servers.route(command.serverId)?.requestConversations()
        return
      case 'requestRecentWorkspaces':
        // ROUTED BY SERVER (#1120), mirrors requestConversations — no orchestrator, no consumer. Sends
        // recent_workspaces; the daemon replies with one recent_workspaces_list →
        // recentWorkspacesReceived event (consumed by #382). Inert no-op when not connected (#380).
        servers.route(command.serverId)?.requestRecentWorkspaces()
        return
      case 'answerModal':
        // ROUTED BY MODAL ID (#1119). `routeModal` answers the connection for the server that RAISED
        // this modal, learned off the stamped `modalShown`, or `null` having already refused and logged
        // — so an answer for a modal no index knows puts no frame on ANY server's wire, and the
        // answer_token this method would mint main-side is never minted at all. Inert no-op when not
        // connected (#236), now by the same expression.
        correlations.routeModal(command.payload.modal_id)?.answerModal(command.payload)
        return
      case 'cancelModal':
        // ROUTED BY MODAL ID (#1119), sends modal_cancel. Inert no-op when not connected (#236).
        correlations.routeModal(command.payload.modal_id)?.cancelModal(command.payload)
        return
      case 'answerQuestions':
        // ROUTED BY QUESTION BATCH ID (#1119), learned off the stamped `questionShown` and forgotten at
        // `questionDismissed` — a settled batch refuses, which costs nothing, since a retired batch
        // resolves nothing daemon-side either. The method mints the answer_token main-side and sends
        // question_answer; no reply is correlated. Inert no-op when not connected (#920).
        correlations.routeQuestions(command.payload.question_batch_id)?.answerQuestions(command.payload)
        return
      case 'refuseQuestions':
        // ROUTED BY QUESTION BATCH ID (#1119), sends question_refused. It mints a token too, unlike the
        // cancelModal it otherwise mirrors. Inert no-op when not connected (#920).
        correlations.routeQuestions(command.payload.question_batch_id)?.refuseQuestions(command.payload)
        return
      case 'createConversation':
        // ROUTED BY SERVER (#1120) — a new chat is created ON a host, so the window says which. Only
        // `payload` is passed on, never `command`, so the routing key has no expression that could
        // carry it onto the wire. Sends create_conversation; the daemon replies with one
        // conversation_created → conversationCreated event. Inert no-op when not connected (#241).
        servers.route(command.serverId)?.createConversation(command.payload)
        return
      case 'createWorkspaceFolder':
        // ROUTED BY SERVER (#1120), mirrors createConversation — the folder is created on the named
        // host's filesystem, which the daemon polices server-side. Sends create_workspace_folder; the
        // daemon replies with one workspace_folder_created → workspaceFolderCreated event (consumed by
        // #157). Inert no-op when not connected (#381).
        servers.route(command.serverId)?.createWorkspaceFolder(command.payload)
        return
      case 'dequeueMessage':
        // Direct to the connection method (mirrors sendMessage), no orchestrator — a dequeue is
        // ungated fire-and-forget. Sends dequeue_message; no reply is expected (the daemon re-broadcasts
        // its queue_state as the observable effect, #294). Inert no-op when not connected (#300).
        router.route(command.payload.conversation_id)?.dequeueMessage(command.payload)
        return
      case 'interrupt': {
        // ROUTED BY CONVERSATION (#1092), mirroring the newSession arm below and no longer by server —
        // an interrupt stops the turn in ONE conversation, so the conversation id is the address and
        // the `serverId` this arm carried since #1120 would be a second one that could disagree with
        // it. That field predicted its own removal here and is gone from the command entirely. ONE
        // local, read twice, so the id routed by and the id sent can never be two different
        // expressions. No `?.` on `payload`: it is required, and `isInterruptPayload` has already
        // proven it a NON-EMPTY string at the boundary — an empty id would be the daemon's
        // process-wide follow-active cursor, i.e. some other conversation's turn. Direct to the
        // connection method — an interrupt has no orchestrator and no consumer, and no reply is
        // expected (the turn stops via the ordinary turn_end / turn_state{idle} events). Inert no-op
        // when nothing is connected, and when the id names a conversation no connection holds the
        // `?.` is the refusal, so no frame reaches any wire.
        const conversationId = command.payload.conversation_id
        router.route(conversationId)?.interrupt(conversationId)
        return
      }
      case 'newSession': {
        // ROUTED BY CONVERSATION (#1217), mirroring requestModelList and NOT the interrupt arm above
        // — a restart kills claude in one conversation, so the conversation id is the address and a
        // `serverId` would be a second one that could disagree with it. ONE local, read twice, so the
        // id routed by and the id sent can never be two different expressions. No `?.` on `payload`:
        // it is required, and `isNewSessionPayload` has already proven it a NON-EMPTY string at the
        // boundary — an empty id would be the daemon's process-wide follow-active cursor, i.e. some
        // other conversation's restart. Direct to the connection method — a restart has no
        // orchestrator and no consumer, and NO REPLY is awaited: the daemon answers this frame with
        // nothing at all, and the break surfaces as the existing session_transition marker. Inert
        // no-op when nothing is connected, and when the id names a conversation no connection holds
        // the `?.` is the refusal, so no frame reaches any wire (AC4).
        const conversationId = command.payload.conversation_id
        router.route(conversationId)?.newSession(conversationId)
        return
      }
      case 'promoteConversation':
        // Direct to the connection method (mirrors createConversation), no orchestrator — a promote
        // request has no consumer/reassembler. Sends promote_conversation; the daemon confirms with one
        // unsolicited conversation_updated broadcast → conversationUpdated event (consumed by #275).
        // Inert no-op when not connected (#273).
        router.route(command.payload.conversation_id)?.promoteConversation(command.payload)
        return
      case 'archiveConversation':
        // Direct to the connection method (mirrors unarchiveConversation), no orchestrator — a fire-and-
        // forget request has no consumer/reassembler. Sends archive_conversation; the daemon confirms by
        // replying with a conversation_updated record, decoded by the existing path and reflected in the
        // list by #275 (consumed by #366), not correlated here. Inert no-op when not connected (#363).
        router.route(command.payload.conversation_id)?.archiveConversation(command.payload)
        return
      case 'unarchiveConversation':
        // Direct to the connection method (mirrors promoteConversation), no orchestrator — a fire-and-
        // forget request has no consumer/reassembler. Sends unarchive_conversation; the daemon confirms by
        // replying with a conversation_updated record, not correlated here (#348 reads restored state from
        // the re-list). Inert no-op when not connected (#346).
        router.route(command.payload.conversation_id)?.unarchiveConversation(command.payload)
        return
      case 'deleteConversation':
        // Direct to the connection method (mirrors unarchiveConversation), no orchestrator — a fire-and-
        // forget request has no consumer/reassembler. Sends delete_conversation; the daemon replies with a
        // distinct conversation_deleted { id } record correlated to the requester (no broadcast), NOT
        // decoded or correlated here — #367 owns the reply decode + explicit re-list. Inert no-op when not
        // connected (#364).
        router.route(command.payload.conversation_id)?.deleteConversation(command.payload)
        return
      case 'renameConversation':
        // Direct to the connection method (mirrors unarchiveConversation), no orchestrator — a fire-and-
        // forget request has no consumer/reassembler. Sends rename_conversation; the daemon confirms by
        // replying with a conversation_updated record, decoded by the existing path and reflected in the
        // list by #275 (consumed by #360), not correlated here. Inert no-op when not connected (#359).
        router.route(command.payload.conversation_id)?.renameConversation(command.payload)
        return
      case 'changeWorkspace':
        // Direct to the connection method (mirrors renameConversation), no orchestrator — a fire-and-
        // forget request has no consumer/reassembler. Sends change_workspace; the daemon confirms by
        // replying with the existing conversation_updated record, decoded by the existing path and
        // reflected in the list for free, not correlated here (the Workspace Picker reads the new
        // workspace from the re-list). Inert no-op when not connected (#379).
        router.route(command.payload.conversation_id)?.changeWorkspace(command.payload)
        return
      case 'setSessionSettings':
        // ROUTED BY SESSION ID (#1119) — the DAEMON's own session id, not a conversation id (#501 is the
        // standing bug about those two being confused), learned off the stamped `runConfigReceived` and
        // `sessionSettingsUpdated`. A `session_id` of `''` is a real daemon answer meaning "no session to
        // address": never learned, so it refuses on the ordinary path with no separate branch owed.
        // Sends set_session_settings; the daemon replies with one session_settings_updated (decoded by
        // #264, correlated by #261). The renderer-minted `changeId` rides through so main can match the
        // reply back to this change (never onto the wire). Inert no-op when not connected (#263).
        correlations.routeSession(command.payload.session_id)?.setSessionSettings(command.payload, command.changeId)
        return
      case 'requestDebugBundle': {
        // ROUTED BY SERVER (#1120) — the bundle is a whole server's, so this is the one arm that needs
        // the routing KEY as well as the connection: the key selects that server's held orchestrator
        // (its own in-flight gate, its own origin-bound sink) and the connection arms THIS ask.
        //
        // THE KEY IS THE RESOLVED ONE, NEVER `command.serverId`. Keying the orchestrator map on the
        // renderer's string before resolution would make it renderer-driven and unbounded — one entry
        // and one bound sink per fabricated id. After resolution it can only be an id a held entry
        // matched, or null for the stand-in.
        //
        // The early return IS the refusal (already logged inside the router): no orchestrator is
        // selected, no consumer is built, and the transport's reassembler slot is never armed.
        const target = servers.resolve(command.serverId)
        if (target === null) return
        downloads
          .for(target.serverId)
          .request((consumer) => target.connection.requestDebugBundle(consumer))
        return
      }
      case 'notify':
        // NOT SERVER-SCOPED, and deliberately gains no id (#1120). It is main-local: fireNotification
        // owns the copy table, no command field supplies text, and no frame results — so a server id
        // here would be a field nothing reads. Host-attributed notification copy, if it turns out to be
        // wanted, is a separate ticket with its own consumer. The event the click emits stays
        // origin-free for the reason `windowLocalSink` gives above.
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
            emitDaemonEvent(windowLocalSink, { type: 'notificationActivated' })
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
  // THREE ENTRIES, ONE LISTENER (#890, #1032). An argument-free send is #862's bare intent: the
  // renderer names an intent and nothing else, so that arm still reaches no untrusted request field and
  // no renderer-supplied string can get near a path, a declared filename or the wire. A send CARRYING a
  // request is a dropped file or a pasted image, and whichever it is, it is untrusted at this boundary
  // regardless of the declared type — the two guards are the locks the header promised when the door
  // was left value-free, and an ask that passes neither is DROPPED: no filesystem call, no clipboard
  // read, no event, matching every sibling attachment channel. Nothing an operator can physically do
  // produces one, so there is nothing to report.
  //
  // PRESENCE ALONE NO LONGER SUFFICES, which is #1032's substance. Presence was the discriminator
  // because the shipped picker sender cannot be given a field without changing what a conforming
  // renderer puts on the wire — so with a third entry, the NEW ask is the one that names itself, and
  // the two shipped shapes are untouched. The path guard is tried first, so every ask that works today
  // reaches the arm it reaches today.
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
  /**
   * The clipboard's image as PNG bytes, or null when it holds none (#1032) — this slice's ONLY Electron
   * touch, held here so `src/main/attachmentUpload.ts` stays Electron-free and its no-image branch
   * unit-tests without reaching the operator's real clipboard. The `saveDebugBundle` / `downloadsDir`
   * seam, in the same shape.
   *
   * THE BACKGROUND PROCESS READS THE CLIPBOARD ITSELF rather than trusting anything the window claims
   * about it, and that is what bounds this capability: a text-only clipboard answers `isEmpty()` and
   * becomes a refusal, so a text-flavoured secret cannot become an attachment however the ask is
   * forged. This adds NO renderer permission — see the allowlist above, which must still never grow to
   * `clipboard-read`: the renderer never holds clipboard content, it only asks for this one act, and
   * what comes back to it is a content-free outcome.
   *
   * A true Uint8Array VIEW honouring offset and length, `readChosenFile`'s idiom — and it matters more
   * here, because a small Buffer from native code can sit in a pooled ArrayBuffer.
   */
  const readClipboardImagePng = (): Uint8Array | null => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const png = image.toPNG()
    return new Uint8Array(png.buffer, png.byteOffset, png.byteLength)
  }

  let pickerOpen = false
  const attachmentUploadListener = (event: Electron.IpcMainEvent, request?: unknown): void => {
    const sender = event.sender
    /**
     * ONE deps object per ask, shared by all three arms rather than one per arm: they must not be
     * able to drift into reporting on different channels or forwarding progress differently.
     * `sender` — the window that asked — is closed in, and the isDestroyed() guard is
     * emitDaemonEvent's (#518).
     *
     * A FACTORY SINCE #1129, and that makes the single-instance property STRONGER rather than
     * weaker. The deps now depend on the ask's server, which is knowable only once an arm has been
     * selected, so a single inline literal at the top of the listener could no longer express them.
     * There is still exactly ONE construction site and exactly one call per ask — each arm below
     * returns — and with one body rather than one object it is now structurally impossible to hand
     * two arms differently-built `emit`s.
     *
     * ⭐ CALLED FROM INSIDE AN ARM, NEVER AT THE TOP OF THE LISTENER, and that placement is a
     * security property rather than a style choice. `servers.route` LOGS `server-route-refused` on
     * both of its refusal branches, so resolving before the guards discriminate would hand a
     * looping renderer exactly the lever the neither-guard return below exists to deny. The chain
     * that keeps it denied: `route` is reached only from `upload`, `upload` only from the flow
     * module, and the flow module only from a matched arm.
     */
    const buildDeps = (
      serverId: string | undefined,
      conversationId: string
    ): AttachmentUploadDeps => ({
      // #1205: the destination, as the ask carried it and as the guard admitted it. Read once by the
      // flow module into the plan, which spreads it onto every chunk; it reaches no filename, path or
      // log line from here. See `AttachmentUploadDeps.conversationId`.
      conversationId,
      /**
       * The progress seam is forwarded, never swallowed: the flow module owns the threshold that
       * decides whether a report becomes a message, and this arrow owns nothing but the join and,
       * since #1129, the routing.
       *
       * ROUTED BY SERVER (#1129), the last entry point off `registry.active`. `servers.route`
       * answers the connection for the server the window named, or — when the ask carries no id,
       * which is every ask until #1086 gives the composer a per-server surface — the sole
       * connection if the registry holds exactly one entry. Anything else REFUSES: an id no held
       * entry matches, or an absent id with more than one entry. There is no fallback to the first
       * or the most recent connection.
       *
       * ⭐ THE REFUSAL IS SURFACED THROUGH THIS SEAM RATHER THAN DECIDED ABOVE THE FLOW MODULE,
       * which is what buys the window a well-formed terminal for free. `driveUpload` mints the
       * `uploadId`, calls this arrow exactly once, and emits exactly one terminal from what it
       * returns — so a refusal reported here is addressed with the same id every other terminal for
       * this ask would carry, by machinery that already exists and is already tested. A refusal
       * decided BEFORE the flow module runs would have no id to address itself to and would have to
       * hand-write the exactly-one property.
       *
       * `not-connected` RATHER THAN A LITERAL OF ITS OWN, weighed rather than defaulted to. It is
       * exactly right for `server-not-connected` and imprecise for `ambiguous-server`, where the
       * client is connected to more than one host and cannot choose. It is accepted because
       * `resolve` collapses both refusals into one `null` — so a distinct literal would need either
       * a sentence vague enough to cover both, which is no more honest than this one, or a
       * re-derivation of the resolver's own branch at this call site, minting a second copy of the
       * decision `serverRouter.ts` owns. The distinction is not lost: `resolve` logs
       * `server-route-refused` with `ambiguous-server` vs `server-not-connected`, so the
       * operator-facing diagnostic is precise while the composer sentence is coarse. There is also
       * no action a truer sentence could invite today. When #1086 gives the composer a server to
       * name, a truer literal becomes worth minting — and at that point the resolver must report
       * WHICH refusal it made, which is a change to `serverRouter.ts`.
       *
       * With exactly one held entry this reduces to the expression it replaces, which is what keeps
       * single-server behaviour byte-for-byte unchanged.
       */
      upload: (input, onProgress) => {
        const target = servers.route(serverId)
        return target === null
          ? Promise.resolve({ ok: false, outcome: 'not-connected' })
          : target.uploadAttachment(input, onProgress)
      },
      emit: (uploadEvent) => {
        if (sender.isDestroyed()) return
        sender.send(ATTACHMENT_UPLOAD_EVENT_CHANNEL, uploadEvent)
      },
      diagnosticLog
    })

    // The DROPPED-FILE arm (#890), TRIED FIRST OF THE TWO GUARDED ONES and that ordering is
    // load-bearing rather than stylistic: an ask carrying a valid `path` reaches this arm exactly as it
    // does today, extra keys included, so nothing an operator can produce changes arm now that a second
    // shape is accepted. A malformed ask falls past both guards and returns below, having made no
    // filesystem call, no clipboard read and no event.
    if (isAttachmentUploadRequest(request)) {
      void uploadAttachmentFile(request.path, buildDeps(request.serverId, request.conversationId))
      return
    }

    // The PASTED-IMAGE arm (#1032). The ask carries nothing but its own name and, since #1129, an
    // optional routing key — so nothing about the IMAGE is read off it. The reader below is what
    // produces the bytes, and it is a local closure over Electron's `clipboard`, never anything the
    // window sent; `uploadClipboardImage` still takes no field off the ask whatsoever, and the id
    // it now carries is resolved against the registry and discarded, reaching no filename, byte or
    // wire field. See AttachmentPasteRequest, which amends its own "and nothing else" paragraph to
    // say so.
    if (isAttachmentPasteRequest(request)) {
      void uploadClipboardImage(readClipboardImagePng, buildDeps(request.serverId, request.conversationId))
      return
    }

    // The PICKER arm (#862), which since #1205 has an ask of its own: the destination has to ride it,
    // so the argument-free intent is retired and a bare send matches no guard. An ask matching none of
    // the three — a bare send included — is dropped outright, matching every sibling attachment
    // channel: no event, and no log either, which is what denies a looping renderer a way to drive the
    // main-process logger. The picker's `serverId` takes the resolver's path like the other two asks'.
    // Deps are built AFTER the pickerOpen gate so a suppressed second picker builds nothing.
    if (!isAttachmentPickRequest(request)) return
    if (pickerOpen) return
    pickerOpen = true
    const pickerDeps = buildDeps(request.serverId, request.conversationId)
    void dialog
      .showOpenDialog({ properties: ['openFile'] })
      .then((choice) => {
        // Cancelling is a TOTAL no-op: nothing read, nothing sent, no outcome reported (AC1).
        if (choice.canceled || choice.filePaths.length === 0) return
        void uploadAttachmentFile(choice.filePaths[0], pickerDeps)
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
    // ROUTED BY CONVERSATION (#1118), and the tenth of the ten entry points that carry the key they
    // need: `AttachmentRetrievalRequest.conversationId` already survived the boundary guard, so this
    // is a lookup rather than a new field. It is the one routed site that OWES ITS ASKER AN ANSWER —
    // the window is waiting on a terminal — so a refusal is reported rather than dropped, on the
    // existing `not-connected` outcome ("the ask arrived with no live session, so nothing was sent"),
    // which the driver turns into exactly one `failed` on the asker's own emit and releases its
    // in-flight slot. No member is added to AttachmentRetrievalFailure. Attachment UPLOAD carries no
    // conversation id and stays on the stand-in above.
    requestAttachment: (payload, consumer) => {
      const owner = router.route(payload.conversation_id)
      if (owner === null) {
        consumer.fail('not-connected')
        return
      }
      owner.requestAttachment(payload, consumer)
    },
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
