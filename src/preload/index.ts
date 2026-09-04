import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'
import { COMMAND_CHANNEL, type RendererCommand } from '../shared/ipc/commands'
import { DIAGNOSTIC_CHANNEL, type RendererDiagnosticEvent } from '../shared/ipc/diagnostics'
import {
  PAIRING_CHANNEL,
  type PairingSubmitResponse,
  type PairingConfirmResponse
} from '../shared/ipc/pairing'
import { PAIRING_STATUS_CHANNEL, type PairingStatus } from '../shared/ipc/pairingStatus'
import { UNPAIR_CHANNEL, type UnpairResult } from '../shared/ipc/unpair'
import { SERVER_INFO_CHANNEL, type ServerInfo } from '../shared/ipc/serverInfo'
import { HOST_LABEL_CHANNEL, type HostLabelResult } from '../shared/ipc/hostLabel'
import {
  ATTACHMENT_PASTE_SOURCE,
  ATTACHMENT_UPLOAD_CHANNEL,
  ATTACHMENT_UPLOAD_EVENT_CHANNEL,
  type AttachmentPasteRequest,
  type AttachmentUploadEvent,
  type AttachmentUploadRequest
} from '../shared/ipc/attachmentUpload'
import {
  ATTACHMENT_RETRIEVAL_CHANNEL,
  ATTACHMENT_RETRIEVAL_EVENT_CHANNEL,
  type AttachmentRetrievalEvent,
  type AttachmentRetrievalRequest
} from '../shared/ipc/attachmentRetrieval'
import {
  ATTACHMENT_SAVE_CHANNEL,
  ATTACHMENT_SAVE_EVENT_CHANNEL,
  type AttachmentSaveEvent,
  type AttachmentSaveRequest
} from '../shared/ipc/attachmentSave'
import {
  ATTACHMENT_BYTES_CHANNEL,
  ATTACHMENT_BYTES_EVENT_CHANNEL,
  type AttachmentBytesEvent,
  type AttachmentBytesRequest
} from '../shared/ipc/attachmentBytes'
import {
  ATTACHMENT_OPEN_CHANNEL,
  ATTACHMENT_OPEN_EVENT_CHANNEL,
  type AttachmentOpenEvent,
  type AttachmentOpenRequest
} from '../shared/ipc/attachmentOpen'

// The bridge surface exposed to the renderer window. Typed events from the transport in
// the background process arrive via onDaemonEvent; typed user commands go out via
// sendCommand. Keys and raw bytes stay in the background process; ipcRenderer itself never
// crosses the bridge.
const api = {
  /**
   * Ship a typed command to the background process. Fire-and-forget (no reply); the daemon's
   * response arrives later as typed events over the #18 channel. COMMAND_CHANNEL is fixed
   * here so the renderer cannot address arbitrary IPC channels, and ipcRenderer never crosses
   * the bridge — only this typed function does.
   */
  sendCommand: (command: RendererCommand): void => {
    ipcRenderer.send(COMMAND_CHANNEL, command)
  },

  /**
   * Ship a content-free diagnostic record to the background process logger (#126). Fire-and-forget,
   * one-way (returns void, no reply, no throw path back into the window — a diagnostics channel must
   * not take down the window it observes). The typed `record` param is the compile-time half of the
   * allowlist; the main-side projection (#131) is the runtime half that actually enforces it, since
   * the renderer is untrusted at the IPC boundary regardless of the TS type. DIAGNOSTIC_CHANNEL is
   * fixed here so the renderer cannot address arbitrary IPC channels, and ipcRenderer never crosses
   * the bridge. No consumer is wired yet — the state-store instrumentation is #134.
   */
  sendDiagnostic: (record: RendererDiagnosticEvent): void => {
    ipcRenderer.send(DIAGNOSTIC_CHANNEL, record)
  },

  /**
   * Submit a pasted pairing payload to the background process and await either the display
   * fingerprint (to confirm) or a typed error. Request/response (ipcRenderer.invoke), unlike
   * sendCommand's fire-and-forget — pairing needs a reply. PAIRING_CHANNEL is fixed here so the
   * renderer cannot address arbitrary channels, and ipcRenderer never crosses the bridge. The paste
   * is the only value that leaves the renderer; the token and server key never come back — only the
   * fingerprint or a value-free reason. `invoke` returns Promise<any>, so the narrower declared
   * return type is a typed wrapper (no unsafe cast).
   */
  submitPairingPaste: (paste: string): Promise<PairingSubmitResponse> =>
    ipcRenderer.invoke(PAIRING_CHANNEL, { type: 'submit', paste }),

  /**
   * Confirm the currently-prepared pairing — a signal carrying no record (the fingerprinted record
   * stays in the background process, #53), at most the operator's display label for the host (#823).
   * The label is the ONE exception to the bare-signal shape, and it is not the record: it is local
   * text about a host, bound for the host-label store, with no wire field and no route to the daemon.
   * Resolves to success or a typed error — nothing about the label crosses back. Mirrors
   * submitPairingPaste's fixed-channel, no-ipcRenderer-crossing discipline.
   *
   * The omitted-label request is built without the key at all, so the no-label path stays exactly
   * what it was. That is a convenience, NOT a defence: the renderer is untrusted and can invoke with
   * anything, so isPairingRequest bounds and type-checks the label on its own merits regardless.
   */
  confirmPairing: (label?: string): Promise<PairingConfirmResponse> =>
    ipcRenderer.invoke(
      PAIRING_CHANNEL,
      label === undefined ? { type: 'confirm' } : { type: 'confirm', label }
    ),

  /**
   * Ask the background process, at launch, whether a stored pairing exists — so the renderer can
   * choose a screen (#80) before first paint, without racing the connect sequence. Resolves to the
   * value-free three-outcome enum (paired / not-paired / error). Request/response
   * (ipcRenderer.invoke) called with NO second argument — no data leaves the renderer; only the
   * enum comes back, never the token / server key / relay. PAIRING_STATUS_CHANNEL is fixed here so
   * the renderer cannot address arbitrary channels, and ipcRenderer never crosses the bridge.
   */
  pairingStatus: (): Promise<PairingStatus> => ipcRenderer.invoke(PAIRING_STATUS_CHANNEL),

  /**
   * Ask the background process to erase the stored pairing, returning the app to a clean, not-paired
   * state (#173). Request/response (ipcRenderer.invoke) called with NO second argument — no data
   * leaves the renderer; only the value-free ok/error enum comes back, never the token / server key /
   * relay / keychain path. UNPAIR_CHANNEL is fixed here so the renderer cannot address arbitrary
   * channels, and ipcRenderer never crosses the bridge. No caller is wired yet — the visible unpair
   * action is #166/#167.
   */
  unpair: (): Promise<UnpairResult> => ipcRenderer.invoke(UNPAIR_CHANNEL),

  /**
   * Ask the background process for the paired server's NON-SECRET identity — its server id and relay
   * URL — so a Settings screen can tell the user which server they are paired with, including while
   * disconnected (#340/#334). Request/response (ipcRenderer.invoke) called with NO second argument —
   * no data leaves the renderer; only the two-field-or-absent union comes back, never the token /
   * server key. SERVER_INFO_CHANNEL is fixed here so the renderer cannot address arbitrary channels,
   * and ipcRenderer never crosses the bridge. No caller is wired yet — the renderer store is #340.
   */
  serverInfo: (): Promise<ServerInfo> => ipcRenderer.invoke(SERVER_INFO_CHANNEL),

  /**
   * Ask the background process for the host label the operator typed at pairing time (#822/#823), so
   * a surface can render the host's own name instead of a generic word (#824). Reads AT-REST state,
   * so it answers whether or not a connection is live. Request/response (ipcRenderer.invoke) called
   * with NO second argument — no data leaves the renderer; only the three-outcome union comes back
   * (stored / not-stored / error), never the token / server key / keychain path, and never a
   * truncated label. HOST_LABEL_CHANNEL is fixed here so the renderer cannot address arbitrary
   * channels, and ipcRenderer never crosses the bridge. No caller is wired yet — the renderer store
   * and the sidebar host row are #826.
   */
  hostLabel: (): Promise<HostLabelResult> => ipcRenderer.invoke(HOST_LABEL_CHANNEL),

  /**
   * Subscribe to typed daemon events from the background process; returns an unsubscribe
   * handle the renderer must call on teardown (#19/#12) so listeners don't accumulate across
   * remounts. The raw IpcRendererEvent (exposing .sender/.ports) is stripped before the
   * listener runs, and removeListener uses the exact handler registered so the handle
   * removes precisely the listener it added.
   */
  onDaemonEvent: (listener: (event: DaemonEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, event: DaemonEvent): void => listener(event)
    ipcRenderer.on(DAEMON_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(DAEMON_EVENT_CHANNEL, handler)
  },

  /**
   * Ask the background process to let the user attach a file (#862). Fire-and-forget (no reply); the
   * outcome arrives later on the push channel below, because the flow reports MORE THAN ONE message
   * per intent once #864 adds progress.
   *
   * CALLED WITH NO ARGUMENT, and that is the point rather than an omission: this window names an
   * INTENT, never a file. Nothing crosses on THIS call, so no string it could supply reaches a host
   * path, a declared filename, or the wire — the picker, the path and the bytes all stay in the
   * background process. ATTACHMENT_UPLOAD_CHANNEL is fixed here so the renderer cannot address
   * arbitrary IPC channels, and ipcRenderer never crosses the bridge.
   *
   * The channel itself is no longer value-free — `dropAttachmentFile` below sends a request on it — so
   * this paragraph is scoped to this function rather than to the channel. The two are told apart on the
   * main side by presence: an argument-free send reaches no request field at all.
   */
  requestAttachmentUpload: (): void => {
    ipcRenderer.send(ATTACHMENT_UPLOAD_CHANNEL)
  },

  /**
   * Attach a file the operator DROPPED onto the window (#890), entering the same flow the picker does.
   * Fire-and-forget; the outcome arrives on the push channel below, from the same driver and the same
   * exactly-one terminal.
   *
   * ⭐ THIS IS THE ONE PLACE ON THE WINDOW SIDE THAT MAY TOUCH A HOST PATH, and the deliberate, narrow
   * exception to #862's "the renderer names an intent, main owns the path" rule — the reason the ticket
   * carried `security-sensitive`. It exists because a drop is delivered by the operating system to the
   * WINDOW, as a DOM `File` on the drop event, so there is nowhere else the path can be recovered.
   * Electron 33 removed `File.path`; `webUtils.getPathForFile` is the sanctioned route and works in a
   * sandboxed preload, which this app runs (`sandbox: true`).
   *
   * WHY THE EXCEPTION IS CONTAINED. `getPathForFile` answers the EMPTY STRING for a `File` the page
   * constructed itself — only a file an operator GESTURE delivered is backed by a path. That is the
   * honest form of the property, and it is slightly wider than "only a drop": any path-backed `File`
   * this window holds would do, from a drop or a file input (this app renders none). What a compromised
   * renderer cannot do is name an arbitrary file on disk and have the background process stream it to
   * the host, which is the property #862 built the channel around.
   *
   * The resolved string is a local in this isolated-world frame and the function returns `void`, so it
   * reaches no renderer state, no log line and no diagnostic record. The `File` handle is all the window
   * ever holds. `webUtils` itself does not cross the bridge, any more than `ipcRenderer` does, and
   * ATTACHMENT_UPLOAD_CHANNEL is fixed here so the renderer cannot address arbitrary channels.
   *
   * TWO WAYS OUT WITHOUT SENDING, both silent. `getPathForFile` THROWS when handed something that is not
   * a `File`, so the call is wrapped — the `try` is what stops that throw from crossing the bridge as
   * much as it is a non-`File` filter. An empty result sends nothing. Neither is a defence on its own:
   * the window is untrusted at the boundary regardless of the declared parameter type, so
   * `isAttachmentUploadRequest` re-checks on the main side and drops a malformed ask there.
   */
  dropAttachmentFile: (file: File): void => {
    let path: string
    try {
      path = webUtils.getPathForFile(file)
    } catch {
      return
    }
    if (path === '') return
    const request: AttachmentUploadRequest = { path }
    ipcRenderer.send(ATTACHMENT_UPLOAD_CHANNEL, request)
  },

  /**
   * Attach the image on the CLIPBOARD (#1032), entering the same flow the picker and the drop do.
   * Fire-and-forget; the outcome arrives on the push channel below, from the same driver and the same
   * exactly-one terminal. #1033's paste keystroke is the only caller.
   *
   * ⭐ IT CARRIES NOTHING, AND THAT IS THE WHOLE DESIGN. This is the REVERSE cut from
   * `dropAttachmentFile` above: a drop had to admit a host path because the OS hands the file to the
   * WINDOW, but a clipboard is readable from the background process, so the window asks and main reads.
   * The one field on the wire is a client-owned literal that selects an arm — a renderer cannot vary it
   * without `isAttachmentPasteRequest` refusing the ask — so no renderer-supplied value reaches a path,
   * a filename, a byte or the wire on this path at all. The window never sees the image: the outcome
   * union is content-free by construction, so what comes back is "attached" or "no image", never a
   * pixel, a dimension or a length.
   *
   * THIS IS NOT THE `clipboard-read` PERMISSION, and must never become it. `src/main/index.ts`'s
   * permission allowlist carries a standing instruction that it must not grow to `clipboard-read` or
   * `clipboard-sanitized-read`, because reading exfiltrates whatever the user last copied — routinely a
   * password-manager secret — into the renderer's own address space. Nothing here does that: the
   * renderer gains no permission, holds no clipboard content, and cannot address the clipboard except
   * by asking for this one act. A text-flavoured secret yields an empty image and a refusal.
   *
   * ipcRenderer does not cross the bridge and ATTACHMENT_UPLOAD_CHANNEL is fixed here, so the renderer
   * cannot address arbitrary channels. There is nothing to throw and nothing to filter — unlike its
   * neighbour, this function takes no argument at all.
   */
  pasteAttachmentImage: (): void => {
    const request: AttachmentPasteRequest = { source: ATTACHMENT_PASTE_SOURCE }
    ipcRenderer.send(ATTACHMENT_UPLOAD_CHANNEL, request)
  },

  /**
   * Subscribe to attachment-upload outcomes from the background process (#862); returns an
   * unsubscribe handle the renderer must call on teardown so listeners don't accumulate across
   * remounts. The onDaemonEvent shape — the raw IpcRendererEvent (exposing .sender/.ports) is
   * stripped before the listener runs, and removeListener uses the exact handler registered.
   *
   * A cancelled picker delivers NOTHING, so a listener must not assume one event per intent. The
   * event carries no path and no file byte by construction (see AttachmentUploadEvent). No consumer
   * is wired yet — the rendering is #863.
   */
  onAttachmentUploadEvent: (listener: (event: AttachmentUploadEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, event: AttachmentUploadEvent): void => listener(event)
    ipcRenderer.on(ATTACHMENT_UPLOAD_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(ATTACHMENT_UPLOAD_EVENT_CHANNEL, handler)
  },

  /**
   * Ask the background process to fetch a stored attachment back from the host (#996). Fire-and-forget
   * (no reply); the outcome arrives later on the push channel below, because the terminal comes long
   * after the ask — after a request frame, a stream of chunks, a digest check and a disk write, which
   * an invoke reply cannot straddle.
   *
   * CALLED WITH TWO IDENTIFIERS AND NOTHING ELSE, which is where it parts from
   * `requestAttachmentUpload`'s bare intent: that one carries no argument because the picker runs in
   * the background process, and this one names what to fetch. NO PATH AND NO DIRECTORY CROSSES in
   * either direction — the attachment directory is derived in the background process from Electron's
   * per-user app-data location, never from anything this window sends. Because the window IS untrusted
   * at this boundary, the declared type is only the compile-time half: the main side re-checks the
   * shape with isAttachmentRetrievalRequest and drops a malformed ask. ATTACHMENT_RETRIEVAL_CHANNEL is
   * fixed here so the renderer cannot address arbitrary IPC channels, and ipcRenderer never crosses the
   * bridge. No caller is wired yet — the consumers are #814, #866 and #867.
   */
  requestAttachment: (request: AttachmentRetrievalRequest): void => {
    ipcRenderer.send(ATTACHMENT_RETRIEVAL_CHANNEL, request)
  },

  /**
   * Subscribe to attachment-retrieval outcomes from the background process (#996); returns an
   * unsubscribe handle the renderer must call on teardown so listeners don't accumulate across
   * remounts. The onDaemonEvent shape — the raw IpcRendererEvent (exposing .sender/.ports) is stripped
   * before the listener runs, and removeListener uses the exact handler registered.
   *
   * Correlate on the event's `attachmentId`: it is this window's OWN value coming back, and at most one
   * retrieval per identifier is live, so two concurrent fetches of different attachments stay
   * distinguishable. A duplicate ask for an attachment already being fetched delivers ONE event, not
   * two — it joins the retrieval in flight rather than starting a second. The event carries no path,
   * no filename and no file byte by construction (see AttachmentRetrievalEvent). No consumer is wired
   * yet — the rendering is #814/#866/#867.
   */
  onAttachmentRetrievalEvent: (
    listener: (event: AttachmentRetrievalEvent) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, event: AttachmentRetrievalEvent): void =>
      listener(event)
    ipcRenderer.on(ATTACHMENT_RETRIEVAL_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(ATTACHMENT_RETRIEVAL_EVENT_CHANNEL, handler)
  },

  /**
   * Ask the background process to save an attachment already on this machine into the operating
   * system's Downloads folder, with no save dialog, and reveal it there with the file selected (#814).
   * Fire-and-forget (no reply); the outcome arrives later on the push channel below, matching the
   * retrieval pair rather than an invoke.
   *
   * CALLED WITH AN IDENTIFIER AND A DISPLAY NAME. NO PATH AND NO DIRECTORY CROSSES in either direction:
   * both the app-private attachment directory and Downloads are computed in the background process from
   * Electron, never from anything this window sends. The name is DISPLAY-DERIVED, NOT ADDRESSING — the
   * bytes are selected by the identifier alone — and it is UNTRUSTED at this boundary regardless of the
   * declared type, so the main side re-runs its own sanitiser on the value it actually builds the path
   * from and re-checks the shape with isAttachmentSaveRequest, dropping a malformed ask.
   * ATTACHMENT_SAVE_CHANNEL is fixed here so the renderer cannot address arbitrary IPC channels, and
   * ipcRenderer never crosses the bridge. No caller is wired yet — the file row is #815 and the click
   * that calls this is #816.
   */
  saveAttachment: (request: AttachmentSaveRequest): void => {
    ipcRenderer.send(ATTACHMENT_SAVE_CHANNEL, request)
  },

  /**
   * Subscribe to attachment-save outcomes from the background process (#814); returns an unsubscribe
   * handle the renderer must call on teardown so listeners don't accumulate across remounts. The
   * onDaemonEvent shape — the raw IpcRendererEvent (exposing .sender/.ports) is stripped before the
   * listener runs, and removeListener uses the exact handler registered.
   *
   * Correlate on the event's `attachmentId`: it is this window's OWN value coming back, echoed even on a
   * refused identifier. Exactly one event arrives per ask that passed the boundary guard; a malformed
   * one delivers nothing at all, so a listener must not assume one event per call. The event carries no
   * path, no directory and no saved file name by construction (see AttachmentSaveEvent). No consumer is
   * wired yet — the rendering is #816.
   */
  onAttachmentSaveEvent: (listener: (event: AttachmentSaveEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, event: AttachmentSaveEvent): void => listener(event)
    ipcRenderer.on(ATTACHMENT_SAVE_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(ATTACHMENT_SAVE_EVENT_CHANNEL, handler)
  },

  /**
   * Ask the background process for the bytes of an attachment already on this machine, so the window
   * can display it (#866). Fire-and-forget (no reply); the bytes arrive later on the push channel
   * below, matching the retrieval and save pairs rather than an invoke.
   *
   * CALLED WITH AN IDENTIFIER AND NOTHING ELSE, because the window cannot be handed a path: the
   * attachment directory is computed in the background process from Electron, never from anything
   * this window sends, and `setWindowOpenHandler`'s `file:` and custom-protocol denies stay closed.
   * NO PATH, NO DIRECTORY AND NO URL crosses in either direction. The identifier is UNTRUSTED at this
   * boundary regardless of the declared type, so the main side re-checks the shape with
   * `isAttachmentBytesRequest` and drops a malformed ask, then refuses a non-canonical one at
   * `resolveAttachmentPath` before any filesystem call. ATTACHMENT_BYTES_CHANNEL is fixed here so the
   * renderer cannot address arbitrary IPC channels, and ipcRenderer never crosses the bridge.
   *
   * IT DOES NOT FETCH. An attachment that is not on this machine answers `unavailable`; fetching it
   * is `requestAttachment` above. No caller is wired yet — the thumbnail is #868.
   */
  requestAttachmentBytes: (request: AttachmentBytesRequest): void => {
    ipcRenderer.send(ATTACHMENT_BYTES_CHANNEL, request)
  },

  /**
   * Subscribe to attachment-bytes outcomes from the background process (#866); returns an unsubscribe
   * handle the renderer must call on teardown so listeners don't accumulate across remounts. The
   * onDaemonEvent shape — the raw IpcRendererEvent (exposing .sender/.ports) is stripped before the
   * listener runs, and removeListener uses the exact handler registered.
   *
   * Correlate on the event's `attachmentId`: it is this window's OWN value coming back, echoed even on
   * a refused identifier. Exactly one event arrives per ask that passed the boundary guard — asks are
   * NOT coalesced, so two asks for one attachment deliver two events — and a malformed ask delivers
   * nothing at all, so a listener must not assume one event per call.
   *
   * THIS IS THE ONE ATTACHMENT EVENT THAT CARRIES CONTENT: `delivered` holds the file's bytes, copied
   * into a buffer of exactly that length in the background process. It still carries no path, no
   * directory, no URL, no file name and no media type. Building a `blob:` or `data:` URL from those
   * bytes is #868's, and needs the renderer's `default-src 'self'` CSP widened with an `img-src`
   * directive first (`src/renderer/index.html`) — currently that URL form is blocked outright.
   */
  onAttachmentBytesEvent: (listener: (event: AttachmentBytesEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, event: AttachmentBytesEvent): void => listener(event)
    ipcRenderer.on(ATTACHMENT_BYTES_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(ATTACHMENT_BYTES_EVENT_CHANNEL, handler)
  },

  /**
   * Ask the background process to open an attachment already on this machine in the operating
   * system's default handler for its type (#867). Fire-and-forget (no reply); the outcome arrives
   * later on the push channel below, matching the three sibling pairs rather than an invoke.
   *
   * CALLED WITH AN IDENTIFIER AND NOTHING ELSE, because the window cannot be handed a path and must
   * not be able to name one: `setWindowOpenHandler`'s `file:` and custom-protocol denies stay
   * closed, and this channel is the whole reason they can. NO PATH, DIRECTORY OR URL crosses in
   * either direction. The identifier is UNTRUSTED at this boundary regardless of the declared type,
   * so the main side re-checks the shape with `isAttachmentOpenRequest` and drops a malformed ask,
   * then refuses a non-canonical one at `resolveAttachmentPath` before any filesystem call.
   * ATTACHMENT_OPEN_CHANNEL is fixed here so the renderer cannot address arbitrary IPC channels, and
   * ipcRenderer never crosses the bridge.
   *
   * THE WINDOW DOES NOT CHOOSE THE TYPE, and cannot. What the operating system is told is decided in
   * the background process from the file's own leading bytes, against a closed set of raster image
   * signatures — a file matching none of them is refused rather than opened, whatever a `mime_type`
   * claimed. IT DOES NOT FETCH either: an attachment that is not on this machine answers
   * `unavailable`; fetching it is `requestAttachment` above. No caller is wired yet — the thumbnail
   * that becomes this control is #869.
   */
  openAttachment: (request: AttachmentOpenRequest): void => {
    ipcRenderer.send(ATTACHMENT_OPEN_CHANNEL, request)
  },

  /**
   * Subscribe to attachment-open outcomes from the background process (#867); returns an unsubscribe
   * handle the renderer must call on teardown so listeners don't accumulate across remounts. The
   * onDaemonEvent shape — the raw IpcRendererEvent (exposing .sender/.ports) is stripped before the
   * listener runs, and removeListener uses the exact handler registered.
   *
   * Correlate on the event's `attachmentId`: it is this window's OWN value coming back, echoed even
   * on a refused identifier. Exactly one event arrives per ask that passed the boundary guard, and a
   * malformed ask delivers nothing at all, so a listener must not assume one event per call.
   *
   * FOUR FAILURE REASONS, AND THEY ARE APART BECAUSE A CONSUMER ACTS ON THE DIFFERENCE: `refused` is
   * permanent, `unavailable` is fetched and asked for again, `unsupported-type` means offer the save
   * leg instead, and `open-failed` is the only one a plain retry can fix. The event carries no path,
   * no derived file name, no matched type and no operating-system message by construction (see
   * AttachmentOpenEvent).
   */
  onAttachmentOpenEvent: (listener: (event: AttachmentOpenEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, event: AttachmentOpenEvent): void => listener(event)
    ipcRenderer.on(ATTACHMENT_OPEN_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(ATTACHMENT_OPEN_EVENT_CHANNEL, handler)
  }
}

// Context isolation is always on (webPreferences.contextIsolation: true), so the bridge is
// always exposed through contextBridge; there is no non-isolated fallback to keep.
try {
  contextBridge.exposeInMainWorld('pyry', api)
} catch (error) {
  console.error(error)
}

export type PyryApi = typeof api
