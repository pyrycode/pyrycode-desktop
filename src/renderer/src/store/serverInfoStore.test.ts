import { describe, it, expect } from 'vitest'
import {
  createServerInfoStore,
  initialServerInfoState,
  selectServerInfo
} from './serverInfoStore'

// Plain-function store tests over isolated createServerInfoStore() instances — the sessionIdStore.test
// idiom. No React, no bridge: the store is pure renderer state with a single record-the-fetched-values
// mutation. Unlike sessionIdStore's bare string, the held value is an object-or-null
// { serverId, relayUrl } | null, where null is the absence-distinct "no server info yet" state,
// distinguishable from a present pair, and replaced whole-value by each setServerInfo.

const pair = { serverId: 'srv-1', relayUrl: 'wss://relay.example/v1' }

describe('serverInfoStore', () => {
  it('starts absent — serverInfo is null (AC1)', () => {
    const store = createServerInfoStore()
    expect(store.getState().serverInfo).toBeNull()
    expect(selectServerInfo(store.getState())).toBeNull()
  })

  it('setServerInfo records the pair; selectServerInfo returns it, distinct from null (AC1)', () => {
    const store = createServerInfoStore()
    store.getState().setServerInfo(pair)
    const held = selectServerInfo(store.getState())
    expect(held).not.toBeNull()
    expect(held).toEqual({ serverId: 'srv-1', relayUrl: 'wss://relay.example/v1' })
  })

  it('setServerInfo(null) clears back to null — the map-to-null path (AC3)', () => {
    const store = createServerInfoStore()
    store.getState().setServerInfo(pair)
    store.getState().setServerInfo(null)
    expect(selectServerInfo(store.getState())).toBeNull()
  })

  it('a later setServerInfo replaces the whole value — no merge (AC2)', () => {
    const store = createServerInfoStore()
    store.getState().setServerInfo(pair)
    store.getState().setServerInfo({ serverId: 'srv-2', relayUrl: 'wss://other/v1' })
    expect(selectServerInfo(store.getState())).toEqual({
      serverId: 'srv-2',
      relayUrl: 'wss://other/v1'
    })
  })

  it('holds serverId / relayUrl verbatim, including empty strings, as a present pair distinct from null', () => {
    const store = createServerInfoStore()
    store.getState().setServerInfo({ serverId: '', relayUrl: '' })
    const held = selectServerInfo(store.getState())
    expect(held).not.toBeNull()
    expect(held).toEqual({ serverId: '', relayUrl: '' })
  })

  it('keeps two stores independent (DI)', () => {
    const a = createServerInfoStore()
    const b = createServerInfoStore()
    a.getState().setServerInfo(pair)
    expect(selectServerInfo(a.getState())).toEqual(pair)
    expect(selectServerInfo(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const store = createServerInfoStore({ serverInfo: { serverId: 'seed', relayUrl: 'wss://seed' } })
    expect(selectServerInfo(store.getState())).toEqual({ serverId: 'seed', relayUrl: 'wss://seed' })
  })

  it('initialServerInfoState is a null serverInfo', () => {
    expect(initialServerInfoState).toEqual({ serverInfo: null })
  })

  it('keeps the setServerInfo reference stable across updates', () => {
    const store = createServerInfoStore()
    const before = store.getState().setServerInfo
    store.getState().setServerInfo(pair)
    expect(store.getState().setServerInfo).toBe(before)
  })
})
