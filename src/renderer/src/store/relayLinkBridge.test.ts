import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent, RelayLinkStatus } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import { translateRelayLink, subscribeRelayLink, RelayLinkData } from './relayLinkBridge'
import { createRelayLinkStore, selectRelayLinkStatus } from './relayLinkStore'

// Framework-free data-path tests with injected spies (the sessionIdBridge idiom): no React, no
// Electron. The real store is wired only for the not-connected → held seam test. This holder is
// reactive-only — no request half — so there is no requestX describe block.

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

const CATEGORIES: RelayLinkStatus[] = ['connected', 'offline', 'daemon-absent']

describe('translateRelayLink', () => {
  it('maps a relayLinkChanged to its status (one case per category)', () => {
    for (const status of CATEGORIES) {
      const event: DaemonEvent = { type: 'relayLinkChanged', status }
      expect(translateRelayLink(event)).toBe(status)
    }
  })

  it('returns null for a sample of unrelated daemon events (the filter, AC3)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      {
        type: 'snapshotReceived',
        model: '',
        effort: '',
        yolo: false,
        used_tokens: 0,
        window_tokens: 0
      },
      { type: 'conversationsReceived', conversations: [] }
    ]
    for (const event of others) expect(translateRelayLink(event)).toBeNull()
  })
})

describe('subscribeRelayLink', () => {
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
    subscribeRelayLink(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes status on a relayLinkChanged event', () => {
    const bridge = fakeBridge()
    const setRelayLinkStatus = vi.fn()
    subscribeRelayLink(bridge.onDaemonEvent, setRelayLinkStatus)

    bridge.emit({ type: 'relayLinkChanged', status: 'connected' })
    expect(setRelayLinkStatus).toHaveBeenCalledTimes(1)
    expect(setRelayLinkStatus).toHaveBeenCalledWith('connected')
  })

  it('writes again on a second relayLinkChanged — last-write-wins (AC5)', () => {
    const bridge = fakeBridge()
    const setRelayLinkStatus = vi.fn()
    subscribeRelayLink(bridge.onDaemonEvent, setRelayLinkStatus)

    bridge.emit({ type: 'relayLinkChanged', status: 'connected' })
    bridge.emit({ type: 'relayLinkChanged', status: 'offline' })
    expect(setRelayLinkStatus).toHaveBeenCalledTimes(2)
    expect(setRelayLinkStatus).toHaveBeenNthCalledWith(2, 'offline')
  })

  it('does not call setRelayLinkStatus for an unrelated event (AC3)', () => {
    const bridge = fakeBridge()
    const setRelayLinkStatus = vi.fn()
    subscribeRelayLink(bridge.onDaemonEvent, setRelayLinkStatus)

    bridge.emit({ type: 'connecting' })
    expect(setRelayLinkStatus).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeRelayLink(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives the store from not-connected (null) through each category (seam, AC1→AC5)', () => {
    const bridge = fakeBridge()
    const store = createRelayLinkStore()
    subscribeRelayLink(bridge.onDaemonEvent, (status) =>
      store.getState().setRelayLinkStatus(status)
    )

    expect(selectRelayLinkStatus(store.getState())).toBeNull()
    for (const status of CATEGORIES) {
      bridge.emit({ type: 'relayLinkChanged', status })
      expect(selectRelayLinkStatus(store.getState())).toBe(status)
    }
  })
})

describe('RelayLinkData (container)', () => {
  // Server-render sanity — the SessionIdData.test idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock. Effect timing (deps/StrictMode) is verified by inspection
  // against the SessionIdData subscribe-effect idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(RelayLinkData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
