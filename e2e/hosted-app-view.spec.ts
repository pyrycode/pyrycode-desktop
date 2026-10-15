import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, seedConversationsFrame, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import type { ElectronApplication } from '@playwright/test'

const appId = '22222222-2222-4222-8222-222222222222'
const record = (release = '1.0.0') => ({ app_id: appId, title: 'Example', state: 'running', desired: 'available',
  active_release: release, pending_release: null, last_error: null, revision: 1 })
function scenario(label = 'first', fetchService = false) {
  const seen: any[] = [], chunks = new Map<number, { app: string; bytes: Buffer[] }>()
  const late: Uint8Array[] = [], discovery: Uint8Array[] = []
  let id = 1000, release = '1.0.0', revision = 1, holdDiscovery = false
  let preference = ''
  const frame = (type: string, payload: unknown, reply?: number) => Buffer.from(JSON.stringify({
    id: id++, type, ts: '2026-10-15T10:00:00Z', ...(reply === undefined ? {} : { in_reply_to: reply }), payload }))
  const part = (request: number, index: number) => {
    const c = chunks.get(request)!
    return frame('app_response_chunk', { app_id: c.app, index, data: c.bytes[index].toString('base64') }, request)
  }
  return { seen, frame, late, discovery, holdDiscovery() { holdDiscovery = true }, update(next: string, state = 'running') { release = next; revision++;
    return frame('app_updated', { ...record(release), state, revision }) },
  options: { helloAck: { server_id: label === 'second' ? SECOND_SERVER_ID : FIRST_SERVER_ID, capabilities: ['hosted_apps_v1'] }, buildReplyFrames(bytes: Uint8Array) {
    const r = JSON.parse(Buffer.from(bytes).toString()); seen.push(r)
    if (r.type === 'list_conversations') return [seedConversationsFrame(label === 'second' ? SECOND_SEEDED_ROW : undefined)]
    if (r.type === 'list_apps') {
      const reply = frame('apps', { revision, items: [{ ...record(release), revision }], next_cursor: null }, r.id)
      if (holdDiscovery) { discovery.push(reply); return [] }
      return [reply]
    }
    if (r.type === 'app_response_credit') return [part(r.payload.request_id, r.payload.next_index)]
    if (r.type === 'app_cancel') return [frame('app_cancelled', r.payload, r.id)]
    if (!['app_asset_request', 'app_api_request'].includes(r.type)) return []
    const path = r.payload.path
    if (fetchService && path === '/api/preferences' && r.payload.method === 'POST')
      preference = Buffer.from(r.payload.body, 'base64').toString()
    const resources: Record<string, [string, Buffer | string]> = {
      '/': ['text/html', '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><p>Loading</p><img src="/pixel.svg"><script type="module" src="./main.js"></script></body></html>'],
      '/index.html': ['text/html', '<!doctype html><script type="module" src="/main.js"></script><p>SPA</p>'],
      '/main.js': ['text/javascript', `import { value } from './value.js'; const dynamic = await import('/dynamic.js'); document.body.dataset.loaded = value + dynamic.value; document.querySelector('p').textContent = 'Hosted app on ' + value;`],
      '/value.js': ['text/javascript', `export const value = '${label}';`],
      '/dynamic.js': ['text/javascript', `export const value = '-dynamic';`],
      '/style.css': ['text/css', 'body { color: rgb(1, 2, 3) }'],
      '/pixel.svg': ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>'],
      '/binary.bin': ['application/octet-stream', Buffer.alloc(70000, 173)],
      '/api/read': ['application/json', '{"ok":true}']
    }
    if (fetchService) resources['/api/preferences'] = ['text/plain', r.payload.method === 'POST' ? '' : preference]
    const asset = resources[path] ?? (r.payload.navigation && !path.includes('.') && !path.startsWith('/api') && !path.startsWith('/_pyry') ? resources['/index.html'] : undefined)
    const status = path === '/api/empty' || (fetchService && path === '/api/preferences' && r.payload.method === 'POST') ? 204 : path === '/api/reset' ? 205 : path === '/api/redirect' ? 302 : path === '/api/cached' ? 304 : asset ? 200 : 404
    const body = Buffer.from(r.payload.method === 'HEAD' ? '' : asset?.[1] ?? '')
    const pieces: Buffer[] = []
    for (let i = 0; i < body.length; i += 32768) pieces.push(body.subarray(i, i + 32768))
    chunks.set(r.id, { app: appId, bytes: pieces })
    const frames = [frame('app_response', { app_id: appId, release_version: r.payload.release_version, status,
      headers: { 'content-type': asset?.[0] ?? 'text/plain', etag: '"test"' }, size_bytes: body.length,
      total_chunks: pieces.length, sha256: createHash('sha256').update(body).digest('hex') }, r.id),
    ...(pieces.length ? [part(r.id, 0)] : [])]
    if (path === '/api/held' || (fetchService && r.payload.query === 'hold=1')) { late.push(...frames); return [] }
    return frames
  } } }
}
async function open(app: ElectronApplication, server = FIRST_SERVER_ID, separate = false) {
  const parentId = await app.evaluate(({ BrowserWindow }, separate) => (separate ? new BrowserWindow({ show: false }) :
    BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))!).id, separate)
  let opened: { origin: string; id: number } | undefined
  let unexpected: unknown
  await expect.poll(async () => {
    if (opened) return true // Retain the first successful native handle; never replace it while polling.
    const result = await app.evaluate(({ BrowserWindow, app }, { server, appId, parentId }) => {
      const controller = (app as any).hostedAppViews
      const parent = BrowserWindow.fromId(parentId)!
      const result = controller.open(parent, server, appId, { x: 400, y: 60, width: 600, height: 600 })
      if (!result.ok) { (globalThis as any).hostedOpenRefusal = result; return result }
      ;(globalThis as any).hosted = result.view
      ;(globalThis as any).hostedParent = parent
      ;(globalThis as any).hostedStates = [result.view.read().type]
      result.view.subscribe(() => (globalThis as any).hostedStates.push(result.view.read().type))
      return { ok: true as const, origin: result.view.origin, id: result.view.content.webContents.id }
    }, { server, appId, parentId })
    if (!result.ok) {
      if (result.error === 'unconfirmed' && result.state.type === 'loading') return false
      unexpected = result; return true
    }
    opened = { origin: result.origin, id: result.id }
    return true
  }).toBe(true)
  expect(unexpected).toBeUndefined()
  if (!opened) throw new Error('authoritative open did not complete')
  return opened
}
async function expectDiscoveryPending(app: ElectronApplication) {
  expect(await app.evaluate(({ app, BrowserWindow }, { appId, server }) => app.hostedAppViews!.open(
    BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))!, server,
    appId, { x: 400, y: 60, width: 600, height: 600 }), { appId, server: FIRST_SERVER_ID }))
    .toEqual({ ok: false, error: 'unconfirmed', state: { type: 'loading' } })
}
async function evaluate(app: ElectronApplication, script: string) {
  return app.evaluate(async (_, script) => (globalThis as any).hosted.content.webContents.executeJavaScript(script), script)
}

test('Fetch writes retained preferences and serializes bounded request bodies', async ({ launchPairedApp }) => {
  const s = scenario('first', true), { app } = await launchPairedApp(s.options)
  await open(app)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
  expect(await evaluate(app, `fetch('/api/preferences?b=%2f&a=&a=2#drop', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{"period":"24h"}'}).then(r => [r.status,r.body===null])`)).toEqual([204,true])
  expect(s.seen.filter(r => r.type === 'app_api_request').at(-1).payload).toMatchObject({
    method: 'POST', query: 'b=%2f&a=&a=2', headers: { 'content-type': 'application/json' }, body: Buffer.from('{"period":"24h"}').toString('base64') })
  await open(app)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
  expect(await evaluate(app, `fetch('/api/preferences').then(r=>r.text())`)).toBe('{"period":"24h"}')
  for (const body of [`new Blob([new Uint8Array([0,255,128])],{type:'application/octet-stream'})`, `new Uint8Array([0,255,128])`, `new Uint8Array([0,255,128]).buffer`]) {
    expect(await evaluate(app, `fetch('/api/preferences',{method:'PUT',body:${body}}).then(r=>r.status)`)).toBe(200)
    expect(Buffer.from(s.seen.filter(r=>r.type==='app_api_request').at(-1).payload.body,'base64')).toEqual(Buffer.from([0,255,128]))
  }
  expect(await evaluate(app, `(async()=>{const f=new FormData();f.append('key','value');f.append('file',new Blob([new Uint8Array([0,255])]),'a.bin');return (await fetch('/api/preferences',{method:'PATCH',body:f})).status})()`)).toBe(200)
  const multipart = s.seen.filter(r=>r.type==='app_api_request').at(-1).payload
  const boundary = multipart.headers['content-type'].split('boundary=')[1]
  expect(Buffer.from(multipart.body,'base64').toString('latin1')).toBe(`--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\nvalue\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n\x00\xff\r\n--${boundary}--\r\n`)
  expect(await evaluate(app, `fetch('/api/preferences',{method:'POST',body:new Uint8Array(32768)}).then(r=>r.status)`)).toBe(204)
  expect(Buffer.from(s.seen.filter(r=>r.type==='app_api_request').at(-1).payload.body,'base64')).toHaveLength(32768)
  expect(await evaluate(app, `Promise.all([
    {method:'POST',body:new Uint8Array(32769)}, {method:'POST',body:'é'.repeat(32768)},
    {method:'POST',body:new Blob([new Uint8Array(32769)])},
    {method:'POST',body:(()=>{const f=new FormData();f.append('f',new Blob([new Uint8Array(32768)]));return f})()},
    {method:'GET',body:'x'}, {method:'HEAD',body:'x'}, {method:'TRACE'},
    {headers:{Range:'bytes=0-1'}}, {headers:{Authorization:'no'}},
    {method:'POST',body:new ReadableStream()}
  ].map(o=>fetch('/api/read',o).then(()=>false,e=>e.name==='TypeError')))`)).toEqual(Array(10).fill(true))
  expect(await evaluate(app, `Promise.all(['HEAD','OPTIONS','DELETE'].map(method=>fetch('/api/read',{method}).then(async r=>[r.status,method==='HEAD'?r.body===null:await r.text()])) )`)).toEqual([[200,true],[200,'{"ok":true}'],[200,'{"ok":true}']])
  expect(await evaluate(app, `Promise.all(['/api/empty','/api/reset','/api/cached','/api/redirect','/missing'].map(p=>fetch(p).then(r=>[r.status,r.body===null,r.headers.get('location')])))`)).toEqual([[204,true,null],[205,true,null],[304,true,null],[302,false,null],[404,false,null]])
})

test('Fetch cancellation and document replacement fence late completions and forged bridge calls', async ({ launchPairedApp }) => {
  const s = scenario(), { app, daemon } = await launchPairedApp(s.options)
  const first = await open(app)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
  expect(await evaluate(app, `(()=>{const c=new AbortController();c.abort();return fetch('/api/held',{signal:c.signal}).catch(e=>e.name)})()`)).toBe('AbortError')
  await evaluate(app, `window.controller=new AbortController();window.settlements=[];window.pending=fetch('/api/held',{signal:controller.signal}).then(()=>settlements.push('resolved'),e=>settlements.push(e.name));undefined`)
  await expect.poll(() => s.late.length).toBe(1)
  await evaluate(app, 'controller.abort();controller.abort();undefined')
  expect(await evaluate(app, 'pending.then(()=>settlements)')).toEqual(['AbortError'])
  const held = s.seen.find(r=>r.type==='app_api_request' && r.payload.path==='/api/held')
  await expect.poll(() => s.seen.some(r=>r.type==='app_cancel' && r.payload.request_id===held.id)).toBe(true)
  for (const frame of s.late.splice(0)) daemon.pushFrame(frame)
  expect(await evaluate(app, `fetch('/api/read?barrier=aborted').then(r=>r.status)`)).toBe(200)
  expect(await evaluate(app, 'settlements')).toEqual(['AbortError'])
  // Preserve another held response across document replacement and reuse the first page sequence.
  await evaluate(app, `window.pending=fetch('/api/held').catch(()=>null);undefined`)
  await expect.poll(() => s.seen.filter(r=>r.type==='app_api_request' && r.payload.path==='/api/held').length).toBe(2)
  const oldToken = await app.evaluate(({ ipcMain }) => {
    const wc=(globalThis as any).hosted.content.webContents
    const event:any={sender:wc,senderFrame:wc.mainFrame}
    ipcMain.emit('hosted-fetch-bind',event);return event.returnValue
  })
  await evaluate(app, `location.href='/replaced';undefined`)
  await expect.poll(() => evaluate(app, '[location.pathname,document.body.dataset.loaded]')).toEqual(['/replaced','first-dynamic'])
  const baseline=s.seen.filter(r=>r.type==='app_api_request').length
  // Exercise real main listeners with hostile sender/frame/token, then the page-facing surface.
  await app.evaluate(({ ipcMain, BrowserWindow }, { oldToken, first }) => {
    const wc=(globalThis as any).hosted.content.webContents
    const input={url:first.origin+'/api/forged',method:'POST',headers:{},body:new Uint8Array()}
    const emit=(sender:any,frame:any,token:any,operation='request')=>ipcMain.emit('hosted-fetch',
      {sender,senderFrame:frame,reply(){}},token,1,operation,input)
    emit(wc,wc.mainFrame,oldToken); emit(wc,wc.mainFrame,oldToken,'abort')
    emit(BrowserWindow.getAllWindows().find(w=>w.webContents!==wc)!.webContents,wc.mainFrame,oldToken)
    emit(wc,{url:first.origin+'/'},oldToken)
  }, {oldToken,first})
  for (const frame of s.late.splice(0)) daemon.pushFrame(frame)
  expect(await evaluate(app, `hostedFetch.request({url:location.origin+'/api/forged',method:'POST',headers:{},body:new Uint8Array(),app_id:'other'}).result.then(r=>r.error)`)).toBe('network')
  expect(await evaluate(app, `Promise.all(['https://other.invalid/api/x','data:text/plain,hello',location.origin.replace('https://','https://user@')+'/api/x'].map(url=>fetch(url).then(()=>false,()=>true)))`)).toEqual([true,true,true])
  expect(await evaluate(app, `fetch('/api/read?barrier=forged').then(r=>r.status)`)).toBe(200)
  expect(s.seen.filter(r=>r.type==='app_api_request').slice(baseline).map(r=>r.payload.path)).toEqual(['/api/read'])
})

test('Fetch reconnect reconciles committed uncertain writes without replay', async ({ launchPairedApp }) => {
  const s=scenario('first',true), { app, page, daemon }=await launchPairedApp(s.options)
  const first=await open(app)
  await expect.poll(()=>evaluate(app,'document.body.dataset.loaded')).toBe('first-dynamic')
  await evaluate(app, `window.pending=fetch('/api/preferences?hold=1',{method:'POST',body:'committed'}).catch(()=>null);undefined`)
  await expect.poll(()=>s.late.length).toBe(1) // Fake service committed before withholding its reply.
  s.holdDiscovery()
  await page.evaluate(server=>window.pyry.reconnectServer(server),FIRST_SERVER_ID)
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).hosted.read().type)).toBe('disconnected')
  await expect.poll(()=>s.discovery.length).toBe(1)
  await expectDiscoveryPending(app)
  for(const frame of s.discovery.splice(0)) daemon.pushFrame(frame)
  const next=await open(app)
  expect(next.origin).not.toBe(first.origin)
  await expect.poll(()=>evaluate(app,'document.body.dataset.loaded')).toBe('first-dynamic')
  for(const frame of s.late.splice(0)) daemon.pushFrame(frame)
  expect(await evaluate(app,`fetch('/api/preferences?barrier=reconcile').then(r=>r.text())`)).toBe('committed')
  expect(s.seen.filter(r=>r.type==='app_api_request' && r.payload.method==='POST')).toHaveLength(1)
  // Retained fake-service state proves the client contract; real SQL durability is #1929's gate.
})

test('native resources load modules, SPA navigation, binary bytes and HTTP semantics', async ({ launchPairedApp }) => {
  const s = scenario()
  s.holdDiscovery()
  const { app, daemon } = await launchPairedApp(s.options)
  await expect.poll(() => s.discovery.length).toBe(1)
  await expectDiscoveryPending(app)
  const opening = open(app).then(view => ({ view }), error => ({ error: String(error) }))
  await expect.poll(() => app.evaluate(() => (globalThis as any).hostedOpenRefusal))
    .toEqual({ ok: false, error: 'unconfirmed', state: { type: 'loading' } })
  for (const frame of s.discovery.splice(0)) daemon.pushFrame(frame)
  const result = await opening
  expect(result).toHaveProperty('view')
  if (!('view' in result)) throw new Error(result.error)
  const v = result.view
  expect(v.origin).toMatch(/^https:\/\/app-[a-f0-9]{32}\.invalid$/)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
  expect(await app.evaluate(() => (globalThis as any).hostedStates)).toEqual(['loading', 'ready'])
  expect(await app.evaluate(() => {
    const wc = (globalThis as any).hosted.content.webContents, prefs = wc.getLastWebPreferences()
    return [prefs.nodeIntegration, prefs.contextIsolation, prefs.sandbox, wc.session.isPersistent()]
  })).toEqual([false, true, true, false])
  expect(await app.evaluate(async () => {
    const r = await (globalThis as any).hosted.request({ type: 'app_api_request', payload: { path: '/api/read', method: 'GET', headers: {}, body: '' } })
    return [r.ok, r.metadata.status]
  })).toEqual([true, 200])
  expect(await evaluate(app, `({ pyry: typeof window.pyry, node: typeof require, color: getComputedStyle(document.body).color })`))
    .toEqual({ pyry: 'undefined', node: 'undefined', color: 'rgb(1, 2, 3)' })
  expect(await evaluate(app, 'document.images[0].naturalWidth')).toBe(2)
  expect(await evaluate(app, `fetch('/binary.bin').then(async r => [r.status, r.headers.get('content-length'), new Uint8Array(await r.arrayBuffer()).every(b => b === 173)])`))
    .toEqual([200, null, true])
  expect(await evaluate(app, `fetch('/api/read?b=%2f&a=&a=2#ignored').then(async r => [r.headers.get('content-type'), await r.json()])`))
    .toEqual(['application/json', { ok: true }])
  expect(s.seen.filter(r => r.type === 'app_api_request').at(-1).payload).toMatchObject({ query: 'b=%2f&a=&a=2', method: 'GET', body: '' })
  expect(await evaluate(app, `Promise.all(['/api/empty','/api/reset','/missing.js','/missing'].map(p => fetch(p).then(async r => [r.status, await r.text()])) )`))
    .toEqual([[204, ''], [205, ''], [404, ''], [404, '']])
  expect(await evaluate(app, `fetch('/api/redirect').then(r => r.status)`)).toBe(302)
  expect(await evaluate(app, `fetch('/api/read?').then(r => r.status)`)).toBe(200)
  expect(s.seen.filter(r => r.type === 'app_api_request').at(-1).payload).not.toHaveProperty('query')
  expect(await evaluate(app, `fetch('/api/read').then(r => [r.headers.get('content-security-policy'), r.headers.get('x-content-type-options'), r.headers.get('etag')])`))
    .toEqual([null, null, '"test"'])
  await mkdir('/tmp/builder-1991', { recursive: true })
  const capture = await app.evaluate(async () => (await (globalThis as any).hosted.content.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile('/tmp/builder-1991/native-view.png', Buffer.from(capture, 'base64'))
  await evaluate(app, `location.href = '/nested/route#fragment'; undefined`)
  await expect.poll(() => evaluate(app, '[location.pathname, document.body.dataset.loaded, document.readyState]'))
    .toEqual(['/nested/route', 'first-dynamic', 'complete'])
  expect(s.seen.find(r => r.payload.path === '/nested/route').payload.navigation).toBe(true)
  expect(await app.evaluate(() => (globalThis as any).hostedStates)).toEqual(['loading', 'ready', 'loading', 'ready'])
  await evaluate(app, `history.pushState({}, '', '/history'); history.back(); undefined`)
  await expect.poll(() => evaluate(app, 'location.pathname')).toBe('/nested/route')
  await evaluate(app, 'history.forward(); undefined')
  await expect.poll(() => evaluate(app, 'location.pathname')).toBe('/history')
  expect(await app.evaluate(() => {
    const v = (globalThis as any).hosted
    v.resize({ x: 410, y: 80, width: 350, height: 400 }); return v.content.getBounds()
  })).toEqual({ x: 410, y: 80, width: 350, height: 400 })
  await app.evaluate(() => { (globalThis as any).hosted.close(); (globalThis as any).hosted.close() })
  expect(await app.evaluate(() => (globalThis as any).hosted.read())).toEqual({ type: 'closed' })
  expect(await app.evaluate(() => (globalThis as any).hosted.request({ type: 'app_asset_request', payload: { path: '/', navigation: false } })))
    .toEqual({ ok: false, error: 'retired', uncertain: false })
})

test('hostile content cannot escape native policy or dispatch unsupported traffic', async ({ launchPairedApp }) => {
  const s = scenario(), { app, page } = await launchPairedApp(s.options)
  let externalRequests = 0
  const externalServer = createServer((_request, response) => { externalRequests++; response.setHeader('Access-Control-Allow-Origin', '*'); response.end('external control') })
  await new Promise<void>(resolve => externalServer.listen(0, '127.0.0.1', resolve))
  const address = externalServer.address()
  if (!address || typeof address === 'string') throw new Error('missing external fixture address')
  const external = `http://127.0.0.1:${address.port}`
  try {
  expect(await (await fetch(external)).text()).toBe('external control')
  externalRequests = 0
  const first = await open(app)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
  const baseline = s.seen.filter(r => ['app_asset_request', 'app_api_request'].includes(r.type)).length
  expect(await evaluate(app, `Promise.all([
    fetch('/asset-post', {method:'POST', body:'do not drop'}),
    fetch('/binary.bin', {headers:{Range:'bytes=0-1'}}),
    fetch('https://example.com/escape'), fetch('${external}/escape'), fetch('file:///etc/passwd')
  ].map(p => p.then(() => false, () => true)))`)).toEqual([true, true, true, true, true])
  expect(await evaluate(app, `(() => {
    document.cookie = 'secret=one';
    const frame = document.createElement('iframe'); frame.src='/frame'; document.body.append(frame);
    const script = document.createElement('script'); script.textContent='window.inlineRan=true'; document.head.append(script);
    const foreign = document.createElement('script'); foreign.src='https://example.com/evil.js'; document.head.append(foreign);
    const form = document.createElement('form'); form.action='/api/form'; document.body.append(form); form.submit();
    window.open('/popup'); navigator.sendBeacon('/api/beacon', 'body');
    return [typeof XMLHttpRequest, typeof EventSource, typeof WebSocket, typeof Worker, typeof SharedWorker,
      typeof navigator.serviceWorker, typeof window.pyry, typeof require, document.cookie, window.inlineRan === true];
  })()`)).toEqual(['undefined','undefined','undefined','undefined','undefined','undefined','undefined','undefined','',false])
  expect(await evaluate(app, `(async () => {
    try { await cookieStore.set('verifier', 'synthetic'); return 'allowed' } catch { return 'denied' }
  })()`)).toBe('denied')
  expect(await evaluate(app, `(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'cookieStore');
    return [typeof cookieStore, typeof CookieStore, descriptor.writable, descriptor.configurable];
  })()`)).toEqual(['undefined', 'undefined', false, false])
  // Completed read is the processing barrier after the hostile batch.
  expect(await evaluate(app, `fetch('/api/read?barrier=hostile').then(r => r.status)`)).toBe(200)
  expect(await app.evaluate(() => (globalThis as any).hosted.content.webContents.session.cookies.get({}))).toEqual([])
  expect(s.seen.filter(r => ['app_asset_request', 'app_api_request'].includes(r.type)).slice(baseline).map(r => r.payload.path))
    .toEqual(['/api/read'])
  expect(externalRequests).toBe(0)
  expect(await evaluate(app, 'Notification.requestPermission()')).toBe('denied')
  await app.evaluate(() => {
    ;(globalThis as any).downloadPrevented = false
    ;(globalThis as any).hosted.content.webContents.session.once('will-download', (event: any) => { (globalThis as any).downloadPrevented = event.defaultPrevented })
  })
  await evaluate(app, `(() => { const a=document.createElement('a'); a.href='/binary.bin'; a.download='untrusted.bin'; document.body.append(a); a.click() })()`)
  await expect.poll(() => app.evaluate(() => (globalThis as any).downloadPrevented)).toBe(true)
  expect(await evaluate(app, `fetch('/nonexistent', {headers:{'X-Pyry-Navigation':'1'}}).then(() => false, () => true)`)).toBe(true)
  expect(await evaluate(app, `(() => { const f = document.createElement('iframe'); document.body.append(f); return [typeof f.contentWindow.XMLHttpRequest, typeof f.contentWindow.cookieStore] })()`))
    .toEqual(['undefined', 'undefined'])
  expect(await page.evaluate(() => typeof window.pyry)).toBe('object')
  expect(await page.evaluate(() => document.body.dataset.loaded)).toBeUndefined()
  await app.evaluate(({ webContents }, origin) => {
    ;(globalThis as any).oldHosted = (globalThis as any).hosted
    ;(globalThis as any).oldContents = webContents.getAllWebContents().find(w => w.getURL().startsWith(origin))
  }, first.origin)
  const second = await open(app)
  expect(second.origin).not.toBe(first.origin)
  await expect.poll(() => app.evaluate(() => (globalThis as any).oldContents.isDestroyed())).toBe(true)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
  expect(await evaluate(app, `fetch('${first.origin}/api/read').then(() => false, () => true)`)).toBe(true)
  await evaluate(app, `location.href = 'https://example.com/escape'; undefined`)
  expect(await evaluate(app, `fetch('/api/read?barrier=navigation').then(r => r.status)`)).toBe(200)
  expect(await evaluate(app, 'location.origin')).toBe(second.origin)
  } finally { await new Promise<void>((resolve, reject) => externalServer.close(error => error ? reject(error) : resolve())) }
})

test('authority changes retire pending work and isolate releases and two hosts', async ({ launchPairedApp }) => {
  const s = scenario(), other = scenario('second')
  const { app, daemon, servers } = await launchPairedApp(s.options, { secondServer: other.options })
  const first = await open(app)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
  await evaluate(app, `window.pending = fetch('/api/held').catch(() => 'retired'); undefined`)
  await expect.poll(() => s.late.length).toBe(1)
  daemon.pushFrame(s.update('2.0.0'))
  await expect.poll(() => app.evaluate(() => (globalThis as any).hosted.read().type)).toBe('unavailable')
  const second = await open(app)
  expect(second.origin).not.toBe(first.origin)
  for (const frame of s.late.splice(0)) daemon.pushFrame(frame)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
  expect(await evaluate(app, `fetch('/api/read?barrier=release').then(r => r.status)`)).toBe(200)
  expect(s.seen.filter(r => r.type === 'app_api_request').at(-1).payload.release_version).toBe('2.0.0')
  daemon.pushFrame(s.update('3.0.0'))
  await expect.poll(() => app.evaluate(() => (globalThis as any).hosted.read().type)).toBe('unavailable')
  const concurrent = await open(app)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
  await app.evaluate(() => { (globalThis as any).firstHostView = (globalThis as any).hosted })
  await open(app, SECOND_SERVER_ID, true)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('second-dynamic')
  expect(await evaluate(app, `fetch('${concurrent.origin}/api/read').then(() => false, () => true)`)).toBe(true)
  expect(await app.evaluate(() => (globalThis as any).firstHostView.read().type)).toBe('ready')
  expect(await evaluate(app, `fetch('/api/read?barrier=host').then(r => r.status)`)).toBe(200)
  expect(other.seen.filter(r => r.type === 'app_api_request')).toHaveLength(1)
  expect(s.seen.filter(r => r.type === 'app_api_request')).toHaveLength(2)
  servers[1].forwarder.closeClientLeg(4401)
  await expect.poll(() => app.evaluate(() => (globalThis as any).hosted.read().type)).toBe('disconnected')
  // The first host remains independently usable after the second disconnects.
  await open(app)
  await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
  daemon.pushFrame(s.update('3.0.0', 'stopped'))
  await expect.poll(() => app.evaluate(() => (globalThis as any).hosted.read().type)).toBe('unavailable')
  expect(await app.evaluate(({ app, BrowserWindow }, appId) => app.hostedAppViews!.open(BrowserWindow.getAllWindows()[0], 'fake-daemon', appId,
    { x: 0, y: 0, width: 300, height: 300 }).ok, appId)).toBe(false)
})

for (const cause of ['removed', 'discovery-gap', 'rehandshake', 'unpair', 'parent'] as const) {
  test(`native view retires on ${cause}`, async ({ launchPairedApp }) => {
    const s = scenario(), { app, page, daemon } = await launchPairedApp(s.options)
    const initial = await open(app, FIRST_SERVER_ID, cause === 'parent')
    await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
    await app.evaluate(() => { (globalThis as any).retiredContents = (globalThis as any).hosted.content.webContents })
    if (cause === 'parent') {
      await evaluate(app, `window.pending = fetch('/api/held').catch(() => 'retired'); undefined`)
      await expect.poll(() => s.seen.filter(r => r.type === 'app_api_request' && r.payload.path === '/api/held').length).toBe(1)
    }
    if (cause === 'discovery-gap' || cause === 'rehandshake') s.holdDiscovery()
    if (cause === 'removed') daemon.pushFrame(s.frame('app_removed', { app_id: appId, revision: 2 }))
    if (cause === 'discovery-gap') daemon.pushFrame(s.frame('app_removed', { app_id: appId, revision: 900 }))
    if (cause === 'rehandshake') await page.evaluate(server => window.pyry.reconnectServer(server), FIRST_SERVER_ID)
    if (cause === 'unpair') await page.evaluate(server => window.pyry.unpairServer(server), FIRST_SERVER_ID)
    if (cause === 'parent') await app.evaluate(() => (globalThis as any).hostedParent.destroy())
    await expect.poll(() => app.evaluate(() => (globalThis as any).hosted.read().type)).toBe(
      cause === 'parent' ? 'closed' : cause === 'unpair' || cause === 'rehandshake' ? 'disconnected' : 'unavailable')
    await expect.poll(() => app.evaluate(() => (globalThis as any).retiredContents.isDestroyed())).toBe(true)
    if (cause === 'parent') {
      const held = s.seen.find(r => r.type === 'app_api_request' && r.payload.path === '/api/held')
      await expect.poll(() => s.seen.some(r => r.type === 'app_cancel' && r.payload.request_id === held.id)).toBe(true)
      const next = await open(app)
      expect(next.origin).not.toBe(initial.origin)
      for (const frame of s.late.splice(0)) daemon.pushFrame(frame)
      await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
      expect(await evaluate(app, `fetch('/api/read?barrier=parent').then(r => r.status)`)).toBe(200)
      expect(await app.evaluate(() => [(globalThis as any).hosted.read().type, (globalThis as any).retiredContents.isDestroyed()]))
        .toEqual(['ready', true])
    }
    if (cause === 'discovery-gap' || cause === 'rehandshake') {
      await expect.poll(() => s.discovery.length).toBe(1)
      await expectDiscoveryPending(app)
      for (const frame of s.discovery.splice(0)) daemon.pushFrame(frame)
      const next = await open(app)
      expect(next.origin).not.toBe(initial.origin)
      await expect.poll(() => evaluate(app, 'document.body.dataset.loaded')).toBe('first-dynamic')
    }
  })
}

test('unsupported and unknown hosts refuse native content without discovery bypass', async ({ launchPairedApp }) => {
  const { app } = await launchPairedApp()
  expect(await app.evaluate(({ app, BrowserWindow }, appId) => {
    const parent = BrowserWindow.getAllWindows()[0], bounds = { x: 0, y: 0, width: 200, height: 200 }
    return ['fake-daemon', 'unknown'].map(server => app.hostedAppViews!.open(parent, server, appId, bounds))
  }, appId)).toEqual([
    { ok: false, error: 'unconfirmed', state: { type: 'unsupported' } },
    { ok: false, error: 'unconfirmed', state: { type: 'disconnected' } }
  ])
})
