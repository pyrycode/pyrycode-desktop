import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import {
  toRunConfigSnapshot,
  requestRunConfigSnapshot,
  subscribeRunConfig
} from './runConfigSnapshot'
import { MILESTONE_CONVERSATION_ID } from './composerSend'

// Framework-free data-path tests with injected spies (the composerSend / logDataDownload idiom):
// no React, no store, no Electron.

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('toRunConfigSnapshot', () => {
  it('maps a snapshotReceived to the five fields verbatim, including empty/false (AC5)', () => {
    // Input carries the two usage ints (#191); #192 widens the OUTPUT to also carry them, mapping the
    // wire snake_case (used_tokens / window_tokens) to the store's camelCase.
    const event: DaemonEvent = {
      type: 'snapshotReceived',
      model: '',
      effort: '',
      yolo: false,
      used_tokens: 45000,
      window_tokens: 200000
    }
    expect(toRunConfigSnapshot(event)).toEqual({
      model: '',
      effort: '',
      yolo: false,
      usedTokens: 45000,
      windowTokens: 200000
    })
  })

  it('carries non-empty values through verbatim', () => {
    const event: DaemonEvent = {
      type: 'snapshotReceived',
      model: 'claude-x',
      effort: 'high',
      yolo: true,
      used_tokens: 45000,
      window_tokens: 200000
    }
    expect(toRunConfigSnapshot(event)).toEqual({
      model: 'claude-x',
      effort: 'high',
      yolo: true,
      usedTokens: 45000,
      windowTokens: 200000
    })
  })

  it('carries window_tokens: 0 (usage unavailable) through as windowTokens: 0, not coerced', () => {
    const event: DaemonEvent = {
      type: 'snapshotReceived',
      model: '',
      effort: '',
      yolo: false,
      used_tokens: 0,
      window_tokens: 0
    }
    expect(toRunConfigSnapshot(event)).toEqual({
      model: '',
      effort: '',
      yolo: false,
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
  it('fires exactly one requestSnapshot for the milestone conversation (AC1)', () => {
    const sendCommand = vi.fn()
    requestRunConfigSnapshot(sendCommand)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'requestSnapshot',
      payload: { conversation_id: MILESTONE_CONVERSATION_ID }
    })
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
    subscribeRunConfig(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the verbatim snapshot on a snapshotReceived event (AC3/AC5)', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot)

    bridge.emit({
      type: 'snapshotReceived',
      model: '',
      effort: '',
      yolo: false,
      used_tokens: 45000,
      window_tokens: 200000
    })
    expect(setSnapshot).toHaveBeenCalledTimes(1)
    expect(setSnapshot).toHaveBeenCalledWith({
      model: '',
      effort: '',
      yolo: false,
      usedTokens: 45000,
      windowTokens: 200000
    })
  })

  it('does not call setSnapshot for an unrelated event', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot)

    bridge.emit({ type: 'connecting' })
    expect(setSnapshot).not.toHaveBeenCalled()
  })

  it('a later event replaces the held value — most recent snapshot wins (AC4)', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot)

    bridge.emit({
      type: 'snapshotReceived',
      model: 'a',
      effort: 'low',
      yolo: false,
      used_tokens: 10000,
      window_tokens: 200000
    })
    bridge.emit({
      type: 'snapshotReceived',
      model: 'b',
      effort: 'high',
      yolo: true,
      used_tokens: 20000,
      window_tokens: 200000
    })
    expect(setSnapshot).toHaveBeenNthCalledWith(1, {
      model: 'a',
      effort: 'low',
      yolo: false,
      usedTokens: 10000,
      windowTokens: 200000
    })
    expect(setSnapshot).toHaveBeenNthCalledWith(2, {
      model: 'b',
      effort: 'high',
      yolo: true,
      usedTokens: 20000,
      windowTokens: 200000
    })
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeRunConfig(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })
})
