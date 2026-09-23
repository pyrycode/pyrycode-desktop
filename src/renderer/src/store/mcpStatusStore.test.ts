import { translateDaemonEvent } from './daemonEventBridge'
import { translateTimelineEvent } from './timelineBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'
import { describe, expect, it } from 'vitest'
import { createMcpStatusStore, selectMcpStatusFor, selectMcpStatusUnavailableFor } from './mcpStatusStore'
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
    }, store.getState().setMcpStatus, store.getState().markMcpStatusUnavailable)
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
    }, store.getState().setMcpStatus, store.getState().markMcpStatusUnavailable)
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

it('a report has no timeline, turn, modal or question action', () => {
  const event: DaemonEvent = { type: 'mcpStatus', conversationId: 'a', ...report }
  expect(translateDaemonEvent(event)).toBeNull()
  expect(translateTimelineEvent(event)).toBeNull()
  expect(translateModalEvent(event, () => new Set())).toBeNull()
  expect(translateQuestionEvent(event)).toBeNull()
})
