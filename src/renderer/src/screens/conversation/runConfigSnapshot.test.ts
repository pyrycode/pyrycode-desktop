import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import {
  toRunConfigSnapshot,
  toSnapshotSessionId,
  requestRunConfigSnapshot,
  subscribeRunConfig
} from './runConfigSnapshot'

// Framework-free data-path tests with injected spies (the composerSend / logDataDownload idiom):
// no React, no store, no Electron.

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('toRunConfigSnapshot', () => {
  it('maps a runConfigReceived to the five display fields verbatim, including empty/false (AC5)', () => {
    // Input carries the two usage ints (#191); #192 widens the OUTPUT to also carry them, mapping the
    // wire snake_case (used_tokens / window_tokens) to the store's camelCase.
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      sessionId: 'sess-a',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 45000,
      window_tokens: 200000
    }
    expect(toRunConfigSnapshot(event)).toEqual({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 45000,
      windowTokens: 200000
    })
  })

  it('carries non-empty values through verbatim', () => {
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      sessionId: 'sess-a',
      model: 'claude-x',
      effort: 'high',
      yolo: true,
      permissionMode: 'bypassPermissions',
      used_tokens: 45000,
      window_tokens: 200000
    }
    expect(toRunConfigSnapshot(event)).toEqual({
      model: 'claude-x',
      effort: 'high',
      yolo: true,
      permissionMode: 'bypassPermissions',
      usedTokens: 45000,
      windowTokens: 200000
    })
  })

  it('carries permissionMode verbatim for each of the six modes, and for one outside them (#1020)', () => {
    // No mapping to or from `yolo`, and no client-side allowlist: the read half carries six modes
    // where the write half accepts five (#1021), so the mapper copies whatever arrived. The seventh
    // case is a value the daemon should never send — it still passes through, because deciding what
    // to DISPLAY for an unknown mode belongs to #682, not to this mapper.
    const modes = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions', 'nonsense']
    for (const mode of modes) {
      const event: DaemonEvent = {
        type: 'runConfigReceived',
        sessionId: 'sess-a',
        model: 'claude-x',
        effort: 'high',
        // Deliberately `false` beside `bypassPermissions` in one iteration: the mapper must not
        // reconcile the two, even though a real daemon keeps them in agreement.
        yolo: false,
        permissionMode: mode,
        used_tokens: 45000,
        window_tokens: 200000
      }
      expect(toRunConfigSnapshot(event)?.permissionMode).toBe(mode)
    }
  })

  it('carries permissionMode: "" (no session resolved) through, never coerced (#1020)', () => {
    // The all-zero reply's reading. '' is held as '' — not mapped to 'default', not to null, and not
    // inferred from `yolo: false`. It is the same verbatim-hold the empty session_id already gets.
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      sessionId: '',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: '',
      used_tokens: 0,
      window_tokens: 0
    }
    expect(toRunConfigSnapshot(event)).toHaveProperty('permissionMode', '')
    expect(toSnapshotSessionId(event)).toBe('')
  })

  it('carries window_tokens: 0 (usage unavailable) through as windowTokens: 0, not coerced', () => {
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      sessionId: 'sess-a',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 0,
      window_tokens: 0
    }
    expect(toRunConfigSnapshot(event)).toEqual({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 0,
      windowTokens: 0
    })
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'debugBundleSaved', path: '/tmp/pyry-debug.tar.gz' }
    ]
    for (const event of others) expect(toRunConfigSnapshot(event)).toBeNull()
  })
})

describe('requestRunConfigSnapshot', () => {
  it('fires exactly one requestSessionSettings naming the given conversation (#946)', () => {
    const sendCommand = vi.fn()
    requestRunConfigSnapshot(sendCommand, 'conv-1')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'requestSessionSettings',
      payload: { conversation_id: 'conv-1' }
    })
  })

  // The daemon has answered only the conversation a request names since 2026-08-20
  // (pyrycode#1586/#1610), and answers an unnamed one with a zero-valued reply rather than an error
  // frame. #945 gave the frame the field; this asserts the renderer fills it and carries nothing
  // else — the key sets, not just the shape, so an extra field cannot slip onto the wire unnoticed.
  it('carries the conversation id and nothing else (#946)', () => {
    const sendCommand = vi.fn()
    requestRunConfigSnapshot(sendCommand, 'conv-1')
    const command = sendCommand.mock.calls[0][0]
    expect(Object.keys(command)).toEqual(['type', 'payload'])
    expect(Object.keys(command.payload)).toEqual(['conversation_id'])
  })

  // AC2, and the ONLY proof of this branch anywhere: the real-daemon spec seeds and opens a promoted
  // conversation, so an active one always exists there, and no renderer spec in this repo can run an
  // effect to drive the two mount sites. A request that names nothing draws the zero reply, and
  // `setSnapshot` replaces the WHOLE snapshot — so sending one would wipe held values that the reply
  // could never have improved. Not sending is the fix; there is nothing to degrade to.
  it('sends nothing when no conversation is active (#946)', () => {
    const sendCommand = vi.fn()
    requestRunConfigSnapshot(sendCommand, null)
    expect(sendCommand).not.toHaveBeenCalled()
  })

  // The same unresolvable request spelled differently: '' serialises to the identical frame and draws
  // the identical zero reply, so it carries the identical wipe hazard. One falsy check covers both
  // because it is one failure, not two. The IPC-boundary guard (isRequestSessionSettingsPayload)
  // deliberately still ACCEPTS '' — it checks type, not emptiness; refusing to send an unaddressable
  // id is this helper's job, not the boundary's.
  it('sends nothing for an empty conversation id (#946)', () => {
    const sendCommand = vi.fn()
    requestRunConfigSnapshot(sendCommand, '')
    expect(sendCommand).not.toHaveBeenCalled()
  })
})

describe('toSnapshotSessionId', () => {
  it('maps a runConfigReceived to its session id', () => {
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      sessionId: 'sess-a',
      model: 'opus',
      effort: 'high',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 0,
      window_tokens: 200000
    }
    expect(toSnapshotSessionId(event)).toBe('sess-a')
  })

  it('maps an empty session id to "" verbatim, NOT to null', () => {
    // '' is the daemon saying "I have no session to address" — a real answer. Returning null here
    // would leave a stale id in the store, so the sheet would stay operable and address a session
    // the daemon just said it cannot resolve. The gate, not this mapper, turns '' into inert.
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      sessionId: '',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 0,
      window_tokens: 200000
    }
    expect(toSnapshotSessionId(event)).toBe('')
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message }
    ]
    for (const event of others) expect(toSnapshotSessionId(event)).toBeNull()
  })
})

describe('subscribeRunConfig', () => {
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
    subscribeRunConfig(bridge.onDaemonEvent, vi.fn(), vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the verbatim snapshot on a runConfigReceived event (AC3/AC5)', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, vi.fn())

    bridge.emit({
      type: 'runConfigReceived',
      sessionId: 'sess-a',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 45000,
      window_tokens: 200000
    })
    expect(setSnapshot).toHaveBeenCalledTimes(1)
    expect(setSnapshot).toHaveBeenCalledWith({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 45000,
      windowTokens: 200000
    })
  })

  it('does not call setSnapshot for an unrelated event', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, vi.fn())

    bridge.emit({ type: 'connecting' })
    expect(setSnapshot).not.toHaveBeenCalled()
  })

  it('a later event replaces the held value — most recent snapshot wins (AC4)', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, vi.fn())

    bridge.emit({
      type: 'runConfigReceived',
      sessionId: 'sess-a',
      model: 'a',
      effort: 'low',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 10000,
      window_tokens: 200000
    })
    bridge.emit({
      type: 'runConfigReceived',
      sessionId: 'sess-a',
      model: 'b',
      effort: 'high',
      yolo: true,
      permissionMode: 'bypassPermissions',
      used_tokens: 20000,
      window_tokens: 200000
    })
    expect(setSnapshot).toHaveBeenNthCalledWith(1, {
      model: 'a',
      effort: 'low',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 10000,
      windowTokens: 200000
    })
    expect(setSnapshot).toHaveBeenNthCalledWith(2, {
      model: 'b',
      effort: 'high',
      yolo: true,
      permissionMode: 'bypassPermissions',
      usedTokens: 20000,
      windowTokens: 200000
    })
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeRunConfig(bridge.onDaemonEvent, vi.fn(), vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('feeds BOTH setters from ONE listener on a single event (#491)', () => {
    // The values and the session id arrive on the same frame and are only meaningful together: the
    // values describe the session the id names. One subscription, not two, so there is no state
    // where the sheet shows one session's values while addressing another.
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    const setSessionId = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, setSessionId)

    bridge.emit({
      type: 'runConfigReceived',
      sessionId: 'sess-a',
      model: 'opus',
      effort: 'high',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 100,
      window_tokens: 200000
    })

    expect(bridge.subscribeCalls()).toBe(1)
    expect(setSnapshot).toHaveBeenCalledTimes(1)
    expect(setSessionId).toHaveBeenCalledTimes(1)
    expect(setSessionId).toHaveBeenCalledWith('sess-a')
  })

  it('writes an empty session id through, so the gate can close on it', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, vi.fn(), setSessionId)

    bridge.emit({
      type: 'runConfigReceived',
      sessionId: '',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 0,
      window_tokens: 200000
    })

    expect(setSessionId).toHaveBeenCalledWith('')
  })

  it('does not call setSessionId for an unrelated event', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, vi.fn(), setSessionId)

    bridge.emit({ type: 'connecting' })
    expect(setSessionId).not.toHaveBeenCalled()
  })
})
