// The Run configuration sheet's WRITE machine: the pending-change state the interactive Model /
// Effort / YOLO controls (#257) dispatch onto and read back. Pure renderer state — no IPC, no preload
// bridge, no transport. The data path (runSettingsWriteBridge.ts) mints the correlation id, sends the
// outbound `setSessionSettings` command, and folds the two correlated daemon replies back in.
//
// An ADJACENT dedicated store, NOT a runConfigStore facet — the same two reasons as sessionIdStore
// (#259): (a) its inbound subscription is App-level always-listening (a confirm/reject reply can
// arrive after the sheet closes), whereas runConfigStore's subscriber is sheet-scoped; (b) the write
// state (pending changes + client-confirmed overrides + last error) is orthogonal to the snapshot's
// { model, effort, yolo, usedTokens, windowTokens }. A REDUCER (a sealed event union + one `dispatch`)
// rather than sessionIdStore's named setters, because its three transitions (dispatch / confirm /
// reject) are CORRELATED and each reads prior state — a confirm or reject is a no-op without a matching
// pending record — whereas sessionIdStore's set and clear (#529) are independent whole-value writes
// that read nothing. The contrast is the coupling, not the count.
//
// Why the confirmed value is client-side, not a daemon re-read: the daemon's `set_session_settings`
// reply carries only `session_id` and the change lands on the NEXT session spawn (daemon ADR 031), so
// runConfigStore.snapshot does NOT change on an ack. The store therefore remembers what value each
// pending change requested and commits THAT on the confirm — held as SPARSE per-field overrides
// composed OVER the snapshot base (selectEffectiveSettings), never a duplicated full triple. This is
// what avoids divergence: the snapshot stays the daemon's, the override is the client's, the effective
// display layers them. Unidirectional: read-only selectors, one `dispatch`, never two-way-bound.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { RunConfigSnapshot } from './runConfigStore'

/** The per-field intent the user requests. Discriminated on `field` so `value` is exact per field
 *  (a `string` for model/effort, a `boolean` for yolo) — never a widened `string | boolean`. */
export type SettingsChange =
  | { field: 'model'; value: string }
  | { field: 'effort'; value: string }
  | { field: 'yolo'; value: boolean }

/** The store's sealed event set on `type`: the outgoing user action (`changeDispatched`) plus the two
 *  incoming daemon events, each keyed by the renderer-minted `changeId` correlation key.
 *  `settingsConfirmed` ← `sessionSettingsUpdated` (#261); `settingsRejected` ← `sessionSettingsRejected`
 *  (#269). The confirm carries no value — the store commits the value the pending record remembered. */
export type RunSettingsWriteEvent =
  | { type: 'changeDispatched'; changeId: string; change: SettingsChange }
  | { type: 'settingsConfirmed'; changeId: string }
  | { type: 'settingsRejected'; changeId: string }

/**
 * The write machine's whole state.
 *
 * `pending` is a `Map` (insertion-ordered) keyed by `changeId` so two outstanding changes are told
 * apart (AC4) and rapid same-field changes have a deterministic last-write-wins order. Exposed as
 * `ReadonlyMap` — the reducer replaces it, never mutates in place.
 *
 * `confirmed` holds SPARSE per-field client-confirmed overrides (absent field = no override, fall
 * through to the snapshot base). Empty-string / `yolo:false` are real values held verbatim — never
 * coerced (the runConfigStore posture).
 *
 * `error` carries only the last-rejected FIELD — `sessionSettingsRejected` deliberately strips the
 * daemon message (#269), so the store cannot surface daemon text; #257 renders the copy from the
 * field. `null` when there is no standing rejection.
 */
export interface RunSettingsWriteState {
  pending: ReadonlyMap<string, SettingsChange>
  confirmed: { model?: string; effort?: string; yolo?: boolean }
  error: SettingsChange['field'] | null
}

/** Store shape = state + the single reducer entry point (the sessionStore dispatch idiom). */
export type RunSettingsWriteStore = RunSettingsWriteState & {
  dispatch: (event: RunSettingsWriteEvent) => void
}

export const initialRunSettingsWriteState: RunSettingsWriteState = {
  pending: new Map(),
  confirmed: {},
  error: null
}

/** Compile-time exhaustiveness guard: a new event arm / field without a case is a type error. */
function assertNever(x: never): never {
  throw new Error(`Unhandled run-settings-write case: ${JSON.stringify(x)}`)
}

/** Commit the value the pending change requested into the sparse confirmed overrides. A per-field
 *  switch (not a computed `[change.field]: change.value`) so each arm narrows `value` to the exact
 *  field type — the string/boolean split stays type-safe, and a new field is a compile error. */
function applyConfirmed(
  confirmed: RunSettingsWriteState['confirmed'],
  change: SettingsChange
): RunSettingsWriteState['confirmed'] {
  switch (change.field) {
    case 'model':
      return { ...confirmed, model: change.value }
    case 'effort':
      return { ...confirmed, effort: change.value }
    case 'yolo':
      return { ...confirmed, yolo: change.value }
    default:
      return assertNever(change)
  }
}

/**
 * The pure reducer — three arms, each pinned by a named test:
 *  - `changeDispatched`: record the pending change under its `changeId`; clear `error` (a fresh
 *    attempt supersedes the last rejection). `confirmed` untouched — the optimistic value shows via
 *    the pending overlay in selectEffectiveSettings (AC1).
 *  - `settingsConfirmed`: if no pending change matches the `changeId` → no-op (AC4 fail-closed); else
 *    commit the SENT value into `confirmed` and delete the pending marker (AC2). The event carries no
 *    value — the store commits what the pending record remembered.
 *  - `settingsRejected`: if no match → no-op (AC4 fail-closed); else delete the pending marker (the
 *    view rolls back on its own — the optimistic overlay vanishes, revealing the last confirmed value
 *    or the snapshot base) and set `error` to the rejected field (AC3).
 *
 * There is no explicit "roll back" mutation: clearing the pending marker IS the rollback, because the
 * effective view falls through to the confirmed override or the snapshot base. A no-match returns the
 * SAME state object, so zustand skips the notify (no spurious re-render).
 */
function reduceRunSettingsWrite(
  state: RunSettingsWriteState,
  event: RunSettingsWriteEvent
): RunSettingsWriteState {
  switch (event.type) {
    case 'changeDispatched': {
      const pending = new Map(state.pending)
      pending.set(event.changeId, event.change)
      return { ...state, pending, error: null }
    }
    case 'settingsConfirmed': {
      const change = state.pending.get(event.changeId)
      if (change === undefined) return state
      const pending = new Map(state.pending)
      pending.delete(event.changeId)
      return { ...state, pending, confirmed: applyConfirmed(state.confirmed, change) }
    }
    case 'settingsRejected': {
      const change = state.pending.get(event.changeId)
      if (change === undefined) return state
      const pending = new Map(state.pending)
      pending.delete(event.changeId)
      return { ...state, pending, error: change.field }
    }
    default:
      return assertNever(event)
  }
}

/**
 * DI-friendly, React-free store — one isolated instance per test. All mutation flows through the
 * reducer's sealed event union via `dispatch`; there is no direct setter (AC5). The stored values are
 * never coerced or validated — an empty-string or `yolo:false` override is held as-is.
 */
export function createRunSettingsWriteStore(
  init: RunSettingsWriteState = initialRunSettingsWriteState
) {
  return createStore<RunSettingsWriteStore>((set) => ({
    ...init,
    dispatch: (event) => set((s) => reduceRunSettingsWrite(s, event))
  }))
}

/** App-wide singleton — the one source of truth the data path dispatches onto and #257 reads. */
export const runSettingsWriteStore = createRunSettingsWriteStore()

/** Narrow-slice React binding for #257. Selecting a single slice avoids cross-facet re-renders. */
export function useRunSettingsWriteStore<T>(selector: (s: RunSettingsWriteStore) => T): T {
  return useStore(runSettingsWriteStore, selector)
}

/**
 * The effective displayed settings, composed per field: optimistic pending overlay > client-confirmed
 * override > snapshot base. Pure — #257 reads it and this ticket's tests assert it directly, no render.
 * The single pass over `pending` keeps the LAST matching entry per field, so `Map` insertion order
 * gives last-write-wins for rapid same-field changes. `??` falls through only on `undefined`, so an
 * empty-string / `false` value at any layer is held verbatim (never coerced); a `null` snapshot falls
 * to `'' / '' / false` (the runConfigStore "not loaded" base).
 */
export function selectEffectiveSettings(
  snapshot: RunConfigSnapshot | null,
  s: RunSettingsWriteState
): Pick<RunConfigSnapshot, 'model' | 'effort' | 'yolo'> {
  let model: string | undefined
  let effort: string | undefined
  let yolo: boolean | undefined
  for (const change of s.pending.values()) {
    switch (change.field) {
      case 'model':
        model = change.value
        break
      case 'effort':
        effort = change.value
        break
      case 'yolo':
        yolo = change.value
        break
      default:
        assertNever(change)
    }
  }
  return {
    model: model ?? s.confirmed.model ?? snapshot?.model ?? '',
    effort: effort ?? s.confirmed.effort ?? snapshot?.effort ?? '',
    yolo: yolo ?? s.confirmed.yolo ?? snapshot?.yolo ?? false
  }
}

/** The last-rejected field (for #257's error copy), or `null` when there is no standing rejection. */
export const selectError = (s: RunSettingsWriteState): SettingsChange['field'] | null => s.error

/** Per-field in-flight flags so #257 can show a pending state and disable a field mid-change. */
export function selectPendingFields(s: RunSettingsWriteState): {
  model: boolean
  effort: boolean
  yolo: boolean
} {
  let model = false
  let effort = false
  let yolo = false
  for (const change of s.pending.values()) {
    switch (change.field) {
      case 'model':
        model = true
        break
      case 'effort':
        effort = true
        break
      case 'yolo':
        yolo = true
        break
      default:
        assertNever(change)
    }
  }
  return { model, effort, yolo }
}
