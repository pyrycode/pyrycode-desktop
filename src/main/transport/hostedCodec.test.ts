import { describe, expect, it } from 'vitest'
import { decodeHostedControl, encodeHostedControl, isHostedAppId, isHostedReleaseVersion } from './hostedCodec'
import { decodeHostedEnvelope } from './hostedBoundary'
import { decodeEnvelope, encodeEnvelope, WireDecodeError, WireEncodeError } from './codec'
import { parseHelloAck } from './helloExchange'
import type { Envelope, EnvelopeType, HostedPayloads } from '../../shared/wire/types'

// Unchanged shared JSON examples, daemon 3120-hosted-app-contract.md §10,
// source revision 964c5c4bab8e9267ee5e4c374d34a5bb1ebeb6f0. Resource requests are context only.
const negotiation = [
  {"id":1,"type":"hello","ts":"2026-10-10T18:00:00Z","payload":{"role":"client","device_name":"Example phone","client_version":"pyrycode-mobile/1.0.0","protocol_versions":["v2"],"capabilities":["hosted_apps_v1","future_example"],"token":"synthetic-example-token"}},
  {"id":1,"type":"hello_ack","ts":"2026-10-10T18:00:00Z","in_reply_to":1,"payload":{"protocol_version":"v2","server_id":"11111111-1111-4111-8111-111111111111","conn_id":"example-connection","capabilities":["hosted_apps_v1"]}}
]
const discovery = [
  {"id":2,"type":"list_apps","ts":"2026-10-10T18:00:01Z","payload":{}},
  {"id":2,"type":"apps","ts":"2026-10-10T18:00:01Z","in_reply_to":2,"payload":{"revision":7,"items":[{"app_id":"22222222-2222-4222-8222-222222222222","title":"Orchestrator","desired":"available","state":"starting","active_release":null,"pending_release":"1.0.0","last_error":null,"revision":7}],"next_cursor":null}},
  {"id":3,"type":"app_updated","ts":"2026-10-10T18:00:02Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","title":"Orchestrator","desired":"available","state":"running","active_release":"1.0.0","pending_release":null,"last_error":null,"revision":8}}
]
const cancellation = [
  {"id":6,"type":"app_api_request","ts":"2026-10-10T18:00:05Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","release_version":"1.0.0","path":"/api/computers","query":"period=24h","method":"GET","headers":{},"body":""}},
  {"id":7,"type":"app_cancel","ts":"2026-10-10T18:00:05Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","request_id":6}},
  {"id":8,"type":"app_cancelled","ts":"2026-10-10T18:00:05Z","in_reply_to":7,"payload":{"app_id":"22222222-2222-4222-8222-222222222222","request_id":6}}
]
const bridgeError = [
  {"id":8,"type":"app_asset_request","ts":"2026-10-10T18:00:06Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","release_version":"1.0.0","path":"/","navigation":true}},
  {"id":9,"type":"error","ts":"2026-10-10T18:00:06Z","in_reply_to":8,"payload":{"code":"app.busy","message":"app request capacity is full","retryable":true,"retry_after_s":1}}
]
const removal = {"id":10,"type":"app_removed","ts":"2026-10-10T18:00:07Z","payload":{"app_id":"22222222-2222-4222-8222-222222222222","revision":9}}
const bytes = (value: unknown): Uint8Array => Buffer.from(JSON.stringify(value))
const client = 'client-to-daemon'
const daemon = 'daemon-to-client'
const list = discovery[0]
const record = discovery[1].payload.items![0]
const frame = (type: string, payload: unknown, reply?: number): Envelope =>
  ({ id: 12, type, ts: '2026-10-10T18:00:00Z', payload, ...(reply === undefined ? {} : { in_reply_to: reply }) })
const reject = (value: unknown, direction: typeof client | typeof daemon = daemon): void => {
  expect(() => decodeHostedControl(bytes(value), direction)).toThrow(WireDecodeError)
  expect(() => encodeHostedControl(value as Envelope, direction)).toThrow(WireEncodeError)
}

describe('hosted contract examples and declarations', () => {
  it('declares every name directly, and retains resource defaults as data only', () => {
    const names: EnvelopeType[] = ['list_apps', 'apps', 'app_updated', 'app_removed', 'app_asset_request',
      'app_api_request', 'app_response', 'app_response_chunk', 'app_response_credit', 'app_cancel', 'app_cancelled']
    expect(names).toHaveLength(11)
    const asset: HostedPayloads['app_asset_request'] = { app_id: record.app_id, release_version: '1.0.0', path: '/', navigation: false }
    const api: HostedPayloads['app_api_request'] = { ...asset, method: 'GET', headers: {}, body: '' }
    const response: HostedPayloads['app_response'] = { app_id: record.app_id, release_version: '1.0.0', status: 204,
      headers: {}, size_bytes: 0, total_chunks: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }
    expect(decodeEnvelope(encodeEnvelope(frame('app_asset_request', asset))).payload).toEqual(asset)
    expect(JSON.parse(Buffer.from(encodeEnvelope(frame('app_api_request', api))).toString()).payload).toMatchObject({ headers: {}, body: '' })
    expect(decodeEnvelope(encodeEnvelope(frame('app_response', response))).payload).toEqual(response)
  })
  it('uses existing negotiation facilities without activating capability support', () => {
    expect(decodeEnvelope(bytes(negotiation[0]))).toEqual(negotiation[0])
    expect(parseHelloAck(bytes(negotiation[1]))).toEqual(negotiation[1].payload)
  })
  it('round trips unchanged discovery, cancellation, bridge error and removal examples', () => {
    for (const value of [...discovery, ...cancellation.slice(1), ...bridgeError.slice(1), removal]) {
      const direction = ['list_apps', 'app_cancel'].includes(value.type) ? client : daemon
      const decoded = decodeHostedControl(bytes(value), direction)
      expect(decoded).toEqual(value)
      expect(JSON.parse(Buffer.from(encodeHostedControl(decoded, direction)).toString())).toEqual(value)
      expect(decodeHostedControl(bytes(value), direction)).toEqual(decoded)
    }
    expect(cancellation[2]).toMatchObject({ in_reply_to: 7, payload: { request_id: 6 } })
  })
  it('retains resource requests as context, rejecting all resources as control validation', () => {
    for (const value of [cancellation[0], bridgeError[0], frame('app_response', {}, 1), frame('app_response_chunk', {}, 1), frame('app_response_credit', {})]) {
      const direction = ['app_response', 'app_response_chunk'].includes(value.type) ? daemon : client
      expect(decodeHostedEnvelope(bytes(value), direction).type).toBe(value.type)
      reject(value, direction)
    }
  })
})

describe('strict raw boundary', () => {
  it.each(['{} {}', '[]', 'null', '1', '{', '\ufeff{}', '{"id":1,"id":2}',
    '{"x":{"a":1,"\\u0061":2}}', '{"x":[{"a":1,"a":2}]}',
    JSON.stringify(list).replace('"id":2', '"id":2,"\\u0069d":3')])('rejects malformed or duplicate JSON: %s', text => {
    expect(() => decodeHostedControl(Buffer.from(text), client)).toThrow(WireDecodeError)
  })
  it('rejects invalid UTF-8, nested duplicates in additions, and oversized bytes', () => {
    for (const data of [Buffer.from([0xff]), Buffer.concat([bytes(list), Buffer.from([0xc0, 0x80])]), Buffer.alloc(65520, 32)])
      expect(() => decodeHostedControl(data, client)).toThrow(WireDecodeError)
    const text = JSON.stringify(list).replace('"payload":{}', '"payload":{"future":{"a":1,"a":2}}')
    expect(() => decodeHostedControl(Buffer.from(text), client)).toThrow(WireDecodeError)
  })
  it.each(['conversation_id', 'session_id', 'event_id', 'history_entry_id', 'session_state_cleared', 'payload_encrypted'])('rejects forbidden metadata %s even null/false', key => {
    for (const value of [null, false, 0, '']) reject({ ...list, [key]: value }, client)
  })
  it.each(['id', 'type', 'ts', 'payload'])('requires exact envelope field %s', key => {
    const value = { ...list }; delete value[key as keyof typeof value]
    reject(value, client)
    for (const bad of [null, [], true]) reject({ ...list, [key]: bad }, client)
  })
  it('validates safe IDs and optional correlation before projection', () => {
    for (const id of [-1, 0.5, 9007199254740992, '1', true, null]) {
      reject({ ...list, id }, client); reject({ ...discovery[1], in_reply_to: id })
    }
    for (const id of [0, Number.MAX_SAFE_INTEGER]) expect(decodeHostedControl(bytes({ ...list, id }), client).id).toBe(id)
    reject({ ...list, in_reply_to: null }, client)
  })
  it('requires UTC RFC3339 with real calendar fields', () => {
    for (const ts of ['', '2026-02-30T00:00:00Z', '2026-10-10', '2026-10-10T24:00:00Z', '2026-10-10T00:00:00+01:00', '2026-13-01T00:00:00Z', '2026-10-10T18:00:60Z']) reject({ ...list, ts }, client)
    for (const ts of ['2024-02-29T00:00:00.123Z', '2026-10-10T00:00:00+00:00', '2016-12-31T23:59:60Z', '2026-10-10t00:00:00z']) expect(decodeHostedControl(bytes({ ...list, ts }), client).ts).toBe(ts)
  })
  it('enforces each direction and correlation shape', () => {
    for (const value of [...discovery, ...cancellation.slice(1), ...bridgeError.slice(1), removal]) {
      const request = ['list_apps', 'app_cancel'].includes(value.type)
      reject(value, request ? daemon : client)
      const changed = { ...value, in_reply_to: 'in_reply_to' in value ? undefined : 1 }
      reject(changed, request ? client : daemon)
    }
    reject(frame('unknown', {}), client)
    for (const [type, direction, reply] of [
      ['app_asset_request', client, false], ['app_api_request', client, false], ['app_response_credit', client, false],
      ['app_response', daemon, true], ['app_response_chunk', daemon, true]
    ] as const) {
      const value = frame(type, {}, reply ? 0 : undefined)
      expect(() => decodeHostedEnvelope(bytes(value), direction === client ? daemon : client)).toThrow(WireDecodeError)
      expect(() => decodeHostedEnvelope(bytes({ ...value, in_reply_to: reply ? undefined : 0 }), direction)).toThrow(WireDecodeError)
    }
  })
  it('ignores additive authority claims and accepts escaped strings/independent object keys', () => {
    expect(decodeHostedControl(bytes({ ...list, host: 'other', payload: { host: 'other', future: [{ a: '"\\' }, { a: 2 }] } }), client)).toEqual(list)
    const polluted = JSON.stringify(list).replace('"payload":{}', '"payload":{"__proto__":{"cursor":"bad"}}')
    expect(decodeHostedControl(Buffer.from(polluted), client)).toEqual(list)
  })
  it('measures the final serialized envelope including escaped/additive fields', () => {
    const base = { ...list, future: '' }
    const room = 65519 - bytes(base).length
    const exact = { ...base, future: 'x'.repeat(room) }
    expect(encodeHostedControl(exact, client)).toHaveLength(65519)
    expect(decodeHostedControl(bytes(exact), client)).toEqual(list)
    for (const future of ['x'.repeat(room + 1), '\n'.repeat(room), 'é'.repeat(room)]) reject({ ...base, future }, client)
    const circular: any = { ...list }; circular.future = circular
    expect(() => encodeHostedControl(circular, client)).toThrow(WireEncodeError)
  })
  it('accepts deeply nested additions without recursive scanning and rejects duplicate nested names', () => {
    const wrap = (middle: string): Buffer => Buffer.from(JSON.stringify(list).replace('"payload":{}',
      `"payload":{"future":${'['.repeat(4000)}${middle}${']'.repeat(4000)}}`))
    expect(decodeHostedControl(wrap('{"a":1}'), client)).toEqual(list)
    expect(() => decodeHostedControl(wrap('{"a":1,"\\u0061":2}'), client)).toThrow(WireDecodeError)
  })
  it('reports category-only failures without echoing peer fields', () => {
    const marker = 'private-daemon-content'
    try {
      decodeHostedControl(bytes(frame('app_updated', { ...record, title: marker, active_release: marker })), daemon)
      expect.fail('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(WireDecodeError)
      expect((error as Error).message).not.toContain(marker)
    }
  })
})

describe('discovery and control payload semantics', () => {
  it('validates canonical identity and release boundaries', () => {
    expect(isHostedAppId(record.app_id)).toBe(true)
    for (const value of ['ABCDEFAB-2222-4222-8222-222222222222', record.app_id.replace('-4222-', '-5222-'), record.app_id.replace('-8222-', '-7222-'), '', null]) expect(isHostedAppId(value)).toBe(false)
    for (const value of ['0.0.0', '2147483647.2147483647.2147483647']) expect(isHostedReleaseVersion(value)).toBe(true)
    for (const value of ['01.0.0', '1.2', 'v1.0.0', '1.0.0-beta', '2147483648.0.0', '', null]) expect(isHostedReleaseVersion(value)).toBe(false)
  })
  it('requires every record field including explicit nulls and exact enums', () => {
    for (const key of Object.keys(record)) { const value = { ...record }; delete value[key as keyof typeof value]; reject(frame('app_updated', value)) }
    for (const patch of [{ app_id: 'bad' }, { title: null }, { desired: 'running' }, { state: 'ready' }, { active_release: false }, { pending_release: '' }, { last_error: {} }, { last_error: { code: 'unknown', message: 'failure' } }, { revision: 0 }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { state: 'running', active_release: null }]) reject(frame('app_updated', { ...record, ...patch }))
    expect(decodeHostedControl(bytes(frame('app_updated', { ...record, last_error: { code: 'app.io_failed', message: 'failed' } })), daemon).payload).toHaveProperty('last_error', { code: 'app.io_failed', message: 'failed' })
  })
  it('bounds titles by UTF-8 bytes and rejects controls/edge whitespace', () => {
    for (const title of ['', ' ', ' title', 'title\n', 'a\u0080b', 'a\u0000b', 'é'.repeat(65)]) reject(frame('app_updated', { ...record, title }))
    expect(decodeHostedControl(bytes(frame('app_updated', { ...record, title: 'é'.repeat(64) })), daemon).payload).toHaveProperty('title', 'é'.repeat(64))
  })
  it('requires sorted unique bounded pages and valid snapshot revisions', () => {
    const items = Array.from({ length: 16 }, (_, n) => ({ ...record, app_id: `${n.toString(16).padStart(8, '0')}-2222-4222-8222-222222222222` }))
    const page = { revision: 7, items, next_cursor: null }
    expect(decodeHostedControl(bytes(frame('apps', page, 1)), daemon).payload).toEqual(page)
    for (const patch of [{ items: [...items, items[0]] }, { items: [items[1], items[0]] }, { items: [items[0], items[0]] }, { items: null }, { revision: 6 }, { revision: -1 }, { next_cursor: undefined }]) reject(frame('apps', { ...page, ...patch }, 1))
    expect(decodeHostedControl(bytes(frame('apps', { revision: 0, items: [], next_cursor: null }, 1)), daemon).payload).toEqual({ revision: 0, items: [], next_cursor: null })
  })
  it('bounds optional request and required nullable response cursors', () => {
    for (const cursor of ['', null, 0, 'é', 'a'.repeat(257)]) {
      reject(frame('list_apps', { cursor }), client)
      if (cursor !== null) reject(frame('apps', { revision: 0, items: [], next_cursor: cursor }, 1))
    }
    expect(decodeHostedControl(bytes(frame('list_apps', { cursor: 'a'.repeat(256) })), client).payload).toEqual({ cursor: 'a'.repeat(256) })
    expect(decodeHostedControl(bytes(frame('list_apps', {})), client).payload).not.toHaveProperty('cursor')
    const page = frame('apps', { revision: Number.MAX_SAFE_INTEGER, items: [], next_cursor: 'a'.repeat(256) }, 0)
    expect(decodeHostedControl(bytes(page), daemon)).toEqual(page)
  })
  it('validates cancellation without confusing target and cancel correlations', () => {
    for (const type of ['app_cancel', 'app_cancelled']) {
      const direction = type === 'app_cancel' ? client : daemon
      const reply = type === 'app_cancelled' ? 10 : undefined
      expect(decodeHostedControl(bytes(frame(type, { request_id: 0 }, reply)), direction).payload).toEqual({ request_id: 0 })
      const unscoped = decodeHostedControl(bytes(frame(type, { request_id: 0 }, reply)), direction)
      expect(JSON.parse(Buffer.from(encodeHostedControl(unscoped, direction)).toString()).payload).toEqual({ request_id: 0 })
      for (const patch of [{}, { request_id: null }, { request_id: -1 }, { request_id: 1.5 }, { request_id: 0, app_id: null }, { request_id: 0, app_id: 'bad' }]) reject(frame(type, patch, reply), direction)
    }
    reject(frame('app_cancel', { request_id: 12 }), client)
    reject(frame('app_cancelled', { request_id: 10 }, 10))
  })
  it('validates bridge errors, retry flags, other known fields and byte bounds', () => {
    const payload = bridgeError[1].payload
    for (const patch of [{ code: 'unknown' }, { retryable: false }, { retryable: 1 }, { message: '' }, { message: 'é'.repeat(81) }, { retry_after_s: 0 }, { retry_after_s: 31 }, { retry_after_s: 1.5 }, { retry_after_s: null }, { min_client_version: '1.0.0' }]) reject(frame('error', { ...payload, ...patch }, 1))
    for (const code of ['protocol.unsupported', 'app.invalid_request', 'app.not_found', 'app.release_changed', 'app.limit_exceeded']) {
      expect(decodeHostedControl(bytes(frame('error', { code, message: 'failure', retryable: false }, 1)), daemon).payload).toHaveProperty('code', code)
      reject(frame('error', { code, message: 'failure', retryable: false, retry_after_s: 1 }, 1))
    }
    for (const code of ['app.unavailable', 'app.busy', 'app.timeout', 'app.io_failed', 'apps.changed']) expect(decodeHostedControl(bytes(frame('error', { code, message: 'é'.repeat(80), retryable: true, retry_after_s: 30 }, 1)), daemon).payload).toHaveProperty('code', code)
  })
  it('projects additive record/error fields and re-encodes absent retry delay', () => {
    const value = frame('app_updated', { ...record, server_id: 'foreign', last_error: { code: 'app.io_failed', message: 'failure', host: 'foreign' } })
    const decoded = decodeHostedControl(bytes(value), daemon)
    expect(decoded.payload).not.toHaveProperty('server_id')
    expect(decoded.payload).toHaveProperty('last_error', { code: 'app.io_failed', message: 'failure' })
    const error = decodeHostedControl(bytes(frame('error', { code: 'app.io_failed', message: 'failure', retryable: true, host: 'foreign' }, 0)), daemon)
    expect(JSON.parse(Buffer.from(encodeHostedControl(error, daemon)).toString()).payload).toEqual({ code: 'app.io_failed', message: 'failure', retryable: true })
    for (const key of ['code', 'message', 'retryable']) {
      const payload: Record<string, unknown> = { code: 'app.io_failed', message: 'failure', retryable: true }
      delete payload[key]
      reject(frame('error', payload, 0))
    }
    for (const payload of [{ app_id: record.app_id }, { revision: 1 }, { app_id: 'bad', revision: 1 }, { app_id: record.app_id, revision: 0 }]) reject(frame('app_removed', payload))
  })
})
