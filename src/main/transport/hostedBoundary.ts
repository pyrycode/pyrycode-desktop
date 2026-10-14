// Main-only structural boundary. Resource payload semantics are deliberately left to consumers.
import { MAX_PLAINTEXT_BYTES } from '../../shared/wire/types'
import type { Envelope } from '../../shared/wire/types'
import { WireDecodeError } from './codec'

const requests = new Set(['list_apps', 'app_asset_request', 'app_api_request', 'app_response_credit', 'app_cancel'])
const replies = new Set(['apps', 'app_response', 'app_response_chunk', 'app_cancelled', 'error'])
const notifications = new Set(['app_updated', 'app_removed'])
const forbidden = ['conversation_id', 'session_id', 'event_id', 'history_entry_id', 'session_state_cleared', 'payload_encrypted']

export function hostedObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new WireDecodeError('hosted object required')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hostedInteger(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new WireDecodeError('invalid hosted integer')
  return value
}

// JSON.parse already checks grammar. Scan tokens iteratively to detect duplicate *decoded* keys,
// including unknown additions. Object sets are separate across siblings; arrays carry no key set.
function rejectDuplicateKeys(text: string): void {
  const stack: (Set<string> | null)[] = []
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g
  for (const match of text.matchAll(tokens)) {
    const token = match[0]
    if (token === '{') stack.push(new Set())
    else if (token === '[') stack.push(null)
    else if (token === '}' || token === ']') stack.pop()
    else if (token.startsWith('"') && /^\s*:/.test(text.slice(match.index + token.length))) {
      const key: unknown = JSON.parse(token)
      const keys = stack[stack.length - 1]
      if (typeof key !== 'string' || !keys || keys.has(key)) throw new WireDecodeError('duplicate hosted key')
      keys.add(key)
    }
  }
}

function utcTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new WireDecodeError('invalid hosted timestamp')
  const parts = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|\+00:00)$/.exec(value)
  if (!parts) throw new WireDecodeError('invalid hosted timestamp')
  const [, year, month, day, hour, minute, second] = parts
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`)
  // RFC3339 permits a leap second at the end of a UTC month. No clock normalization
  // is performed: retain the sender's timestamp as data, including its precision.
  const nextDay = new Date(date.getTime() + 86400000)
  const leapSecond = Number(second) === 60 && Number(hour) === 23 && Number(minute) === 59 && nextDay.getUTCDate() === 1
  if (!Number.isFinite(date.getTime()) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day) ||
      Number(hour) > 23 || Number(minute) > 59 || (Number(second) > 59 && !leapSecond)) throw new WireDecodeError('invalid hosted timestamp')
  return value
}

/** Bytes → envelope structure only. Check directions before projection; payload stays opaque.
 * Does not establish capability support, request ownership, uniqueness, or resource validity. */
export function decodeHostedEnvelope(bytes: Uint8Array, direction: 'client-to-daemon' | 'daemon-to-client'): Envelope {
  if (bytes.length > MAX_PLAINTEXT_BYTES) throw new WireDecodeError('hosted plaintext exceeds limit')
  let parsed: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    parsed = JSON.parse(text)
    rejectDuplicateKeys(text)
  } catch {
    throw new WireDecodeError('invalid hosted JSON')
  }
  const obj = hostedObject(parsed)
  const id = hostedInteger(obj.id)
  const type = obj.type
  const ts = utcTimestamp(obj.ts)
  const payload = hostedObject(obj.payload)
  if (forbidden.some(key => Object.hasOwn(obj, key))) throw new WireDecodeError('forbidden hosted metadata')
  if (typeof type !== 'string' || !(requests.has(type) || replies.has(type) || notifications.has(type))) throw new WireDecodeError('invalid hosted type')
  if ((direction === 'client-to-daemon') !== requests.has(type) || (direction !== 'client-to-daemon' && direction !== 'daemon-to-client')) throw new WireDecodeError('invalid hosted direction')
  const correlated = Object.hasOwn(obj, 'in_reply_to')
  if (correlated !== replies.has(type)) throw new WireDecodeError('invalid hosted correlation')
  return { id, type, ts, payload, ...(correlated ? { in_reply_to: hostedInteger(obj.in_reply_to) } : {}) }
}
