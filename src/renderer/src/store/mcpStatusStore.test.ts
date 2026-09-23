import { translateDaemonEvent } from './daemonEventBridge'
import { translateTimelineEvent } from './timelineBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'
import { describe, expect, it } from 'vitest'
import {
  createMcpStatusStore,
  isMcpServerFailed,
  selectUnacknowledgedMcpFailureFor,
  selectMcpReconnectRefusedFor,
  selectMcpReconnectingFor,
  selectMcpStatusFor,
  selectMcpStatusUnavailableFor,
  selectMcpToggleRefusedFor,
  selectMcpTogglingFor
} from './mcpStatusStore'
import { subscribeMcpStatus } from './mcpStatusBridge'
import type { DaemonEvent } from '@shared/ipc/events'

const row = { name: 'docs', status: 'connected', error: '', scope: 'user', version: '2.0-beta' }
const report = { servers: [row], droppedServers: 0 }

describe('MCP status retention', () => {
  it('isolates conversations, keeps an empty list distinct from absence, and replaces whole reports', () => {
    const store = createMcpStatusStore()
    const read = (id: string | null) => selectMcpStatusFor(id)(store.getState())
    expect(read('__proto__')).toBeNull()
    expect(read(null)).toBeNull()
    for (const conversationId of ['a', 'b', '__proto__', 'constructor', '']) {
      store.getState().setMcpStatus({ conversationId, ...report })
    }
    const b = read('b')
    store.getState().setMcpStatus({ conversationId: 'a', servers: [], droppedServers: 3 })
    expect(read('a')).toEqual({ servers: [], droppedServers: 3 })
    expect(read('b')).toBe(b)
    expect(read('__proto__')).toEqual(report)
    expect(read('unknown')).toBeNull()
    store.getState().clearMcpStatus()
    for (const id of ['a', 'b', '__proto__', 'constructor', '']) expect(read(id)).toBeNull()
  })

  it('copies the rows it is handed', () => {
    const store = createMcpStatusStore()
    const servers = [{ ...row }]
    store.getState().setMcpStatus({ conversationId: 'a', servers, droppedServers: 0 })
    servers[0].status = 'failed'
    servers.push({ ...row })
    expect(selectMcpStatusFor('a')(store.getState())).toEqual(report)
  })

  it('subscribes independently of the sheet and tears down', () => {
    const store = createMcpStatusStore()
    const listeners = new Set<(event: DaemonEvent) => void>()
    const off = subscribeMcpStatus((listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }, store.getState().setMcpStatus, store.getState().markMcpStatusUnavailable, store.getState().markMcpReconnectRefused, store.getState().markMcpToggleRefused)
    const emit = (event: DaemonEvent) => listeners.forEach((listener) => listener(event))
    emit({ type: 'mcpStatus', conversationId: 'a', ...report })
    expect(selectMcpStatusFor('a')(store.getState())).toEqual(report)
    emit({ type: 'modelAnnounced', conversationId: 'a', model: 'other', truncated: false })
    expect(selectMcpStatusFor('a')(store.getState())).toEqual(report)
    off()
    expect(listeners.size).toBe(0)
  })
})

describe('MCP status unavailable mark', () => {
  const unavailable = (store: ReturnType<typeof createMcpStatusStore>, id: string | null) =>
    selectMcpStatusUnavailableFor(id)(store.getState())

  it('keeps the held report, isolates conversations and clears on that conversation\'s next report', () => {
    const store = createMcpStatusStore()
    store.getState().setMcpStatus({ conversationId: 'a', ...report })
    const held = selectMcpStatusFor('a')(store.getState())
    store.getState().markMcpStatusUnavailable('a')
    store.getState().markMcpStatusUnavailable('__proto__')
    expect(unavailable(store, 'a')).toBe(true)
    expect(unavailable(store, '__proto__')).toBe(true)
    expect(unavailable(store, 'b')).toBe(false)
    expect(unavailable(store, 'constructor')).toBe(false)
    expect(unavailable(store, null)).toBe(false)
    expect(selectMcpStatusFor('a')(store.getState())).toBe(held)
    store.getState().setMcpStatus({ conversationId: 'b', servers: [], droppedServers: 0 })
    expect(unavailable(store, 'a')).toBe(true)
    store.getState().setMcpStatus({ conversationId: 'a', servers: [], droppedServers: 0 })
    expect(unavailable(store, 'a')).toBe(false)
    expect(unavailable(store, '__proto__')).toBe(true)
    store.getState().clearMcpStatus()
    expect(unavailable(store, '__proto__')).toBe(false)
  })

  it('marks only on an unavailable refusal', () => {
    const store = createMcpStatusStore()
    let listener: (event: DaemonEvent) => void = () => {}
    subscribeMcpStatus((next) => {
      listener = next
      return () => {}
    }, store.getState().setMcpStatus, store.getState().markMcpStatusUnavailable, store.getState().markMcpReconnectRefused, store.getState().markMcpToggleRefused)
    store.getState().setMcpStatus({ conversationId: 'a', ...report })
    const before = store.getState()
    listener({ type: 'mcpStatusRequestRejected', conversationId: 'a', reason: 'unclassified' })
    expect(store.getState()).toBe(before)
    listener({ type: 'mcpStatusRequestRejected', conversationId: 'a', reason: 'mcp-status-unavailable' })
    expect(unavailable(store, 'a')).toBe(true)
    expect(unavailable(store, 'b')).toBe(false)
    expect(selectMcpStatusFor('a')(store.getState())).toEqual(report)
  })
})

describe('MCP reconnect wait and refusal', () => {
  const read = (store: ReturnType<typeof createMcpStatusStore>, id: string | null) => ({
    reconnecting: selectMcpReconnectingFor(id)(store.getState()),
    refused: selectMcpReconnectRefusedFor(id)(store.getState())
  })

  it('waits per conversation and ends the wait on close without touching other conversations', () => {
    const store = createMcpStatusStore()
    store.getState().beginMcpReconnect('a')
    store.getState().beginMcpReconnect('__proto__')
    expect(read(store, 'a')).toEqual({ reconnecting: true, refused: false })
    expect(read(store, '__proto__')).toEqual({ reconnecting: true, refused: false })
    expect(read(store, 'b')).toEqual({ reconnecting: false, refused: false })
    expect(read(store, 'constructor')).toEqual({ reconnecting: false, refused: false })
    expect(read(store, null)).toEqual({ reconnecting: false, refused: false })
    const before = store.getState().reconnecting
    store.getState().beginMcpReconnect('a')
    store.getState().endMcpReconnectWait('b')
    expect(store.getState().reconnecting).toBe(before)
    store.getState().endMcpReconnectWait('a')
    expect(read(store, 'a')).toEqual({ reconnecting: false, refused: false })
    expect(read(store, '__proto__')).toEqual({ reconnecting: true, refused: false })
  })

  it('a refusal ends the wait, marks the conversation and keeps the held report', () => {
    const store = createMcpStatusStore()
    store.getState().setMcpStatus({ conversationId: 'a', ...report })
    const held = selectMcpStatusFor('a')(store.getState())
    store.getState().beginMcpReconnect('a')
    store.getState().beginMcpReconnect('b')
    store.getState().markMcpReconnectRefused('a')
    expect(read(store, 'a')).toEqual({ reconnecting: false, refused: true })
    expect(read(store, 'b')).toEqual({ reconnecting: true, refused: false })
    expect(selectMcpStatusFor('a')(store.getState())).toBe(held)
    // A later press keeps the notice: only a report lifts it.
    store.getState().beginMcpReconnect('a')
    expect(read(store, 'a')).toEqual({ reconnecting: true, refused: true })
  })

  it('any report for the conversation ends the wait and lifts the notice, pending rows included', () => {
    const store = createMcpStatusStore()
    store.getState().beginMcpReconnect('a')
    store.getState().markMcpReconnectRefused('b')
    store.getState().beginMcpReconnect('b')
    store.getState().setMcpStatus({ conversationId: 'a', servers: [{ ...row, status: 'pending' }], droppedServers: 0 })
    expect(read(store, 'a')).toEqual({ reconnecting: false, refused: false })
    expect(read(store, 'b')).toEqual({ reconnecting: true, refused: true })
    store.getState().setMcpStatus({ conversationId: 'b', ...report })
    expect(read(store, 'b')).toEqual({ reconnecting: false, refused: false })
    store.getState().beginMcpReconnect('a')
    store.getState().markMcpReconnectRefused('c')
    store.getState().clearMcpStatus()
    expect(read(store, 'a')).toEqual({ reconnecting: false, refused: false })
    expect(read(store, 'c')).toEqual({ reconnecting: false, refused: false })
  })

  it('the bridge routes a reconnect refusal to the mark and nothing else', () => {
    const store = createMcpStatusStore()
    let listener: (event: DaemonEvent) => void = () => {}
    subscribeMcpStatus((next) => {
      listener = next
      return () => {}
    }, store.getState().setMcpStatus, store.getState().markMcpStatusUnavailable, store.getState().markMcpReconnectRefused, store.getState().markMcpToggleRefused)
    store.getState().setMcpStatus({ conversationId: 'a', ...report })
    store.getState().beginMcpReconnect('a')
    listener({ type: 'mcpReconnectRejected', conversationId: 'a' })
    expect(read(store, 'a')).toEqual({ reconnecting: false, refused: true })
    expect(selectMcpStatusUnavailableFor('a')(store.getState())).toBe(false)
    expect(selectMcpStatusFor('a')(store.getState())).toEqual(report)
  })
})

describe('MCP toggle wait and refusal', () => {
  const read = (store: ReturnType<typeof createMcpStatusStore>, id: string | null) => ({
    toggling: selectMcpTogglingFor(id)(store.getState()),
    refused: selectMcpToggleRefusedFor(id)(store.getState())
  })

  it('waits per conversation, ends on close, and keeps the reconnect sets apart', () => {
    const store = createMcpStatusStore()
    store.getState().beginMcpToggle('a')
    store.getState().beginMcpToggle('__proto__')
    expect(read(store, 'a')).toEqual({ toggling: true, refused: false })
    expect(read(store, '__proto__')).toEqual({ toggling: true, refused: false })
    expect(read(store, 'constructor')).toEqual({ toggling: false, refused: false })
    expect(read(store, null)).toEqual({ toggling: false, refused: false })
    expect(selectMcpReconnectingFor('a')(store.getState())).toBe(false)
    const before = store.getState().toggling
    store.getState().beginMcpToggle('a')
    store.getState().endMcpToggleWait('b')
    expect(store.getState().toggling).toBe(before)
    store.getState().endMcpToggleWait('a')
    expect(read(store, 'a')).toEqual({ toggling: false, refused: false })
    expect(read(store, '__proto__')).toEqual({ toggling: true, refused: false })
  })

  it('a refusal ends the wait and marks it, the held report stays, and only a report lifts the mark', () => {
    const store = createMcpStatusStore()
    store.getState().setMcpStatus({ conversationId: 'a', ...report })
    const held = selectMcpStatusFor('a')(store.getState())
    store.getState().beginMcpToggle('a')
    store.getState().beginMcpToggle('b')
    store.getState().markMcpToggleRefused('a')
    expect(read(store, 'a')).toEqual({ toggling: false, refused: true })
    expect(read(store, 'b')).toEqual({ toggling: true, refused: false })
    expect(selectMcpReconnectRefusedFor('a')(store.getState())).toBe(false)
    expect(selectMcpStatusFor('a')(store.getState())).toBe(held)
    store.getState().beginMcpToggle('a')
    expect(read(store, 'a')).toEqual({ toggling: true, refused: true })
    store.getState().setMcpStatus({ conversationId: 'a', servers: [{ ...row, status: 'disabled' }], droppedServers: 0 })
    expect(read(store, 'a')).toEqual({ toggling: false, refused: false })
    expect(read(store, 'b')).toEqual({ toggling: true, refused: false })
    store.getState().markMcpToggleRefused('c')
    store.getState().clearMcpStatus()
    expect(read(store, 'b')).toEqual({ toggling: false, refused: false })
    expect(read(store, 'c')).toEqual({ toggling: false, refused: false })
  })

  it('the bridge routes each refusal to its own mark', () => {
    const store = createMcpStatusStore()
    let listener: (event: DaemonEvent) => void = () => {}
    subscribeMcpStatus((next) => {
      listener = next
      return () => {}
    }, store.getState().setMcpStatus, store.getState().markMcpStatusUnavailable, store.getState().markMcpReconnectRefused, store.getState().markMcpToggleRefused)
    store.getState().setMcpStatus({ conversationId: 'a', ...report })
    store.getState().beginMcpToggle('a')
    listener({ type: 'mcpToggleRejected', conversationId: 'a' })
    expect(read(store, 'a')).toEqual({ toggling: false, refused: true })
    expect(selectMcpReconnectRefusedFor('a')(store.getState())).toBe(false)
    expect(selectMcpStatusFor('a')(store.getState())).toEqual(report)
    listener({ type: 'mcpReconnectRejected', conversationId: 'b' })
    expect(read(store, 'b')).toEqual({ toggling: false, refused: false })
    expect(selectMcpReconnectRefusedFor('b')(store.getState())).toBe(true)
  })
})

it('a report has no timeline, turn, modal or question action', () => {
  const event: DaemonEvent = { type: 'mcpStatus', conversationId: 'a', ...report }
  expect(translateDaemonEvent(event)).toBeNull()
  expect(translateTimelineEvent(event)).toBeNull()
  expect(translateModalEvent(event, () => new Set())).toBeNull()
  expect(translateQuestionEvent(event)).toBeNull()
})

describe('MCP failure acknowledgement', () => {
  const at = (name: string, status: string) => ({ ...row, name, status })
  const failure = (store: ReturnType<typeof createMcpStatusStore>, id: string | null) =>
    selectUnacknowledgedMcpFailureFor(id)(store.getState())
  const push = (store: ReturnType<typeof createMcpStatusStore>, conversationId: string, ...servers: typeof row[]) =>
    store.getState().setMcpStatus({ conversationId, servers, droppedServers: 0 })

  it('classifies exactly `failed` as failed', () => {
    expect(isMcpServerFailed('failed')).toBe(true)
    for (const word of ['pending', 'needs-auth', 'disabled', 'connected', 'Failed', 'failed ', '', 'unknown']) {
      expect(isMcpServerFailed(word)).toBe(false)
    }
  })

  it('names the first unacknowledged failure in report order, built-ins included', () => {
    const store = createMcpStatusStore()
    expect(failure(store, null)).toBeNull()
    expect(failure(store, 'a')).toBeNull()
    push(store, 'a', at('docs', 'connected'), at('late', 'pending'), at('pyry_files', 'failed'), at('broken', 'failed'))
    expect(failure(store, 'a')).toBe('pyry_files')
    push(store, 'a', at('docs', 'needs-auth'), at('off', 'disabled'))
    expect(failure(store, 'a')).toBeNull()
  })

  it('acknowledges every current failure once, and raises only a new one', () => {
    const store = createMcpStatusStore()
    push(store, 'a', at('one', 'failed'), at('two', 'failed'), at('ok', 'connected'))
    store.getState().acknowledgeMcpFailures('a')
    expect(failure(store, 'a')).toBeNull()
    push(store, 'a', at('two', 'failed'), at('one', 'failed'))
    expect(failure(store, 'a')).toBeNull()
    push(store, 'a', at('one', 'failed'), at('ok', 'failed'))
    expect(failure(store, 'a')).toBe('ok')
  })

  it('drops an unacknowledged failure once the report no longer reads failed', () => {
    const store = createMcpStatusStore()
    push(store, 'a', at('flaky', 'failed'))
    expect(failure(store, 'a')).toBe('flaky')
    push(store, 'a', at('flaky', 'connected'))
    expect(failure(store, 'a')).toBeNull()
  })

  it('isolates conversations, ignores an absent report, and clears with the reset', () => {
    const store = createMcpStatusStore()
    const before = store.getState().acknowledgedFailures
    store.getState().acknowledgeMcpFailures('a')
    expect(store.getState().acknowledgedFailures).toBe(before)
    for (const id of ['a', '__proto__', 'constructor']) push(store, id, at('same', 'failed'))
    store.getState().acknowledgeMcpFailures('a')
    expect(failure(store, 'a')).toBeNull()
    expect(failure(store, '__proto__')).toBe('same')
    expect(failure(store, 'constructor')).toBe('same')
    // A name is a value compared for equality, never a key: acknowledging a prototype-shaped name
    // silences only that exact name.
    push(store, 'b', at('__proto__', 'failed'), at('constructor', 'failed'))
    store.getState().acknowledgeMcpFailures('b')
    push(store, 'b', at('__proto__', 'failed'), at('toString', 'failed'))
    expect(failure(store, 'b')).toBe('toString')
    store.getState().clearMcpStatus()
    push(store, 'a', at('same', 'failed'))
    expect(failure(store, 'a')).toBe('same')
  })
})
