import { describe, it, expect, vi } from 'vitest'
import {
  createDefaultWorkspaceStore,
  localStorageWorkspacePref,
  selectDefaultWorkspace,
  DEFAULT_WORKSPACE_KEY,
  type WorkspacePrefStorage
} from './defaultWorkspaceStore'

// Plain-function store tests over isolated createDefaultWorkspaceStore() instances — the
// recentWorkspacesStore.test idiom. No React, no DOM: the store is pure renderer state with a single
// set-through mutation. The persistence backend is an injected WorkspacePrefStorage port, so the
// persist-then-restore round-trip is testable under the `node` runtime with no localStorage/window.

// A closure over a mutable `string | null`, exposing read/write — the in-memory fake port. `read`/`write`
// are vi spies so the "persist" half is observable; `write` also mutates the backing value so a second
// store constructed over the SAME fake hydrates what the first wrote (the simulated restart).
function fakeStorage(seed: string | null = null): WorkspacePrefStorage {
  let value = seed
  return {
    read: vi.fn((): string | null => value),
    write: vi.fn((next: string | null): void => {
      value = next
    })
  }
}

describe('defaultWorkspaceStore', () => {
  it('starts with no default — fresh install reads null (AC1)', () => {
    const store = createDefaultWorkspaceStore(fakeStorage())
    expect(store.getState().defaultWorkspace).toBeNull()
    expect(selectDefaultWorkspace(store.getState())).toBeNull()
  })

  it('hydrates the persisted value once at construction — the restore half (AC1/AC5)', () => {
    const storage = fakeStorage('/home/pyry/project')
    const store = createDefaultWorkspaceStore(storage)
    expect(selectDefaultWorkspace(store.getState())).toBe('/home/pyry/project')
    expect(storage.read).toHaveBeenCalledTimes(1)
  })

  it('setDefaultWorkspace records the value; the selector returns it', () => {
    const store = createDefaultWorkspaceStore(fakeStorage())
    store.getState().setDefaultWorkspace('/x')
    expect(selectDefaultWorkspace(store.getState())).toBe('/x')
  })

  it('setDefaultWorkspace persists through the port — the persist half (AC1/AC5)', () => {
    const storage = fakeStorage()
    const store = createDefaultWorkspaceStore(storage)
    store.getState().setDefaultWorkspace('/x')
    expect(storage.write).toHaveBeenCalledWith('/x')
  })

  it('setDefaultWorkspace(null) records null and clears through the port', () => {
    const storage = fakeStorage('/seed')
    const store = createDefaultWorkspaceStore(storage)
    store.getState().setDefaultWorkspace(null)
    expect(selectDefaultWorkspace(store.getState())).toBeNull()
    expect(storage.write).toHaveBeenCalledWith(null)
  })

  it('survives a simulated restart — a new store over the same port hydrates the last write (AC5)', () => {
    const storage = fakeStorage()
    const a = createDefaultWorkspaceStore(storage)
    a.getState().setDefaultWorkspace('/home/pyry/project')
    // Fresh store over the SAME backend = a restart: it reads back what `a` persisted.
    const b = createDefaultWorkspaceStore(storage)
    expect(selectDefaultWorkspace(b.getState())).toBe('/home/pyry/project')
  })

  it('keeps two stores over independent ports isolated (DI)', () => {
    const a = createDefaultWorkspaceStore(fakeStorage())
    const b = createDefaultWorkspaceStore(fakeStorage())
    a.getState().setDefaultWorkspace('/x')
    expect(selectDefaultWorkspace(a.getState())).toBe('/x')
    expect(selectDefaultWorkspace(b.getState())).toBeNull()
  })

  it('keeps the setDefaultWorkspace reference stable across updates', () => {
    const store = createDefaultWorkspaceStore(fakeStorage())
    const before = store.getState().setDefaultWorkspace
    store.getState().setDefaultWorkspace('/x')
    expect(store.getState().setDefaultWorkspace).toBe(before)
  })
})

describe('localStorageWorkspacePref', () => {
  it('uses the namespaced storage key', () => {
    expect(DEFAULT_WORKSPACE_KEY).toBe('pyry.defaultWorkspace')
  })

  // Under the `node` test runtime there is no `window`; the import-safety guard makes read() return null
  // and write() a no-op, so constructing the singleton over the real backend is safe (no ReferenceError).
  it('is a safe no-op when window is absent (import-safety guard)', () => {
    const pref = localStorageWorkspacePref()
    expect(pref.read()).toBeNull()
    expect(() => pref.write('/x')).not.toThrow()
  })
})
