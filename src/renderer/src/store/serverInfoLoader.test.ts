import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ServerInfo } from '@shared/ipc/serverInfo'
import { mapServerInfo, loadServerInfo, ServerInfoData } from './serverInfoLoader'
import { createServerInfoStore, selectServers } from './serverInfoStore'

// Pure-map tests + injected-fake-bridge tests (the sessionIdBridge.test idiom): no React, no Electron.
// The real store is wired only for the absent → held seam test. This is a one-shot invoke, not a
// subscription, so there is no subscribe/off/last-write-wins block — a single invoke maps the
// ServerInfo union into the { serverId, relayUrl }[] store shape.

// Held separately from the response so the rebuild test can compare entry identities.
const bridgeEntries = [
  { serverId: 'srv-alpha', relayUrl: 'wss://relay.example/v1' },
  { serverId: 'srv-bravo', relayUrl: 'wss://second-relay.example/v1' }
]
const twoServers: ServerInfo = { status: 'available', servers: bridgeEntries }
const unavailable: ServerInfo = { status: 'unavailable' }

describe('mapServerInfo', () => {
  it('maps an available response to every entry, in order, dropping status (AC1)', () => {
    expect(mapServerInfo(twoServers)).toEqual([
      { serverId: 'srv-alpha', relayUrl: 'wss://relay.example/v1' },
      { serverId: 'srv-bravo', relayUrl: 'wss://second-relay.example/v1' }
    ])
  })

  it('rebuilds each entry rather than passing the bridge objects through (AC4)', () => {
    // The renderer-side half of the handler's field-by-field defence: a structured-clone'd IPC object
    // can carry own properties the type does not declare, so nothing that crossed the bridge is
    // retained by reference. Fresh literals, and exactly the two vetted keys on each.
    const mapped = mapServerInfo(twoServers)
    mapped.forEach((entry, index) => {
      expect(entry).not.toBe(bridgeEntries[index])
      expect(Object.keys(entry).sort()).toEqual(['relayUrl', 'serverId'])
    })
  })

  it('maps an unavailable response to an empty list (AC3)', () => {
    expect(mapServerInfo(unavailable)).toEqual([])
  })

  it('maps an available response with an empty list to the same empty list (AC3)', () => {
    // The handler never builds this arm, but the renderer treats it identically to unavailable, so the
    // non-empty invariant is documented rather than depended upon.
    expect(mapServerInfo({ status: 'available', servers: [] })).toEqual([])
  })
})

describe('loadServerInfo', () => {
  it('writes the mapped list once on an available response — never partial (AC1)', async () => {
    const invoke = vi.fn(async () => twoServers)
    const setServers = vi.fn()

    const written = await loadServerInfo(invoke, setServers)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(setServers).toHaveBeenCalledTimes(1)
    expect(setServers).toHaveBeenCalledWith([
      { serverId: 'srv-alpha', relayUrl: 'wss://relay.example/v1' },
      { serverId: 'srv-bravo', relayUrl: 'wss://second-relay.example/v1' }
    ])
    // #1162: the loader RESOLVES TO the list it just wrote, so a caller that needs to act on the
    // fresh count — the per-server unpair's "do any records remain?" — reads the same value the rows
    // render, rather than re-invoking or reaching back into the store.
    expect(written).toEqual([
      { serverId: 'srv-alpha', relayUrl: 'wss://relay.example/v1' },
      { serverId: 'srv-bravo', relayUrl: 'wss://second-relay.example/v1' }
    ])
  })

  it('writes an empty list once on an unavailable response (AC3)', async () => {
    const invoke = vi.fn(async () => unavailable)
    const setServers = vi.fn()

    const written = await loadServerInfo(invoke, setServers)

    expect(setServers).toHaveBeenCalledTimes(1)
    expect(setServers).toHaveBeenCalledWith([])
    expect(written).toEqual([])
  })

  it('writes an empty list once on a rejected invoke and never rejects into the caller (AC5)', async () => {
    const invoke = vi.fn(async (): Promise<ServerInfo> => {
      throw new Error('handler absent')
    })
    const setServers = vi.fn()

    // The returned promise resolves — the loader swallows the rejection — and #1162 makes it resolve
    // to the same empty list it wrote, so the swallow stays observable to a caller that reads the
    // value rather than silently indistinguishable from an unavailable response.
    await expect(loadServerInfo(invoke, setServers)).resolves.toEqual([])

    expect(setServers).toHaveBeenCalledTimes(1)
    expect(setServers).toHaveBeenCalledWith([])
  })

  it('drives a real store from absent to both held entries via the real setter (seam, AC1)', async () => {
    const store = createServerInfoStore()
    const invoke = vi.fn(async () => twoServers)

    expect(selectServers(store.getState())).toEqual([])
    await loadServerInfo(invoke, store.getState().setServers)
    expect(selectServers(store.getState())).toEqual([
      { serverId: 'srv-alpha', relayUrl: 'wss://relay.example/v1' },
      { serverId: 'srv-bravo', relayUrl: 'wss://second-relay.example/v1' }
    ])
  })
})

describe('ServerInfoData (container)', () => {
  // Server-render sanity — the SessionIdData.test idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock. Effect timing (active flag / one-applied-write under StrictMode
  // / one-shot invoke) is verified by inspection against the App.tsx pairingStatus idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(ServerInfoData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
