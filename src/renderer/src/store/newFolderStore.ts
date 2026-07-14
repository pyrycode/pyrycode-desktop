// The create-workspace-folder round-trip as one unidirectional source of truth: the status the
// Create-folder dialog (#398) dispatches a request onto and watches resolve to created / rejected.
// Pure renderer state — no IPC, no preload bridge, no transport. The dedicated bridge
// (newFolderBridge.ts) folds the two typed daemon replies in; the dialog reads via the selector.
//
// A dedicated store (the recentWorkspacesStore / modalStore precedent), orthogonal to session /
// timeline / modal / recentWorkspaces — a folder-creation round-trip touches none of them, so a
// transition re-renders only the dialog reading `roundTrip`. A REDUCER (a sealed event union + one
// `dispatch`) rather than a single setter, because there are four real transitions (request / created
// / rejected / reset), two of them gated.
//
// The status is a discriminated union on `status`, NESTED under a store field (not intersected flat).
// The nesting is load-bearing: `created` carries `path` and the other members do not, so a flat
// `State & { dispatch }` under zustand's shallow-merge `set` would leak a stale `path` across a
// `created → idle` reset. Nesting swaps the whole union object wholesale, so no key survives a
// transition — the modalStore / serverInfoStore idiom. `path` is held VERBATIM as opaque display text,
// never coerced and never resolved into a local filesystem operation (it is a remote daemon-side path;
// the inherited warning at events.ts carries forward — #398 renders it as plain text). Unidirectional:
// a read-only selector, one `dispatch`, never two-way-bound.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The round-trip status — a discriminated union on `status` (AC1). `created` carries the daemon's
 *  `path`; every other member is bare (`rejected` carries nothing — workspaceFolderRejected is bare,
 *  #396). Members are swapped wholesale on each transition, so no stale key survives. */
export type NewFolderRoundTrip =
  | { status: 'idle' }
  | { status: 'in-flight' }
  | { status: 'created'; path: string }
  | { status: 'rejected' }

/** The store's sealed event set on `type`: two dialog-driven actions (`createRequested` / `reset`) and
 *  two bridge-driven daemon-reply events (`folderCreated` / `folderRejected`). */
export type NewFolderEvent =
  | { type: 'createRequested' } // dialog: mark a create request outstanding
  | { type: 'folderCreated'; path: string } // bridge: workspaceFolderCreated → capture path
  | { type: 'folderRejected' } // bridge: workspaceFolderRejected → bare
  | { type: 'reset' } // dialog: clear after an outcome or on close (AC4)

/** The whole round-trip state — the union nested under one field (never intersected flat). */
export interface NewFolderState {
  roundTrip: NewFolderRoundTrip
}

/** Store shape = state + the single reducer entry point (the modalStore dispatch idiom). `dispatch` is
 *  the sole write path; the only read surface is `selectNewFolderRoundTrip`. No exposed setter. */
export type NewFolderStore = NewFolderState & {
  dispatch: (event: NewFolderEvent) => void
}

export const initialNewFolderState: NewFolderState = { roundTrip: { status: 'idle' } }

/** Compile-time exhaustiveness guard: a new event arm without a case is a type error. */
function assertNever(x: never): never {
  throw new Error(`Unhandled new-folder case: ${JSON.stringify(x)}`)
}

/**
 * The pure reducer — four arms, two gated:
 *  - `createRequested`: → `in-flight` from ANY status, ungated (dialog-driven; a retry after a
 *    rejection moves rejected → in-flight).
 *  - `folderCreated`: honored ONLY while `in-flight` → `created` capturing `path`; in any other status
 *    the event is ignored (AC3).
 *  - `folderRejected`: honored ONLY while `in-flight` → `rejected`; in any other status ignored (AC3).
 *  - `reset`: → `idle` from ANY status, ungated (dialog-driven, AC4).
 *
 * The in-flight gate (AC3) lives HERE, not in the bridge — the bridge forwards both daemon events
 * unconditionally and the reducer decides whether to honor them. Because workspaceFolderRejected is
 * bare (no correlation key), this gate is the SOLE guard against a stale or unsolicited reply flipping
 * state. A gated (ignored) event returns the SAME `state` object, so zustand's functional `set` sees
 * `Object.is(next, prev)` and skips the notify — no spurious re-render.
 */
export function reduceNewFolder(state: NewFolderState, event: NewFolderEvent): NewFolderState {
  switch (event.type) {
    case 'createRequested':
      return { roundTrip: { status: 'in-flight' } }
    case 'folderCreated':
      if (state.roundTrip.status !== 'in-flight') return state
      return { roundTrip: { status: 'created', path: event.path } }
    case 'folderRejected':
      if (state.roundTrip.status !== 'in-flight') return state
      return { roundTrip: { status: 'rejected' } }
    case 'reset':
      return { roundTrip: { status: 'idle' } }
    default:
      return assertNever(event)
  }
}

/**
 * DI-friendly, React-free store — one isolated instance per test. All mutation flows through the
 * reducer's sealed event union via `dispatch`; there is no direct setter (AC5). The stored `path` is
 * never coerced or validated — it is the daemon's, held as-is.
 */
export function createNewFolderStore(init: NewFolderState = initialNewFolderState) {
  return createStore<NewFolderStore>((set) => ({
    ...init,
    dispatch: (event) => set((s) => reduceNewFolder(s, event))
  }))
}

/** App-wide singleton — the one source of truth the dialog dispatches onto and the bridge folds into. */
export const newFolderStore = createNewFolderStore()

/** Narrow-slice React binding for #398. Selecting a single slice avoids cross-facet re-renders. */
export function useNewFolderStore<T>(selector: (s: NewFolderStore) => T): T {
  return useStore(newFolderStore, selector)
}

/** The sole read surface (AC5). Both write paths are `dispatch` — the dialog's actions and the
 *  bridge's daemon-reply events; there is no two-way binding from a component. */
export const selectNewFolderRoundTrip = (s: NewFolderState): NewFolderRoundTrip => s.roundTrip
