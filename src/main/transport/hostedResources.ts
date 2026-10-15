import { createHash } from 'node:crypto'
import type { HostedPayloads, HostedResourceEnvelope } from '../../shared/wire/types'
import type { DiagnosticLog } from '../diagnosticLog'
import type { SendOutcome } from './sendObservation'
import { decodeHostedResource, encodeHostedResource } from './hostedResourceCodec'
import { decodeHostedControl, encodeHostedControl } from './hostedCodec'

type Request = Extract<HostedResourceEnvelope, { type: 'app_asset_request' | 'app_api_request' }>
export type HostedResourceInput = {
  [K in Request['type']]: { type: K; payload: Omit<HostedPayloads[K], 'app_id' | 'release_version'> }
}[Request['type']]
type Failure = 'unavailable' | 'retired' | 'aborted' | 'limit' | 'invalid' | 'timeout' | 'corrupt' | 'bridge' | 'send-failed'
export type HostedResourceResult =
  | { ok: true; metadata: HostedPayloads['app_response']; bytes: Buffer }
  | { ok: false; error: Failure; uncertain: boolean }
type Pending = {
  scope: symbol; request: Request; resolve: (result: HostedResourceResult) => void
  active: boolean; attempted: boolean; granted: number; index: number; offset: number; expires: number; idleExpires?: number
  metadata?: HostedPayloads['app_response']; bytes?: Buffer
  deadline: ReturnType<typeof setTimeout>; idle?: ReturnType<typeof setTimeout>; cleanup: () => void
}

/** Trusted main-only API. A view captures authority; no byte channel reaches the renderer. */
export function createHostedResources(deps: {
  nextId: () => number; now: () => string; connected: () => boolean
  send: (bytes: Uint8Array, observe: (outcome: SendOutcome) => void) => void; log?: DiagnosticLog
}) {
  const pending = new Map<number, Pending>()
  const cancels = new Map<number, { target: number; app: string; timer: ReturnType<typeof setTimeout> }>()
  let enabled = false, generation = 0, reserved = 0, pumping = false
  const log = (code: string): void => deps.log?.event({ event: 'hosted-resource', code })
  const available = (): boolean => enabled && deps.connected()
  function forgetCancel(id: number): void {
    clearTimeout(cancels.get(id)?.timer); cancels.delete(id)
  }
  function cancel(p: Pending): void {
    if (!p.attempted || !available()) return
    if (cancels.size >= 16) {
      const oldest = cancels.keys().next().value
      if (oldest !== undefined) forgetCancel(oldest)
    }
    const id = deps.nextId(), target = p.request.id, app = p.request.payload.app_id
    cancels.set(id, { target, app, timer: setTimeout(() => forgetCancel(id), 5000) })
    try {
      deps.send(encodeHostedControl({ id, ts: deps.now(), type: 'app_cancel',
        payload: { request_id: target, app_id: app } }, 'client-to-daemon'), outcome => {
        if (outcome.type === 'dropped') { forgetCancel(id); log('send-failed') }
      })
    } catch { forgetCancel(id); log('send-failed') }
  }
  function finish(p: Pending, result: HostedResourceResult, cancellation = false): void {
    if (pending.get(p.request.id) !== p) return
    pending.delete(p.request.id)
    clearTimeout(p.deadline); clearTimeout(p.idle); p.cleanup()
    reserved -= p.metadata?.size_bytes ?? 0
    p.bytes = undefined
    if (cancellation) cancel(p)
    log(result.ok ? 'complete' : result.error)
    p.resolve(result)
    pump()
  }
  function fail(p: Pending, error: Failure, cancellation = true): void {
    const mutation = p.request.type === 'app_api_request' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(p.request.payload.method)
    finish(p, { ok: false, error, uncertain: mutation && p.attempted }, cancellation)
  }
  function progress(p: Pending): void {
    clearTimeout(p.idle)
    p.idleExpires = Date.now() + 5000
    p.idle = setTimeout(() => fail(p, 'timeout'), 5000)
  }
  function write(p: Pending, bytes: Uint8Array, granted: number): void {
    try {
      deps.send(bytes, outcome => {
        if (pending.get(p.request.id) !== p) return
        if (outcome.type === 'dropped') fail(p, 'send-failed')
        else p.granted = granted
      })
    } catch { fail(p, 'send-failed') }
  }
  function pump(): void {
    if (!available() || pumping) return
    pumping = true
    try {
      let active = [...pending.values()].filter(p => p.active).length
      for (const p of pending.values()) {
        if (p.active) continue
        if (active >= 8) break
        if (Date.now() >= p.expires) { fail(p, 'timeout'); continue }
        p.active = true; p.attempted = true; active++
        progress(p); log('started')
        write(p, encodeHostedResource(p.request, 'client-to-daemon'), 0)
        if (!pending.has(p.request.id)) active--
      }
    } finally { pumping = false }
  }
  function reset(supported = false, cancellation = false): void {
    // Remove the queue before callbacks can promote old work during teardown.
    const old = [...pending.values()]
    for (const p of old) p.active = true
    const wasEnabled = enabled
    enabled = false; generation++
    for (const p of old) {
      if (cancellation) { enabled = wasEnabled; cancel(p); enabled = false }
      fail(p, 'retired', false)
    }
    for (const id of cancels.keys()) if (!cancellation) forgetCancel(id)
    enabled = supported
  }
  // Unvalidated routing hints can retire owned work; only the contextual codecs admit bytes.
  function receive(bytes: Uint8Array, envelope: { type?: unknown; in_reply_to?: unknown }): boolean {
    const id = envelope.in_reply_to
    if (typeof id !== 'number') return false
    const control = cancels.get(id), p = pending.get(id)
    const resource = envelope.type === 'app_response' || envelope.type === 'app_response_chunk'
    if (!resource && envelope.type !== 'app_cancelled' && !(envelope.type === 'error' && (p || control))) return false
    if (control) {
      try {
        const reply = decodeHostedControl(bytes, 'daemon-to-client')
        if (reply.type !== 'error' && (reply.type !== 'app_cancelled' || reply.payload.request_id !== control.target || reply.payload.app_id !== control.app)) throw new Error()
        log(reply.type === 'error' ? 'bridge' : 'cancelled')
      } catch { log('corrupt') }
      forgetCancel(id); return true
    }
    if (!p) return true // Late frames never allocate or revive an operation.
    if (Date.now() >= p.expires || (p.idleExpires !== undefined && Date.now() >= p.idleExpires)) {
      fail(p, 'timeout'); return true
    }
    try {
      if (!p.active || !available()) throw new Error()
      if (envelope.type === 'error') {
        decodeHostedControl(bytes, 'daemon-to-client'); fail(p, 'bridge'); return true
      }
      const reply = decodeHostedResource(bytes, 'daemon-to-client', p.request)
      if (reply.type === 'app_response') {
        const m = reply.payload
        if (p.metadata || m.size_bytes > m.total_chunks * 32768 || m.total_chunks > m.size_bytes) throw new Error()
        if (reserved + m.size_bytes > 16777216) { fail(p, 'limit'); return true }
        reserved += m.size_bytes; p.metadata = m; p.bytes = Buffer.alloc(m.size_bytes)
        progress(p)
        if (m.size_bytes === 0) finish(p, { ok: true, metadata: m, bytes: p.bytes })
      } else if (reply.type === 'app_response_chunk') {
        const m = p.metadata, data = p.bytes, part = reply.payload
        if (!m || !data || part.index !== p.index || part.index !== p.granted || p.index >= m.total_chunks) throw new Error()
        const chunk = Buffer.from(part.data, 'base64')
        if (p.offset + chunk.length > data.length) throw new Error()
        chunk.copy(data, p.offset); p.offset += chunk.length; p.index++; progress(p)
        if (p.index === m.total_chunks) {
          if (p.offset !== m.size_bytes || createHash('sha256').update(data).digest('hex') !== m.sha256) throw new Error()
          finish(p, { ok: true, metadata: m, bytes: data })
        } else {
          if (p.offset >= m.size_bytes) throw new Error()
          write(p, encodeHostedResource({ id: deps.nextId(), ts: deps.now(), type: 'app_response_credit',
            payload: { app_id: p.request.payload.app_id, request_id: id, next_index: p.index } }, 'client-to-daemon', p.request), p.index)
        }
      } else throw new Error()
    } catch { fail(p, 'corrupt') }
    return true
  }
  function openView(appId: string, release: string) {
    const epoch = generation, scope = Symbol()
    let retired = false
    return {
      request(input: HostedResourceInput, signal?: AbortSignal): Promise<HostedResourceResult> {
        const enqueued = Date.now()
        const failure = (error: Failure): Promise<HostedResourceResult> => {
          log(error); return Promise.resolve({ ok: false, error, uncertain: false })
        }
        if (retired || epoch !== generation) return failure('retired')
        if (!available()) return failure('unavailable')
        if (signal?.aborted) return failure('aborted')
        if ([...pending.values()].filter(p => p.scope === scope).length >= 16) return failure('limit')
        let request: Request
        try {
          const parsed = decodeHostedResource(encodeHostedResource({ id: deps.nextId(), ts: deps.now(), type: input.type,
            payload: { ...input.payload, app_id: appId, release_version: release } }, 'client-to-daemon'), 'client-to-daemon')
          if (parsed.type !== 'app_asset_request' && parsed.type !== 'app_api_request') return failure('invalid')
          request = parsed
        } catch { log('invalid'); return failure('invalid') }
        return new Promise(resolve => {
          const abort = (): void => fail(p, 'aborted')
          const p: Pending = { scope, request, resolve, active: false, attempted: false, granted: -1, index: 0, offset: 0, expires: enqueued + 30000,
            deadline: setTimeout(() => fail(p, 'timeout'), Math.max(0, enqueued + 30000 - Date.now())), cleanup: () => signal?.removeEventListener('abort', abort) }
          pending.set(request.id, p); signal?.addEventListener('abort', abort, { once: true }); log('enqueued'); pump()
        })
      },
      retire(): void {
        retired = true
        // Aborting a scope must not promote another queued operation of that same scope.
        const old = [...pending.values()].filter(p => p.scope === scope)
        for (const p of old) p.active = true
        for (const p of old) fail(p, 'retired')
      }
    }
  }
  return { openView, receive, reset, retire: (): void => reset(enabled, true) }
}
