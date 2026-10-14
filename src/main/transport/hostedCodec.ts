// Pure main-process validation. No daemon content enters errors or logs.
import type { Envelope, ErrorPayload, HostedAppRecord, HostedControlEnvelope } from '../../shared/wire/types'
import { encodeEnvelope, WireDecodeError, WireEncodeError } from './codec'
import { decodeHostedEnvelope, hostedInteger, hostedObject } from './hostedBoundary'

const errorCodes = new Map([
  ['protocol.unsupported', false], ['app.invalid_request', false], ['app.not_found', false],
  ['app.release_changed', false], ['app.limit_exceeded', false], ['app.unavailable', true],
  ['app.busy', true], ['app.timeout', true], ['app.io_failed', true], ['apps.changed', true]
])

export function isHostedAppId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

export function isHostedReleaseVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 32 && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value) &&
    value.split('.').every(part => Number(part) <= 2147483647)
}

function appId(value: unknown): string {
  if (!isHostedAppId(value)) throw new WireDecodeError('invalid hosted app identity')
  return value
}

function release(value: unknown): string | null {
  if (value === null) return null
  if (!isHostedReleaseVersion(value)) throw new WireDecodeError('invalid hosted release')
  return value
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 1 || Buffer.byteLength(value, 'utf8') > maximum) throw new WireDecodeError('invalid hosted text')
  return value
}

function errorSummary(value: unknown): Pick<ErrorPayload, 'code' | 'message'> {
  const obj = hostedObject(value)
  if (typeof obj.code !== 'string' || !errorCodes.has(obj.code)) throw new WireDecodeError('invalid hosted error code')
  return { code: obj.code, message: text(obj.message, 160) }
}

function appRecord(value: unknown): HostedAppRecord {
  const obj = hostedObject(value)
  const title = text(obj.title, 128)
  if (title.trim() !== title || /[\u0000-\u001f\u007f-\u009f]/.test(title)) throw new WireDecodeError('invalid hosted title')
  const desired = obj.desired
  const state = obj.state
  if (desired !== 'available' && desired !== 'stopped') throw new WireDecodeError('invalid hosted desired state')
  if (state !== 'starting' && state !== 'running' && state !== 'stopped' && state !== 'failed') throw new WireDecodeError('invalid hosted observed state')
  const active_release = release(obj.active_release)
  if (state === 'running' && active_release === null) throw new WireDecodeError('hosted running release required')
  return { app_id: appId(obj.app_id), title, desired, state, active_release,
    pending_release: release(obj.pending_release), last_error: obj.last_error === null ? null : errorSummary(obj.last_error),
    revision: hostedInteger(obj.revision, 1) }
}

function cursor(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[^\x00-\x7f]/.test(value)) throw new WireDecodeError('invalid hosted cursor')
  return value
}

/** Validate only discovery/control, returning projected known fields with null/absence preserved. */
export function decodeHostedControl(bytes: Uint8Array, direction: 'client-to-daemon' | 'daemon-to-client'): HostedControlEnvelope {
  const envelope = decodeHostedEnvelope(bytes, direction)
  const { id, ts, type } = envelope
  const obj = hostedObject(envelope.payload)
  switch (type) {
    case 'list_apps':
      return { id, ts, type, payload: Object.hasOwn(obj, 'cursor') ? { cursor: cursor(obj.cursor) } : {} }
    case 'app_updated':
      return { id, ts, type, payload: appRecord(obj) }
    case 'app_removed':
      return { id, ts, type, payload: { app_id: appId(obj.app_id), revision: hostedInteger(obj.revision, 1) } }
    case 'apps': {
      const revision = hostedInteger(obj.revision)
      if (!Array.isArray(obj.items) || obj.items.length > 16) throw new WireDecodeError('invalid hosted page')
      const items = obj.items.map(appRecord)
      if (items.some((item, index) => item.revision > revision || (index > 0 && items[index - 1].app_id >= item.app_id))) throw new WireDecodeError('invalid hosted page order or revision')
      return { id, ts, type, in_reply_to: hostedInteger(envelope.in_reply_to), payload: {
        revision, items, next_cursor: obj.next_cursor === null ? null : cursor(obj.next_cursor) } }
    }
    case 'app_cancel':
    case 'app_cancelled': {
      const request_id = hostedInteger(obj.request_id)
      const payload = { request_id, ...(Object.hasOwn(obj, 'app_id') ? { app_id: appId(obj.app_id) } : {}) }
      if (type === 'app_cancel') {
        if (request_id === id) throw new WireDecodeError('invalid hosted cancel identity')
        return { id, ts, type, payload }
      }
      const in_reply_to = hostedInteger(envelope.in_reply_to)
      if (request_id === in_reply_to) throw new WireDecodeError('invalid hosted cancel correlation')
      return { id, ts, type, in_reply_to, payload }
    }
    case 'error': {
      const summary = errorSummary(obj)
      if (typeof obj.retryable !== 'boolean' || obj.retryable !== errorCodes.get(summary.code) || Object.hasOwn(obj, 'min_client_version')) throw new WireDecodeError('invalid hosted error fields')
      const payload: ErrorPayload = { ...summary, retryable: obj.retryable }
      if (Object.hasOwn(obj, 'retry_after_s')) {
        const delay = hostedInteger(obj.retry_after_s, 1)
        if (!obj.retryable || delay > 30) throw new WireDecodeError('invalid hosted retry delay')
        payload.retry_after_s = delay
      }
      return { id, ts, type, in_reply_to: hostedInteger(envelope.in_reply_to), payload }
    }
    default:
      throw new WireDecodeError('hosted resource validation required')
  }
}

/** Validate exactly the final serialization, including additive fields and JSON escaping. */
export function encodeHostedControl(envelope: Envelope, direction: 'client-to-daemon' | 'daemon-to-client'): Uint8Array {
  try {
    const bytes = encodeEnvelope(envelope)
    decodeHostedControl(bytes, direction)
    return bytes
  } catch {
    throw new WireEncodeError('invalid hosted control encoding')
  }
}
