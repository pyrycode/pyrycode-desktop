import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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
  ATTACHMENT_UPLOAD_CHANNEL,
  ATTACHMENT_UPLOAD_EVENT_CHANNEL,
  type AttachmentUploadEvent
} from '../shared/ipc/attachmentUpload'

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
   * INTENT, never a file. Nothing crosses, so no renderer-supplied string can reach a host path, a
   * declared filename, or the wire — the picker, the path and the bytes all stay in the background
   * process. ATTACHMENT_UPLOAD_CHANNEL is fixed here so the renderer cannot address arbitrary IPC
   * channels, and ipcRenderer never crosses the bridge. No caller is wired yet — the button is #863.
   */
  requestAttachmentUpload: (): void => {
    ipcRenderer.send(ATTACHMENT_UPLOAD_CHANNEL)
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
