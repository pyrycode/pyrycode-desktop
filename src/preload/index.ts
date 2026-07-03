import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'
import { COMMAND_CHANNEL, type RendererCommand } from '../shared/ipc/commands'

// The bridge surface exposed to the renderer window. Typed events from the transport in
// the background process arrive via onDaemonEvent; typed user commands go out via
// sendCommand. Keys and raw bytes stay in the background process; ipcRenderer itself never
// crosses the bridge.
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),

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

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('pyry', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore fallback when context isolation is disabled
  window.pyry = api
}

export type PyryApi = typeof api
