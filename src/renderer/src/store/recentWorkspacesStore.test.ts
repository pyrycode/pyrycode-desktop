import { describe, it, expect } from 'vitest'
import type { RecentWorkspace } from '@shared/wire/types'
import {
  createRecentWorkspacesStore,
  initialRecentWorkspacesState,
  selectRecentWorkspaces
} from './recentWorkspacesStore'

// Plain-function store tests over isolated createRecentWorkspacesStore() instances — the
// conversationListStore.test idiom. No React, no bridge: the store is pure renderer state with a
// single set-on-event mutation. Rows are held verbatim in wire snake_case (no camelCase remap) — the
// whole point is drift-free reuse of RecentWorkspace.

const row = (over: Partial<RecentWorkspace> = {}): RecentWorkspace => ({
  path: '/home/pyry/project',
  last_used_at: '2026-07-10T12:05:00Z',
  ...over
})

describe('recentWorkspacesStore', () => {
  it('starts not-loaded — recentWorkspaces is null (AC2)', () => {
    const store = createRecentWorkspacesStore()
    expect(store.getState().recentWorkspaces).toBeNull()
    expect(selectRecentWorkspaces(store.getState())).toBeNull()
  })

  it('setRecentWorkspaces records the list; selectRecentWorkspaces returns it (AC1)', () => {
    const store = createRecentWorkspacesStore()
    const list = [row({ path: '/a' }), row({ path: '/b' })]
    store.getState().setRecentWorkspaces(list)
    expect(selectRecentWorkspaces(store.getState())).toEqual(list)
  })

  it('a later setRecentWorkspaces replaces the held list — most recent wins, no merge, no dedupe (AC3)', () => {
    const store = createRecentWorkspacesStore()
    store.getState().setRecentWorkspaces([row({ path: '/a' }), row({ path: '/b' }), row({ path: '/c' })])
    store.getState().setRecentWorkspaces([row({ path: '/z' })])
    expect(selectRecentWorkspaces(store.getState())).toEqual([row({ path: '/z' })])
  })

  it('holds an empty list verbatim — [] is loaded-zero, NOT null (AC2)', () => {
    const store = createRecentWorkspacesStore()
    store.getState().setRecentWorkspaces([])
    const held = selectRecentWorkspaces(store.getState())
    expect(held).not.toBeNull()
    expect(held).toEqual([])
  })

  it('holds a row verbatim in snake_case — { path, last_used_at } intact, order preserved (AC1)', () => {
    const store = createRecentWorkspacesStore()
    const rows = [
      { path: '/home/pyry/newest', last_used_at: '2026-07-10T12:05:00Z' },
      { path: '/home/pyry/older', last_used_at: '2026-07-09T08:00:00Z' }
    ]
    store.getState().setRecentWorkspaces(rows)
    expect(selectRecentWorkspaces(store.getState())).toEqual([
      { path: '/home/pyry/newest', last_used_at: '2026-07-10T12:05:00Z' },
      { path: '/home/pyry/older', last_used_at: '2026-07-09T08:00:00Z' }
    ])
  })

  it('keeps two stores independent (DI)', () => {
    const a = createRecentWorkspacesStore()
    const b = createRecentWorkspacesStore()
    a.getState().setRecentWorkspaces([row()])
    expect(selectRecentWorkspaces(a.getState())).not.toBeNull()
    expect(selectRecentWorkspaces(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const list = [row({ path: '/seed' })]
    const store = createRecentWorkspacesStore({ recentWorkspaces: list })
    expect(selectRecentWorkspaces(store.getState())).toEqual(list)
  })

  it('initialRecentWorkspacesState is a null list', () => {
    expect(initialRecentWorkspacesState).toEqual({ recentWorkspaces: null })
  })

  it('keeps the setRecentWorkspaces reference stable across updates', () => {
    const store = createRecentWorkspacesStore()
    const before = store.getState().setRecentWorkspaces
    store.getState().setRecentWorkspaces([row()])
    expect(store.getState().setRecentWorkspaces).toBe(before)
  })
})
