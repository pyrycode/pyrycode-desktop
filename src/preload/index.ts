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
   * Confirm the currently-prepared pairing — a bare signal carrying no record (the fingerprinted
   * record stays in the background process, #53). Resolves to success or a typed error. Mirrors
   * submitPairingPaste's fixed-channel, no-ipcRenderer-crossing discipline.
   */
  confirmPairing: (): Promise<PairingConfirmResponse> =>
    ipcRenderer.invoke(PAIRING_CHANNEL, { type: 'confirm' }),

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
