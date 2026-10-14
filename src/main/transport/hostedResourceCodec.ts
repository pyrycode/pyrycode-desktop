import type { Envelope, HostedResourceEnvelope, HostedPayloads } from '../../shared/wire/types'
import { base64StdDecode, encodeEnvelope, WireDecodeError, WireEncodeError } from './codec'
import { decodeHostedEnvelope, hostedInteger, hostedObject } from './hostedBoundary'
import { isHostedAppId, isHostedReleaseVersion } from './hostedCodec'

type Direction = 'client-to-daemon' | 'daemon-to-client'
type Request = Extract<HostedResourceEnvelope, { type: 'app_asset_request' | 'app_api_request' }>
const EMPTY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/
const REQUEST_HEADERS = new Set(['accept', 'content-type', 'if-none-match'])
const RESPONSE_HEADERS = new Set(['content-type', 'cache-control', 'etag', 'last-modified'])

function appId(value: unknown): string {
  if (!isHostedAppId(value)) throw new WireDecodeError('invalid hosted app identity')
  return value
}

function release(value: unknown): string {
  if (!isHostedReleaseVersion(value)) throw new WireDecodeError('invalid hosted release')
  return value
}

function bounded(value: unknown, maximum: number): number {
  const number = hostedInteger(value)
  if (number > maximum) throw new WireDecodeError('hosted resource integer exceeds limit')
  return number
}

function escaped(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || /[^\x21-\x7e]/.test(value) || /%(?![0-9a-fA-F]{2})/.test(value)) {
    throw new WireDecodeError('invalid hosted escaped URL')
  }
  return value
}

function resourcePath(value: unknown, api: boolean): string {
  const path = escaped(value, 2048)
  if (!path.startsWith('/') || path.includes('//') || /[\\?#]/.test(path) || /%(?:2f|5c|25)/i.test(path)) {
    throw new WireDecodeError('invalid hosted path')
  }
  let decoded: string
  try { decoded = decodeURIComponent(path) } catch { throw new WireDecodeError('invalid hosted path escape') }
  if (CONTROLS.test(decoded) || decoded.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new WireDecodeError('invalid hosted path containment')
  }
  const root = decoded.split('/')[1]
  if (api ? !path.startsWith('/api/') : ['api', '_pyry', 'service', 'data', 'builds', 'registry', 'registry.json'].includes(root) || decoded === '/dist/service' || decoded.startsWith('/dist/service/')) {
    throw new WireDecodeError('invalid hosted resource route')
  }
  return path
}

function query(obj: Record<string, unknown>): { query?: string } {
  if (!Object.hasOwn(obj, 'query')) return {}
  const value = escaped(obj.query, 1024)
  if (value.startsWith('?') || value.includes('#')) throw new WireDecodeError('invalid hosted query')
  // Query escapes are opaque; do not decode or normalize parameter order, duplicates or values.
  return { query: value }
}

function headers(value: unknown, response: boolean): Record<string, string> {
  const obj = hostedObject(value)
  if (Object.keys(obj).length > 8) throw new WireDecodeError('hosted headers exceed limit')
  const allowed = response ? RESPONSE_HEADERS : REQUEST_HEADERS
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(obj)) {
    if (!allowed.has(name) || typeof value !== 'string' || Buffer.byteLength(value) > 1024 || CONTROLS.test(value)) {
      throw new WireDecodeError('invalid hosted header')
    }
    result[name] = value
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 4096) throw new WireDecodeError('hosted headers exceed limit')
  return result
}

function binary(value: unknown, nonempty: boolean): string {
  // Check encoded length, decoded length arithmetic, alphabet/padding and pad bits before allocation.
  if (typeof value !== 'string' || value.length > 43692 || value.length % 4 !== 0 || (nonempty && value.length === 0) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new WireDecodeError('invalid hosted base64')
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  if (value.length / 4 * 3 - padding > 32768 ||
      (padding > 0 && (alphabet.indexOf(value[value.length - padding - 1]) & (padding === 2 ? 15 : 3)) !== 0)) {
    throw new WireDecodeError('invalid hosted base64 bounds or padding')
  }
  base64StdDecode(value)
  return value
}

function method(value: unknown): HostedPayloads['app_api_request']['method'] {
  switch (value) {
    case 'GET': case 'HEAD': case 'POST': case 'PUT': case 'PATCH': case 'DELETE': case 'OPTIONS': return value
    default: throw new WireDecodeError('invalid hosted method')
  }
}

function resource(envelope: Envelope): HostedResourceEnvelope {
  const { id, ts, type } = envelope
  const obj = hostedObject(envelope.payload)
  const app_id = appId(obj.app_id)
  switch (type) {
    case 'app_asset_request': {
      if (typeof obj.navigation !== 'boolean') throw new WireDecodeError('invalid hosted navigation')
      return { id, ts, type, payload: { app_id, release_version: release(obj.release_version), path: resourcePath(obj.path, false), navigation: obj.navigation, ...query(obj) } }
    }
    case 'app_api_request': {
      const verb = method(obj.method)
      const body = binary(obj.body, false)
      if ((verb === 'GET' || verb === 'HEAD') && body !== '') throw new WireDecodeError('invalid hosted read body')
      return { id, ts, type, payload: { app_id, release_version: release(obj.release_version), path: resourcePath(obj.path, true), ...query(obj), method: verb, headers: headers(obj.headers, false), body } }
    }
    case 'app_response': {
      const status = bounded(obj.status, 599)
      const size_bytes = bounded(obj.size_bytes, 8388608)
      const total_chunks = bounded(obj.total_chunks, 256)
      if (status < 200 || typeof obj.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(obj.sha256) ||
          (size_bytes === 0 ? total_chunks !== 0 || obj.sha256 !== EMPTY_DIGEST : total_chunks === 0) ||
          ([204, 205, 304].includes(status) && size_bytes !== 0)) throw new WireDecodeError('invalid hosted response metadata')
      return { id, ts, type, in_reply_to: hostedInteger(envelope.in_reply_to), payload: {
        app_id, release_version: release(obj.release_version), status, headers: headers(obj.headers, true), size_bytes, total_chunks, sha256: obj.sha256 } }
    }
    case 'app_response_chunk':
      return { id, ts, type, in_reply_to: hostedInteger(envelope.in_reply_to), payload: { app_id, index: bounded(obj.index, 255), data: binary(obj.data, true) } }
    case 'app_response_credit':
      return { id, ts, type, payload: { app_id, request_id: hostedInteger(obj.request_id), next_index: bounded(obj.next_index, 255) } }
    default: throw new WireDecodeError('hosted resource type required')
  }
}

/** Stateless correspondence only: no ownership, ordering, credit progression or completion claim. */
export function decodeHostedResource(bytes: Uint8Array, direction: Direction, originalRequest?: Request): HostedResourceEnvelope {
  const frame = resource(decodeHostedEnvelope(bytes, direction))
  if (!originalRequest) return frame
  let original: HostedResourceEnvelope
  try { original = resource(decodeHostedEnvelope(encodeEnvelope(originalRequest), 'client-to-daemon')) }
  catch { throw new WireDecodeError('invalid hosted request context') }
  if (original.type !== 'app_asset_request' && original.type !== 'app_api_request') throw new WireDecodeError('invalid hosted request context')
  if (frame.payload.app_id !== original.payload.app_id) throw new WireDecodeError('hosted request context mismatch')
  const api = original.type === 'app_api_request'
  switch (frame.type) {
    case 'app_asset_request': case 'app_api_request':
      if (frame.id !== original.id || frame.type !== original.type || frame.payload.release_version !== original.payload.release_version) throw new WireDecodeError('hosted request context mismatch')
      break
    case 'app_response':
      if (frame.in_reply_to !== original.id || frame.payload.release_version !== original.payload.release_version ||
          frame.payload.size_bytes > (api ? 1048576 : 8388608) || frame.payload.total_chunks > (api ? 32 : 256) ||
          (!api && frame.payload.status >= 300 && frame.payload.status < 400) ||
          (original.type === 'app_api_request' && original.payload.method === 'HEAD' && frame.payload.size_bytes !== 0)) throw new WireDecodeError('hosted response context mismatch')
      break
    case 'app_response_chunk':
      if (frame.in_reply_to !== original.id || frame.payload.index >= (api ? 32 : 256)) throw new WireDecodeError('hosted chunk context mismatch')
      break
    case 'app_response_credit':
      if (frame.payload.request_id !== original.id || frame.payload.next_index >= (api ? 32 : 256)) throw new WireDecodeError('hosted credit context mismatch')
  }
  return frame
}

/** Validate the final serialized bytes, preserving additive fields in size accounting. */
export function encodeHostedResource(envelope: Envelope, direction: Direction, originalRequest?: Request): Uint8Array {
  try {
    const obj = hostedObject(envelope.payload)
    const payload = { ...obj }
    if ((envelope.type === 'app_asset_request' || envelope.type === 'app_api_request') && obj.query === '') delete payload.query
    const bytes = encodeEnvelope({ ...envelope, payload })
    decodeHostedResource(bytes, direction, originalRequest)
    return bytes
  } catch {
    throw new WireEncodeError('invalid hosted resource encoding')
  }
}
