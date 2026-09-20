import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload, MessagePayload } from '@shared/wire/types'
import {
  translateWriteEvent,
  subscribeRunSettingsWrite,
  submitSettingsChange,
  RunSettingsWriteData,
  confirmedEffortLevel,
  foldWriteEvent,
  type SubmitSettingsChangeDeps
} from './runSettingsWriteBridge'
import type { RunSettingsWriteEvent, SettingsChange } from './runSettingsWriteStore'

// Framework-free data-path tests with injected spies (the sessionIdBridge idiom): no React, no
// Electron. Inbound (translate/subscribe) and outbound (submit) helpers carry the logic and are
// tested directly; RunSettingsWriteData is thin App-mount glue verified only by a server render.

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

// The `connected` arm's payload, which this path deliberately ignores (mirrors modalBridge.test.ts).
const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}

describe('translateWriteEvent', () => {
  it('maps sessionSettingsUpdated to settingsConfirmed carrying its changeId', () => {
    const event: DaemonEvent = { type: 'sessionSettingsUpdated', sessionId: 's1', changeId: 'c1' }
    expect(translateWriteEvent(event)).toEqual({ type: 'settingsConfirmed', changeId: 'c1' })
  })

  it('maps sessionSettingsRejected to settingsRejected carrying its changeId', () => {
    const event: DaemonEvent = { type: 'sessionSettingsRejected', changeId: 'c2' }
    expect(translateWriteEvent(event)).toEqual({ type: 'settingsRejected', changeId: 'c2' })
  })

  it('maps connected to a payload-free reconnected, ignoring the ack (#539)', () => {
    const event: DaemonEvent = { type: 'connected', ack }
    const translated = translateWriteEvent(event)
    // Uncorrelated by construction — it carries no changeId, because its job is to abandon them all.
    expect(translated).toEqual({ type: 'reconnected' })
    expect(translated).not.toBe(event)
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      {
        type: 'sessionTransition',
        conversationId: 'conv-transition',
        newSessionId: 's1',
        reason: 'clear',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: null
      },
      { type: 'conversationsReceived', conversations: [] }
    ]
    for (const event of others) expect(translateWriteEvent(event)).toBeNull()
  })
})

describe('subscribeRunSettingsWrite', () => {
  // A fake onDaemonEvent that captures the listener and hands back an off spy.
  function fakeBridge(): {
    onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
    emit: (e: DaemonEvent) => void
    off: ReturnType<typeof vi.fn>
    subscribeCalls: () => number
  } {
    let listener: ((e: DaemonEvent) => void) | undefined
    const off = vi.fn()
    const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
      listener = l
      return off
    })
    return {
      onDaemonEvent,
      emit: (e) => listener?.(e),
      off,
      subscribeCalls: () => onDaemonEvent.mock.calls.length
    }
  }

  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeRunSettingsWrite(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('routes a sessionSettingsUpdated into dispatch as settingsConfirmed', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeRunSettingsWrite(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'sessionSettingsUpdated', sessionId: 's1', changeId: 'c1' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'settingsConfirmed', changeId: 'c1' })
  })

  it('routes a sessionSettingsRejected into dispatch as settingsRejected', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeRunSettingsWrite(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'sessionSettingsRejected', changeId: 'c2' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'settingsRejected', changeId: 'c2' })
  })

  it('routes a connected into dispatch as reconnected (#539)', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeRunSettingsWrite(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'connected', ack })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'reconnected' })
  })

  it('does not dispatch for an unrelated event', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeRunSettingsWrite(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'connecting' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeRunSettingsWrite(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })
})

describe('submitSettingsChange', () => {
  function makeDeps(change: SettingsChange): {
    deps: SubmitSettingsChangeDeps
    sendCommand: ReturnType<typeof vi.fn>
    dispatch: ReturnType<typeof vi.fn>
    mint: ReturnType<typeof vi.fn>
    run: () => void
  } {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()
    const mint = vi.fn(() => 'minted-id')
    const deps: SubmitSettingsChangeDeps = {
      sessionId: 'sess-1',
      sendCommand,
      dispatch,
      mintChangeId: mint
    }
    return { deps, sendCommand, dispatch, mint, run: () => submitSettingsChange(deps, change) }
  }

  it('mints one changeId, dispatches changeDispatched, and sends one setSessionSettings — all sharing the changeId (the correlation invariant)', () => {
    const { sendCommand, dispatch, mint, run } = makeDeps({ field: 'model', value: 'opus' })
    run()

    expect(mint).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'changeDispatched',
      changeId: 'minted-id',
      change: { field: 'model', value: 'opus' }
    })
    expect(sendCommand).toHaveBeenCalledTimes(1)
    const command = sendCommand.mock.calls[0][0]
    expect(command.type).toBe('setSessionSettings')
    if (command.type !== 'setSessionSettings') throw new Error('unreachable')
    // Same changeId on the store record and the command — the correlation key confirm/reject matches on.
    expect(command.changeId).toBe('minted-id')
  })

  it('builds a model payload carrying session_id + only model (omitempty: effort/yolo absent)', () => {
    const { sendCommand, run } = makeDeps({ field: 'model', value: 'opus' })
    run()
    const command = sendCommand.mock.calls[0][0]
    if (command.type !== 'setSessionSettings') throw new Error('unreachable')
    expect(command.payload).toEqual({ session_id: 'sess-1', model: 'opus' })
    expect(command.payload).not.toHaveProperty('effort')
    expect(command.payload).not.toHaveProperty('yolo')
  })

  it('builds an effort payload carrying session_id + only effort', () => {
    const { sendCommand, run } = makeDeps({ field: 'effort', value: 'high' })
    run()
    const command = sendCommand.mock.calls[0][0]
    if (command.type !== 'setSessionSettings') throw new Error('unreachable')
    expect(command.payload).toEqual({ session_id: 'sess-1', effort: 'high' })
    expect(command.payload).not.toHaveProperty('model')
    expect(command.payload).not.toHaveProperty('yolo')
  })

  it('builds a yolo payload carrying session_id + only yolo (a present false, not omitted)', () => {
    const { sendCommand, run } = makeDeps({ field: 'yolo', value: false })
    run()
    const command = sendCommand.mock.calls[0][0]
    if (command.type !== 'setSessionSettings') throw new Error('unreachable')
    expect(command.payload).toEqual({ session_id: 'sess-1', yolo: false })
    expect(command.payload).not.toHaveProperty('model')
    expect(command.payload).not.toHaveProperty('effort')
  })

  it('builds a permissionMode payload carrying session_id + permission_mode and NO yolo key (#1021)', () => {
    // The camelCase→snake_case spelling change happens HERE and nowhere else: the store's union arm is
    // `permissionMode` (the #1020 renderer/IPC spelling) and the wire key is `permission_mode`.
    const { sendCommand, run } = makeDeps({ field: 'permissionMode', value: 'plan' })
    run()
    const command = sendCommand.mock.calls[0][0]
    if (command.type !== 'setSessionSettings') throw new Error('unreachable')
    expect(command.payload).toEqual({ session_id: 'sess-1', permission_mode: 'plan' })
    // The daemon refuses a frame carrying both as malformed; the single-key literal keeps them apart.
    expect(command.payload).not.toHaveProperty('yolo')
    expect(command.payload).not.toHaveProperty('model')
    expect(command.payload).not.toHaveProperty('effort')
  })

  it('submits a permission mode VERBATIM — no allowlist, no repair, no mapping onto yolo (#1021)', () => {
    // `bypassPermissions` is refused by the daemon on this field (the escalation keeps one spelling,
    // `yolo: true`). The write path still submits it unchanged: policy is the daemon's, and a client-side
    // allowlist would drift from `validPermissionMode` while defending nothing.
    const { sendCommand, dispatch, run } = makeDeps({
      field: 'permissionMode',
      value: 'bypassPermissions'
    })
    run()
    const command = sendCommand.mock.calls[0][0]
    if (command.type !== 'setSessionSettings') throw new Error('unreachable')
    expect(command.payload).toEqual({ session_id: 'sess-1', permission_mode: 'bypassPermissions' })
    expect(command.payload).not.toHaveProperty('yolo')
    // The optimistic record carries the same unmapped value.
    expect(dispatch).toHaveBeenCalledWith({
      type: 'changeDispatched',
      changeId: 'minted-id',
      change: { field: 'permissionMode', value: 'bypassPermissions' }
    })
  })
})

describe('RunSettingsWriteData (container)', () => {
  // Server-render sanity — the SessionIdData.test idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock. Effect timing (deps/StrictMode) is verified by inspection
  // against the SessionIdData subscribe-effect idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(RunSettingsWriteData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})

// #1169 — REMEMBER ON CONFIRM. The confirm reply carries only a `changeId`, and the reducer deletes the
// pending record as it commits, so the value that was confirmed is recoverable in exactly one place:
// the pending map, read BEFORE the dispatch. Both helpers are injected and framework-free.

describe('confirmedEffortLevel', () => {
  const pendingWith = (change: SettingsChange): ReadonlyMap<string, SettingsChange> =>
    new Map([['id-1', change]])

  it('returns the confirmed effort value', () => {
    expect(
      confirmedEffortLevel(pendingWith({ field: 'effort', value: 'deep' }), {
        type: 'settingsConfirmed',
        changeId: 'id-1'
      })
    ).toBe('deep')
  })

  it('returns null for a confirmed change on any other field', () => {
    const others: SettingsChange[] = [
      { field: 'model', value: 'graded' },
      { field: 'yolo', value: true },
      { field: 'permissionMode', value: 'plan' }
    ]

    for (const change of others) {
      expect(
        confirmedEffortLevel(pendingWith(change), { type: 'settingsConfirmed', changeId: 'id-1' })
      ).toBeNull()
    }
  })

  it('returns null when the changeId matches no pending record', () => {
    // The store's own fail-closed rule (AC4 there): an uncorrelated confirm commits nothing, so it
    // remembers nothing either. This is also what closes a replayed ack from a hostile relay.
    expect(
      confirmedEffortLevel(pendingWith({ field: 'effort', value: 'deep' }), {
        type: 'settingsConfirmed',
        changeId: 'other-id'
      })
    ).toBeNull()
  })

  it('returns null for a rejection, a reconnect and a conversation switch', () => {
    const pending = pendingWith({ field: 'effort', value: 'deep' })
    const events: RunSettingsWriteEvent[] = [
      { type: 'settingsRejected', changeId: 'id-1' },
      { type: 'changeDispatched', changeId: 'id-1', change: { field: 'effort', value: 'deep' } },
      { type: 'reconnected' },
      { type: 'conversationSwitched' }
    ]

    for (const event of events) {
      expect(confirmedEffortLevel(pending, event)).toBeNull()
    }
  })

  it('returns null for a confirmed empty effort', () => {
    // `''` is the wire's ABSENCE of a level, so a confirm carrying it is not a level that was used.
    expect(
      confirmedEffortLevel(pendingWith({ field: 'effort', value: '' }), {
        type: 'settingsConfirmed',
        changeId: 'id-1'
      })
    ).toBeNull()
  })
})

describe('foldWriteEvent', () => {
  it('reads the pending map BEFORE dispatching, then remembers the confirmed level', () => {
    // The ordering IS the helper. The reducer deletes the pending record on a confirm, so a getPending
    // called after the dispatch would read an already-emptied map and remember nothing — a change that
    // compiles, passes every count assertion, and silently never persists anything.
    const order: string[] = []
    const pending = new Map<string, SettingsChange>([['id-1', { field: 'effort', value: 'deep' }]])
    const getPending = vi.fn(() => {
      order.push('read')
      return pending as ReadonlyMap<string, SettingsChange>
    })
    const dispatch = vi.fn(() => {
      order.push('dispatch')
      pending.delete('id-1')
    })
    const rememberEffort = vi.fn(() => order.push('remember'))

    foldWriteEvent({ getPending, dispatch, rememberEffort }, {
      type: 'settingsConfirmed',
      changeId: 'id-1'
    })

    expect(order).toEqual(['read', 'dispatch', 'remember'])
    expect(rememberEffort).toHaveBeenCalledWith('deep')
  })

  it('dispatches every event and remembers nothing on the ones that are not an effort confirm', () => {
    const dispatch = vi.fn()
    const rememberEffort = vi.fn()
    const getPending = () =>
      new Map<string, SettingsChange>([['id-1', { field: 'model', value: 'graded' }]])
    const events: RunSettingsWriteEvent[] = [
      { type: 'settingsConfirmed', changeId: 'id-1' },
      { type: 'settingsRejected', changeId: 'id-1' },
      { type: 'reconnected' },
      { type: 'conversationSwitched' }
    ]

    for (const event of events) {
      foldWriteEvent({ getPending, dispatch, rememberEffort }, event)
    }

    expect(dispatch).toHaveBeenCalledTimes(events.length)
    expect(rememberEffort).not.toHaveBeenCalled()
  })
})


describe('confirmed effort refresh', () => {
  it('refreshes after remembering only a correlated successful effort choice', () => {
    const pending = new Map<string, SettingsChange>([['choice', { field: 'effort', value: 'medium' }]])
    const order: string[] = []
    const deps = { getPending: () => pending, dispatch: () => order.push('dispatch'),
      rememberEffort: () => order.push('remember'), refresh: () => order.push('refresh') }
    foldWriteEvent(deps, { type: 'settingsConfirmed', changeId: 'choice' })
    expect(order).toEqual(['dispatch', 'remember', 'refresh'])
    for (const event of [
      { type: 'settingsConfirmed', changeId: 'foreign' },
      { type: 'settingsRejected', changeId: 'choice' }
    ] as const) {
      order.length = 0
      foldWriteEvent(deps, event)
      expect(order).toEqual(['dispatch'])
    }
  })
})
