import { contextBridge, ipcRenderer } from 'electron'

// A private document fence. Page code sees request semantics, never this token or IPC.
const token: unknown = ipcRenderer.sendSync('hosted-fetch-bind')
let sequence = 0
const pending = new Map<number, (value: unknown) => void>()
ipcRenderer.on('hosted-fetch-reply', (_event, document: unknown, id: number, value: unknown) => {
  if (document !== token) return
  const resolve = pending.get(id)
  pending.delete(id); resolve?.(value)
})
contextBridge.exposeInMainWorld('hostedFetch', {
  request(input: unknown) {
    if (!input || typeof input !== 'object' || !('body' in input) || !(input.body instanceof Uint8Array) ||
        Object.keys(input).some(key => !['url', 'method', 'headers', 'body'].includes(key)) ||
        input.body.byteLength > 32768 || !('url' in input) || typeof input.url !== 'string' || input.url.length > 4096 ||
        !('method' in input) || typeof input.method !== 'string' || input.method.length > 7 ||
        !('headers' in input) || !input.headers || typeof input.headers !== 'object' ||
        Object.keys(input.headers).length > 3 || Object.values(input.headers).some(v => typeof v !== 'string' || v.length > 1024) ||
        pending.size >= 16) return { id: 0, result: Promise.resolve({ error: 'network' }) }
    const id = ++sequence
    const result = new Promise<unknown>(resolve => pending.set(id, resolve))
    ipcRenderer.send('hosted-fetch', token, id, 'request', input)
    return { id, result }
  },
  abort(id: number) { if (Number.isSafeInteger(id) && id > 0) ipcRenderer.send('hosted-fetch', token, id, 'abort') }
})
window.addEventListener('pagehide', () => {
  for (const [id, resolve] of pending) {
    ipcRenderer.send('hosted-fetch', token, id, 'abort'); resolve({ error: 'network' })
  }
  pending.clear(); ipcRenderer.removeAllListeners('hosted-fetch-reply')
}, { once: true })
