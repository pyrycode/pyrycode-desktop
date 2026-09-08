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
import { createAnnouncedModelStore, selectAnnouncedModelFor } from './announcedModelStore'

// Framework-free data-path tests with injected spies (the sessionIdBridge
// idiom): no React, no Electron. The real store is wired only for the not-yet-announced → announced
// seam tests.
//
// #1146: the translate carries `conversationId` onward instead of dropping it, so every expectation
// below names the routing key the event arrived with. The store reads go through a selector bound to
// one id, which is what makes "landed under ITS OWN key" assertable at all.

/** Read one conversation's announcement out of a real store instance. */
const announcedFor = (
  store: ReturnType<typeof createAnnouncedModelStore>,
  conversationId: string
): { model: string; truncated: boolean } | null =>
  selectAnnouncedModelFor(conversationId)(store.getState())

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
      truncated: false,
      conversationId: 'conv-1'
    }
    expect(translateModelAnnounced(event)).toEqual({
      model: 'claude-haiku-4-5-20251001',
      truncated: false,
      conversationId: 'conv-1'
    })
  })

  it('carries truncated: true through unchanged (AC2)', () => {
    const event: DaemonEvent = {
      type: 'modelAnnounced',
      model: 'claude-opus-4-5',
      truncated: true,
      conversationId: 'conv-1'
    }
    expect(translateModelAnnounced(event)).toEqual({
      model: 'claude-opus-4-5',
      truncated: true,
      conversationId: 'conv-1'
    })
  })

  it('maps an empty-model modelAnnounced to { model: "", truncated } — not null (AC4)', () => {
    const event: DaemonEvent = {
      type: 'modelAnnounced',
      model: '',
      truncated: false,
      conversationId: 'conv-1'
    }
    expect(translateModelAnnounced(event)).not.toBeNull()
    expect(translateModelAnnounced(event)).toEqual({
      model: '',
      truncated: false,
      conversationId: 'conv-1'
    })
  })

  it('returns a FRESH literal, not the event — `type` never reaches the store', () => {
    const event: DaemonEvent = {
      type: 'modelAnnounced',
      model: 'claude-opus-4-5',
      truncated: false,
      conversationId: 'conv-1'
    }
    const result = translateModelAnnounced(event)
    expect(result).not.toBeNull()
    expect(result === null || 'type' in result).toBe(false)
    expect(result).not.toBe(event)
  })

  it('carries the routing key VERBATIM, whatever the daemon asserted (#1146 AC3)', () => {
    // The id is daemon-asserted and is NOT normalised, allow-listed or checked against the open
    // conversation here — it is carried onward as the map key it will become, and an id matching no
    // conversation a reader can select simply lands under its own key. `__proto__` is an ordinary id to
    // this path, which is the property the store's `ReadonlyMap` keeps true downstream.
    for (const conversationId of ['matches-no-conversation', '__proto__', '']) {
      const event: DaemonEvent = {
        type: 'modelAnnounced',
        model: 'claude-opus-4-5',
        truncated: false,
        conversationId
      }
      expect(translateModelAnnounced(event)).toEqual({
        model: 'claude-opus-4-5',
        truncated: false,
        conversationId
      })
    }
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
        // The conversation the reply describes (#1176); inert on this path, which reads other fields.
        conversationId: 'conv-1',
        sessionId: 's',
        model: 'some-override',
        effort: '',
        yolo: false,
        permissionMode: 'default',
        used_tokens: 0,
        window_tokens: 0
      },
      { type: 'compacting', active: true, conversationId: 'conv-1' },
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

    bridge.emit({
      type: 'modelAnnounced',
      model: 'claude-haiku-4-5',
      truncated: false,
      conversationId: 'conv-1'
    })
    expect(setAnnouncedModel).toHaveBeenCalledTimes(1)
    expect(setAnnouncedModel).toHaveBeenCalledWith({
      model: 'claude-haiku-4-5',
      truncated: false,
      conversationId: 'conv-1'
    })
  })

  it('writes again on a second announcement, with the second value (AC3)', () => {
    const bridge = fakeBridge()
    const setAnnouncedModel = vi.fn()
    subscribeAnnouncedModel(bridge.onDaemonEvent, setAnnouncedModel)

    bridge.emit({
      type: 'modelAnnounced',
      model: 'first-model',
      truncated: false,
      conversationId: 'conv-1'
    })
    bridge.emit({
      type: 'modelAnnounced',
      model: 'second-model',
      truncated: true,
      conversationId: 'conv-1'
    })
    expect(setAnnouncedModel).toHaveBeenCalledTimes(2)
    expect(setAnnouncedModel).toHaveBeenLastCalledWith({
      model: 'second-model',
      truncated: true,
      conversationId: 'conv-1'
    })
  })

  it('writes an empty-model announcement — the !== null guard, not truthiness (AC4)', () => {
    const bridge = fakeBridge()
    const setAnnouncedModel = vi.fn()
    subscribeAnnouncedModel(bridge.onDaemonEvent, setAnnouncedModel)

    bridge.emit({ type: 'modelAnnounced', model: '', truncated: false, conversationId: 'conv-1' })
    expect(setAnnouncedModel).toHaveBeenCalledTimes(1)
    // `truncated` survives too: an `if (announced?.model)` guard would have dropped both fields.
    expect(setAnnouncedModel).toHaveBeenCalledWith({
      model: '',
      truncated: false,
      conversationId: 'conv-1'
    })
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

    expect(announcedFor(store, 'conv-1')).toBeNull()
    bridge.emit({
      type: 'modelAnnounced',
      model: 'claude-haiku-4-5',
      truncated: true,
      conversationId: 'conv-1'
    })
    expect(announcedFor(store, 'conv-1')).toEqual({
      model: 'claude-haiku-4-5',
      truncated: true
    })
  })

  it('a newer announcement replaces the older one through the real store (AC3)', () => {
    const bridge = fakeBridge()
    const store = createAnnouncedModelStore()
    subscribeAnnouncedModel(bridge.onDaemonEvent, (a) => store.getState().setAnnouncedModel(a))

    bridge.emit({
      type: 'modelAnnounced',
      model: 'old-model',
      truncated: true,
      conversationId: 'conv-1'
    })
    bridge.emit({
      type: 'modelAnnounced',
      model: 'new-model',
      truncated: false,
      conversationId: 'conv-1'
    })
    expect(announcedFor(store, 'conv-1')).toEqual({
      model: 'new-model',
      truncated: false
    })
  })

  it('lands two conversations’ announcements under their own keys — neither displaces the other (#1146 AC1, AC2)', () => {
    const bridge = fakeBridge()
    const store = createAnnouncedModelStore()
    subscribeAnnouncedModel(bridge.onDaemonEvent, (a) => store.getState().setAnnouncedModel(a))

    // The reproduction, end to end through the real store: server A's conversation announces, then
    // server B's does. Before #1146 the second write clobbered the first and every reader saw it.
    bridge.emit({
      type: 'modelAnnounced',
      model: 'model-on-A',
      truncated: true,
      conversationId: 'on-server-a'
    })
    expect(announcedFor(store, 'on-server-b')).toBeNull()

    bridge.emit({
      type: 'modelAnnounced',
      model: 'model-on-B',
      truncated: false,
      conversationId: 'on-server-b'
    })

    expect(announcedFor(store, 'on-server-a')).toEqual({ model: 'model-on-A', truncated: true })
    expect(announcedFor(store, 'on-server-b')).toEqual({ model: 'model-on-B', truncated: false })
    // ...and a conversation neither announcement named still reads nothing.
    expect(announcedFor(store, 'never-announced')).toBeNull()
  })

  it('leaves the store untouched on a runConfigReceived carrying an override model', () => {
    const bridge = fakeBridge()
    const store = createAnnouncedModelStore()
    subscribeAnnouncedModel(bridge.onDaemonEvent, (a) => store.getState().setAnnouncedModel(a))

    bridge.emit({
      type: 'runConfigReceived',
      // The conversation the reply describes (#1176); inert on this path, which reads other fields.
      conversationId: 'conv-1',
      sessionId: 's',
      model: 'some-override',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 0,
      window_tokens: 0
    })
    expect(announcedFor(store, 'conv-1')).toBeNull()
  })
})

describe('AnnouncedModelData (container)', () => {
  // Server-render sanity — the QueueData idiom. The binding is headless (renders
  // null) and dereferences window.pyry only inside effects, so a server render (effects never run)
  // produces empty markup without a bridge mock. Effect timing (deps/StrictMode) is verified by
  // inspection against the QueueData off-handle-as-cleanup idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(AnnouncedModelData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
