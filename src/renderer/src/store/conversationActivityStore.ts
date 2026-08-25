// What every conversation is currently DOING, held per conversation id rather than for whichever one
// is open (#747, split from #674) — so the sidebar can draw a dot on a row the user has never opened.
// Pure renderer state: no IPC, no preload bridge, no transport, no async task, no timer, no teardown.
//
// This slice shipped the HOLDER (#747); #748 wires the four daemon arms (`turnState`, `stallDetected`,
// `apiRetry`, `compacting` — src/shared/ipc/events.ts:125,145,172,199) into it, and #749 added the two
// eviction paths below. Nothing is registered in `clearPairingScopedState`, and that is the DECIDED
// answer rather than a pending one: on the `connected`-edge vs pairing-scoped discriminator
// announcedModelStore.ts:29-45 documents ("does a reconnect to the SAME daemon need to clear it?") all
// four facts are liveness, so a reconnect must clear them ⇒ the `connected` edge, wired in
// conversationActivityBridge.ts. There is still no reader — #676's sidebar dot is the first.
//
// Keyed by `conversationId`, NOT a flat slot — the backgroundTaskRosterStore.ts:31-37 argument, reused
// rather than re-derived: the daemon fans these frames out to every interactive connection and each
// carries `conversation_id`, so frames for DIFFERENT conversations arrive in sequence and a single
// "hold the latest" slot lets one clobber another. Replacement truth PER KEY — relayLinkStore's
// single-setter posture applied per id. Four named setters rather than a reducer: four independent
// whole-value writes model no state machine, so a discriminated-union action set is ceremony without
// benefit, and one generic `setFact(id, name, value)` would reintroduce a stringly-typed key right
// next to the one hostile string this store exists to contain.
//
// It runs ALONGSIDE threadTimeline.ts:189-224's chrome scalars and migrates none of them. Those carry
// intricate per-fact clear semantics across 28 renderer references; unpicking them is its own piece of
// work and nothing needs it yet (CLAUDE.md: don't refactor adjacent code while you are there).
//
// HARD IMPORT CONSTRAINT, checkable by grep: this module imports nothing from
// `src/renderer/src/screens/` and nothing from `activeConversationStore`. Its only imports are the two
// below. Two things follow. `isTurnRunning` — the existing running-turn predicate — is exported from
// screens/conversation/ConversationScreen.tsx:1343, a REACT SCREEN MODULE, so importing it would drag
// React, JSX and that screen's whole import graph into a store whose tests run with no React and no
// DOM; #748 owns deriving the fact with it, which is why `setTurnRunning` takes a plain boolean here.
// And with no reference to the open conversation in scope, the `?? activeConversation` fallback that
// the four arms' REQUIRED `conversationId` was designed to prevent is not something a developer must
// remember to avoid — it is unavailable.
//
// SECURITY: the `conversationId` is daemon-asserted untrusted text used here ONLY as a lookup key —
// never stored inside an entry, never rendered, never concatenated, never a filename, a cache key or a
// URL, and never compared against a secret. `ReadonlyMap` is MANDATED and `Record<string, …>` is
// forbidden: `Map.prototype.get('__proto__')` performs no prototype-chain lookup and
// `Map.prototype.set('__proto__', v)` creates an ordinary own entry, so `__proto__`, `constructor` and
// `''` are three unremarkable keys by construction rather than by validation. Three consequences,
// pinned here because none of them is a type error: nothing is keyed into an object literal; the write
// path uses NO computed object keys at all (every fact is a property shorthand at a named call site,
// so there is no `{ [x]: v }` whose key provenance a reviewer must trace); and `Object.fromEntries`,
// spreading the map into an object, and `JSON.stringify` of the map are all out, each re-materialising
// the hazard the `Map` removes. A future swap of `Map` for `Record` produces no type error and breaks
// no other assertion — only conversationActivityStore.test.ts's hostile-key reads fail.
//
// Log-free by construction — no `console.*` on any path. The only value a diagnostic here could carry
// is the untrusted id, and the content-free diagnostics rule (#126) keeps it out of a file. A read
// miss is silent by design, not a swallowed error. Nothing is persisted either, and must not be:
// `defaultWorkspaceStore` and `pushNotificationPrefStore` do use `localStorage`, so the pattern is in
// the repo to copy — but web storage would survive the pairing boundary #749 exists to enforce.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The four facts this app holds about ONE conversation. Plain booleans, not `boolean | null`: the
 *  "never observed" reading lives at the ENTRY level, where `selectActivityFor` returns `null`, exactly
 *  as backgroundTaskRosterStore.ts:398-413 puts it. Per-fact nullability would invent a third state the
 *  sidebar cannot draw and multiply the test matrix by four for no consumer.
 *
 *  Two names diverge DELIBERATELY from the chrome scalars they mirror:
 *
 *    - `apiRetrying`, not `apiRetry`. threadTimeline.ts:184-199's `apiRetry` is `ApiRetryStatus | null`
 *      — a counter record. This is the LIVENESS fact only; the counter stays where it is and serves the
 *      open conversation's chrome. The different name is what stops a reader treating one as the other,
 *      the same-name-different-shape trap announcedModelStore.ts:12-16 documents for `model`.
 *    - `turnRunning`, not `phase`. This holds the derived boolean, never the `TurnPhase` wire enum.
 *
 *  `stalled` and `compacting` keep their names because their shapes match too.
 *
 *  There is deliberately NO fifth fact: `localSendPending` (threadTimeline.ts:206-224) is the one
 *  renderer-sourced scalar, opened by the operator's own send with no daemon involvement, and only the
 *  open conversation has a composer that can open it.
 *
 *  Fields are plain, not `readonly`, matching `HeldBackgroundTask`
 *  (backgroundTaskRosterStore.ts:147-154): immutability is carried by the `ReadonlyMap` signal and the
 *  copy-on-write convention, as it already is repo-wide. */
export interface ConversationActivityEntry {
  turnRunning: boolean
  stalled: boolean
  apiRetrying: boolean
  compacting: boolean
}

/** The whole state. A key ABSENT from the map means "no frame has ever arrived for that conversation"
 *  and is a DISTINCT state from a present all-false entry ("observed; nothing is happening") — see
 *  `selectActivityFor`, which preserves that distinction rather than collapsing it. `ReadonlyMap`
 *  signals the setters REPLACE the map, never mutate it in place, and is the construction that makes
 *  the hostile-key property hold (see the header). */
export interface ConversationActivityState {
  entries: ReadonlyMap<string, ConversationActivityEntry>
}

/** Store shape = state + one named setter per fact + the two eviction paths (#749). `dropConversation`
 *  reads against the entry-per-conversation model; `clearAllActivity` carries `All` so its blast radius
 *  is legible at the CALL SITE rather than only in this docstring. */
export type ConversationActivityStore = ConversationActivityState & {
  setTurnRunning: (conversationId: string, turnRunning: boolean) => void
  setStalled: (conversationId: string, stalled: boolean) => void
  setApiRetrying: (conversationId: string, apiRetrying: boolean) => void
  setCompacting: (conversationId: string, compacting: boolean) => void
  dropConversation: (conversationId: string) => void
  clearAllActivity: () => void
}

export const initialConversationActivityState: ConversationActivityState = { entries: new Map() }

/** The seed for a newly created entry. Module-private ON PURPOSE and never exported: an exported one
 *  invites a reader to write `selectActivityFor(id) ?? idleActivity`, which collapses the
 *  absent-vs-observed-idle distinction with no type error and no failing test — the precise collapse
 *  queueStore's `?? EMPTY_BACKLOG` makes and backgroundTaskRosterStore.ts:398-405 warns against
 *  inheriting. Tests construct their own literals. */
const idleActivity: ConversationActivityEntry = {
  turnRunning: false,
  stalled: false,
  apiRetrying: false,
  compacting: false
}

/** The one write path: read the held entry (or seed a fresh idle one), apply `update`, clone the OUTER
 *  map, replace the key, return a fresh state. Never mutates `s.entries` or an entry in place.
 *
 *  `new Map(s.entries)` copies REFERENCES, so every untouched entry object survives identically —
 *  `nextMap.get(otherId)` is `Object.is`-identical to `previousMap.get(otherId)`. With a selector that
 *  hands back the held entry itself, a component watching another conversation does not re-render
 *  (backgroundTaskRosterStore.ts:415-417 states exactly this property). That is the whole of AC2. */
function writeEntry(
  s: ConversationActivityState,
  conversationId: string,
  update: (held: ConversationActivityEntry) => ConversationActivityEntry
): ConversationActivityState {
  const next = new Map(s.entries)
  next.set(conversationId, update(s.entries.get(conversationId) ?? idleActivity))
  return { entries: next }
}

/**
 * DI-friendly, React-free store — one isolated instance per test.
 *
 * Each setter is a same-value guard composed onto `writeEntry`, and the guard is written against ITS
 * OWN NAMED FIELD rather than a shared four-field `entriesEqual` inside the helper. That is deliberate:
 * a shared exhaustive comparison silently stops writing the moment a fifth fact is added, whereas a
 * fifth fact here means a fifth setter carrying its own guard.
 *
 * Two properties fall out of `?.` + `===`:
 *
 *   - A FIRST write always creates the entry, INCLUDING a first write of `false`: `?.` yields
 *     `undefined` on an absent key and `undefined` is never `===` a boolean, so the create path runs.
 *     "Absent" and "observed idle" cannot be conflated by the guard. Not a hypothetical — `apiRetry`
 *     and `compacting` both carry explicit falling edges, so `active: false` can be the first frame a
 *     conversation ever produces.
 *   - A VERBATIM REPEAT churns no listener. The upstream arms are explicitly not deduped — the
 *     transport holds no state, so a consumer sees one event per daemon frame including a verbatim
 *     repeat (events.ts:165-167, :195-197). Returning the state object itself makes zustand's
 *     `Object.is` short-circuit fire, so no subscriber wakes, at the cost of one comparison. Documented
 *     wire behaviour, not a speculative defence.
 *
 * Every setter takes a `boolean`, `setStalled` included, even though `stallDetected` is an onset-only
 * nullary arm: the store holds replacement truth and THE WRITER decides when a fact clears. A nullary
 * `markStalled(id)` would leave no way to clear the fact at all, and #748 needs one.
 *
 * Growth is bounded by the number of distinct `conversationId`s the daemon names SINCE THE LAST
 * HANDSHAKE, at four booleans plus one bounded id string per entry: `clearAllActivity` empties the map
 * on every `connected` edge and `dropConversation` removes a deleted conversation before then. The
 * residue between handshakes — a long-lived pairing that names many conversations without deleting any
 * — is deliberately not capped here; #676, the first reader, is where a real ceiling would go.
 *
 * Every write is a synchronous `set` under zustand's own store lock with no `await` inside it, so there
 * is no check-then-act gap across a suspension point for a concurrent handler to interleave into.
 * Unidirectional is preserved: read-only selector, one write path per fact, and no setter is
 * two-way-bound from a component.
 */
export function createConversationActivityStore(
  init: ConversationActivityState = initialConversationActivityState
) {
  return createStore<ConversationActivityStore>((set) => ({
    ...init,
    setTurnRunning: (conversationId, turnRunning) =>
      set((s) =>
        s.entries.get(conversationId)?.turnRunning === turnRunning
          ? s
          : writeEntry(s, conversationId, (held) => ({ ...held, turnRunning }))
      ),
    setStalled: (conversationId, stalled) =>
      set((s) =>
        s.entries.get(conversationId)?.stalled === stalled
          ? s
          : writeEntry(s, conversationId, (held) => ({ ...held, stalled }))
      ),
    setApiRetrying: (conversationId, apiRetrying) =>
      set((s) =>
        s.entries.get(conversationId)?.apiRetrying === apiRetrying
          ? s
          : writeEntry(s, conversationId, (held) => ({ ...held, apiRetrying }))
      ),
    setCompacting: (conversationId, compacting) =>
      set((s) =>
        s.entries.get(conversationId)?.compacting === compacting
          ? s
          : writeEntry(s, conversationId, (held) => ({ ...held, compacting }))
      ),
    // Remove exactly one key, CLONING the outer map and deleting on the clone — never
    // `s.entries.delete(...)`. `new Map(s.entries)` copies references, so every survivor is
    // `Object.is`-identical to the object held before, the same property `writeEntry` documents at
    // :124-127. `has` rather than `get(...) !== undefined`: an entry is never `undefined`, so both
    // work and `has` states the intent. `writeEntry` is deliberately NOT reused — its contract is
    // "seed-or-read, apply, set", and a removal is a different shape with one call site, so sharing
    // would force a sentinel through it for no gain. The absent-key guard is the four setters'
    // same-value doctrine applied to a key that is not there: it returns the state OBJECT, so
    // zustand's `Object.is` short-circuit fires and no subscriber wakes. That is the common case
    // rather than an edge one — the bridge fires for every deletion and most conversations have
    // never produced an activity frame — and it is a no-op BY DESIGN, not a swallowed error.
    dropConversation: (conversationId) =>
      set((s) => {
        if (!s.entries.has(conversationId)) return s
        const next = new Map(s.entries)
        next.delete(conversationId)
        return { entries: next }
      }),
    // The pairing boundary, wired at the `connected` edge (conversationActivityBridge.ts). Shaped
    // after backgroundTaskRosterStore.ts:382, guard included. It deliberately does NOT hand back
    // `initialConversationActivityState`: that exported constant holds a module-shared MUTABLE
    // `Map`, so returning it as live state would make every store instance that clears share one
    // object. The `size === 0` guard buys the idempotence that returning a constant would.
    clearAllActivity: () => set((s) => (s.entries.size === 0 ? s : { entries: new Map() }))
  }))
}

/** App-wide singleton — the one source of truth #748 writes and the sidebar reads. */
export const conversationActivityStore = createConversationActivityStore()

/** Narrow-slice React binding. Selecting a single conversation's slice avoids cross-facet re-renders. */
export function useConversationActivityStore<T>(selector: (s: ConversationActivityStore) => T): T {
  return useStore(conversationActivityStore, selector)
}

/**
 * The only read surface — a selector FACTORY bound to one `conversationId`.
 *
 * `?? null` is the `selectRosterFor` posture (backgroundTaskRosterStore.ts:395-424), adopted rather
 * than re-derived, and NOT queueStore's `?? EMPTY_BACKLOG`: that collapse would make "no frame has ever
 * arrived" and "observed, nothing is happening" read identically, with no type error and no failing
 * test unless one is written for it. The three readings stay distinct:
 *
 *   key absent                       → `null`      no frame has ever arrived for this conversation
 *   `{ …all false }`                 → that entry  observed; nothing is happening
 *   `{ compacting: true, … }`        → that entry  observed; compacting
 *
 * `null` is a STABLE reference by construction, so no hoisted `EMPTY_*` constant is needed and no fresh
 * object is built per selector call — it hands back the HELD ENTRY ITSELF. The nullable return type
 * forces the eventual reader to branch, so the distinction cannot be ignored accidentally.
 *
 * A bare `Map.get` with `?? null` is also what makes an unknown id an EXPLICIT no-match that can never
 * resolve onto a neighbour's entry — the misattribution the four arms' required `conversationId` was
 * introduced to push down here.
 *
 * There is deliberately no whole-map `selectAllActivity`: nothing in this slice or the next two reads
 * the map wholesale (#749 clears it, #748 writes it, the sidebar reads one row at a time), so shipping
 * one would ship an unread read surface (the backgroundTaskRosterStore.ts:418-420 rule).
 */
export const selectActivityFor =
  (conversationId: string) =>
  (s: ConversationActivityState): ConversationActivityEntry | null =>
    s.entries.get(conversationId) ?? null
