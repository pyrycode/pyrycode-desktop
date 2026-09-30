// The Run configuration sheet's WRITE machine: the pending-change state the interactive Model /
// Effort / YOLO controls (#257) dispatch onto and read back. Pure renderer state — no IPC, no preload
// bridge, no transport. The data path (runSettingsWriteBridge.ts) mints the correlation id, sends the
// outbound `setSessionSettings` command, folds the two correlated daemon replies back in, and clears
// the pending markers a reconnect stranded (#539).
//
// An ADJACENT dedicated store, NOT a runConfigStore facet — the same two reasons as sessionIdStore
// (#259): (a) its inbound subscription is App-level always-listening (a confirm/reject reply can
// arrive after the sheet closes), whereas runConfigStore's subscriber is sheet-scoped; (b) the write
// state (pending changes + client-confirmed overrides + last error) is orthogonal to the snapshot's
// { model, effort, yolo, usedTokens, windowTokens }. A REDUCER (a sealed event union + one `dispatch`)
// rather than sessionIdStore's named setters, because every one of its five transitions reads prior
// state: three are CORRELATED (dispatch / confirm / reject — a confirm or reject is a no-op without a
// matching pending record) and the other two (`reconnected`, #539, and `conversationSwitched`, #1167)
// are uncorrelated but still prior-state reading, since each clears only when something is held.
// sessionIdStore's set and clear (#529) — and runConfigStore's, since #1167 — are independent
// whole-value writes that read nothing. The contrast is the coupling, not the count.
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
 *  (a `string` for model/effort/permissionMode, a `boolean` for yolo) — never a widened
 *  `string | boolean`.
 *
 *  `permissionMode` (#1021) is spelled camelCase here and snake_case `permission_mode` on the wire, the
 *  same seam every sibling crosses; the one translation lives in `buildSettingsPayload`. It is a plain
 *  `string` with NO union and NO allowlist — the #1020 read half's posture, kept deliberately: the
 *  daemon's `validPermissionMode` is the authority, it refuses `bypassPermissions` on this field (that
 *  escalation keeps one spelling, `yolo: true`), and nothing on this path maps between the two. */
export type SettingsChange =
  | { field: 'model'; value: string; source?: 'recall' }
  | { field: 'effort'; value: string }
  | { field: 'yolo'; value: boolean }
  | { field: 'permissionMode'; value: string }

/** The store's sealed event set on `type`. Three are change-scoped and keyed by the renderer-minted
 *  `changeId` correlation key: the outgoing user action (`changeDispatched`) plus the two incoming
 *  daemon replies — `settingsConfirmed` ← `sessionSettingsUpdated` (#261), `settingsRejected` ←
 *  `sessionSettingsRejected` (#269). The confirm carries no value — the store commits the value the
 *  pending record remembered. `reconnected` (#539) is the one CONNECTION-LIFECYCLE arm: bridge-produced
 *  from the `connected` wire edge, carrying no daemon content and no `changeId` — it is correlated to
 *  nothing precisely because its job is to abandon every correlation.
 *
 *  `conversationSwitched` (#1167) is the one CONVERSATION-LIFETIME arm, dispatched by
 *  `activateConversation` and `exitActiveConversation` rather than by any bridge — no wire edge
 *  produces it. It carries nothing, because which chat is open is not a fact this store holds; the
 *  helpers own that decision and this store only obeys it. */
export type RunSettingsWriteEvent =
  | { type: 'changeDispatched'; changeId: string; change: SettingsChange }
  | { type: 'settingsConfirmed'; changeId: string }
  | { type: 'settingsRejected'; changeId: string }
  | { type: 'reconnected' }
  | { type: 'conversationSwitched' }

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
  confirmed: { model?: string; effort?: string; yolo?: boolean; permissionMode?: string }
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
 *  field type — the string/boolean split stays type-safe, and a new field is a compile error. The
 *  literal-key form is also what keeps a computed write off this object entirely, so no key here is ever
 *  taken from a string that came in over the wire. */
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
    case 'permissionMode':
      return { ...confirmed, permissionMode: change.value }
    default:
      return assertNever(change)
  }
}

/** Does anything stand in the sparse confirmed overrides? Key presence, not value inspection: every
 *  writer here is `applyConfirmed`, which only ever sets a real value, so a present key is a real
 *  override. A hand-seeded `{ model: undefined }` counts as held and is cleared anyway — the composed
 *  read is identical either way, so the only cost is one extra notify in a state production cannot
 *  produce. Its one caller is #1167's arm, whose early-out must not fire on a dirty store. */
function hasConfirmed(confirmed: RunSettingsWriteState['confirmed']): boolean {
  return Object.keys(confirmed).length > 0
}

/**
 * The pure reducer — five arms, each pinned by a named test:
 *  - `changeDispatched`: record the pending change under its `changeId`; clear `error` (a fresh
 *    attempt supersedes the last rejection). `confirmed` untouched — the optimistic value shows via
 *    the pending overlay in selectEffectiveSettings (AC1).
 *  - `settingsConfirmed`: if no pending change matches the `changeId` → no-op (AC4 fail-closed); else
 *    commit the SENT value into `confirmed` and delete the pending marker (AC2). The event carries no
 *    value — the store commits what the pending record remembered.
 *  - `settingsRejected`: if no match → no-op (AC4 fail-closed); else delete the pending marker (the
 *    view rolls back on its own — the optimistic overlay vanishes, revealing the last confirmed value
 *    or the snapshot base) and set `error` to the rejected field (AC3).
 *  - `reconnected`: drop EVERY pending marker (#539). Main abandons its envelope-id → changeId
 *    correlation on each re-dial (`daemonConnection.ts:1490`) and emits nothing in its place, so an
 *    in-flight change's reply can never arrive; left alone the entry strands forever and — since
 *    pending BEATS confirmed in selectEffectiveSettings — outlives later confirmed changes as a
 *    permanent lie about the applied value. `confirmed` and `error` are preserved: a standing rejection
 *    is still true after a reconnect, and a confirmed override is still what the daemon has.
 *  - `conversationSwitched`: drop pending, confirmed AND error (#1167). Every layer of this store
 *    describes ONE chat's session, and after a switch all three describe the chat being left. This is
 *    the whole of what distinguishes it from `reconnected` above, and the reason is that a reconnect
 *    abandons correlations for a session that is STILL the one being described, while a switch changes
 *    WHICH session is being described at all — so a standing rejection and a confirmed override, both
 *    still true across a reconnect, are both false across a switch.
 *
 * There is no explicit "roll back" mutation: clearing the pending marker IS the rollback, because the
 * effective view falls through to the confirmed override or the snapshot base. `reconnected` is the
 * fourth caller of that doctrine, not a new mechanism. A no-match returns the SAME state object, so
 * zustand skips the notify (no spurious re-render).
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
      return { ...state, pending, error: change.field === 'model' && change.source === 'recall'
        ? state.error : change.field }
    }
    case 'reconnected': {
      // Nothing outstanding → the SAME reference, and this early-out is load-bearing rather than
      // cosmetic: #257 selects the whole raw write state (`RunConfigSections.tsx:327`), so zustand's
      // Object.is short-circuit is what keeps a first connect — or any reconnect with nothing in flight
      // — from re-rendering the entire sheet (AC4).
      if (state.pending.size === 0) return state
      // A FRESH empty Map, not `initialRunSettingsWriteState.pending`: aliasing the shared constant is
      // safe today (every arm copy-on-writes) but a latent footgun for zero gain, and the early-out
      // means this allocates only when there was something to clear.
      //
      // Spread `state` — the file's idiom, and the conservative direction here: an unknown future field
      // is PRESERVED by default, matching this arm's posture (clear the one thing that strands, leave
      // everything else alone). This is why the argument INVERTS from sibling #538, which spread the
      // initial constant and so would have silently wiped a future field. The mirror-image residual:
      // a future field that is itself pending-scoped must be added to this arm by hand — TypeScript
      // will not force it.
      return { ...state, pending: new Map() }
    }
    case 'conversationSwitched': {
      // Nothing held → the SAME reference, for `reconnected`'s reason one arm up: #257 selects the
      // whole raw write state, so this is what keeps a switch between two chats that never wrote
      // anything from re-rendering the sheet. The predicate spans ALL THREE fields where
      // `reconnected`'s spans only `pending` — copying that narrower guard here would return early on
      // exactly the state this arm exists for, a confirmed override standing with nothing in flight,
      // which is the durable half of the defect and the one no reply can ever displace.
      if (state.pending.size === 0 && state.error === null && !hasConfirmed(state.confirmed)) {
        return state
      }
      // A FRESH WHOLE-STATE LITERAL, not `{ ...state, … }`, and the argument INVERTS from `reconnected`
      // directly above. That arm spreads `state` so an unknown future field is preserved by default,
      // matching its posture of clearing only the one thing that strands. This arm's posture is the
      // opposite — every field of this store is conversation-scoped — so returning a literal makes a
      // future required field a COMPILE ERROR here rather than a silently-preserved value that outlives
      // the chat it described. Forcing that decision is the point.
      return { pending: new Map(), confirmed: {}, error: null }
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
 * to `'' / '' / false / ''` (the runConfigStore "not loaded" base).
 *
 * The return type is widened BY HAND alongside each new field, and that is load-bearing rather than
 * bookkeeping: the compiler forces a `case`, NOT a returned field. A `case` that assigns its local and
 * never threads it into the object below would satisfy `assertNever` while leaving the overlay silently
 * dead — a change that looks applied in the store and never reaches a reader.
 *
 * CONSUMER NOTE (#682): `permissionMode` composes a client-owned pending/confirmed value over a
 * DAEMON-AUTHORED snapshot base, and the read half reports six modes where the write half accepts five.
 * The composed value can legitimately be `bypassPermissions`, which a write would be refused for. A
 * control must not offer the currently-displayed value straight back as a submittable option.
 */
export function selectEffectiveSettings(
  snapshot: RunConfigSnapshot | null,
  s: RunSettingsWriteState
): Pick<RunConfigSnapshot, 'model' | 'effort' | 'yolo' | 'permissionMode'> {
  let model: string | undefined
  let effort: string | undefined
  let yolo: boolean | undefined
  let permissionMode: string | undefined
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
      case 'permissionMode':
        permissionMode = change.value
        break
      default:
        assertNever(change)
    }
  }
  return {
    model: model ?? s.confirmed.model ?? snapshot?.model ?? '',
    effort: effort ?? s.confirmed.effort ?? snapshot?.effort ?? '',
    yolo: yolo ?? s.confirmed.yolo ?? snapshot?.yolo ?? false,
    permissionMode: permissionMode ?? s.confirmed.permissionMode ?? snapshot?.permissionMode ?? ''
  }
}

/** The last-rejected field (for #257's error copy), or `null` when there is no standing rejection. */
export const selectError = (s: RunSettingsWriteState): SettingsChange['field'] | null => s.error

/** Per-field in-flight flags so #257 can show a pending state and disable a field mid-change. The
 *  return type is widened by hand per field for selectEffectiveSettings' reason: a `case` that sets its
 *  local without the object below gaining the key compiles clean and flags nothing. */
export function selectPendingFields(s: RunSettingsWriteState): {
  model: boolean
  effort: boolean
  yolo: boolean
  permissionMode: boolean
} {
  let model = false
  let effort = false
  let yolo = false
  let permissionMode = false
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
      case 'permissionMode':
        permissionMode = true
        break
      default:
        assertNever(change)
    }
  }
  return { model, effort, yolo, permissionMode }
}
