import { randomUUID } from 'node:crypto'
import { decodeEnvelope, encodeEnvelope } from '../../src/main/transport/codec'
import type { Envelope } from '../../src/shared/wire/types'

export type RecordedEntry = { direction: 'client' | 'daemon'; message: Envelope; atMs?: number }
export type Recording = {
  format: 'pyrycode.daemon-exchange'
  version: 1
  source: { capturedAt: string; desktopRevision: string; daemonRevision: string; daemonBinarySha256: string; claudeVersion: string }
  scenario: { id: 'permission-allow'; prompt: string; expectedReply: string; allowLabel: string; historyRetry: boolean }
  capabilities: string[]
  deviceId: string
  wire: RecordedEntry[]
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const forbidden = new Set(['hello', 'hello_ack', 'rekey_request', 'multipart', 'fragment'])
const queries = new Set(['list_conversations', 'thread_catch_up', 'thread_page', 'request_session_settings',
  'request_context_usage', 'request_model_list', 'request_system_prompt'])
const isAction = (type: string): boolean => !queries.has(type)
const secretKeys = /^(?:token|access_?token|refresh_?token|private_?key|secret|authorization)$/i
const credential = /sk-ant-|gh[pousr]_|-----BEGIN .*PRIVATE KEY-----/

/** Controlled test conversations only. No handshake, keys, credentials or arbitrary user data. */
export function assertRecordingSafe(value: unknown): void {
  if (typeof value === 'string' && credential.test(value)) throw new Error('Invalid daemon recording: sensitive material')
  if (Array.isArray(value)) value.forEach(assertRecordingSafe)
  else if (object(value)) for (const [key, child] of Object.entries(value)) {
    if (secretKeys.test(key)) throw new Error('Invalid daemon recording: sensitive material')
    assertRecordingSafe(child)
  }
}

/** Version and provenance are mandatory. Validation errors never include recorded content. */
export function parseRecording(text: string): Recording {
  const invalid = (): never => { throw new Error('Invalid daemon recording') }
  if (Buffer.byteLength(text) > 2_000_000) invalid()
  let value: unknown
  try { value = JSON.parse(text) } catch { return invalid() }
  if (!object(value) || value.format !== 'pyrycode.daemon-exchange' || value.version !== 1) return invalid()
  const { source, scenario, capabilities, deviceId, wire } = value
  if (!object(source) || !nonempty(source.capturedAt) || !Number.isFinite(Date.parse(source.capturedAt)) ||
      !/^[a-f0-9]{40}$/.test(String(source.desktopRevision)) || !/^[a-f0-9]{40}$/.test(String(source.daemonRevision)) ||
      !/^[a-f0-9]{64}$/.test(String(source.daemonBinarySha256)) || !nonempty(source.claudeVersion) ||
      !object(scenario) || scenario.id !== 'permission-allow' || !nonempty(scenario.prompt) ||
      !nonempty(scenario.expectedReply) || !nonempty(scenario.allowLabel) || typeof scenario.historyRetry !== 'boolean' ||
      !Array.isArray(capabilities) || !capabilities.every(nonempty) || !capabilities.includes('thread') ||
      !capabilities.includes('interactive') || !nonempty(deviceId) || !Array.isArray(wire) ||
      wire.length === 0 || wire.length > 5000 || !object(wire[0]) || wire[0].direction !== 'client') return invalid()
  assertRecordingSafe(value)
  const clientIds = new Set<number>()
  const daemonIds = new Set<number>()
  for (const entry of wire) {
    if (!object(entry) || !['client', 'daemon'].includes(String(entry.direction)) || !object(entry.message)) return invalid()
    const m = entry.message
    if (!Number.isSafeInteger(m.id) || Number(m.id) < 0 || !nonempty(m.type) || forbidden.has(m.type) ||
        !nonempty(m.ts) || !object(m.payload) ||
        entry.atMs !== undefined && (typeof entry.atMs !== 'number' || !Number.isFinite(entry.atMs) || entry.atMs < 0)) return invalid()
    const ids = entry.direction === 'client' ? clientIds : daemonIds
    if (ids.has(m.id as number)) return invalid()
    ids.add(m.id as number)
    if (m.in_reply_to !== undefined && (entry.direction !== 'daemon' || !clientIds.has(m.in_reply_to as number))) return invalid()
    const frame: Envelope = { id: m.id as number, type: m.type, ts: m.ts, payload: m.payload,
      ...(m.in_reply_to === undefined ? {} : { in_reply_to: m.in_reply_to as number }) }
    try { decodeEnvelope(encodeEnvelope(frame)) } catch { return invalid() }
  }
  return value as Recording
}

const identityKeys = new Set(['conversation_id', 'current_session_id', 'session_id', 'modal_id', 'message_id',
  'device_id', 'queued_msg_id', 'tool_use_id', 'parent_tool_use_id', 'turn_id', 'task_id', 'parent', 'epoch'])
const conversationTypes = new Set(['conversation_created', 'conversation_updated', 'conversation_deleted'])
const stable = (value: unknown): string => JSON.stringify(value, (_key, child) =>
  object(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child)

/**
 * User actions are ordered causal barriers. Queries may reorder within a barrier,
 * but daemon frames retain recorded order and wait for all earlier requests.
 * No future-response fallback, invented publisher, wall-clock delays or partial matching.
 */
export class RecordedExchange {
  private readonly recording: Recording
  private identities = new Map<string, string>()
  private requestIds = new Map<number, number>()
  private actualIds = new Set<number>()
  private consumed = new Set<Envelope>()
  private index = 0
  private matched = 0
  private emitted = 0
  private failure: Error | undefined
  constructor(recording: Recording) {
    // Clone and validate so callers cannot mutate an active replay.
    this.recording = parseRecording(JSON.stringify(recording))
    const collect = (value: unknown, parent = '', rootConversation = false): void => {
      if (Array.isArray(value)) { value.forEach(child => collect(child, parent)); return }
      if (!object(value)) return
      for (const [key, child] of Object.entries(value)) {
        if (nonempty(child) && (identityKeys.has(key) || key === 'id' &&
            (rootConversation || ['conversations', 'items', 'item'].includes(parent))))
          this.identities.set(child, randomUUID())
        collect(child, key)
      }
    }
    for (const entry of this.recording.wire) collect(entry.message.payload, '', conversationTypes.has(entry.message.type))
  }
  setDeviceId(value: string): void {
    if (this.index !== 0 || !nonempty(value)) throw new Error('Recorded exchange identity must be bound before replay')
    this.identities.set(this.recording.deviceId, value)
  }
  private mapped(value: unknown): unknown {
    if (typeof value === 'string') return this.identities.get(value) ?? value
    if (Array.isArray(value)) return value.map(child => this.mapped(child))
    if (!object(value)) return value
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, this.mapped(child)]))
  }
  private fail(message: string): never {
    this.failure ??= new Error(message)
    throw this.failure
  }
  reply(bytes: Uint8Array): Uint8Array[] {
    if (this.failure) throw this.failure
    let actual: Envelope
    try { actual = decodeEnvelope(bytes) } catch { return this.fail('Recorded exchange malformed request') }
    if (this.actualIds.has(actual.id)) return this.fail('Recorded exchange duplicate request ID')
    const mismatch = `Recorded exchange request mismatch at step ${this.matched + 1}`
    if (!object(actual.payload)) return this.fail(mismatch)
    const eligible: Envelope[] = []
    for (const entry of this.recording.wire.slice(this.index)) {
      if (entry.direction !== 'client' || this.consumed.has(entry.message)) continue
      if (isAction(entry.message.type)) {
        if (eligible.length === 0) eligible.push(entry.message)
        break
      }
      eligible.push(entry.message)
    }
    const expected = eligible.find(message => message.type === actual.type &&
      (isAction(actual.type) || stable(this.mapped(message.payload)) === stable(actual.payload)))
    if (!expected) return this.fail(mismatch)
    const before = new Map(this.identities)
    const payload = expected.payload as Record<string, unknown>
    // Only these client-owned opaque identities vary. Choices, text, cursors and routes must match exactly.
    const bindings = actual.type === 'send_message' ? ['message_id'] : actual.type === 'modal_answer' ? ['answer_token'] : []
    for (const key of bindings) if (nonempty(payload[key]) && nonempty(actual.payload[key])) {
      this.identities.set(payload[key], actual.payload[key])
    }
    if (stable(this.mapped(payload)) !== stable(actual.payload) || actual.in_reply_to !== undefined) {
      this.identities = before
      return this.fail(mismatch)
    }
    this.actualIds.add(actual.id)
    this.requestIds.set(expected.id, actual.id)
    this.consumed.add(expected)
    this.matched++
    const frames: Uint8Array[] = []
    while (this.index < this.recording.wire.length) {
      const entry = this.recording.wire[this.index]
      if (entry.direction === 'client') {
        if (!this.consumed.has(entry.message)) break
        this.index++
        continue
      }
      const recorded = entry.message
      this.index++
      const message = this.mapped(recorded) as Envelope
      if (recorded.in_reply_to !== undefined) message.in_reply_to = this.requestIds.get(recorded.in_reply_to)!
      frames.push(encodeEnvelope(message))
    }
    this.emitted += frames.length
    return frames
  }
  stats(): { matchedRequests: number; emittedFrames: number; remainingRequests: number } {
    return { matchedRequests: this.matched, emittedFrames: this.emitted,
      remainingRequests: this.recording.wire.filter(e => e.direction === 'client' && !this.consumed.has(e.message)).length }
  }
  assertComplete(): void {
    if (this.failure) throw this.failure
    const remaining = this.stats().remainingRequests
    if (remaining) throw new Error(`Recorded exchange incomplete: ${remaining} requests remain`)
  }
}
