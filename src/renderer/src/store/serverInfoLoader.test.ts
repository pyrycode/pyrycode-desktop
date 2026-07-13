import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ServerInfo } from '@shared/ipc/serverInfo'
import { mapServerInfo, loadServerInfo, ServerInfoData } from './serverInfoLoader'
import { createServerInfoStore, selectServerInfo } from './serverInfoStore'

// Pure-map tests + injected-fake-bridge tests (the sessionIdBridge.test idiom): no React, no Electron.
// The real store is wired only for the absent → held seam test. Unlike sessionIdBridge this is a
// one-shot invoke, not a subscription, so there is no subscribe/off/last-write-wins block — a single
// invoke maps the ServerInfo union into the { serverId, relayUrl } | null store shape.

const available: ServerInfo = {
  status: 'available',
  serverId: 'srv-1',
  relayUrl: 'wss://relay.example/v1'
}
const unavailable: ServerInfo = { status: 'unavailable' }

describe('mapServerInfo', () => {
  it('maps an available response to the { serverId, relayUrl } pair, dropping status (AC2)', () => {
    const mapped = mapServerInfo(available)
    expect(mapped).toEqual({ serverId: 'srv-1', relayUrl: 'wss://relay.example/v1' })
    // The store must never hold the discriminant — a fresh literal, not a pass-through.
    expect(mapped).not.toHaveProperty('status')
  })

  it('maps an unavailable response to null (AC3)', () => {
    expect(mapServerInfo(unavailable)).toBeNull()
  })
})

describe('loadServerInfo', () => {
  it('writes the mapped pair once on an available response — never partial (AC2/AC5)', async () => {
    const invoke = vi.fn(async () => available)
    const setServerInfo = vi.fn()

    await loadServerInfo(invoke, setServerInfo)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(setServerInfo).toHaveBeenCalledTimes(1)
    expect(setServerInfo).toHaveBeenCalledWith({
      serverId: 'srv-1',
      relayUrl: 'wss://relay.example/v1'
    })
  })

  it('writes null once on an unavailable response (AC3)', async () => {
    const invoke = vi.fn(async () => unavailable)
    const setServerInfo = vi.fn()

    await loadServerInfo(invoke, setServerInfo)

    expect(setServerInfo).toHaveBeenCalledTimes(1)
    expect(setServerInfo).toHaveBeenCalledWith(null)
  })

  it('writes null once on a rejected invoke and never rejects into the caller (AC3)', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('handler absent')
    })
    const setServerInfo = vi.fn()

    // The returned promise resolves — the loader swallows the rejection.
    await expect(loadServerInfo(invoke, setServerInfo)).resolves.toBeUndefined()

    expect(setServerInfo).toHaveBeenCalledTimes(1)
    expect(setServerInfo).toHaveBeenCalledWith(null)
  })

  it('drives a real store from absent (null) to the held pair via the real setter (seam, AC5)', async () => {
    const store = createServerInfoStore()
    const invoke = vi.fn(async () => available)

    expect(selectServerInfo(store.getState())).toBeNull()
    await loadServerInfo(invoke, store.getState().setServerInfo)
    expect(selectServerInfo(store.getState())).toEqual({
      serverId: 'srv-1',
      relayUrl: 'wss://relay.example/v1'
    })
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
