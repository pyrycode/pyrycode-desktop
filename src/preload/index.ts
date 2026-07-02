import { contextBridge, ipcRenderer } from 'electron'

// Placeholder bridge surface. The typed event channel from the transport in the
// background process lands here. Keys and raw bytes stay in the background process.
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping')
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
