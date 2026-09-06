import { describe, it, expect } from 'vitest'
import {
  createServerInfoStore,
  initialServerInfoState,
  selectServers,
  type ServerInfoValue
} from './serverInfoStore'

// Plain-function store tests over isolated createServerInfoStore() instances — the sessionIdStore.test
// idiom. No React, no bridge: the store is pure renderer state with a single record-what-the-loader-
// mapped mutation. Since #1148 the held value is a LIST of { serverId, relayUrl } entries, where the
// empty array is the one absent form — there is no null "not yet fetched" state distinct from it,
// because every consumer renders the same placeholder for both.

const alpha: ServerInfoValue = { serverId: 'srv-alpha', relayUrl: 'wss://relay.example/v1' }
const bravo: ServerInfoValue = { serverId: 'srv-bravo', relayUrl: 'wss://second-relay.example/v1' }

describe('serverInfoStore', () => {
  it('starts absent — servers is an empty list, never null (AC3)', () => {
    const store = createServerInfoStore()
    expect(store.getState().servers).toEqual([])
    expect(selectServers(store.getState())).toEqual([])
  })

  it('setServers records every entry, in the order given (AC1)', () => {
    const store = createServerInfoStore()
    store.getState().setServers([alpha, bravo])
    expect(selectServers(store.getState())).toEqual([
      { serverId: 'srv-alpha', relayUrl: 'wss://relay.example/v1' },
      { serverId: 'srv-bravo', relayUrl: 'wss://second-relay.example/v1' }
    ])
  })

  it('holds a one-entry list as a one-entry list', () => {
    const store = createServerInfoStore()
    store.getState().setServers([alpha])
    expect(selectServers(store.getState())).toEqual([alpha])
  })

  it('setServers([]) clears back to absent — the map-to-empty path (AC3)', () => {
    const store = createServerInfoStore()
    store.getState().setServers([alpha, bravo])
    store.getState().setServers([])
    expect(selectServers(store.getState())).toEqual([])
  })

  it('a later setServers replaces the whole list — no merge, no append (AC1)', () => {
    const store = createServerInfoStore()
    store.getState().setServers([alpha, bravo])
    store.getState().setServers([bravo])
    expect(selectServers(store.getState())).toEqual([bravo])
  })

  it('holds serverId / relayUrl verbatim, including empty strings, as a present entry', () => {
    const store = createServerInfoStore()
    store.getState().setServers([{ serverId: '', relayUrl: '' }])
    expect(selectServers(store.getState())).toEqual([{ serverId: '', relayUrl: '' }])
  })

  it('keeps two stores independent (DI)', () => {
    const a = createServerInfoStore()
    const b = createServerInfoStore()
    a.getState().setServers([alpha])
    expect(selectServers(a.getState())).toEqual([alpha])
    expect(selectServers(b.getState())).toEqual([])
  })

  it('starts from an injected initial state (DI)', () => {
    const store = createServerInfoStore({ servers: [bravo] })
    expect(selectServers(store.getState())).toEqual([bravo])
  })

  it('initialServerInfoState is an empty servers list', () => {
    expect(initialServerInfoState).toEqual({ servers: [] })
  })

  it('keeps the setServers reference stable across updates', () => {
    const store = createServerInfoStore()
    const before = store.getState().setServers
    store.getState().setServers([alpha])
    expect(store.getState().setServers).toBe(before)
  })
})
