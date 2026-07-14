// The client-owned "default workspace" preference (#403), persisted locally so a new discussion opens in
// the user's saved folder instead of the daemon's scratch default. Pure renderer state — no IPC, no
// preload bridge, no transport: a workspace path is not a secret, so it need not sit behind the transport
// boundary. `cwd` is renderer-supplied text the daemon resolves server-side; the desktop never
// filesystem-resolves it. The ChannelList FAB reads this slice and passes the value into
// requestNewConversation; the (separate) Settings row (#404) reads it to render "scratch"/the path and
// writes it through the single setter.
//
// A dedicated store (the serverInfoStore precedent), NOT a facet of an existing store: this preference is
// orthogonal to connection/messages/conversation-list state, so it stays its own slice and only
// components selecting it re-render. It mirrors serverInfoStore's DI-factory → singleton → hook →
// selector structure, holding a bare `string | null` (`null` = the absence-distinct "no default set"
// state, i.e. fresh install / never chosen). A single setter rather than a reducer: there is exactly one
// mutation ("record the chosen default"), so a discriminated-union action set would be a one-member union
// — ceremony without benefit. Unidirectional is preserved: read-only selector, one write path, never
// two-way-bound from a component — #404 dispatches into the setter, it does not bind a field to it.
//
// The DI seam is the `storage` PORT (not a static seed like the other stores) because the dependency that
// varies between prod and test is the persistence backend, not an initial value. The vitest runtime is
// `node` (no jsdom, no localStorage, no window), so a store reaching for window.localStorage directly
// could not be unit-tested and would throw on import; the injected port makes the persist-then-restore
// round-trip testable with an in-memory fake.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The persistence backend the store depends on — the injected DI seam. `read` returns the persisted
 *  default (or null if never set); `write` persists a value, with `null` meaning "clear the stored
 *  default". Synchronous: both back onto localStorage, whose access is synchronous. */
export interface WorkspacePrefStorage {
  read(): string | null
  write(value: string | null): void
}

/** The one renderer-pref key. The first localStorage key in the app; if a second is ever added, a small
 *  key-namespacing convention may be worth extracting — deferred until then (no premature abstraction). */
export const DEFAULT_WORKSPACE_KEY = 'pyry.defaultWorkspace' as const

/**
 * The real `localStorage`-backed port, wired at the singleton composition root. The `typeof window`
 * guard is the import-safety guard (the ChannelList "dereference window only inside callbacks"
 * discipline): it makes constructing the singleton safe under `node`/`renderToStaticMarkup`, where
 * `read()` yields `null` and the store starts empty. It is deliberately NOT a defensive try/catch — a
 * localStorage quota/disabled failure is not an observed failure mode in the Electron renderer (a single
 * short path, always-present storage), and shipping a defense for an unobserved failure is Evidence-Based
 * Fix Selection's anti-pattern; if it ever surfaces, the fix is localized here.
 */
export function localStorageWorkspacePref(): WorkspacePrefStorage {
  return {
    read: () =>
      typeof window === 'undefined' ? null : window.localStorage.getItem(DEFAULT_WORKSPACE_KEY),
    write: (value) => {
      if (typeof window === 'undefined') return
      if (value === null) window.localStorage.removeItem(DEFAULT_WORKSPACE_KEY)
      else window.localStorage.setItem(DEFAULT_WORKSPACE_KEY, value)
    }
  }
}

/** The whole default-workspace state. `defaultWorkspace: null` is the distinct "no default set" state
 *  (fresh install / never chosen), distinguishable from a present path. */
export interface DefaultWorkspaceState {
  defaultWorkspace: string | null
}

/** Store shape = state + the single mutation entry point. */
export type DefaultWorkspaceStore = DefaultWorkspaceState & {
  setDefaultWorkspace: (value: string | null) => void
}

/**
 * DI-friendly, React-free store — one isolated instance per test, wired to the injected port.
 * Hydration: initial state reads the persisted value once at construction (the "restore" half).
 * Set-through: `setDefaultWorkspace` persists via the port THEN records the value in state (the "persist"
 * half), replacing the whole value unconditionally — no merge, no coercion — exactly as setServerInfo
 * does. A `null` clears the stored default back to the daemon default.
 */
export function createDefaultWorkspaceStore(storage: WorkspacePrefStorage) {
  return createStore<DefaultWorkspaceStore>((set) => ({
    defaultWorkspace: storage.read(),
    setDefaultWorkspace: (defaultWorkspace) => {
      storage.write(defaultWorkspace)
      set({ defaultWorkspace })
    }
  }))
}

/** App-wide singleton — the one source of truth the FAB reads and #404 reads/writes, backed by the real
 *  localStorage port. */
export const defaultWorkspaceStore = createDefaultWorkspaceStore(localStorageWorkspacePref())

/** Narrow-slice React binding. Selecting a single slice avoids cross-facet re-renders. */
export function useDefaultWorkspaceStore<T>(selector: (s: DefaultWorkspaceStore) => T): T {
  return useStore(defaultWorkspaceStore, selector)
}

/** The read surface, shared by the FAB container and #404. There is no exposed setter beyond
 *  `setDefaultWorkspace`; it is the sole mutation path, never two-way-bound from a component. */
export const selectDefaultWorkspace = (s: DefaultWorkspaceState): string | null => s.defaultWorkspace
