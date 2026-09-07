import { describe, it, expect, vi } from 'vitest'
import {
  createLastEffortStore,
  localStorageLastEffortPref,
  LAST_EFFORT_KEY,
  selectLastEffort,
  type LastEffortStorage
} from './lastEffortStore'

// #1169 — the remembered effort level, the app's third renderer preference. The port is the DI seam
// (the defaultWorkspaceStore / pushNotificationPrefStore precedent), so the persist-then-restore round
// trip is exercised with an in-memory fake under the repo's `node` vitest environment, where there is no
// window and no localStorage.

/** An in-memory port over one cell — the persistence backend a test can inspect. */
function fakeStorage(initial: string | null = null): LastEffortStorage & { cell: string | null } {
  return {
    cell: initial,
    read(): string | null {
      return this.cell === '' ? null : this.cell
    },
    write(value: string): void {
      this.cell = value
    }
  }
}

describe('lastEffortStore', () => {
  it('hydrates from the persisted level', () => {
    const store = createLastEffortStore(fakeStorage('steady'))

    expect(selectLastEffort(store.getState())).toBe('steady')
  })

  it('hydrates to null when nothing is persisted', () => {
    const store = createLastEffortStore(fakeStorage(null))

    expect(selectLastEffort(store.getState())).toBeNull()
  })

  it('reads a persisted empty string as nothing remembered', () => {
    // `''` is the wire's ABSENCE of a level, never a level, so it is not a value this store may hand
    // out — an inherited-default chat would otherwise be "remembered" as having no level.
    const store = createLastEffortStore(fakeStorage(''))

    expect(selectLastEffort(store.getState())).toBeNull()
  })

  it('persists through the port and then records the value', () => {
    const storage = fakeStorage(null)
    const store = createLastEffortStore(storage)

    store.getState().setLastEffort('deep')

    expect(storage.cell).toBe('deep')
    expect(selectLastEffort(store.getState())).toBe('deep')
  })

  it('replaces the remembered level wholesale on each write', () => {
    const storage = fakeStorage('brisk')
    const store = createLastEffortStore(storage)

    store.getState().setLastEffort('steady')
    store.getState().setLastEffort('deep')

    expect(storage.cell).toBe('deep')
    expect(selectLastEffort(store.getState())).toBe('deep')
  })

  // AC3, asserted literally: "a store built fresh from that same storage reports it". A store that
  // recorded the value in memory but never reached the port would pass every assertion above and fail
  // this one, which is the whole persistence half of the criterion.
  it('a store built fresh from the same storage reports a level written by an earlier store', () => {
    const storage = fakeStorage(null)

    createLastEffortStore(storage).getState().setLastEffort('deep')
    const rebuilt = createLastEffortStore(storage)

    expect(selectLastEffort(rebuilt.getState())).toBe('deep')
  })
})

describe('localStorageLastEffortPref', () => {
  it('reads null and swallows the write with no window', () => {
    // The import-safety guard: the singleton is constructed at module load, and every renderer spec in
    // this repo runs under `node` with no window at all. Without the guard this throws on import.
    expect(typeof globalThis.window).toBe('undefined')
    const port = localStorageLastEffortPref()

    expect(port.read()).toBeNull()
    expect(() => port.write('deep')).not.toThrow()
  })

  it('round-trips through a stand-in localStorage under the app key', () => {
    const getItem = vi.fn().mockReturnValue('steady')
    const setItem = vi.fn()
    vi.stubGlobal('window', { localStorage: { getItem, setItem } })

    try {
      const port = localStorageLastEffortPref()

      expect(port.read()).toBe('steady')
      expect(getItem).toHaveBeenCalledWith(LAST_EFFORT_KEY)

      port.write('deep')
      expect(setItem).toHaveBeenCalledWith(LAST_EFFORT_KEY, 'deep')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads a stored empty string as nothing remembered', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '', setItem: vi.fn() } })

    try {
      expect(localStorageLastEffortPref().read()).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // The const NAME is a preference; the STRING is the contract, and a rename would silently strand every
  // already-persisted choice. The sibling keys' convention.
  it('pins the renderer-preference key', () => {
    expect(LAST_EFFORT_KEY).toBe('pyry.lastEffort')
  })
})
