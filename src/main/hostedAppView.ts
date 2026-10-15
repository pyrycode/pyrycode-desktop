/// <reference types="electron-vite/node" />
import { randomBytes } from 'node:crypto'
import { STATUS_CODES } from 'node:http'
import { WebContentsView, session, type BrowserWindow, type Rectangle } from 'electron'
import type { ConnectionRegistry } from './connectionRegistry'
import type { DiagnosticLog } from './diagnosticLog'
import type { HostedResourceInput, HostedResourceResult } from './transport/hostedResources'
import lockdownSource from './hostedAppLockdown.js?raw'

export type HostedAppViewState = { type: 'loading' | 'ready' | 'disconnected' | 'unsupported' | 'unavailable' | 'closed' }
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'"
function denyRequest(_details: unknown, callback: (response: { cancel: boolean }) => void): void { callback({ cancel: true }) }

/** Main-process authority only. No renderer IPC or production navigation entry. */
export function createHostedAppViews(registry: Pick<ConnectionRegistry, 'connectionFor'>, log?: DiagnosticLog) {
  const parents = new WeakMap<BrowserWindow, { close(): void }>()
  function open(parent: BrowserWindow, serverId: string, appId: string, bounds: Rectangle) {
    const apps = registry.connectionFor(serverId)?.hostedApps
    const discovery = apps?.read()
    const record = discovery?.type === 'ready' ? discovery.items.find(item => item.app_id === appId) : undefined
    const binding = apps?.openView(appId)
    if (parent.isDestroyed() || !apps || !binding?.ok || !record?.active_release) {
      log?.event({ event: 'hosted-view', code: 'unconfirmed' })
      const state: HostedAppViewState = { type: discovery?.type === 'unsupported' ? 'unsupported' :
        discovery?.type === 'unavailable' || !apps ? 'disconnected' : discovery?.type === 'loading' ? 'loading' : 'unavailable' }
      if (binding?.ok) binding.view.retire()
      return { ok: false as const, error: 'unconfirmed' as const, state }
    }
    const resource = binding.view
    parents.get(parent)?.close()
    const origin = `https://app-${randomBytes(16).toString('hex')}.invalid`
    const navigationStamp = randomBytes(16).toString('hex')
    const isolated = session.fromPartition(`hosted-${randomBytes(16).toString('hex')}`, { cache: false })
    const content = new WebContentsView({ webPreferences: { session: isolated,
      nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false,
      navigateOnDragDrop: false, spellcheck: false } })
    const wc = content.webContents, abort = new AbortController(), listeners = new Set<() => void>()
    let state: HostedAppViewState = { type: 'loading' }, retired = false, navigation = 0
    const notify = (): void => {
      for (const listener of [...listeners]) { try { listener() } catch { /* Observers cannot change policy. */ } }
    }
    const event = (code: string): void => log?.event({ event: 'hosted-view', code })
    function finish(type: HostedAppViewState['type']): void {
      if (retired) return
      retired = true; state = { type }; abort.abort(); resource.retire(); off()
      parent.removeListener('closed', onParentClosed)
      if (!parent.isDestroyed()) parent.contentView.removeChildView(content)
      if (parents.get(parent) === view) parents.delete(parent)
      if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false })
      isolated.protocol.unhandle('https')
      isolated.webRequest.onBeforeRequest(denyRequest)
      // Even requests retained by Chromium fail after retirement; the session is never reused.
      void isolated.clearStorageData().catch(() => event('storage-failed'))
      event(type); notify(); listeners.clear()
    }
    const sameOrigin = (url: string): boolean => {
      try { const parsed = new URL(url); return parsed.origin === origin && !parsed.username && !parsed.password }
      catch { return false }
    }
    isolated.setPermissionCheckHandler(() => false)
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    isolated.setDevicePermissionHandler(() => false)
    isolated.on('will-download', event => { event.preventDefault() })
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const allowed = !retired && sameOrigin(details.url) && details.method === 'GET' &&
        ['mainFrame', 'stylesheet', 'script', 'image', 'font', 'xhr', 'media'].includes(details.resourceType)
      if (!allowed) event('denied')
      callback({ cancel: !allowed })
    })
    isolated.protocol.handle('https', async request => {
      try {
        if (retired || !sameOrigin(request.url) || request.method !== 'GET' || request.headers.has('range')) {
          event('denied'); return Response.error()
        }
        const url = new URL(request.url), query = url.search.slice(1)
        const common = { path: url.pathname, ...(query ? { query } : {}) }
        const api = url.pathname.startsWith('/api/')
        const headers: Record<string, string> = {}
        for (const name of ['accept', 'content-type', 'if-none-match']) {
          const value = request.headers.get(name)
          if (value !== null) headers[name] = value
        }
        const result = await resource.request(api
          ? { type: 'app_api_request', payload: { ...common, method: 'GET', headers, body: '' } }
          : { type: 'app_asset_request', payload: { ...common, navigation: request.headers.get('X-Pyry-Navigation') === navigationStamp } }, abort.signal)
        if (retired || !result.ok || (result.metadata.status >= 300 && result.metadata.status < 400)) {
          event('resource-failed'); return Response.error()
        }
        const { metadata, bytes } = result
        return new Response([204, 205].includes(metadata.status) ? null : new Uint8Array(bytes), {
          status: metadata.status, statusText: STATUS_CODES[metadata.status] ?? 'App response',
          headers: { ...metadata.headers, 'content-length': String(bytes.length),
            'content-security-policy': csp, 'x-content-type-options': 'nosniff' } })
      } catch { event('resource-failed'); return Response.error() }
    })
    wc.setWindowOpenHandler(() => { event('denied'); return { action: 'deny' } })
    wc.on('will-frame-navigate', details => {
      details.preventDefault()
      if (details.isMainFrame && sameOrigin(details.url)) void navigate(details.url)
      else event('denied')
    })
    wc.on('will-redirect', details => { details.preventDefault(); event('denied') })
    wc.on('login', (event, _details, _authInfo, callback) => { event.preventDefault(); callback() })
    wc.on('did-finish-load', () => { if (!retired && sameOrigin(wc.getURL())) { state = { type: 'ready' }; event('ready'); notify() } })
    wc.on('render-process-gone', () => finish('unavailable'))
    wc.on('destroyed', () => finish('closed'))
    const off = apps.subscribe(() => {
      const next = apps.read()
      const current = next.type === 'ready' ? next.items.find(item => item.app_id === appId) : undefined
      if (next.type !== 'ready' || current?.state !== 'running' || current.active_release !== record.active_release)
        finish(next.type === 'unavailable' ? 'disconnected' : next.type === 'unsupported' ? 'unsupported' : 'unavailable')
    })
    const onParentClosed = (): void => finish('closed')
    const view = { origin, content, read: (): HostedAppViewState => ({ ...state }),
      // Native capability for the Fetch consumer; never installed in page JavaScript.
      async request(input: HostedResourceInput, signal?: AbortSignal): Promise<HostedResourceResult> {
        const result = await resource.request(input, signal)
        if (!retired) return result
        const mutation = input.type === 'app_api_request' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(input.payload.method)
        return { ok: false, error: 'retired', uncertain: mutation && (result.ok || result.uncertain) }
      },
      subscribe(listener: () => void): () => void { if (!retired) listeners.add(listener); return () => { listeners.delete(listener) } },
      resize(next: Rectangle): void { if (!retired) content.setBounds(next) }, close: (): void => finish('closed') }
    parents.set(parent, view); parent.once('closed', onParentClosed)
    parent.contentView.addChildView(content); content.setBounds(bounds); event('opened')
    async function navigate(url: string): Promise<void> {
      const generation = ++navigation
      if (retired) return
      if (state.type !== 'loading') { state = { type: 'loading' }; notify() }
      try { await wc.loadURL(url, { extraHeaders: `X-Pyry-Navigation: ${navigationStamp}\r\n` }) }
      catch { if (!retired && generation === navigation) finish('unavailable') }
    }
    async function load(): Promise<void> {
      try {
        await wc.loadURL('about:blank')
        if (retired) return
        wc.debugger.attach('1.3')
        await wc.debugger.sendCommand('Page.enable')
        await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: lockdownSource })
        await wc.debugger.sendCommand('Emulation.setDocumentCookieDisabled', { disabled: true })
        await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
        if (!retired) await navigate(`${origin}/`)
      } catch { if (!retired) finish('unavailable') }
    }
    wc.debugger.on('detach', () => { if (!retired) finish('unavailable') })
    void load() // load catches setup/navigation failure and retires the view.
    return { ok: true as const, view }
  }
  return { open }
}

declare global {
  namespace Electron {
    interface App { readonly hostedAppViews?: ReturnType<typeof createHostedAppViews> }
  }
}
