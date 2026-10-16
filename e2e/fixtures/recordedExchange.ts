import { randomUUID } from 'node:crypto'
import { decodeEnvelope, encodeEnvelope } from '../../src/main/transport/codec'
import type { Envelope } from '../../src/shared/wire/types'

export type RecordedEntry = { direction: 'client' | 'daemon'; message: Envelope; atMs?: number; connection?: number }
export type Recording = {
  format: 'pyrycode.daemon-exchange'
  version: 1 | 2
  source: { capturedAt: string; desktopRevision: string; daemonRevision: string; daemonBinarySha256: string; claudeVersion: string }
  scenario: { id: string; prompt?: string; expectedReply?: string; allowLabel?: string; historyRetry?: boolean;
    inputs?: { nonce: number; [key: string]: unknown }; workspace?: string }
  capabilities: string[]
  deviceId: string
  devices?: string[]
  barriers?: { before: number; name: string }[]
  closures?: { before: number; connection: number; code: number }[]
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
  if (!object(value) || value.format !== 'pyrycode.daemon-exchange' || ![1, 2].includes(Number(value.version))) return invalid()
  const { source, scenario, capabilities, deviceId, wire } = value
  if (!object(source) || !nonempty(source.capturedAt) || !Number.isFinite(Date.parse(source.capturedAt)) ||
      !/^[a-f0-9]{40}$/.test(String(source.desktopRevision)) || !/^[a-f0-9]{40}$/.test(String(source.daemonRevision)) ||
      !/^[a-f0-9]{64}$/.test(String(source.daemonBinarySha256)) || !nonempty(source.claudeVersion) ||
      !object(scenario) || !nonempty(scenario.id) || !/^[a-z][a-z0-9-]*$/.test(scenario.id) ||
      !Array.isArray(capabilities) || !capabilities.every(nonempty) || !capabilities.includes('thread') ||
      !capabilities.includes('interactive') || !nonempty(deviceId) || !Array.isArray(wire) ||
      wire.length === 0 || wire.length > 5000 || !object(wire[0]) || value.version === 1 && wire[0].direction !== 'client') return invalid()
  if (scenario.id === 'permission-allow') {
    if (!nonempty(scenario.prompt) || !nonempty(scenario.expectedReply) || !nonempty(scenario.allowLabel) ||
        typeof scenario.historyRetry !== 'boolean') return invalid()
  } else if (!object(scenario.inputs) || !Number.isSafeInteger(scenario.inputs.nonce) ||
      Number(scenario.inputs.nonce) <= 0 || scenario.workspace !== undefined && !nonempty(scenario.workspace)) return invalid()
  assertRecordingSafe(value)
  if (value.version === 2 && (!Array.isArray(value.devices) || value.devices.length === 0 ||
      !value.devices.every(nonempty) || value.devices[0] !== deviceId)) return invalid()
  if (value.barriers !== undefined && (value.version !== 2 || !Array.isArray(value.barriers))) return invalid()
  let boundary = -1
  for (const barrier of value.barriers as { before: number; name: string }[] ?? []) {
    if (!object(barrier) || !Number.isSafeInteger(barrier.before) || barrier.before < 0 || barrier.before > wire.length ||
        barrier.before < boundary || !nonempty(barrier.name) || !/^[a-z][a-z0-9-]*$/.test(barrier.name)) return invalid()
    boundary = barrier.before
  }
  let closeBoundary = -1
  if (value.closures !== undefined && (value.version !== 2 || !Array.isArray(value.closures))) return invalid()
  for (const close of value.closures as NonNullable<Recording['closures']> ?? []) {
    if (!object(close) || !Number.isSafeInteger(close.before) || close.before < 0 || close.before > wire.length ||
        close.before < closeBoundary || !Number.isSafeInteger(close.connection) || close.connection < 1 ||
        !Number.isSafeInteger(close.code) || close.code < 1000 || close.code > 4999 ||
        (wire[close.before - 1] as RecordedEntry | undefined)?.connection !== close.connection) return invalid()
    closeBoundary = close.before
  }
  let connection = 1
  const clientIds = new Set<number>()
  const daemonIds = new Set<number>()
  for (const entry of wire) {
    if (!object(entry) || !['client', 'daemon'].includes(String(entry.direction)) || !object(entry.message)) return invalid()
    const next = entry.connection ?? 1
    if (value.version === 1 && entry.connection !== undefined || value.version === 2 &&
        (typeof next !== 'number' || !Number.isSafeInteger(next) || entry.connection === undefined || next < connection || next > connection + 1)) return invalid()
    if (next !== connection) { connection = next as number; clientIds.clear(); daemonIds.clear() }
    const m = entry.message
    if (!Number.isSafeInteger(m.id) || Number(m.id) < 0 || !nonempty(m.type) || forbidden.has(m.type) ||
        !nonempty(m.ts) || !object(m.payload) ||
        entry.atMs !== undefined && (typeof entry.atMs !== 'number' || !Number.isFinite(entry.atMs) || entry.atMs < 0)) return invalid()
    const ids = entry.direction === 'client' ? clientIds : daemonIds
    if (ids.has(m.id as number)) return invalid()
    ids.add(m.id as number)
    if (m.in_reply_to !== undefined && (entry.direction !== 'daemon' || !clientIds.has(m.in_reply_to as number))) return invalid()
    try { decodeEnvelope(encodeEnvelope(m as unknown as Envelope)) } catch { return invalid() }
  }
  if (value.version === 2 && (value.devices as unknown[]).length !== connection) return invalid()
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
  private boundClientIdentities = new Set<string>()
  private consumed = new Set<Envelope>()
  private index = 0
  private matched = 0
  private emitted = 0
  private connection = 1
  private barrier = 0
  private closure = 0
  private onClose?: (close: { code: number; afterServerFrames: number }) => void
  private failure: Error | undefined
  private progress = new Set<() => void>()
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
    for (const entry of this.recording.wire) {
      collect(entry.message.payload, '', conversationTypes.has(entry.message.type))
      collect({ conversation_id: entry.message.conversation_id, session_id: entry.message.session_id })
    }
  }
  setTransportCloseObserver(observer: (close: { code: number; afterServerFrames: number }) => void): void {
    if (this.index !== 0) throw new Error('Bind transport observer before replay')
    this.onClose = observer
  }
  setDeviceId(value: string): void {
    if (this.index !== 0 || !nonempty(value)) throw new Error('Recorded exchange identity must be bound before replay')
    this.identities.set(this.recording.deviceId, value)
  }
  bindCurrentDevice(value: string): void {
    const next = this.recording.wire[this.index]?.connection
    const connection = next === this.connection + 1 ? next : this.connection
    const recorded = this.recording.devices?.[connection - 1] ?? this.recording.deviceId
    this.identities.set(recorded, value)
  }
  reconnect(deviceId?: string): Uint8Array[] {
    const next = this.recording.wire[this.index]
    if (this.failure || !next || next.connection !== this.connection + 1 ||
        this.recording.barriers?.[this.barrier]?.before === this.index) return this.fail('Recorded exchange connection mismatch')
    this.connection++
    this.actualIds.clear()
    this.requestIds.clear()
    if (deviceId) this.identities.set(this.recording.devices![this.connection - 1], deviceId)
    return this.drain()
  }
  checkpoint(name: string): Uint8Array[] {
    const expected = this.recording.barriers?.[this.barrier]
    if (this.failure || !expected || expected.name !== name || expected.before !== this.index)
      return this.fail('Recorded exchange checkpoint mismatch')
    this.barrier++
    return this.drain()
  }
  async checkpointWhenReady(name: string): Promise<Uint8Array[]> {
    const expected = this.recording.barriers?.[this.barrier]
    if (this.failure) throw this.failure
    if (!expected || expected.name !== name) return this.fail('Recorded exchange checkpoint mismatch')
    if (this.index === expected.before) return this.checkpoint(name)
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        if (this.failure || this.index > expected.before) {
          cleanup(); reject(this.failure ?? new Error('Recorded exchange checkpoint mismatch')); return
        }
        if (this.index === expected.before) {
          cleanup()
          try { resolve(this.checkpoint(name)) } catch (error) { reject(error) }
        }
      }
      const cleanup = (): void => { clearTimeout(timer); this.progress.delete(finish) }
      const timer = setTimeout(() => {
        this.failure ??= new Error('Recorded exchange checkpoint prefix incomplete')
        this.notifyProgress()
      }, 30_000)
      this.progress.add(finish)
      finish()
    })
  }
  private notifyProgress(): void { for (const finish of [...this.progress]) finish() }
  private drain(): Uint8Array[] {
    const frames: Uint8Array[] = []
    while (this.index <= this.recording.wire.length) {
      const close = this.recording.closures?.[this.closure]
      if (close?.before === this.index) {
        if (!this.onClose || close.connection !== this.connection) return this.fail('Recorded exchange transport boundary mismatch')
        this.closure++
        this.onClose({ code: close.code, afterServerFrames: this.connection + this.emitted + frames.length })
      }
      if (this.index === this.recording.wire.length) break;
      if (this.recording.barriers?.[this.barrier]?.before === this.index) break
      const entry = this.recording.wire[this.index]
      if ((entry.connection ?? 1) !== this.connection) break
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
    this.notifyProgress()
    return frames
  }
  start(): Uint8Array[] { return this.drain() }
  private mapped(value: unknown): unknown {
    if (typeof value === 'string') return this.identities.get(value) ?? value
    if (Array.isArray(value)) return value.map(child => this.mapped(child))
    if (!object(value)) return value
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, this.mapped(child)]))
  }
  private fail(message: string): never {
    this.failure ??= new Error(message)
    this.notifyProgress()
    throw this.failure
  }
  reply(bytes: Uint8Array): Uint8Array[] {
    if (this.failure) throw this.failure
    let actual: Envelope
    try {
      decodeEnvelope(bytes)
      actual = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch { return this.fail('Recorded exchange malformed request') }
    if (this.actualIds.has(actual.id)) return this.fail('Recorded exchange duplicate request ID')
    const mismatch = `Recorded exchange request mismatch at step ${this.matched + 1}`
    if (!object(actual.payload)) return this.fail(mismatch)
    const eligible: Envelope[] = []
    for (let i = this.index; i < this.recording.wire.length; i++) {
      if (this.recording.barriers?.[this.barrier]?.before === i) break
      const entry = this.recording.wire[i]
      if ((entry.connection ?? 1) !== this.connection) break
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
    const bindings = actual.type === 'send_message' ? ['message_id'] : actual.type === 'modal_answer' ? ['answer_token'] : actual.type === 'attachment_chunk' ? ['attachment_id'] : []
    const newlyBound: string[] = []
    for (const key of bindings) if (nonempty(payload[key]) && nonempty(actual.payload[key]) && !this.boundClientIdentities.has(payload[key])) {
      this.identities.set(payload[key], actual.payload[key])
      newlyBound.push(payload[key])
    }
    const contract = ({ id: _id, ts: _ts, ...rest }: Envelope) => rest
    if (stable(contract(this.mapped(expected) as Envelope)) !== stable(contract(actual))) {
      this.identities = before
      return this.fail(mismatch)
    }
    newlyBound.forEach(id => this.boundClientIdentities.add(id))
    this.actualIds.add(actual.id)
    this.requestIds.set(expected.id, actual.id)
    this.consumed.add(expected)
    this.matched++
    return this.drain()
  }

  stats(): { matchedRequests: number; emittedFrames: number; remainingRequests: number } {
    return { matchedRequests: this.matched, emittedFrames: this.emitted,
      remainingRequests: this.recording.wire.filter(e => e.direction === 'client' && !this.consumed.has(e.message)).length }
  }
  assertComplete(): void {
    if (this.failure) throw this.failure
    const remaining = this.stats().remainingRequests
    if (this.closure !== (this.recording.closures?.length ?? 0) || this.barrier !== (this.recording.barriers?.length ?? 0) || this.index !== this.recording.wire.length)
      throw new Error(`Recorded exchange incomplete: ${remaining} requests remain`)
    if (remaining) throw new Error(`Recorded exchange incomplete: ${remaining} requests remain`)
  }
}
