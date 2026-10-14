import { describe, expect, it, vi } from 'vitest'
import type { Envelope, HostedResourceEnvelope } from '../../shared/wire/types'
import { MAX_PLAINTEXT_BYTES } from '../../shared/wire/types'
import * as codec from './codec'
import { decodeHostedControl, encodeHostedControl } from './hostedCodec'
import { decodeHostedResource, encodeHostedResource } from './hostedResourceCodec'

// Unchanged examples from 3120-hosted-app-contract.md §10, source revision
// 964c5c4bab8e9267ee5e4c374d34a5bb1ebeb6f0. These prove frames, not assembly or SQL writes.
const asset = [
  {"id":3,"type":"app_asset_request","ts":"2026-10-10T18:00:03Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","release_version":"1.0.0","path":"/assets/example.txt","navigation":false,"query":"v=1&v=2"}},
  {"id":4,"type":"app_response","ts":"2026-10-10T18:00:03Z","in_reply_to":3,"payload":{"app_id":"22222222-2222-4222-8222-222222222222","release_version":"1.0.0","status":200,"headers":{"content-type":"text/plain"},"size_bytes":6,"total_chunks":2,"sha256":"bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721"}},
  {"id":5,"type":"app_response_chunk","ts":"2026-10-10T18:00:03Z","in_reply_to":3,"payload":{"app_id":"22222222-2222-4222-8222-222222222222","index":0,"data":"YWJj"}},
  {"id":4,"type":"app_response_credit","ts":"2026-10-10T18:00:03Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","request_id":3,"next_index":1}},
  {"id":6,"type":"app_response_chunk","ts":"2026-10-10T18:00:03Z","in_reply_to":3,"payload":{"app_id":"22222222-2222-4222-8222-222222222222","index":1,"data":"ZGVm"}}
]
const api = [
  {"id":5,"type":"app_api_request","ts":"2026-10-10T18:00:04Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","release_version":"1.0.0","path":"/api/preferences","method":"POST","headers":{"content-type":"application/json"},"body":"eyJwZXJpb2QiOiIyNGgifQ=="}},
  {"id":7,"type":"app_response","ts":"2026-10-10T18:00:04Z","in_reply_to":5,"payload":{"app_id":"22222222-2222-4222-8222-222222222222","release_version":"1.0.0","status":204,"headers":{},"size_bytes":0,"total_chunks":0,"sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
]
const cancellation = [
  {"id":6,"type":"app_api_request","ts":"2026-10-10T18:00:05Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","release_version":"1.0.0","path":"/api/computers","query":"period=24h","method":"GET","headers":{},"body":""}},
  {"id":7,"type":"app_cancel","ts":"2026-10-10T18:00:05Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","request_id":6}},
  {"id":8,"type":"app_cancelled","ts":"2026-10-10T18:00:05Z","in_reply_to":7,"payload":{"app_id":"22222222-2222-4222-8222-222222222222","request_id":6}}
]
const bridge = [
  {"id":8,"type":"app_asset_request","ts":"2026-10-10T18:00:06Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","release_version":"1.0.0","path":"/","navigation":true}},
  {"id":9,"type":"error","ts":"2026-10-10T18:00:06Z","in_reply_to":8,"payload":{"code":"app.busy","message":"app request capacity is full","retryable":true,"retry_after_s":1}}
]
const client = 'client-to-daemon'
const daemon = 'daemon-to-client'
const bytes = (value: unknown): Uint8Array => Buffer.from(JSON.stringify(value))
const direction = (frame: Envelope): typeof client | typeof daemon => 'in_reply_to' in frame ? daemon : client
type Request = Extract<HostedResourceEnvelope, { type: 'app_asset_request' | 'app_api_request' }>
const request = (frame: Envelope): Request => decodeHostedResource(bytes(frame), client) as Request
const changed = (frame: Envelope, patch: Record<string, unknown>): Envelope =>
  ({ ...frame, payload: { ...frame.payload as object, ...patch } })
const reject = (frame: Envelope, context?: Request): void => {
  expect(() => decodeHostedResource(bytes(frame), direction(frame), context)).toThrow(codec.WireDecodeError)
  expect(() => encodeHostedResource(frame, direction(frame), context)).toThrow(codec.WireEncodeError)
}
const roundtrip = (frame: Envelope, context?: Request): HostedResourceEnvelope => {
  const decoded = decodeHostedResource(bytes(frame), direction(frame), context)
  expect(decoded).toEqual(frame)
  expect(JSON.parse(Buffer.from(encodeHostedResource(decoded, direction(frame), context)).toString())).toEqual(frame)
  return decoded
}

describe('pinned hosted resource examples', () => {
  it('retains asset false, ordered query, metadata, chunks and original-request credit', () => {
    const original = request(asset[0])
    asset.forEach(frame => roundtrip(frame, original))
    expect(asset[0].payload.navigation).toBe(false)
    expect(asset[0].payload.query).toBe('v=1&v=2')
    expect(Buffer.concat([Buffer.from(asset[2].payload.data!, 'base64'), Buffer.from(asset[4].payload.data!, 'base64')]).toString()).toBe('abcdef')
    expect(asset[3].payload.request_id).toBe(asset[0].id)
    expect(asset[3]).not.toHaveProperty('in_reply_to')
  })
  it('retains API POST bytes, omitted query and required 204 zero/empty fields', () => {
    api.forEach(frame => roundtrip(frame, request(api[0])))
    expect(Buffer.from(api[0].payload.body!, 'base64').toString()).toBe('{"period":"24h"}')
    expect(api[0].payload).not.toHaveProperty('query')
    expect(api[1].payload).toMatchObject({ status: 204, headers: {}, size_bytes: 0, total_chunks: 0 })
  })
  it('keeps resource and cancel correlations separate, and bridge errors distinct', () => {
    roundtrip(cancellation[0])
    roundtrip(bridge[0])
    for (const frame of [...cancellation.slice(1), bridge[1]]) {
      const decoded = decodeHostedControl(bytes(frame), direction(frame))
      expect(decoded).toEqual(frame)
      expect(JSON.parse(Buffer.from(encodeHostedControl(decoded, direction(frame))).toString())).toEqual(frame)
    }
    expect(cancellation[0].payload).toMatchObject({ method: 'GET', headers: {}, body: '' })
    expect(cancellation[1].payload.request_id).toBe(6)
    expect(cancellation[2].in_reply_to).toBe(7)
    expect(bridge[1].in_reply_to).toBe(8)
    expect(bridge[0].payload).not.toHaveProperty('query')
  })
})

describe('hosted resource boundaries', () => {
  it('requires every known field with its exact type and admits additive fields without authority', () => {
    for (const frame of [asset[0], api[0], asset[1], asset[2], asset[3]]) {
      for (const key of Object.keys(frame.payload!)) {
        if (key === 'query') continue
        const payload = { ...frame.payload as Record<string, unknown> }
        delete payload[key]
        reject({ ...frame, payload })
        reject(changed(frame, { [key]: null }))
        reject(changed(frame, { [key]: [] }))
      }
      const additive = { ...frame, host: 'ignored', payload: { ...frame.payload as object, future: { session_id: 'ignored' } } }
      expect(decodeHostedResource(encodeHostedResource(additive, direction(frame)), direction(frame))).toEqual(frame)
    }
    reject(changed(asset[0], { navigation: 0 }))
    reject(changed(api[0], { method: 'get' }))
    reject(changed(api[0], { method: 'CONNECT' }))
    reject(changed(asset[0], { query: null }))
  })
  it('reuses strict byte/envelope guards before generic field projection', () => {
    for (const key of ['conversation_id', 'session_id', 'event_id', 'history_entry_id', 'session_state_cleared', 'payload_encrypted']) reject({ ...asset[0], [key]: null })
    for (const value of [-1, 0.5, true, Number.MAX_SAFE_INTEGER + 1]) reject({ ...asset[0], id: value as number })
    roundtrip({ ...asset[0], id: Number.MAX_SAFE_INTEGER })
    roundtrip({ ...asset[0], id: 0 })
    for (const frame of [asset[0], asset[1], asset[2], asset[3]]) {
      expect(() => decodeHostedResource(bytes(frame), direction(frame) === client ? daemon : client)).toThrow(codec.WireDecodeError)
      reject('in_reply_to' in frame ? { ...frame, in_reply_to: null as unknown as number } : { ...frame, in_reply_to: 1 })
    }
    const raw = bytes(asset[0]).toString().replace('"navigation":false', '"navigation":false,"navigation":true')
    for (const value of [Buffer.from(raw), Buffer.from([0xff]), Buffer.concat([bytes(asset[0]), Buffer.from('{}')])]) {
      expect(() => decodeHostedResource(value, client)).toThrow(codec.WireDecodeError)
    }
  })
  it('validates canonical identities and release versions', () => {
    for (const app_id of ['22222222-2222-4222-8222-22222222222A', '22222222-2222-1222-8222-222222222222', '', 'other']) reject(changed(asset[0], { app_id }))
    for (const release_version of ['01.0.0', '1.0', 'v1.0.0', '1.0.0-beta', '2147483648.0.0']) reject(changed(asset[0], { release_version }))
    roundtrip(changed(asset[0], { release_version: '2147483647.2147483647.2147483647' }))
  })
  it('checks escaped path containment, reserved roots and asset/API separation', () => {
    for (const path of ['http://host/a', '//host/a', '/a//b', '/a\\b', '/a?b', '/a#b', '/a\0', '/a\n', '/é', '/a%', '/a%GG', '/a%2fb', '/a%5Cb', '/a%25b', '/a/../b', '/./b', '/%2e%2E/b', '/%00', '/%7f', '/%C2%80', '/%FF', '/' + 'a'.repeat(2048)]) reject(changed(asset[0], { path }))
    for (const path of ['/api', '/api/a', '/_pyry/health', '/service/a', '/data/app.sqlite', '/builds/a', '/registry.json']) reject(changed(asset[0], { path }))
    for (const path of ['/', '/apix/a', '/a%20b', '/%E2%82%AC', '/' + 'a'.repeat(2047)]) roundtrip(changed(asset[0], { path }))
    for (const path of ['/api', '/assets/a', '/%61pi/a', '/api/../data']) reject(changed(api[0], { path }))
    roundtrip(changed(api[0], { path: '/api/a%20b' }))
  })
  it('preserves opaque valid query bytes and omits empty query on encode', () => {
    for (const query of ['?a=1', 'a#b', 'a\n', 'é', '%', '%GG', 'a'.repeat(1025)]) reject(changed(asset[0], { query }))
    for (const query of ['a=1&a=&b=%2F%25%3F&x=+', '%00%7F%C2%80%FF', 'a'.repeat(1024)]) roundtrip(changed(asset[0], { query }))
    const empty = changed(asset[0], { query: '' })
    expect(decodeHostedResource(bytes(empty), client).payload).toHaveProperty('query', '')
    expect(JSON.parse(Buffer.from(encodeHostedResource(empty, client)).toString()).payload).not.toHaveProperty('query')
  })
  it('checks permitted lowercase headers, byte/value/serialized bounds and controls', () => {
    for (const headers of [{ Accept: 'x' }, { authorization: 'x' }, { cookie: 'x' }, { accept: null }, { accept: 'x\r' }, { accept: '\u0080' }, { accept: 'é'.repeat(513) }]) reject(changed(api[0], { headers }))
    roundtrip(changed(api[0], { headers: { accept: 'é'.repeat(512), 'if-none-match': '"abc"' } }))
    for (const name of ['location', 'set-cookie', 'content-encoding', 'access-control-allow-origin', 'Content-Type']) reject(changed(asset[1], { headers: { [name]: 'x' } }))
    const headers = Object.fromEntries(['content-type', 'cache-control', 'etag', 'last-modified'].map(key => [key, 'x'.repeat(1000)]))
    roundtrip(changed(asset[1], { headers }))
    headers.etag += '"'.repeat(24)
    headers['last-modified'] += '"'.repeat(24)
    reject(changed(asset[1], { headers }))
    const exact = { 'content-type': 'x'.repeat(1024), 'cache-control': 'x'.repeat(1024), etag: 'x'.repeat(1024), 'last-modified': '' }
    exact['last-modified'] = 'x'.repeat(4096 - bytes(exact).length)
    expect(bytes(exact)).toHaveLength(4096)
    roundtrip(changed(asset[1], { headers: exact }))
    reject(changed(asset[1], { headers: { ...exact, 'last-modified': exact['last-modified'] + 'x' } }))
    reject(changed(api[0], { headers: Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['h' + i, ''])) }))
  })
  it('retains opaque binary bodies for permitted methods and requires GET/HEAD emptiness', () => {
    const body = codec.base64StdEncode(Uint8Array.from([0, 255, 128, 1]))
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) roundtrip(changed(api[0], { method, body }))
    const chunk = roundtrip(changed(asset[2], { data: body }))
    expect(chunk.type).toBe('app_response_chunk')
    if (chunk.type === 'app_response_chunk') expect(codec.base64StdDecode(chunk.payload.data)).toEqual(Uint8Array.from([0, 255, 128, 1]))
    for (const method of ['GET', 'HEAD']) {
      roundtrip(changed(api[0], { method, body: '' }))
      reject(changed(api[0], { method, body }))
    }
    roundtrip(changed(api[0], { body: codec.base64StdEncode(Buffer.alloc(32768, 255)) }))
    roundtrip(changed(asset[2], { data: codec.base64StdEncode(Buffer.alloc(32768, 255)) }))
  })
  it('rejects invalid/noncanonical/oversized base64 before invoking allocating decode', () => {
    const spy = vi.spyOn(codec, 'base64StdDecode')
    try {
      for (const data of ['YQ', 'YQ=', 'YR==', 'YWJ=', 'YQ==\n', '_w==', 'YQ==garbage', 'A'.repeat(43696), codec.base64StdEncode(Buffer.alloc(32769))]) {
        reject(changed(asset[2], { data }))
        reject(changed(api[0], { body: data }))
      }
      reject(changed(asset[2], { data: '' }))
      expect(spy).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })
  it('bounds metadata, digest, zero-body semantics and chunk/credit indices', () => {
    for (const status of [199, 600, 200.5]) reject(changed(asset[1], { status }))
    for (const size_bytes of [-1, 0.5, 8388609, Number.MAX_SAFE_INTEGER + 1]) reject(changed(asset[1], { size_bytes }))
    for (const total_chunks of [-1, 0.5, 0, 257]) reject(changed(asset[1], { total_chunks }))
    for (const sha256 of ['', 'A'.repeat(64), 'g'.repeat(64)]) reject(changed(asset[1], { sha256 }))
    reject(changed(asset[1], { size_bytes: 0, total_chunks: 0 }))
    reject(changed(api[1], { total_chunks: 1 }))
    for (const index of [-1, 0.5, 256]) reject(changed(asset[2], { index }))
    for (const next_index of [-1, 0.5, 256]) reject(changed(asset[3], { next_index }))
    for (const request_id of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) reject(changed(asset[3], { request_id }))
    roundtrip(changed(asset[1], { size_bytes: 8388608, total_chunks: 256 }))
    roundtrip(changed(asset[2], { index: 255 }))
    roundtrip(changed(asset[3], { next_index: 255, request_id: Number.MAX_SAFE_INTEGER }))
    roundtrip(changed(asset[3], { next_index: 0, request_id: 0 }))
    roundtrip(changed(asset[2], { index: 0 }))
    for (const status of [204, 205, 304]) {
      roundtrip(changed(api[1], { status }))
      reject(changed(asset[1], { status }))
    }
  })
  it('revalidates repeated frames and supplied request context', () => {
    const original = request(asset[0])
    roundtrip(asset[1], original)
    roundtrip(asset[1], original)
    for (const frame of [asset[1], asset[2], asset[3]]) {
      reject(changed(frame, { app_id: '33333333-3333-4333-8333-333333333333' }), original)
      reject(frame.type === 'app_response_credit' ? changed(frame, { request_id: 4 }) : { ...frame, in_reply_to: 4 }, original)
    }
    reject(changed(asset[1], { release_version: '1.0.1' }), original)
    reject(changed(asset[1], { status: 302 }), original)
    const apiContext = request({ ...api[0], id: 3 })
    const response = { ...asset[1], in_reply_to: apiContext.id }
    roundtrip(changed(response, { size_bytes: 1048576, total_chunks: 32 }), apiContext)
    roundtrip(changed(response, { status: 302 }), apiContext)
    roundtrip(changed(api[1], { status: 304 }), request(api[0]))
    reject(changed(response, { size_bytes: 1048577 }), apiContext)
    reject(changed(response, { total_chunks: 33 }), apiContext)
    reject(changed(asset[2], { index: 32 }), apiContext)
    reject(changed(asset[3], { next_index: 32, request_id: apiContext.id }), apiContext)
    roundtrip(changed(asset[2], { index: 31 }), apiContext)
    roundtrip(changed(asset[3], { next_index: 31 }), apiContext)
    const head = request(changed(api[0], { method: 'HEAD', body: '' }))
    roundtrip(api[1], head)
    reject({ ...asset[1], in_reply_to: head.id }, head)
    reject(asset[1], changed(original, { path: '/..' }) as Request)
    reject(asset[1], { ...original, id: -1 })
    reject(asset[1], { ...original, payload: { ...original.payload, path: '/' + 'x'.repeat(65519) } } as Request)
  })
  it('measures final fully escaped request/chunk bytes including additive fields', () => {
    for (const frame of [api[0], asset[2]]) {
      const body = frame.type === 'app_api_request' ? { body: codec.base64StdEncode(Buffer.alloc(32768)) } : { data: codec.base64StdEncode(Buffer.alloc(32768)) }
      const base = { ...changed(frame, body), future: '' }
      const remaining = MAX_PLAINTEXT_BYTES - bytes(base).length
      const limit = { ...base, future: '"'.repeat(Math.floor(remaining / 2)) + 'x'.repeat(remaining % 2) }
      expect(encodeHostedResource(limit, direction(frame))).toHaveLength(MAX_PLAINTEXT_BYTES)
      expect(decodeHostedResource(bytes(limit), direction(frame)).type).toBe(frame.type)
      const oversized = { ...limit, future: limit.future + 'x' }
      reject(oversized)
    }
  })
})
