import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'

// The bridge surface exposed to the renderer window. Typed events from the transport in
// the background process arrive via onDaemonEvent. Keys and raw bytes stay in the
// background process; ipcRenderer itself never crosses the bridge.
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),

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
