import { afterEach, expect, it, vi } from 'vitest'
import type { DaemonEvent, StampedDaemonEvent } from '@shared/ipc/events'
import { createRunConfigStore } from '../../store/runConfigStore'
import { createRunSettingsWriteStore } from '../../store/runSettingsWriteStore'
import { foldWriteEvent } from '../../store/runSettingsWriteBridge'
import { subscribeConfirmedRunConfig } from './confirmedRunConfig'

afterEach(() => vi.useRealTimers())
function setup() {
  vi.useFakeTimers()
  let listener: (event: StampedDaemonEvent) => void = () => {}
  let contextChanged = () => {}
  let context = { conversationId: 'chat', serverId: 'host' }
  const config = createRunConfigStore()
  const writes = createRunSettingsWriteStore()
  const refresh = vi.fn(), log = vi.fn(), setSessionId = vi.fn(), unsubscribe = vi.fn()
  const off = subscribeConfirmedRunConfig({
    onDaemonEvent: fn => { listener = fn; return unsubscribe },
    subscribeContext: fn => { contextChanged = fn; return unsubscribe },
    getContext: () => context, writes, config, refresh, log, setSessionId
  })
  const emit = (event: DaemonEvent, serverId = 'host') => listener({ ...event, serverId })
  const report = (permissionMode = 'bypassPermissions', sessionId = 'session') => emit({
    type: 'runConfigReceived', conversationId: context.conversationId, sessionId,
    model: 'running-model', effort: 'high', effectiveEffort: 'low', yolo: false, permissionMode, used_tokens: 0, window_tokens: 0
  } as DaemonEvent)
  const pick = (value = 'plan', changeId = 'pick') => writes.getState().dispatch({ type: 'changeDispatched', changeId, change: { field: 'permissionMode', value } })
  const settle = (rejected = false, changeId = 'pick') => {
    // Write bridge runs first: correlation must survive removal from its pending map.
    foldWriteEvent({ getPending: () => writes.getState().pending, dispatch: writes.getState().dispatch,
      rememberEffort: vi.fn() }, { type: rejected ? 'settingsRejected' : 'settingsConfirmed', changeId })
    emit({ type: rejected ? 'sessionSettingsRejected' : 'sessionSettingsUpdated', changeId, sessionId: 'session' } as DaemonEvent)
  }
  const switchTo = (conversationId: string, serverId: string) => { context = { conversationId, serverId }; contextChanged() }
  return { config, writes, refresh, log, off, emit, report, pick, settle, switchTo, unsubscribe }
}

it('retains reports while pending and acknowledged, retries an early old reading, then stops on confirmation', () => {
  const h = setup()
  h.report(); h.pick()
  expect(h.refresh).not.toHaveBeenCalled()
  expect(h.config.getState().snapshot?.permissionMode).toBe('bypassPermissions')
  h.settle(); h.report()
  expect(h.refresh).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(500)
  expect(h.refresh).toHaveBeenCalledTimes(2)
  h.report('plan')
  vi.advanceTimersByTime(15_000)
  expect(h.refresh).toHaveBeenCalledTimes(2)
  expect(h.config.getState().snapshot?.permissionMode).toBe('plan')
  h.report('', '')
  expect(h.config.getState().snapshot?.permissionMode).toBe('')
  h.off()
})

it('confirms a bypass selection through fresh reports without an optimistic label', () => {
  const previous = 'plan', confirmed = 'bypassPermissions'
  const h = setup()
  h.report(previous)
  h.writes.getState().dispatch({ type: 'changeDispatched', changeId: 'pick', change: { field: 'yolo', value: true } })
  expect(h.refresh).not.toHaveBeenCalled()
  expect(h.config.getState().snapshot?.permissionMode).toBe(previous)
  h.settle()
  expect(h.refresh).toHaveBeenCalledTimes(1)
  expect(h.config.getState().snapshot?.permissionMode).toBe(previous)
  h.report(previous)
  vi.advanceTimersByTime(500)
  expect(h.refresh).toHaveBeenCalledTimes(2)
  h.report(confirmed)
  vi.advanceTimersByTime(15_000)
  expect(h.refresh).toHaveBeenCalledTimes(2)
  expect(h.log).toHaveBeenCalledWith('confirmed')
  expect(h.config.getState().snapshot?.permissionMode).toBe(confirmed)
  h.off()
})

it('refreshes rejection once and preserves empty mode with a resolved session', () => {
  const h = setup()
  h.report(); h.pick(); h.settle(true)
  expect(h.config.getState().snapshot?.permissionMode).toBe('bypassPermissions')
  h.report('')
  expect(h.config.getState().snapshot?.permissionMode).toBe('')
  vi.advanceTimersByTime(15_000)
  expect(h.refresh).toHaveBeenCalledTimes(1)
  h.off()
})

it.each([false, true])('preserves acknowledged confirmation across rejection with an outstanding read: %s', outstanding => {
  const h = setup()
  h.report('default'); h.pick('acceptEdits', 'first'); h.settle(false, 'first')
  if (!outstanding) h.report('default')
  h.pick('dontAsk', 'later'); h.settle(true, 'later')
  const reads = outstanding ? 1 : 2
  expect(h.refresh).toHaveBeenCalledTimes(reads)
  expect(h.config.getState().snapshot?.permissionMode).toBe('default')
  vi.advanceTimersByTime(500)
  expect(h.refresh).toHaveBeenCalledTimes(reads)
  h.report('default')
  vi.advanceTimersByTime(500)
  expect(h.refresh).toHaveBeenCalledTimes(reads + 1)
  h.report('acceptEdits')
  vi.advanceTimersByTime(15_000)
  expect(h.refresh).toHaveBeenCalledTimes(reads + 1)
  expect(h.config.getState().snapshot?.permissionMode).toBe('acceptEdits')
  h.off()
})

it('does not extend an acknowledged confirmation deadline when a later write is rejected', () => {
  const h = setup()
  h.report('default'); h.pick('acceptEdits', 'first'); h.settle(false, 'first')
  vi.advanceTimersByTime(14_000)
  h.report('default'); h.pick('dontAsk', 'later'); h.settle(true, 'later')
  h.report('default'); vi.advanceTimersByTime(500)
  expect(h.refresh).toHaveBeenCalledTimes(3)
  h.report('default'); vi.advanceTimersByTime(500)
  expect(h.log).toHaveBeenCalledWith('unconfirmed')
  vi.advanceTimersByTime(15_000)
  expect(h.refresh).toHaveBeenCalledTimes(3)
  expect(h.config.getState().snapshot?.permissionMode).toBe('default')
  h.off()
})

it('keeps reset suppression across replacement and the replacement guard across reset completion', () => {
  const h = setup()
  h.report(); h.pick(); h.settle()
  h.emit({ type: 'resetting', conversationId: 'chat', active: true, phase: 'restarting', handoff: 'skipped' })
  h.emit({ type: 'sessionTransition', conversationId: 'chat', newSessionId: 'replacement', reason: 'clear', occurredAt: '', workspaceCwd: null })
  h.report('default', 'replacement')
  vi.advanceTimersByTime(1000)
  expect(h.refresh).toHaveBeenCalledTimes(1)
  expect(h.config.getState().snapshot?.permissionMode).toBe('')
  h.emit({ type: 'resetting', conversationId: 'chat', active: false, phase: '', handoff: '' })
  expect(h.refresh).toHaveBeenCalledTimes(2)
  h.report('default', 'session')
  expect(h.config.getState().snapshot?.permissionMode).toBe('')
  h.report('plan', 'replacement')
  expect(h.config.getState().snapshot?.permissionMode).toBe('plan')
  h.off()
})

it('waits for a missing reply, times out, and cancels listeners and retries on teardown', () => {
  const h = setup()
  h.report(); h.pick(); h.settle()
  vi.advanceTimersByTime(16_000)
  expect(h.refresh).toHaveBeenCalledTimes(1)
  expect(h.log).toHaveBeenCalledWith('unconfirmed')
  h.pick(); h.settle(); h.off()
  const calls = h.refresh.mock.calls.length
  vi.advanceTimersByTime(20_000)
  expect(h.refresh).toHaveBeenCalledTimes(calls)
  expect(h.unsubscribe).toHaveBeenCalledTimes(2)
})

it.each([['other', 'host'], ['chat', 'other-host']])('isolates context changes to %s on %s', (chat, host) => {
  const h = setup()
  h.report(); h.pick(); h.settle(); h.switchTo(chat, host)
  expect(h.config.getState().snapshot?.permissionMode).toBe('')
  h.emit({ type: 'runConfigReceived', conversationId: 'chat', sessionId: 'session', model: '', effort: '', yolo: false, permissionMode: 'default', used_tokens: 0, window_tokens: 0 } as DaemonEvent)
  expect(h.config.getState().snapshot?.permissionMode).toBe('')
  vi.advanceTimersByTime(1000)
  expect(h.refresh).toHaveBeenCalledTimes(1)
  h.off()
})

it('ignores other hosts, invalidates owning reconnects, and excludes reset/replacement sessions', () => {
  const h = setup()
  h.report()
  const connected = { type: 'connected', ack: { protocol_version: 'v2', server_id: 'wire-host', conn_id: 'c', capabilities: [] } } as DaemonEvent
  h.emit(connected, 'other-host')
  expect(h.config.getState().snapshot?.permissionMode).toBe('bypassPermissions')
  h.emit(connected)
  expect(h.config.getState().snapshot?.permissionMode).toBe('')
  expect(h.config.getState().snapshot).toMatchObject({ model: 'running-model', effort: 'high', effectiveEffort: 'low' })
  h.report()
  h.emit({ type: 'resetting', conversationId: 'chat', active: true, phase: 'restarting', handoff: 'skipped' } as DaemonEvent)
  h.report('default')
  expect(h.config.getState().snapshot?.permissionMode).toBe('')
  h.emit({ type: 'resetting', conversationId: 'chat', active: false, phase: '', handoff: '' } as DaemonEvent)
  h.emit({ type: 'sessionTransition', conversationId: 'chat', newSessionId: 'new-session', reason: 'clear', occurredAt: '', workspaceCwd: null } as DaemonEvent)
  h.report('default', 'session')
  expect(h.config.getState().snapshot?.permissionMode).toBe('')
  h.report('plan', 'new-session')
  expect(h.config.getState().snapshot?.permissionMode).toBe('plan')
  h.report('', '')
  expect(h.config.getState().snapshot?.permissionMode).toBe('')
  h.off()
})

it('bounds repeated old-mode replies after an acknowledged no-op', () => {
  const h = setup()
  h.report(); h.pick(); h.settle()
  for (let n = 0; n < 30; n++) { h.report(); vi.advanceTimersByTime(500) }
  expect(h.refresh).toHaveBeenCalledTimes(30)
  expect(h.log).toHaveBeenCalledWith('unconfirmed')
  expect(h.config.getState().snapshot?.permissionMode).toBe('bypassPermissions')
  h.off()
})
