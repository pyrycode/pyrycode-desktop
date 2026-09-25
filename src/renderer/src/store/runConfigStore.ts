// The Run configuration sheet's held snapshot: the session's current model / reasoning effort /
// YOLO state, as one unidirectional source of truth. Pure renderer state — no IPC, no preload
// bridge, no transport. The data path (runConfigSnapshot.ts) requests the session settings on sheet
// open and writes the arriving `runConfigReceived` fields here via the single setter (#491/#500 moved
// it onto that dedicated reply); #188's sections read the held values through the selectors.
//
// A dedicated store (a separate consumer, per #180's landed comments), NOT a session-store facet: a
// snapshot never touches connection/messages state and vice versa, so the two stores stay orthogonal
// and a snapshot arrival re-renders only components selecting this slice. It mirrors sessionStore's
// DI-factory → singleton → hook → selectors structure, but with NAMED SETTERS rather than a reducer:
// its two mutations ("record the latest snapshot", and #1167's "drop it") are independent whole-value
// writes that read no prior state, which is sessionIdStore's set/clear shape (#259/#529) rather than
// a discriminated-union action set. A reducer earns its keep where the transitions are CORRELATED —
// the adjacent runSettingsWriteStore is that contrast, which is why #1167 lands as an arm there and a
// second setter here. Unidirectional is preserved: read-only selectors, and both write paths are
// invoked only by the subscription wiring and by the conversation-lifetime helpers, never
// two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The session-settings fields the sheet displays. Fields are plain `string`/`boolean`, so an
 *  empty model, an empty effort (inherited default), or `yolo: false` (permissions enforced) are
 *  held verbatim by construction — never coerced (AC5). Mirrors the `runConfigReceived` event shape,
 *  minus its `sessionId` (the session-id store holds that).
 *
 *  `usedTokens` / `windowTokens` are the session's context-window usage figures (#192), held for the
 *  Context window gauge. Both required (parallel to model/effort/yolo — held verbatim, never coerced):
 *  the "usage unavailable" state is `windowTokens === 0` (the daemon's foreground / no-transcript
 *  signal), NOT `undefined`. The gauge never divides when `windowTokens === 0`.
 *
 *  `permissionMode` (#1020) is the session's permission mode, one of claude's six on a resolved
 *  session. It takes the same verbatim hold as the fields above, and `''` is its own real reading —
 *  NO SESSION WAS RESOLVED, the one zero here that names no posture — arriving on the same frame as
 *  the empty session id the session-id store holds. It is NOT derived from `yolo` and does not derive
 *  it: `yolo` is a boolean against six modes, so it can only separate `bypassPermissions` from the
 *  rest. Nothing renders it yet; #682 is the first consumer. */
export interface RunConfigSnapshot {
  model: string
  effort: string
  /** Applied reading: omission is unavailable; null means no model effort parameter. */
  effectiveEffort?: string | null
  yolo: boolean
  permissionMode: string
  usedTokens: number
  windowTokens: number
  /** The session's capability flags (#1655, decoded by #1654): omission is "not reported", read as
   *  supported by `sessionSupports`. Only an explicit `false` withdraws a surface. */
  slashCommands?: boolean
  mcpServers?: boolean
  contextUsageDetail?: boolean
}

/** The whole run-config state. `snapshot: null` is the distinct "not yet loaded" state; a received
 *  `{ model: '', effort: '', yolo: false }` is a real snapshot of inherited-defaults, NOT null (#188
 *  distinguishes the two). */
export interface RunConfigState {
  snapshot: RunConfigSnapshot | null
}

/** Store shape = state + the two mutation entry points. They live here and NOT on `RunConfigState`,
 *  so the selector — typed against the state-only interface — cannot see them and
 *  `initialRunConfigState` stays assignable (the sessionIdStore arrangement). */
export type RunConfigStore = RunConfigState & {
  setSnapshot: (snapshot: RunConfigSnapshot) => void
  clearSnapshot: () => void
}

export const initialRunConfigState: RunConfigState = { snapshot: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setSnapshot` replaces the whole
 * `snapshot` object unconditionally (AC4 "most recent snapshot wins" — no merge, no dedupe) and
 * never coerces or validates the fields (AC5). The stored value is the daemon's, as-is.
 *
 * `clearSnapshot` (#1167) returns the state to `initialRunConfigState` for when the conversation that
 * scoped the snapshot stops being the open one — a switch, a delete or an archive. It is sourced from
 * that exported constant rather than a fresh `{ snapshot: null }` literal, for the reason
 * `clearSessionId` states: it keeps resetting everything if the state ever gains a second field. It is
 * unconditional, which is what makes clearing an already-clear store a no-op by construction rather
 * than by a guard — and it is cheap even so, because `selectSnapshot` is the whole read surface and
 * `null → null` is not a slice change, so no subscriber wakes on a redundant clear.
 *
 * It reverts to the DISTINCT not-loaded state, never to an all-zero snapshot: `''` / `false` / `0` are
 * real readings the daemon sends (an inherited default, an unresolved session, a foreground turn), and
 * the not-known rendering every footer control draws depends on telling those apart from "nothing has
 * arrived for this chat yet".
 *
 * A cleared store is not latched: the newly opened conversation's own reply lands through `setSnapshot`
 * moments later, which is the only sequence production runs.
 */
export function createRunConfigStore(init: RunConfigState = initialRunConfigState) {
  return createStore<RunConfigStore>((set) => ({
    ...init,
    setSnapshot: (snapshot) => set({ snapshot }),
    clearSnapshot: () => set(initialRunConfigState)
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #188's sections read. */
export const runConfigStore = createRunConfigStore()

/** Narrow-slice React binding for #188. Selecting a single slice avoids cross-facet re-renders. */
export function useRunConfigStore<T>(selector: (s: RunConfigStore) => T): T {
  return useStore(runConfigStore, selector)
}

/** The only read surface. The two mutation paths are `setSnapshot` and `clearSnapshot` (#1167) and
 *  there is no third; the first is invoked only by the subscription wiring and the second only by the
 *  conversation-lifetime helpers, never two-way-bound from a component. */
export const selectSnapshot = (s: RunConfigState): RunConfigSnapshot | null => s.snapshot

export type SessionCapability = 'slashCommands' | 'mcpServers' | 'contextUsageDetail'

/**
 * Whether the open conversation's session offers a surface (#1655). False ONLY for the daemon's explicit
 * `false`: a snapshot not yet arrived, an older daemon's absent flag and `true` all read as supported, so
 * those sessions look exactly as they did before the flags existed. Keyed on the daemon's statement of
 * support, never on the agent name.
 */
export function sessionSupports(
  snapshot: RunConfigSnapshot | null,
  capability: SessionCapability
): boolean {
  return snapshot?.[capability] !== false
}

/** Boolean slices, so a snapshot change that leaves the flag alone re-renders nothing. */
export const selectSlashCommandsSupported = (s: RunConfigState): boolean =>
  sessionSupports(s.snapshot, 'slashCommands')
export const selectMcpServersSupported = (s: RunConfigState): boolean =>
  sessionSupports(s.snapshot, 'mcpServers')
