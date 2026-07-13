// The paired server's NON-SECRET identity, held as read-only renderer state for a Settings screen
// (#334) to render WHICH server the user is paired with — including while disconnected. Pure renderer
// state — no IPC, no preload bridge, no transport. The data path (serverInfoLoader.ts) fetches the two
// fields once via `window.pyry.serverInfo()` and writes the mapped result here through the single
// setter; #334 reads it through the selector.
//
// A dedicated store (the sessionIdStore precedent, #259), NOT a runConfigStore facet: this identity is
// orthogonal to the { model, effort, yolo, usedTokens, windowTokens } snapshot and is fetched once on
// demand rather than pushed by the daemon. It mirrors sessionIdStore's DI-factory → singleton → hook →
// selector structure, but holds an object-or-null `{ serverId, relayUrl } | null` instead of a bare
// `string | null`, where `null` is the absence-distinct "no server info yet" state. A single setter
// rather than a reducer: there is exactly one mutation ("record the fetched values"), so a
// discriminated-union action set would be a one-member union — ceremony without benefit. Unidirectional
// is preserved: read-only selector, one write path, and `setServerInfo` is invoked only by the loader
// wiring, never two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The two vetted non-secret fields off the ServerInfo union — never the token or server key, which
 *  are structurally absent from the bridge type (#339). Both are typed strings when present. */
export interface ServerInfoValue {
  serverId: string
  relayUrl: string
}

/** The whole server-info state. `serverInfo: null` is the distinct "no server info yet" state (AC1) —
 *  analogous to sessionIdStore's `sessionId: null` — held until the loader maps a present arm, and
 *  distinguishable from a present `{ serverId, relayUrl }`. */
export interface ServerInfoState {
  serverInfo: ServerInfoValue | null
}

/** Store shape = state + the single mutation entry point. */
export type ServerInfoStore = ServerInfoState & {
  setServerInfo: (info: ServerInfoValue | null) => void
}

export const initialServerInfoState: ServerInfoState = { serverInfo: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setServerInfo` replaces the whole
 * `serverInfo` unconditionally ("record what the loader mapped" — no merge, no coercion): a present
 * pair or the absence-`null`, exactly as setSessionId replaces the whole string. The loader never
 * hands it a partial value (both fields come from the same present arm or neither is written), so there
 * is no half-populated state to guard against.
 */
export function createServerInfoStore(init: ServerInfoState = initialServerInfoState) {
  return createStore<ServerInfoStore>((set) => ({
    ...init,
    setServerInfo: (serverInfo) => set({ serverInfo })
  }))
}

/** App-wide singleton — the one source of truth the loader writes and #334 reads. */
export const serverInfoStore = createServerInfoStore()

/** Narrow-slice React binding for #334. Selecting a single slice avoids cross-facet re-renders. */
export function useServerInfoStore<T>(selector: (s: ServerInfoStore) => T): T {
  return useStore(serverInfoStore, selector)
}

/** The only read surface. There is no exposed setter beyond `setServerInfo`; it is the sole mutation
 *  path and is invoked only by the loader wiring, never two-way-bound from a component. */
export const selectServerInfo = (s: ServerInfoState): ServerInfoValue | null => s.serverInfo
