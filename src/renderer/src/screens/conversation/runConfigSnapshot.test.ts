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
  it('maps a snapshotReceived to the three fields verbatim, including empty/false (AC5)', () => {
    const event: DaemonEvent = { type: 'snapshotReceived', model: '', effort: '', yolo: false }
    expect(toRunConfigSnapshot(event)).toEqual({ model: '', effort: '', yolo: false })
  })

  it('carries non-empty values through verbatim', () => {
    const event: DaemonEvent = {
      type: 'snapshotReceived',
      model: 'claude-x',
      effort: 'high',
      yolo: true
    }
    expect(toRunConfigSnapshot(event)).toEqual({ model: 'claude-x', effort: 'high', yolo: true })
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

    bridge.emit({ type: 'snapshotReceived', model: '', effort: '', yolo: false })
    expect(setSnapshot).toHaveBeenCalledTimes(1)
    expect(setSnapshot).toHaveBeenCalledWith({ model: '', effort: '', yolo: false })
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

    bridge.emit({ type: 'snapshotReceived', model: 'a', effort: 'low', yolo: false })
    bridge.emit({ type: 'snapshotReceived', model: 'b', effort: 'high', yolo: true })
    expect(setSnapshot).toHaveBeenNthCalledWith(1, { model: 'a', effort: 'low', yolo: false })
    expect(setSnapshot).toHaveBeenNthCalledWith(2, { model: 'b', effort: 'high', yolo: true })
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeRunConfig(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })
})
