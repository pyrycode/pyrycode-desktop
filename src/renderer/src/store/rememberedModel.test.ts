import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { ConversationCreatedPayload, WireModelOption } from '@shared/wire/types'
import { createRememberedModel } from './rememberedModel'
import { createRunSettingsWriteStore, type SettingsChange } from './runSettingsWriteStore'
import { foldWriteEvent, submitSettingsChange } from './runSettingsWriteBridge'

const chat: ConversationCreatedPayload = { id: 'new', is_promoted: false, cwd: '/workspace',
  name: null, last_used_at: '', workspace_label: null }
const row: WireModelOption = { value: ' Raw Choice ', display_name: 'Choice', resolved_model: 'resolved',
  effort_levels: [], supports_auto_mode: false, truncated_fields: null }
const settings: StampedDaemonEvent = { type: 'runConfigReceived', serverId: 'host',
  conversationId: 'new', sessionId: 'session-new', model: 'inherited', effort: '', yolo: false,
  permissionMode: 'default', used_tokens: 0, window_tokens: 0 }

function harness(value: string | null = row.value) {
  const storage = { read: vi.fn(() => value), write: vi.fn((next: string) => { value = next }) }
  const model = createRememberedModel(storage)
  const writes = createRunSettingsWriteStore()
  const send = vi.fn()
  const log = vi.fn()
  let owned = true
  let contextListener = () => {}
  const listeners = new Set<(event: StampedDaemonEvent) => void>()
  const off = vi.fn()
  const emit = (event: StampedDaemonEvent) => {
    if (event.type === 'sessionSettingsUpdated' || event.type === 'sessionSettingsRejected') {
      foldWriteEvent({ getPending: () => writes.getState().pending, dispatch: writes.getState().dispatch,
        rememberEffort: vi.fn(), rememberModel: model.remember }, {
        type: event.type === 'sessionSettingsUpdated' ? 'settingsConfirmed' : 'settingsRejected',
        changeId: event.changeId
      })
    }
    for (const listener of listeners) listener(event)
  }
  const deps = {
    onDaemonEvent: (listener: (event: StampedDaemonEvent) => void) => {
      listeners.add(listener); return () => { listeners.delete(listener); off() }
    },
    ownsTarget: () => owned,
    canWriteTarget: () => owned,
    subscribeOwnership: (listener: () => void) => { contextListener = listener; return off },
    getModels: () => undefined,
    writes,
    submit: (sessionId: string, change: SettingsChange, changeId: string) => submitSettingsChange({
      sessionId, dispatch: writes.getState().dispatch, sendCommand: send, mintChangeId: () => changeId
    }, change),
    mintChangeId: () => 'recall', log
  }
  const list = (models = [row], conversationId = 'new', serverId = 'host') => emit({
    type: 'modelList', serverId, conversationId, models, droppedModels: 0
  })
  return { storage, model, writes, send, log, emit, deps, list, off,
    loseOwnership: () => { owned = false; contextListener() },
    start: (created = chat) => model.start(created, 'host', deps, () => {}) }
}

describe('remembered model', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('persists a deliberate raw pick only on its correlated confirmation and survives restart', () => {
    const h = harness('previous')
    h.writes.getState().dispatch({ type: 'changeDispatched', changeId: 'user',
      change: { field: 'model', value: row.value } })
    expect(h.storage.write).not.toHaveBeenCalled()
    h.emit({ type: 'sessionSettingsUpdated', serverId: 'host', sessionId: 's', changeId: 'unmatched' })
    expect(h.storage.write).not.toHaveBeenCalled()
    h.emit({ type: 'sessionSettingsUpdated', serverId: 'host', sessionId: 's', changeId: 'user' })
    expect(h.storage.write).toHaveBeenCalledTimes(1)
    expect(h.storage.write).toHaveBeenCalledWith(row.value)
    h.emit({ type: 'sessionSettingsUpdated', serverId: 'host', sessionId: 's', changeId: 'user' })
    expect(h.storage.write).toHaveBeenCalledTimes(1)
    const restarted = createRememberedModel(h.storage)
    restarted.start(chat, 'another-host', { ...h.deps, getModels: () => ({ models: [row], droppedModels: 0 }) }, () => {})
    h.emit({ ...settings, serverId: 'another-host' })
    expect(h.send).toHaveBeenCalledWith({ type: 'setSessionSettings', changeId: 'recall',
      payload: { session_id: 'session-new', model: row.value } })
    restarted.cancel()
  })

  it.each([
    { change: { field: 'model', value: '' }, reply: 'sessionSettingsUpdated' },
    { change: { field: 'model', value: row.value, source: 'recall' }, reply: 'sessionSettingsUpdated' },
    { change: { field: 'model', value: row.value }, reply: 'sessionSettingsRejected' },
    { change: { field: 'effort', value: 'high' }, reply: 'sessionSettingsUpdated' }
  ] as const)('does not remember $change on $reply', ({ change, reply }) => {
    const h = harness('previous')
    h.writes.getState().dispatch({ type: 'changeDispatched', changeId: 'pick', change })
    h.emit(settings)
    h.emit({ type: reply, serverId: 'host', sessionId: 's', changeId: 'pick' })
    expect(h.storage.write).not.toHaveBeenCalled()
  })

  it.each([null, '', 'default'])('skips preference %s after one read', value => {
    const h = harness(value); h.start(); h.list(); h.emit(settings)
    expect(h.storage.read).toHaveBeenCalledTimes(1)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.model.pending.getState().target).toBeNull()
  })

  it.each([{ rows: [] }, { rows: [{ ...row, value: 'raw choice' }] },
    { rows: [{ ...row, agent: 'codex' as const }] },
    { rows: [{ ...row, truncated_fields: ['value'] }] }])('skips an ineligible list $rows', ({ rows }) => {
    const h = harness(); h.start(); h.list(rows); h.emit(settings)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.model.pending.getState().target).toBeNull()
    expect(h.storage.write).not.toHaveBeenCalled()
  })

  it.each(['models', 'settings'])('settles at the %s deadline without retry', stage => {
    const h = harness(); h.start()
    if (stage === 'settings') { vi.advanceTimersByTime(4000); h.list() }
    vi.advanceTimersByTime(4999)
    expect(h.model.pending.getState().target).toBe('new')
    vi.advanceTimersByTime(1)
    expect(h.model.pending.getState().target).toBeNull()
    h.list(); h.emit(settings)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.log).toHaveBeenCalledWith(stage + '-timeout')
  })

  it('retains the first early settings reply and holds through confirmation', () => {
    const h = harness()
    h.model.start(chat, 'host', h.deps, () => h.emit(settings))
    h.emit({ ...settings, sessionId: 'later' })
    h.list([ { ...row, truncated_fields: ['display_name'] } ])
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send).toHaveBeenCalledWith({ type: 'setSessionSettings', changeId: 'recall',
      payload: { session_id: 'session-new', model: row.value } })
    vi.advanceTimersByTime(20000)
    expect(h.model.pending.getState().target).toBe('new')
    h.emit({ type: 'sessionSettingsUpdated', serverId: 'host', sessionId: 'session-new', changeId: 'other' })
    expect(h.model.pending.getState().target).toBe('new')
    h.emit({ type: 'sessionSettingsUpdated', serverId: 'host', sessionId: 'session-new', changeId: 'recall' })
    expect(h.model.pending.getState().target).toBeNull()
    expect(h.writes.getState().confirmed.model).toBe(row.value)
    expect(h.storage.write).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ends immediately on an empty first session even before models', () => {
    const h = harness(); h.start(); h.emit({ ...settings, sessionId: '' }); h.list(); h.emit(settings)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.model.pending.getState().target).toBeNull()
  })

  it.each(['reject', 'throw', 'leave', 'unmount'])('silently rolls back on %s', failure => {
    const h = harness(); h.start(); h.list()
    if (failure === 'throw') h.send.mockImplementation(() => { throw Error('private model/session') })
    h.emit(settings)
    if (failure === 'reject') h.emit({ type: 'sessionSettingsRejected', serverId: 'host', changeId: 'recall' })
    if (failure === 'leave') h.loseOwnership()
    if (failure === 'unmount') h.model.cancel()
    expect(h.model.pending.getState().target).toBeNull()
    expect(h.writes.getState().pending.size).toBe(0)
    expect(h.writes.getState().confirmed).toEqual({})
    expect(h.writes.getState().error).toBeNull()
    h.list(); h.emit(settings)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.storage.write).not.toHaveBeenCalled()
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('private')
  })

  it('ignores foreign hosts/chats and cancels reads on ownership loss', () => {
    const h = harness(); h.start(); h.list([row], 'other'); h.list([row], 'new', 'other-host')
    h.emit({ ...settings, conversationId: 'other' }); h.emit({ ...settings, serverId: 'other-host' })
    expect(h.send).not.toHaveBeenCalled()
    h.loseOwnership(); h.list(); h.emit(settings)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.model.pending.getState().target).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not read preferences or hold channels', () => {
    const h = harness(); h.start({ ...chat, is_promoted: true }); h.list(); h.emit(settings)
    expect(h.storage.read).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
    expect(h.model.pending.getState().target).toBeNull()
  })

  it('recalls the captured preference without replacing a newer deliberate confirmation', () => {
    const h = harness(); h.start()
    h.writes.getState().dispatch({ type: 'changeDispatched', changeId: 'user',
      change: { field: 'model', value: 'newer-choice' } })
    h.emit({ type: 'sessionSettingsUpdated', serverId: 'host', sessionId: 's', changeId: 'user' })
    h.list(); h.emit(settings)
    expect(h.send.mock.calls[0][0].payload.model).toBe(row.value)
    h.emit({ type: 'sessionSettingsUpdated', serverId: 'host', sessionId: 'session-new', changeId: 'recall' })
    expect(h.storage.read()).toBe('newer-choice')
    expect(h.storage.write).toHaveBeenCalledTimes(1)
  })

  it('accepts the created agent and a cached list without waiting for another frame', () => {
    const h = harness()
    h.model.start({ ...chat, agent: 'codex' }, 'host', { ...h.deps,
      getModels: () => ({ models: [{ ...row, agent: 'codex' }], droppedModels: 0 }) }, () => {})
    h.emit(settings)
    expect(h.send).toHaveBeenCalledTimes(1)
    h.model.cancel()
  })

  it('owning-host re-handshake cancels and reopening cannot replay the attempt', () => {
    const h = harness(); h.start(); h.list(); h.emit(settings)
    h.emit({ type: 'connected', serverId: 'host', ack: {
      protocol_version: 'v2', server_id: 'host', conn_id: 'conn', capabilities: []
    } })
    h.list(); h.emit(settings)
    expect(h.model.pending.getState().target).toBeNull()
    expect(h.writes.getState().pending.size).toBe(0)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('refuses an unavailable or ambiguous owning-host lookup immediately before writing', () => {
    const h = harness()
    h.model.start(chat, 'host', { ...h.deps, canWriteTarget: () => false }, () => {})
    h.list(); h.emit(settings)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.model.pending.getState().target).toBeNull()
  })
})
