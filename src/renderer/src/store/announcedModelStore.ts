// The model claude announced for the running turn, kept live as one unidirectional source of truth for
// the run-configuration sheet (#560, later). Pure renderer state — no IPC, no preload bridge, no
// transport. The data path (announcedModelBridge.ts) observes each arriving `modelAnnounced` daemon
// event (#587 decodes claude's `system` / `init` line) and writes its `model`/`truncated` here via the
// single setter; #560 reads them through the selector.
//
// A dedicated store (the runConfigStore precedent, #187), NOT a
// runConfigStore facet, on four grounds. (a) Lifetime: runConfigStore's data path requests a fresh
// snapshot on sheet open (runConfigStore.ts:1-5), whereas this holder must be App-level
// always-listening — an announcement rides the turn's init line whether or not any sheet is open.
// (b) All three exhaustive bridges already name this as a distinct thing (daemonEventBridge.ts:150,
// modalBridge.ts:101, timelineBridge.ts:161). (c) The name collides and means the OPPOSITE:
// runConfigStore.ts:27 holds `model: string` meaning the per-session OVERRIDE (`''` = inherited
// default), while this one is what claude ANNOUNCED, and in the ordinary case the two disagree
// (events.ts:179-185). (d) runConfigStore's `snapshot: null` already spends the not-yet sentinel, so
// folding in would need a second one nested inside it. The two stores stay orthogonal and an
// announcement re-renders only components selecting this slice.
//
// Named setters rather than a reducer: the two mutations ("record the latest announcement" and, since
// #593, "clear when the pairing that scoped it ends") are independent whole-value writes — neither
// reads prior state and neither constrains the other's ordering — so there is no state machine for a
// discriminated-union action set to model; it would still be ceremony without benefit. Unidirectional
// is preserved: read-only selector, store-owned write paths, and both mutations are invoked only by
// wiring (the subscription for one, the pairing-ended helper for the other), never two-way-bound from a
// component.
//
// PAIRING-SCOPED, and IN clearPairingScopedState's set (#529, joined by #593). By that helper's own
// rule (clearPairingScopedState.ts:19-27) a pairing-scoped store that nothing re-asserts on the new
// pairing belongs there, and this one qualifies: nothing on a fresh pairing re-asserts an announcement
// — the next one arrives only with the next turn's init line, so a stale value would otherwise latch,
// and #560's sheet would attribute the previous server's identifier, and its `truncated` cut report,
// to the newly paired one under a "Running model" header that carries no provenance marker.
//
// NOT on the transport's `connected` edge, the other mechanism, which is mutually exclusive with this
// one by design — that helper's docstring (clearPairingScopedState.ts:22-26) excludes stores the
// `connected` edge already clears. The discriminator is one question: does a reconnect to the SAME
// daemon need to clear it? For backgroundTaskRosterStore yes, and its bridge branch is the sole
// enforcement of #573's AC5 (backgroundTaskRosterBridge.ts:118-127). Here NO: after a reconnect to the
// same daemon the held announcement still describes that daemon, and clearing it would blank a correct
// value the sheet has no way to re-fetch — there is no request half on this path
// (announcedModelBridge.ts:1-7), only the unsolicited announcement.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The held announcement. `model` is claude's identifier held VERBATIM — never normalised, lowercased,
 *  allow-listed, date-stamped, family-mapped, or shape-checked. claude echoes an identifier at least as
 *  specific as the one it was given, so `claude-haiku-4-5` announces back undated and appears in no
 *  published model list: a MISS on #560's exact lookup is ORDINARY, not an error.
 *
 *  `truncated` is the daemon's cut report and is LOAD-BEARING: a consumer that ignores it presents
 *  claude's cut text as complete, and a cut identifier always misses #560's lookup and so always
 *  renders verbatim, looking exactly like a legitimate unrecognised model. `false` is a VALUE (nothing
 *  was cut), never an absence.
 *
 *  SECURITY: `model` is UNTRUSTED, model-influenced daemon-relayed text. The daemon BOUNDS it (256
 *  bytes) but does NOT SANITIZE it — nothing strips control characters or terminal escapes anywhere on
 *  this path — so #560's render surface must treat it as PLAIN TEXT ONLY, NEVER HTML (no innerHTML /
 *  dangerouslySetInnerHTML), never into an attribute or a URL. It is a REPORT, NEVER A CONTROL INPUT:
 *  no security-relevant behaviour may branch on it, and it is not a cache key, a filename, or a lookup
 *  path. This slice has no DOM sink, so the constraint is inherited here rather than discharged.
 *  Mirrors the `modelAnnounced` event shape (events.ts:174-211). */
export interface AnnouncedModel {
  model: string
  truncated: boolean
}

/** The whole announced-model state. `announced: null` is the distinct "no announcement has arrived yet"
 *  state — an announcement arrives once per turn, so a freshly launched app has none and #560 must be
 *  able to say so explicitly. A received `{ model: '', truncated: false }` is a REAL (if degenerate)
 *  announcement the daemon emitted, held verbatim and NOT collapsed to null — the sessionIdStore
 *  `null`-vs-`''` contract (sessionIdStore.ts:24-26). That arm is reachable, not hypothetical: the
 *  daemon's producer suppresses an empty model (parser.go:1446) so a conforming daemon never sends one,
 *  but #587 deliberately declined a second client-side suppression, so `requireString` admits `''` and
 *  the decoder passes it through from a non-conforming or hostile daemon.
 *
 *  The record-`|`-null shape (the runConfigStore idiom) is load-bearing rather
 *  than stylistic. The flat alternative `{ model: string | null; truncated: boolean }` would force
 *  `truncated` to carry a value before any announcement exists, contradicting "`false` is a VALUE,
 *  never an absence" (events.ts:194). Wrapping both fields behind one nullable makes "not yet
 *  announced" a single sentinel and makes every field of a present record a real daemon-delivered
 *  value by construction. */
export interface AnnouncedModelState {
  announced: AnnouncedModel | null
}

/** Store shape = state + the two mutation entry points. The mutations live here and NOT on
 *  `AnnouncedModelState`, so the selector — typed against the state-only interface — cannot see them
 *  and `initialAnnouncedModelState` stays assignable. */
export type AnnouncedModelStore = AnnouncedModelState & {
  setAnnouncedModel: (announced: AnnouncedModel) => void
  clearAnnouncedModel: () => void
}

export const initialAnnouncedModelState: AnnouncedModelState = { announced: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setAnnouncedModel` replaces the
 * whole `announced` record unconditionally: no merge, no coercion, no validation, and NO DEDUP OF A
 * VERBATIM REPEAT. The repeat is not noise — per events.ts:208-209 the transport holds no state, so a
 * consumer sees exactly one event per daemon frame, and a repeat is the signal that the value is still
 * current; suppressing it would discard information. One consequence, stated rather than discovered:
 * each write produces a fresh object identity, so a verbatim repeat does re-notify subscribers (#560
 * memoises if it ever matters). Memory is O(1) regardless of how
 * many announcements arrive — the store holds exactly one record and replaces it, so a flooding hostile
 * relay costs one allocation per frame, not an unbounded append.
 *
 * `clearAnnouncedModel` (#593) returns the state to `initialAnnouncedModelState` for when the pairing
 * that scoped the announcement ends — sourced from that exported constant rather than a fresh literal,
 * so it keeps resetting everything if the state ever gains a second field. It restores the `null`
 * not-yet-announced sentinel, never a `{ model: '', truncated: false }` record. It is unconditional and
 * NEVER branches on the held content: a clear gated on the identifier (non-empty, catalog-matching, or
 * otherwise) would let a hostile daemon craft a value that survives a pairing switch and is then
 * attributed to the next daemon. Being unguarded is also what makes clearing an already-clear store a
 * no-op by construction rather than by a guard.
 *
 * A `modelAnnounced` frame already queued on the IPC channel when the clear runs repopulates the store
 * afterwards, because every write here is unconditional and last-write-wins: AnnouncedModelData is an
 * App-level sibling of AppView (App.tsx:126-142), so the unpair route flip does not unmount its
 * listener. That is the window sessionIdStore.ts:56-62 documents and deliberately leaves alone,
 * inherited verbatim and for the same reason — guarding it belongs with the pairing lifecycle that owns
 * the clear, not in a store whose whole contract is to record what it was told. It is bounded (the
 * unpair tears the transport down) and self-correcting (the new daemon's first turn overwrites).
 *
 * The stored value is the daemon's, as-is.
 */
export function createAnnouncedModelStore(
  init: AnnouncedModelState = initialAnnouncedModelState
) {
  return createStore<AnnouncedModelStore>((set) => ({
    ...init,
    setAnnouncedModel: (announced) => set({ announced }),
    clearAnnouncedModel: () => set(initialAnnouncedModelState)
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #560 reads. */
export const announcedModelStore = createAnnouncedModelStore()

/** Narrow-slice React binding for #560. Selecting a single slice avoids cross-facet re-renders. */
export function useAnnouncedModelStore<T>(selector: (s: AnnouncedModelStore) => T): T {
  return useStore(announcedModelStore, selector)
}

/** The only read surface. The exposed mutations are exactly `setAnnouncedModel` and
 *  `clearAnnouncedModel`; both are store-owned and invoked only by wiring — the subscription for the
 *  first, clearPairingScopedState (its sole caller) for the second — never two-way-bound from a
 *  component. */
export const selectAnnouncedModel = (s: AnnouncedModelState): AnnouncedModel | null => s.announced
