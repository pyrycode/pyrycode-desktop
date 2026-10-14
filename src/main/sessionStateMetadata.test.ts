import { afterEach, expect, it, vi } from 'vitest'
import { createDaemonConnection } from './daemonConnection'
import { base64StdEncode, decodeEnvelope, WireDecodeError } from './transport/codec'
import { parseInboundMessage } from './transport/inboundMessage'
import { DAEMON_EVENT_CHANNEL, type StampedDaemonEvent } from '../shared/ipc/events'
import type { NoiseRelayDriverConfig } from './transport/noiseRelayDriver'
import type { PyryApi } from '../preload'

const electron = vi.hoisted(() => ({ expose: vi.fn(), listeners: new Set<Function>() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.expose }, webUtils: {}, ipcRenderer: {
  on: (_channel: string, listener: Function) => electron.listeners.add(listener),
  removeListener: (_channel: string, listener: Function) => electron.listeners.delete(listener)
} }))
import '../preload'
const api: PyryApi = electron.expose.mock.calls[0][1]
const c = { conversation_id: 'conversation' }
const settings = { session_id: 'payload-session', model: '', effort: '', yolo: false,
  permission_mode: '', used_tokens: 0, window_tokens: 0 }
const cases: [string, Record<string, unknown>, string][] = [
  ['modal_shown', { ...c, modal_id: 'm', class: 'permission', title: '', prompt: '', options: [], default_option_id: '' }, 'modalShown'],
  ['modal_dismissed', { modal_id: 'm', outcome: '', source: 'remote' }, 'modalDismissed'],
  ['question_shown', { ...c, question_batch_id: 'q', questions: [] }, 'questionShown'],
  ['question_dismissed', { question_batch_id: 'q', outcome: '', source: 'no_answer' }, 'questionDismissed'],
  ['turn_state', { ...c, state: 'idle' }, 'turnState'],
  ['stall', c, 'stallDetected'],
  ['api_retry', { ...c, active: false, current: 0, total: 0 }, 'apiRetry'],
  ['compacting', { ...c, active: false }, 'compacting'],
  ['thinking_progress', { ...c, estimated_tokens: 0, estimated_tokens_delta: 0 }, 'thinkingProgress'],
  ['tool_progress', { ...c, turn_id: 't', tool_use_id: 'tool', elapsed_seconds: 0 }, 'toolProgress'],
  ['background_task_progress', { ...c, task_id: 'task', description: '', subagent_type: '', last_tool_name: '',
    total_tokens: 0, tool_uses: 0, duration_ms: 0, truncated_fields: null }, 'backgroundTaskProgress'],
  ['resetting', { ...c, active: false, phase: '', handoff: '' }, 'resetting'],
  ['rate_limited', { ...c, status: '', limit_type: '', resets_at: 0, truncated_fields: null }, 'rateLimited'],
  ['context_usage', { ...c, model: '', total_tokens: 0, max_tokens: 0, percentage: 0, categories: [], dropped_categories: 0,
    mcp_tools: [], dropped_mcp_tools: 0, memory_files: [], dropped_memory_files: 0 }, 'contextUsage'],
  ['model_announced', { ...c, model: '', truncated: false }, 'modelAnnounced'],
  ['session_facts', { ...c, claude_code_version: '', permission_mode: '', truncated_fields: null }, 'sessionFacts'],
  ['session_settings', settings, 'runConfigReceived'],
  ['session_settings_updated', { session_id: 'payload-session' }, 'sessionSettingsUpdated'],
  ['mcp_status', { ...c, servers: [], dropped_servers: 0 }, 'mcpStatus'],
  ['slash_command_list', { ...c, commands: [], dropped_commands: 0 }, 'slashCommandList'],
  ['model_list', { ...c, models: [], dropped_models: 0 }, 'modelList'],
  ['reply_suggestion', { ...c, session_id: 'payload-session', revision: 1, suggested_reply: null }, 'replySuggestion'],
  ['session_error', { ...c, code: '' }, 'sessionError']
]
const family = (type: string) => type === 'modal_dismissed' ? 'modal_shown'
  : type === 'question_dismissed' ? 'question_shown' : type === 'session_settings_updated' ? 'session_settings' : type
const frame = (type: string, payload: unknown, metadata: Record<string, unknown> = {}) =>
  Buffer.from(JSON.stringify({ id: 99, type, ts: 'stamp', payload, ...metadata }))

async function connected(serverId = 'host') {
  const configs: NoiseRelayDriverConfig[] = [], sent: Uint8Array[] = []
  const connection = createDaemonConnection({
    serverId, deviceName: 'test', clientVersion: 'test',
    pairedServer: { load: async () => ({ server: 'host', relay: 'wss://relay.example/v1/client', token: 'fake',
      server_static_pubkey: base64StdEncode(new Uint8Array(32)) }), save: async () => {} },
    deviceKeypair: { ensure: async () => ({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }) },
    sink: { isDestroyed: () => false, webContents: { send: (channel, event) => {
      if (channel === DAEMON_EVENT_CHANNEL) electron.listeners.forEach(listener => listener({}, structuredClone(event)))
    } } },
    createDriver: config => { configs.push(config); return { sendMessage: bytes => { sent.push(bytes) }, stop: () => {} } }
  })
  connection.start(); await vi.waitFor(() => expect(configs).toHaveLength(1))
  configs[0].onEvent({ type: 'handshake-complete', helloAck: frame('hello_ack', {
    protocol_version: 'v2', server_id: 'host', conn_id: 'connection', capabilities: []
  }) })
  const emit = (bytes: Uint8Array) => configs.at(-1)!.onEvent({ type: 'message', plaintext: bytes })
  function request(type: string): number {
    if (type === 'session_settings') connection.requestSessionSettings('conversation')
    else if (type === 'session_settings_updated') connection.setSessionSettings({ session_id: 'payload-session', model: 'model' }, 'change')
    else return 42
    return decodeEnvelope(sent.at(-1)!).id
  }
  return { connection, configs, sent, emit, request }
}
afterEach(() => { electron.listeners.clear() })

it.each(cases)('%s carries tri-state provenance and correlation through parse, IPC and preload', async (type, payload, eventType) => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e)), h = await connected()
  for (const tag of [undefined, null, 'envelope-session']) {
    const in_reply_to = h.request(type)
    const bytes = frame(type, payload, { in_reply_to, ...(tag === undefined ? {} : { session_id: tag }) })
    const decoded = decodeEnvelope(bytes), parsed = parseInboundMessage(bytes)
    expect(Object.hasOwn(decoded, 'session_id')).toBe(tag !== undefined)
    expect(parsed).toMatchObject({ inReplyTo: in_reply_to })
    expect(Object.hasOwn(parsed!, 'envelopeSessionId')).toBe(tag !== undefined)
    if (tag !== undefined) expect(parsed).toMatchObject({ envelopeSessionId: tag })
    h.emit(bytes)
    const event = received.at(-1)!
    expect(event).toMatchObject({ type: eventType, serverId: 'host', inReplyTo: in_reply_to })
    expect(Object.hasOwn(event, 'envelopeSessionId')).toBe(tag !== undefined)
    if (tag !== undefined) expect(event).toMatchObject({ envelopeSessionId: tag })
    if (type.startsWith('session_settings') || type === 'reply_suggestion') expect(event).toMatchObject({ sessionId: 'payload-session' })
    if ('conversation_id' in payload || type === 'session_settings') expect(event).toMatchObject({ conversationId: 'conversation' })
    else expect(Object.hasOwn(event, 'conversationId')).toBe(false)
  }
  // Ordinary omission does not synthesize provenance or correlation; correlation-gated replies retain their gate.
  const bytes = frame(type, payload)
  const parsed = parseInboundMessage(bytes)!
  expect(Object.hasOwn(parsed, 'envelopeSessionId')).toBe(false)
  expect(Object.hasOwn(parsed, 'inReplyTo')).toBe(false)
  h.emit(bytes)
  if (!type.startsWith('session_settings')) expect(Object.hasOwn(received.at(-1)!, 'inReplyTo')).toBe(false)
  off(); h.connection.stop()
})

it.each(cases)('%s clears before fresh, maps its family and remains inert for legacy translators', async (type, payload) => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e)), h = await connected()
  for (const tag of [undefined, null, 'envelope-session']) {
    const in_reply_to = h.request(type)
    const bytes = frame(type, {}, { session_state_cleared: true, in_reply_to, ...(tag === undefined ? {} : { session_id: tag }) })
    expect(parseInboundMessage(bytes)).toMatchObject({ kind: 'session-state-cleared', family: family(type) })
    h.emit(bytes)
    const clear = received.at(-1)!
    expect(clear).toMatchObject({ type: 'sessionStateCleared', family: family(type), serverId: 'host', inReplyTo: in_reply_to,
      correlation: { id: 99, ts: 'stamp', in_reply_to } })
    expect(Object.hasOwn(clear, 'conversationId')).toBe(false)
    expect(Object.hasOwn(clear, 'envelopeSessionId')).toBe(tag !== undefined)
    if (tag !== undefined) expect(clear).toMatchObject({ envelopeSessionId: tag, correlation: { session_id: tag } })
    const before = received.length
    h.emit(frame(type, payload, { in_reply_to, session_state_cleared: false, ...(tag === undefined ? {} : { session_id: tag }) }))
    expect(received).toHaveLength(before + 1)
    expect(received.at(-1)!.type).toBe(cases.find(row => row[0] === type)![2])
  }
  // Generated clears omit correlation and cannot attribute through a session binding.
  h.emit(frame(type, {}, { session_state_cleared: true, session_id: 'envelope-session' }))
  const clear = received.at(-1)!
  expect(Object.hasOwn(clear, 'inReplyTo')).toBe(false)
  expect(clear.type === 'sessionStateCleared' && Object.hasOwn(clear.correlation, 'in_reply_to')).toBe(false)
  off(); h.connection.stop()
})

const summary = { id: 'conversation', name: null, is_promoted: false, is_archived: false, cwd: '',
  last_message_ts: '', last_used_at: '', workspace_label: null, read_up_to: 7, latest_entry_id: 12 }
it('preserves empty/zero and omitted summary metadata through preload, alongside legacy marks', async () => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e)), h = await connected()
  for (const metadata of [{}, { current_session_id: '', last_shown_version: 0 }, { current_session_id: 's', last_shown_version: Number.MAX_SAFE_INTEGER },
    { current_session_id: '' }, { last_shown_version: 0 }]) {
    const bytes = frame('conversations', { conversations: [{ ...summary, ...metadata }] })
    const parsed = parseInboundMessage(bytes)
    expect(parsed?.kind).toBe('conversations')
    h.emit(bytes)
    const event = received.at(-1)!
    expect(event.type).toBe('conversationsReceived')
    const row = event.type === 'conversationsReceived' ? event.conversations[0] : undefined
    expect(row).toMatchObject({ ...summary, ...metadata })
    for (const key of ['current_session_id', 'last_shown_version']) {
      expect(Object.hasOwn(row!, key)).toBe(Object.hasOwn(metadata, key))
      if (parsed?.kind === 'conversations') expect(Object.hasOwn(parsed.conversations[0], key)).toBe(Object.hasOwn(metadata, key))
    }
  }
  off(); h.connection.stop()
})
it.each([
  ...[null, 0, false, {}, []].map(current_session_id => ({ current_session_id })),
  ...[null, '0', false, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, {}, []].map(last_shown_version => ({ last_shown_version }))
])('rejects invalid summary metadata %j without partial preload delivery', async metadata => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e)), h = await connected()
  const bytes = frame('conversations', { conversations: [summary, { ...summary, ...metadata }] })
  expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  const before = received.length; h.emit(bytes); expect(received).toHaveLength(before)
  off(); h.connection.stop()
})
it.each(['', 0, false, {}, []])('rejects invalid envelope tag %j in decoder, parser and connection', async session_id => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e)), h = await connected()
  for (const bytes of [frame('stall', c, { session_id }), frame('stall', {}, { session_id, session_state_cleared: true })]) {
    expect(() => decodeEnvelope(bytes)).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
    const before = received.length; h.emit(bytes); expect(received).toHaveLength(before)
  }
  off(); h.connection.stop()
})
it('rejects malformed clears and keeps absent/false flags on ordinary validation paths', async () => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e)), h = await connected()
  for (const flag of [null, 0, 'true', {}, []]) {
    expect(() => decodeEnvelope(frame('stall', c, { session_state_cleared: flag }))).toThrow(WireDecodeError)
  }
  const invalid = [
    ...[null, 0, 'true', {}, []].map(session_state_cleared => frame('stall', c, { session_state_cleared })),
    ...[null, [], '', 0, { conversation_id: 'conversation' }, { future: null }, JSON.parse('{"__proto__":{}}')]
      .map(payload => frame('stall', payload, { session_state_cleared: true })),
    ...['message', 'thread_item_added', 'future', '__proto__', 'constructor', 'toString']
      .map(type => frame(type, {}, { session_state_cleared: true }))
  ]
  for (const bytes of invalid) {
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
    const before = received.length; h.emit(bytes); expect(received).toHaveLength(before)
  }
  for (const metadata of [{}, { session_state_cleared: false }]) {
    expect(() => parseInboundMessage(frame('stall', {}, metadata))).toThrow(WireDecodeError)
    h.emit(frame('stall', c, metadata)); expect(received.at(-1)!.type).toBe('stallDetected')
  }
  off(); h.connection.stop()
})
it('isolates equal conversation/session IDs across hosts and preserves subscription ownership and capabilities', async () => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e))
  const a = await connected('a'), b = await connected('b')
  const metadata = { session_id: 'same-session' }
  a.emit(frame('turn_state', {}, { ...metadata, session_state_cleared: true }))
  b.emit(frame('turn_state', { ...c, state: 'idle' }, metadata))
  a.emit(frame('turn_state', { ...c, state: 'thinking' }, metadata))
  expect(received.slice(-3).map(e => [e.type, e.serverId])).toEqual([
    ['sessionStateCleared', 'a'], ['turnState', 'b'], ['turnState', 'a']
  ])
  for (const h of [a, b]) {
    expect((decodeEnvelope(h.configs[0].session.hello).payload as { capabilities: string[] }).capabilities).not.toContain('thread')
    expect(h.sent).toHaveLength(0)
  }
  off(); const before = received.length
  a.emit(frame('turn_state', c, metadata)); expect(received).toHaveLength(before)
  const offAgain = api.onDaemonEvent(e => received.push(e))
  b.emit(frame('stall', c)); expect(received).toHaveLength(before + 1)
  expect(Object.hasOwn(received.at(-1)!, 'envelopeSessionId')).toBe(false)
  offAgain(); a.connection.stop(); b.connection.stop()
})

it('clear metadata cannot forge conversation attribution, advance replay or feed thread progress', async () => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e)), h = await connected()
  h.emit(frame('turn_state', {}, { session_state_cleared: true, session_id: null, in_reply_to: 0,
    event_id: 500, history_entry_id: 7, conversation_id: 'forged', generation: 12, revision: 4 }))
  const clear = received.at(-1)!
  expect(clear).toMatchObject({ type: 'sessionStateCleared', envelopeSessionId: null, inReplyTo: 0,
    correlation: { id: 99, ts: 'stamp', session_id: null, in_reply_to: 0, event_id: 500, history_entry_id: 7 } })
  expect(clear.type === 'sessionStateCleared' && Object.keys(clear.correlation).sort()).toEqual([
    'event_id', 'history_entry_id', 'id', 'in_reply_to', 'session_id', 'session_state_cleared', 'ts'
  ])
  expect(Object.hasOwn(clear, 'conversationId')).toBe(false)
  expect(received.some(e => e.type === 'threadUpdate' || e.type === 'threadRepairNeeded')).toBe(false)
  h.connection.reconnect(); await vi.waitFor(() => expect(h.configs).toHaveLength(2))
  expect(Object.hasOwn(decodeEnvelope(h.configs[1].session.hello).payload as object, 'last_event_id')).toBe(false)
  off(); h.connection.stop()
})
it('unknown and duplicate ordinary settings replies keep existing settlement gates', async () => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e)), h = await connected()
  const reply = h.request('session_settings')
  const before = received.length
  h.emit(frame('session_settings', settings, { in_reply_to: reply + 1, session_id: null }))
  h.emit(frame('session_settings', settings, { session_id: null }))
  expect(received).toHaveLength(before)
  h.emit(frame('session_settings', settings, { in_reply_to: reply, session_id: null }))
  expect(received).toHaveLength(before + 1)
  h.emit(frame('session_settings', settings, { in_reply_to: reply, session_id: null }))
  expect(received).toHaveLength(before + 1)
  off(); h.connection.stop()
})
