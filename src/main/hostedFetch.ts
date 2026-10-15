import { randomBytes } from 'node:crypto'
import { ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import { encodeEnvelope } from './transport/codec'
import { decodeHostedResource } from './transport/hostedResourceCodec'
import type { HostedResourceInput, HostedResourceResult } from './transport/hostedResources'

/** Only request semantics cross this boundary; the captured binding owns authority. */
export function installHostedFetch(wc: WebContents, origin: string, appId: string, release: string,
  request: (input: HostedResourceInput, signal: AbortSignal) => Promise<HostedResourceResult>,
  cancelRequests: (signals: ReadonlySet<AbortSignal>) => void, denied: () => void) {
  let token = '', last = 0, retired = false
  const pending = new Map<number, AbortController>()
  const replace = (): void => {
    token = randomBytes(16).toString('hex'); last = 0
    const old = [...pending.values()]
    pending.clear()
    cancelRequests(new Set(old.map(controller => controller.signal)))
    for (const controller of old) controller.abort()
  }
  const valid = (event: IpcMainEvent): boolean => {
    if (retired || wc.isDestroyed() || event.sender !== wc || event.senderFrame !== wc.mainFrame) return false
    try { return new URL(event.senderFrame.url).origin === origin } catch { return false }
  }
  const bind = (event: IpcMainEvent): void => {
    if (event.sender !== wc) return
    if (valid(event)) { replace(); event.returnValue = token }
    else event.returnValue = null
  }
  async function receive(event: IpcMainEvent, supplied: unknown, id: unknown, operation: unknown, input: unknown): Promise<void> {
    if (event.sender !== wc) return
    if (!valid(event) || supplied !== token) { denied(); return }
    if (operation === 'abort-document' && id === 0 && input === undefined) { replace(); return }
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) { denied(); return }
    if (operation === 'abort') { pending.get(id)?.abort(); return }
    const document = token
    const reply = (value: unknown): void => {
      if (valid(event) && token === document) event.reply('hosted-fetch-reply', document, id, value)
    }
    if (operation !== 'request' || id <= last) { denied(); return }
    if (pending.size >= 16) { denied(); reply({ error: 'network' }); return }
    last = id
    const controller = new AbortController()
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).some(key => !['url', 'method', 'headers', 'body'].includes(key)) ||
          !('url' in input) || typeof input.url !== 'string' || input.url.length > 4096 ||
          !('method' in input) || typeof input.method !== 'string' || input.method.length > 7 ||
          !('headers' in input) || !('body' in input) || !(input.body instanceof Uint8Array) || input.body.byteLength > 32768) throw new Error()
      const url = new URL(input.url)
      if (url.origin !== origin || url.username || url.password || url.hash) throw new Error()
      const headers = input.headers
      if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > 3 ||
          Object.entries(headers).some(([key, value]) => !['accept', 'content-type', 'if-none-match'].includes(key) ||
            typeof value !== 'string' || value.length > 1024 || Buffer.byteLength(value) > 1024 || /[\x00-\x1f\x7f-\x9f]/.test(value))) throw new Error()
      const api = url.pathname.startsWith('/api/')
      if (!api && (input.method !== 'GET' || input.body.byteLength !== 0)) throw new Error()
      const common = { app_id: appId, release_version: release, path: url.pathname, ...(url.search.slice(1) ? { query: url.search.slice(1) } : {}) }
      const parsed = decodeHostedResource(encodeEnvelope({ id: 1, ts: '2026-10-15T00:00:00Z',
        type: api ? 'app_api_request' : 'app_asset_request', payload: api
          ? { ...common, method: input.method, headers: input.headers, body: Buffer.from(input.body).toString('base64') }
          : { ...common, navigation: false } }), 'client-to-daemon')
      if (parsed.type !== 'app_api_request' && parsed.type !== 'app_asset_request') throw new Error()
      pending.set(id, controller)
      const result = await request(parsed, controller.signal)
      if (pending.get(id) !== controller || token !== document) return
      reply(result.ok ? { status: result.metadata.status, headers: result.metadata.headers, bytes: new Uint8Array(result.bytes) }
        : { error: result.error === 'aborted' ? 'aborted' : 'network' })
    } catch { denied(); reply({ error: 'network' }) }
    finally { if (pending.get(id) === controller) pending.delete(id) }
  }
  const message = (event: IpcMainEvent, ...args: [unknown, unknown, unknown, unknown]): void => {
    void receive(event, ...args) // receive catches validation and transport failures.
  }
  ipcMain.on('hosted-fetch-bind', bind); ipcMain.on('hosted-fetch', message)
  return () => {
    retired = true; replace()
    ipcMain.removeListener('hosted-fetch-bind', bind); ipcMain.removeListener('hosted-fetch', message)
  }
}
