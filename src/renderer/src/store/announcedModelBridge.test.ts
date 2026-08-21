import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import {
  translateModelAnnounced,
  subscribeAnnouncedModel,
  AnnouncedModelData
} from './announcedModelBridge'
import { createAnnouncedModelStore, selectAnnouncedModel } from './announcedModelStore'

// Framework-free data-path tests with injected spies (the screenSnapshotBridge / sessionIdBridge
// idiom): no React, no Electron. The real store is wired only for the not-yet-announced → announced
// seam tests.

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('translateModelAnnounced', () => {
  it('maps a modelAnnounced to { model, truncated } (the owned arm)', () => {
    const event: DaemonEvent = {
      type: 'modelAnnounced',
      model: 'claude-haiku-4-5-20251001',
      truncated: false
    }
    expect(translateModelAnnounced(event)).toEqual({
      model: 'claude-haiku-4-5-20251001',
      truncated: false
    })
  })

  it('carries truncated: true through unchanged (AC2)', () => {
    const event: DaemonEvent = { type: 'modelAnnounced', model: 'claude-opus-4-5', truncated: true }
    expect(translateModelAnnounced(event)).toEqual({ model: 'claude-opus-4-5', truncated: true })
  })

  it('maps an empty-model modelAnnounced to { model: "", truncated } — not null (AC4)', () => {
    const event: DaemonEvent = { type: 'modelAnnounced', model: '', truncated: false }
    expect(translateModelAnnounced(event)).not.toBeNull()
    expect(translateModelAnnounced(event)).toEqual({ model: '', truncated: false })
  })

  it('returns a FRESH literal, not the event — `type` never reaches the store', () => {
    const event: DaemonEvent = { type: 'modelAnnounced', model: 'claude-opus-4-5', truncated: false }
    const result = translateModelAnnounced(event)
    expect(result).not.toBeNull()
    expect(result === null || 'type' in result).toBe(false)
    expect(result).not.toBe(event)
  })

  it('returns null for a sample of unrelated daemon events, INCLUDING the name-colliding arm', () => {
    // runConfigReceived also carries a `model: string`, but it means the per-session OVERRIDE — the
    // opposite value (see the `modelAnnounced` arm's doc in events.ts). The filter must never pick it
    // up and mistake it for claude's announcement.
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      {
        type: 'runConfigReceived',
        sessionId: 's',
        model: 'some-override',
        effort: '',
        yolo: false,
        used_tokens: 0,
        window_tokens: 0
      },
      { type: 'compacting', active: true },
      { type: 'conversationsReceived', conversations: [] }
    ]
    for (const event of others) expect(translateModelAnnounced(event)).toBeNull()
  })
})

describe('subscribeAnnouncedModel', () => {
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
    subscribeAnnouncedModel(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the translated announcement on a modelAnnounced event (AC1)', () => {
    const bridge = fakeBridge()
    const setAnnouncedModel = vi.fn()
    subscribeAnnouncedModel(bridge.onDaemonEvent, setAnnouncedModel)

    bridge.emit({ type: 'modelAnnounced', model: 'claude-haiku-4-5', truncated: false })
    expect(setAnnouncedModel).toHaveBeenCalledTimes(1)
    expect(setAnnouncedModel).toHaveBeenCalledWith({
      model: 'claude-haiku-4-5',
      truncated: false
    })
  })

  it('writes again on a second announcement, with the second value (AC3)', () => {
    const bridge = fakeBridge()
    const setAnnouncedModel = vi.fn()
    subscribeAnnouncedModel(bridge.onDaemonEvent, setAnnouncedModel)

    bridge.emit({ type: 'modelAnnounced', model: 'first-model', truncated: false })
    bridge.emit({ type: 'modelAnnounced', model: 'second-model', truncated: true })
    expect(setAnnouncedModel).toHaveBeenCalledTimes(2)
    expect(setAnnouncedModel).toHaveBeenLastCalledWith({
      model: 'second-model',
      truncated: true
    })
  })

  it('writes an empty-model announcement — the !== null guard, not truthiness (AC4)', () => {
    const bridge = fakeBridge()
    const setAnnouncedModel = vi.fn()
    subscribeAnnouncedModel(bridge.onDaemonEvent, setAnnouncedModel)

    bridge.emit({ type: 'modelAnnounced', model: '', truncated: false })
    expect(setAnnouncedModel).toHaveBeenCalledTimes(1)
    // `truncated` survives too: an `if (announced?.model)` guard would have dropped both fields.
    expect(setAnnouncedModel).toHaveBeenCalledWith({ model: '', truncated: false })
  })

  it('does not call setAnnouncedModel for an unrelated event', () => {
    const bridge = fakeBridge()
    const setAnnouncedModel = vi.fn()
    subscribeAnnouncedModel(bridge.onDaemonEvent, setAnnouncedModel)

    bridge.emit({ type: 'connecting' })
    expect(setAnnouncedModel).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeAnnouncedModel(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives the store from not-yet-announced (null) to the record on one event (AC4 → AC1)', () => {
    const bridge = fakeBridge()
    const store = createAnnouncedModelStore()
    subscribeAnnouncedModel(bridge.onDaemonEvent, (a) => store.getState().setAnnouncedModel(a))

    expect(selectAnnouncedModel(store.getState())).toBeNull()
    bridge.emit({ type: 'modelAnnounced', model: 'claude-haiku-4-5', truncated: true })
    expect(selectAnnouncedModel(store.getState())).toEqual({
      model: 'claude-haiku-4-5',
      truncated: true
    })
  })

  it('a newer announcement replaces the older one through the real store (AC3)', () => {
    const bridge = fakeBridge()
    const store = createAnnouncedModelStore()
    subscribeAnnouncedModel(bridge.onDaemonEvent, (a) => store.getState().setAnnouncedModel(a))

    bridge.emit({ type: 'modelAnnounced', model: 'old-model', truncated: true })
    bridge.emit({ type: 'modelAnnounced', model: 'new-model', truncated: false })
    expect(selectAnnouncedModel(store.getState())).toEqual({
      model: 'new-model',
      truncated: false
    })
  })

  it('leaves the store untouched on a runConfigReceived carrying an override model', () => {
    const bridge = fakeBridge()
    const store = createAnnouncedModelStore()
    subscribeAnnouncedModel(bridge.onDaemonEvent, (a) => store.getState().setAnnouncedModel(a))

    bridge.emit({
      type: 'runConfigReceived',
      sessionId: 's',
      model: 'some-override',
      effort: '',
      yolo: false,
      used_tokens: 0,
      window_tokens: 0
    })
    expect(selectAnnouncedModel(store.getState())).toBeNull()
  })
})

describe('AnnouncedModelData (container)', () => {
  // Server-render sanity — the ScreenSnapshotData / QueueData idiom. The binding is headless (renders
  // null) and dereferences window.pyry only inside effects, so a server render (effects never run)
  // produces empty markup without a bridge mock. Effect timing (deps/StrictMode) is verified by
  // inspection against the ScreenSnapshotData off-handle-as-cleanup idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(AnnouncedModelData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
