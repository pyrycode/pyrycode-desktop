// The operator-typed HOST LABEL held as read-only renderer state, so a sidebar host row (#834) can name
// the machine the conversations live on instead of showing a generic word — including while
// disconnected, because the label is at-rest state. Pure renderer state — no IPC, no preload bridge, no
// transport. The data path (hostLabelLoader.ts) fetches it once via `window.pyry.hostLabel()` (#824) and
// writes the mapped result here through the single setter; #834 reads it through the selector.
//
// A dedicated store (the serverInfoStore precedent, #340), NOT a serverInfoStore facet: different
// channel, different outcome cardinality, different lifetime — the label is independent of session,
// timeline, run config and paired-server state. It mirrors serverInfoStore's DI-factory → singleton →
// hook → selector structure, but holds a FOUR-arm discriminated union instead of an object-or-null,
// because HostLabelResult keeps never-stored and unreadable apart (ADR 0005) where ServerInfo collapses
// them. A single setter rather than a reducer: there is exactly one mutation ("record what the loader
// mapped"), so a discriminated-union action set would be a one-member union — ceremony without benefit.
// The VALUE is a discriminated union; the MUTATION is not. Unidirectional is preserved: read-only
// selector, one write path, and `setHostLabel` is invoked only by the loader wiring, never two-way-bound
// from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/**
 * The held host-label outcome — HostLabelResult's three arms plus the pre-settle `loading`.
 *
 * Four arms, not three: the bridge union cannot represent "the query has not resolved yet," and that
 * state must be distinct from all three settled ones — reusing `not-stored` would make the row claim
 * absence during the round trip, and reusing `error` would flash a recovery affordance before anything
 * failed. `loading` is the created-in state; the loader leaves it exactly once and nothing returns to it.
 *
 * The three settled arms stay mutually distinct, all the way from `hostLabelStore.load()` main-side:
 *   - `stored`     → a label was read, held VERBATIM. `''` IS a stored label, not absence.
 *   - `not-stored` → never stored. The ONLY absence path — nothing else may land here (ADR 0005).
 *   - `error`      → unreadable: over-length, malformed, a decrypt failure, or a rejected invoke.
 *
 * `label` lives only on `stored`, so the other arms are value-free by construction, exactly as the
 * bridge union is.
 */
export type HostLabelValue =
  | { status: 'loading' }
  | { status: 'stored'; label: string }
  | { status: 'not-stored' }
  | { status: 'error' }

/** The whole host-label state — the union NESTED under one field, never intersected flat. The nesting
 *  is load-bearing: `stored` carries `label` and the other three arms do not, so a flat
 *  `{ status, label?, setHostLabel }` under zustand's shallow-merge `set` would leak a stale `label`
 *  across a `stored → not-stored` transition — an absent label rendering as the previous host's name.
 *  Nesting swaps the whole union object wholesale, so no key survives a transition (the newFolderStore /
 *  serverInfoStore idiom). */
export interface HostLabelState {
  hostLabel: HostLabelValue
}

/** Store shape = state + the single mutation entry point. */
export type HostLabelStore = HostLabelState & {
  setHostLabel: (value: HostLabelValue) => void
}

export const initialHostLabelState: HostLabelState = { hostLabel: { status: 'loading' } }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setHostLabel` replaces the whole
 * `hostLabel` value unconditionally ("record what the loader mapped" — no merge, no coercion, no
 * re-validation of the label). It accepts `loading` as a type because that arm is a member of
 * `HostLabelValue`; nothing writes it — the map never produces it. A narrower setter parameter would
 * need a second type for no gain, and `loading` is not a dangerous value to be able to write.
 */
export function createHostLabelStore(init: HostLabelState = initialHostLabelState) {
  return createStore<HostLabelStore>((set) => ({
    ...init,
    setHostLabel: (hostLabel) => set({ hostLabel })
  }))
}

/** App-wide singleton — the one source of truth the loader writes and #834 reads. */
export const hostLabelStore = createHostLabelStore()

/** Narrow-slice React binding for #834. Selecting a single slice avoids cross-facet re-renders. */
export function useHostLabelStore<T>(selector: (s: HostLabelStore) => T): T {
  return useStore(hostLabelStore, selector)
}

/** The only read surface. There is no exposed setter beyond `setHostLabel`; it is the sole mutation
 *  path and is invoked only by the loader wiring, never two-way-bound from a component. */
export const selectHostLabel = (s: HostLabelState): HostLabelValue => s.hostLabel
