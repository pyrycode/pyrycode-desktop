// The paired server's NON-SECRET identity, held as read-only renderer state for a Settings screen
// (#334) to render WHICH server the user is paired with — including while disconnected. Pure renderer
// state — no IPC, no preload bridge, no transport. The data path (serverInfoLoader.ts) fetches the two
// fields once via `window.pyry.serverInfo()` and writes the mapped result here through the single
// setter; #334 reads it through the selector.
//
// A dedicated store (the sessionIdStore precedent, #259), NOT a runConfigStore facet: this identity is
// orthogonal to the { model, effort, yolo, usedTokens, windowTokens } snapshot and is fetched once on
// demand rather than pushed by the daemon. It mirrors sessionIdStore's DI-factory → singleton → hook →
// selector structure, but holds a LIST of `{ serverId, relayUrl }` entries instead of a bare
// `string | null` — one per paired server since #1148, in the store's own order (oldest-paired first).
// A single setter rather than a reducer: there is exactly one mutation ("record the fetched values"),
// so a discriminated-union action set would be a one-member union — ceremony without benefit.
// Unidirectional is preserved: read-only selector, one write path, and `setServers` is invoked only by
// the loader wiring, never two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** ONE paired server's two vetted non-secret fields off the ServerInfo union — never the token or
 *  server key, which are structurally absent from the bridge type (#339). Both are typed strings when
 *  present. Still singular after #1148: it is the value of one row, which is what ServerRow's prop
 *  means; the store holds a list of these. */
export interface ServerInfoValue {
  serverId: string
  relayUrl: string
}

/** The whole server-info state: one entry per paired server, in the order the bridge reported them
 *  (oldest-paired first). The EMPTY list is the one absent form (AC3) — nothing paired, nothing
 *  fetched yet, and an unreadable collection all land here, and every consumer renders the same
 *  placeholder for them. A `ServerInfoValue[] | null` would add a not-yet-fetched vs fetched-and-empty
 *  distinction that no consumer reads: an unobservable impossible-state pair, which is the same
 *  "ceremony without benefit" test that kept this store's mutation a setter rather than a reducer. */
export interface ServerInfoState {
  servers: ServerInfoValue[]
}

/** Store shape = state + the single mutation entry point. */
export type ServerInfoStore = ServerInfoState & {
  setServers: (servers: ServerInfoValue[]) => void
}

export const initialServerInfoState: ServerInfoState = { servers: [] }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setServers` replaces the whole list
 * unconditionally ("record what the loader mapped" — no merge, no append, no coercion), exactly as
 * setSessionId replaces the whole string. That whole-value overwrite is also why this store stays out
 * of clearPairingScopedState: it self-heals on the next Settings mount, so a clear would be dead code
 * (see that module's own note). The loader never hands it a partial value — every entry comes from the
 * same present arm or none is written — so there is no half-populated state to guard against.
 */
export function createServerInfoStore(init: ServerInfoState = initialServerInfoState) {
  return createStore<ServerInfoStore>((set) => ({
    ...init,
    setServers: (servers) => set({ servers })
  }))
}

/** App-wide singleton — the one source of truth the loader writes and #334 reads. */
export const serverInfoStore = createServerInfoStore()

/** Narrow-slice React binding for #334. Selecting a single slice avoids cross-facet re-renders. */
export function useServerInfoStore<T>(selector: (s: ServerInfoStore) => T): T {
  return useStore(serverInfoStore, selector)
}

/** The only read surface. There is no exposed setter beyond `setServers`; it is the sole mutation
 *  path and is invoked only by the loader wiring, never two-way-bound from a component. Returns the
 *  held array by reference, so the narrow slice re-renders its reader once per loader write. */
export const selectServers = (s: ServerInfoState): ServerInfoValue[] => s.servers
