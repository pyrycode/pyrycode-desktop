import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent, RelayLinkStatus, StampedDaemonEvent } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import { translateRelayLink, subscribeRelayLink, RelayLinkData } from './relayLinkBridge'
import {
  createRelayLinkStore,
  selectRelayLinkStatus,
  selectRelayLinkStatusFor,
  type RelayLinkOrigin
} from './relayLinkStore'

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
    // The second argument is the origin (#1134); a bare literal carries no stamp, so it is absent.
    expect(setRelayLinkStatus).toHaveBeenCalledWith('connected', undefined)
  })

  it('writes again on a second relayLinkChanged — last-write-wins (AC5)', () => {
    const bridge = fakeBridge()
    const setRelayLinkStatus = vi.fn()
    subscribeRelayLink(bridge.onDaemonEvent, setRelayLinkStatus)

    bridge.emit({ type: 'relayLinkChanged', status: 'connected' })
    bridge.emit({ type: 'relayLinkChanged', status: 'offline' })
    expect(setRelayLinkStatus).toHaveBeenCalledTimes(2)
    expect(setRelayLinkStatus).toHaveBeenNthCalledWith(2, 'offline', undefined)
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

// ---------------------------------------------------------------------------------------------
// Which server a relay-link status is filed under (#1134) — the stamp, and only the stamp.
// ---------------------------------------------------------------------------------------------

const A = 'srv-a'
const B = 'srv-b'

/**
 * Build the value the preload listener actually hands the bridge: a `StampedDaemonEvent`, which
 * carries #1068's stamp BESIDE the union. Passing one to `subscribeRelayLink`'s bare-union listener
 * is the production shape exactly — a stamped event IS a `DaemonEvent`, so the property arrives
 * structurally while the static type goes silent about it, which is the hole `originOf` reads
 * through. The `daemonEventBridge.test.ts` helper of the same name, for the daemon leg.
 */
function stamped(event: DaemonEvent, serverId: string | null): StampedDaemonEvent {
  return { ...event, serverId }
}

/** Drive one real store from a fake bridge, origin and all — the production wiring's shape. */
function wired(): {
  emit: (e: DaemonEvent) => void
  store: ReturnType<typeof createRelayLinkStore>
  slot: (origin: RelayLinkOrigin) => RelayLinkStatus | undefined
} {
  let listener: ((e: DaemonEvent) => void) | undefined
  const store = createRelayLinkStore()
  subscribeRelayLink(
    (l) => {
      listener = l
      return () => {}
    },
    (status, serverId) => store.getState().setRelayLinkStatus(status, serverId)
  )
  return {
    emit: (e) => listener?.(e),
    store,
    slot: (origin) => selectRelayLinkStatusFor(origin)(store.getState())
  }
}

describe('subscribeRelayLink — which server a status is filed under (#1134)', () => {
  it('files a stamped relayLinkChanged under its stamp', () => {
    const w = wired()
    w.emit(stamped({ type: 'relayLinkChanged', status: 'connected' }, A))

    expect(w.slot(A)).toBe('connected')
    expect(w.slot(B)).toBeUndefined()
  })

  it('separates an unstamped event, a null-stamped one and a string-stamped one', () => {
    const w = wired()
    // Unstamped: no property at all — a producer that never went through a binding, which in
    // production is nothing and in these tests is every bare literal above.
    w.emit({ type: 'relayLinkChanged', status: 'connected' })
    w.emit(stamped({ type: 'relayLinkChanged', status: 'offline' }, null))
    w.emit(stamped({ type: 'relayLinkChanged', status: 'daemon-absent' }, A))

    expect(w.slot(undefined)).toBe('connected')
    expect(w.slot(null)).toBe('offline')
    expect(w.slot(A)).toBe('daemon-absent')
  })

  it('keeps two servers’ relay links independent through the bridge (AC1, AC3)', () => {
    const w = wired()
    w.emit(stamped({ type: 'relayLinkChanged', status: 'connected' }, A))
    w.emit(stamped({ type: 'relayLinkChanged', status: 'offline' }, B))

    expect(w.slot(A)).toBe('connected')
    expect(w.slot(B)).toBe('offline')
    // AC3: the app-wide cell is the most recently written value, exactly as before.
    expect(selectRelayLinkStatus(w.store.getState())).toBe('offline')
  })

  it('reads the origin from the stamp, never from a payload field (AC4)', () => {
    // `relayLinkChanged` carries no id of its own, so this decoy is a field the arm does not have —
    // which is the point: a future edit that reached for a payload id would have to invent one, and
    // this is the assertion that would catch it. The stamp is bound main-side from a record this
    // client holds; a wire-sourced id would let a confused or hostile daemon file its status under
    // another server's slot and make that machine's link read wrong.
    const w = wired()
    const decoy: StampedDaemonEvent = Object.assign(
      stamped({ type: 'relayLinkChanged', status: 'offline' }, A),
      { server_id: B }
    )
    w.emit(decoy)

    expect(w.slot(A)).toBe('offline')
    expect(w.slot(B)).toBeUndefined()
  })

  it('gives a __proto__ stamp its own slot and inherits nothing from Object.prototype', () => {
    const w = wired()
    w.emit(stamped({ type: 'relayLinkChanged', status: 'offline' }, '__proto__'))
    const { statuses } = w.store.getState()

    expect(statuses.get('__proto__')).toBe('offline')
    // A bare-object index would answer `Object.prototype.toString` here — a slot no event opened.
    expect(statuses.get('toString')).toBeUndefined()
    expect(Object.getPrototypeOf(statuses)).toBe(Map.prototype)
  })

  it('does not open a slot for an unrelated event (the filter still holds)', () => {
    const w = wired()
    w.emit(stamped({ type: 'connecting' }, A))

    expect(w.slot(A)).toBeUndefined()
    expect(selectRelayLinkStatus(w.store.getState())).toBeNull()
  })
})
