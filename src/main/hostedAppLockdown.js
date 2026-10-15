// Installed before page scripts by the native document-start hook. Only narrow Fetch is available.
for (const name of ['XMLHttpRequest', 'EventSource', 'WebSocket', 'Worker', 'SharedWorker',
  'RTCPeerConnection', 'webkitRTCPeerConnection', 'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker',
  'cookieStore', 'CookieStore']) {
  Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false })
}
Object.defineProperty(navigator, 'sendBeacon', { value: () => false, writable: false, configurable: false })
Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: false })

// The dedicated isolated preload supplies only request/abort, with private correlations.
;(() => {
  const bridge = globalThis.hostedFetch
  const cap = 32768, encoder = new TextEncoder(), active = new Set()
  let closed = false
  const failure = () => new TypeError('Failed to fetch')
  const aborted = () => new DOMException('The operation was aborted', 'AbortError')
  function text(value) {
    if (value.length > cap) throw failure()
    const bytes = new Uint8Array(cap)
    const result = encoder.encodeInto(value, bytes)
    if (result.read !== value.length) throw failure()
    return bytes.slice(0, result.written)
  }
  async function serialize(body, headers) {
    if (body === undefined || body === null) return new Uint8Array()
    if (typeof body === 'string') {
      if (!headers.has('content-type')) headers.set('content-type', 'text/plain;charset=UTF-8')
      return text(body)
    }
    if (body instanceof FormData) {
      const boundary = '----pyry-' + crypto.randomUUID(), parts = []
      let size = 0
      const add = part => {
        size += part instanceof Blob ? part.size : part.byteLength
        if (size > cap) throw failure()
        parts.push(part)
      }
      const quote = value => {
        if (value.length > cap) throw failure()
        return value.replace(/\r\n|\r|\n/g, '\r\n').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22')
      }
      for (const [name, value] of body) {
        if (typeof value !== 'string' && value.type.length > 1024) throw failure()
        add(text(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"` +
          (typeof value === 'string' ? '\r\n\r\n' : `; filename="${quote(value.name)}"\r\nContent-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`)))
        if (typeof value === 'string' && value.length > cap) throw failure()
        add(typeof value === 'string' ? text(value.replace(/\r\n|\r|\n/g, '\r\n')) : value); add(text('\r\n'))
      }
      add(text(`--${boundary}--\r\n`))
      headers.set('content-type', `multipart/form-data; boundary=${boundary}`)
      return new Uint8Array(await new Blob(parts).arrayBuffer())
    }
    if (body instanceof Blob) {
      if (body.size > cap) throw failure()
      if (body.type && !headers.has('content-type')) headers.set('content-type', body.type)
      return new Uint8Array(await body.arrayBuffer())
    }
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      if (body.byteLength > cap) throw failure()
      return body instanceof ArrayBuffer ? new Uint8Array(body).slice() : new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice()
    }
    throw failure() // Includes streaming uploads; there is no native/browser fallback.
  }
  async function fetch(input, init = {}) {
    if (closed) throw failure()
    const source = input instanceof Request ? input : undefined
    const signal = init.signal ?? source?.signal
    if (signal?.aborted) throw aborted()
    if (source?.body) throw failure()
    const url = new URL(source ? source.url : input, location.href)
    if (url.origin !== location.origin || url.username || url.password) throw failure()
    url.hash = ''
    const method = String(init.method ?? source?.method ?? 'GET').toUpperCase()
    const api = url.pathname.startsWith('/api/')
    if (!(api ? ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'] : ['GET']).includes(method)) throw failure()
    const path = url.pathname, query = url.search.slice(1)
    if (path.length > 2048 || query.length > 1024 || /[^\x21-\x7e]/.test(path + query) ||
        /%(?![0-9a-fA-F]{2})/.test(path + query) || path.includes('//') || /[\\?#]/.test(path) || /%(?:2f|5c|25)/i.test(path)) throw failure()
    let decoded
    try { decoded = decodeURIComponent(path) } catch { throw failure() }
    if (/[\x00-\x1f\x7f-\x9f]/.test(decoded) || decoded.split('/').some(p => p === '.' || p === '..') ||
        (!api && (['api','_pyry','service','data','builds','registry','registry.json'].includes(decoded.split('/')[1]) ||
          decoded === '/dist/service' || decoded.startsWith('/dist/service/')))) throw failure()
    const headers = new Headers(init.headers ?? source?.headers)
    const body = init.body
    if ((method === 'GET' || method === 'HEAD') && body != null) throw failure()
    const bytes = await serialize(body, headers)
    for (const [name, value] of headers) {
      if (!['accept','content-type','if-none-match'].includes(name) || value.length > 1024 || text(value).length > 1024 || /[\x00-\x1f\x7f-\x9f]/.test(value)) throw failure()
    }
    if (text(JSON.stringify(Object.fromEntries(headers))).length > 4096) throw failure()
    if (signal?.aborted) throw aborted()
    if (closed || !bridge || active.size >= 16) throw failure()
    return new Promise((resolve, reject) => {
      let done = false
      const call = bridge.request({ url: url.href, method, headers: Object.fromEntries(headers), body: bytes })
      const finish = (error, response) => {
        if (done) return
        done = true; signal?.removeEventListener('abort', cancel); active.delete(settleAborted)
        if (error) reject(error); else resolve(response)
      }
      const settleAborted = () => finish(aborted())
      const cancel = () => { bridge.abort(call.id); settleAborted() }
      active.add(settleAborted); signal?.addEventListener('abort', cancel, { once: true })
      call.result.then(result => {
        if (done) return
        if (result.error) { finish(result.error === 'aborted' ? aborted() : failure()); return }
        try {
          finish(null, new Response(method === 'HEAD' || [204,205,304].includes(result.status) ? null : result.bytes,
            { status: result.status, headers: result.headers }))
        } catch { finish(failure()) }
      }, () => finish(failure()))
    })
  }
  Object.defineProperty(globalThis, 'fetch', { value: fetch, writable: false, configurable: false })
  addEventListener('pagehide', () => {
    closed = true; bridge?.abort()
    for (const settle of [...active]) settle()
  }, { once: true })
})()
