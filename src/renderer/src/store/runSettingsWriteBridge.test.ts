import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import {
  translateWriteEvent,
  subscribeRunSettingsWrite,
  submitSettingsChange,
  RunSettingsWriteData,
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

describe('translateWriteEvent', () => {
  it('maps sessionSettingsUpdated to settingsConfirmed carrying its changeId', () => {
    const event: DaemonEvent = { type: 'sessionSettingsUpdated', sessionId: 's1', changeId: 'c1' }
    expect(translateWriteEvent(event)).toEqual({ type: 'settingsConfirmed', changeId: 'c1' })
  })

  it('maps sessionSettingsRejected to settingsRejected carrying its changeId', () => {
    const event: DaemonEvent = { type: 'sessionSettingsRejected', changeId: 'c2' }
    expect(translateWriteEvent(event)).toEqual({ type: 'settingsRejected', changeId: 'c2' })
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'sessionTransition', newSessionId: 's1' },
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
