// A WHOLE TIMELINE per conversation id (#755, split from #675) — so leaving a chat and coming back does
// not throw the thread away. Pure renderer state: no IPC, no preload bridge, no transport, no async
// task, no timer, no teardown.
//
// This slice ships the HOLDER and nothing else: it has no writer and no reader. `timelineStore.ts` — the
// single flat timeline belonging to whichever conversation is open — stays exactly as it is and keeps
// serving the screens. #756 wires the four turn-stream arms into `dispatchFor`, #757 owns the clears
// (the pairing boundary and a conversation deletion; NOT the `connected` edge, because a thread must
// survive a reconnect), and #758 cuts the reader over and wires `markViewed` at the switch seam
// (activateConversation.ts:74-77). The viewed path ships UNWIRED here and that is correct — the whole
// slice ships dormant, the third of four merges that lands as a verified no-op from the operator's side.
//
// Keyed by `conversationId`, NOT a flat slot — the backgroundTaskRosterStore.ts:31-37 argument, reused
// rather than re-derived: the daemon fans these frames out to every interactive connection and each
// carries `conversation_id`, so frames for DIFFERENT conversations arrive in sequence and a single
// "hold the latest" slot lets one clobber another. The direct structural precedent is
// conversationActivityStore.ts (#747) — the same slice of the same problem one family over, keying the
// four per-conversation ACTIVITY facts the way this one keys the TIMELINE. Same `ReadonlyMap` state,
// same copy-on-write, same named write paths rather than a reducer, same `?? null` selector factory.
//
// The reducer is REUSED, never rewritten: `reduceTimeline` is already a pure
// `(TimelineState, ThreadEvent) => TimelineState`, so folding an event into one key's slice is a call to
// it. There is no second reducer here and no event set redesigned.
//
// It runs ALONGSIDE conversationActivityStore, which already holds `stalled`, `apiRetrying` and
// `compacting` per conversation, and a slice here holds its own copies of the same three. That overlap
// is DECIDED, not pending (conversationActivityStore.ts:22-24): the chrome scalars migrate nowhere,
// because their per-fact clear semantics span 28 renderer references. Unpicking them is its own piece of
// work and nothing needs it yet (CLAUDE.md: don't refactor adjacent code while you are there).
//
// HARD IMPORT CONSTRAINT, checkable by grep: this module's only imports are the three below. It imports
// nothing from `activeConversationStore`, nothing from `./timelineStore`, and nothing from
// `src/renderer/src/screens/`. With no reference to the open conversation in scope, the
// `?? activeConversation` fallback that #751-#754's REQUIRED `conversationId` was designed to prevent is
// not something a developer must remember to avoid — it is unavailable.
//
// And the read-site counterpart, which this module cannot make unavailable and therefore states
// outright: `selectTimelineFor(id) ?? initialTimelineState` is BANNED at every read site. It collapses
// "nothing is held for this conversation" into "observed, nothing in the thread" with no type error and
// no failing test. The twin defends the same collapse by never exporting its empty entry; here the
// equivalent constant is already exported from `./threadTimeline` for the flat store, so the defences
// are this paragraph, the deliberate absence of a re-export below, and the AC4 tests.
//
// SECURITY: the `conversationId` is daemon-asserted untrusted text used here ONLY as a lookup key —
// never stored inside a slice, never rendered, never concatenated, never a filename, a cache key or a
// URL, and never compared against a secret. `ReadonlyMap` is MANDATED and `Record<string, …>` is
// forbidden: `Map.prototype.get('__proto__')` performs no prototype-chain lookup and
// `Map.prototype.set('__proto__', v)` creates an ordinary own entry, so `__proto__`, `constructor` and
// `''` are three unremarkable keys by construction rather than by validation. Three consequences, pinned
// here because none of them is a type error: nothing is keyed into an object literal; there are no
// computed object keys anywhere on either write path; and `Object.fromEntries`, spreading the map into
// an object, and `JSON.stringify` of the map are all out, each re-materialising the hazard the `Map`
// removes. The `Map` → entries → `Map` REBUILD the head-insert needs is in bounds and is not that
// hazard: `new Map(iterable)` uses `Map.prototype.set` semantics, so no object key is ever materialised.
// A future swap of `Map` for `Record` produces no type error and breaks no other assertion — only
// conversationTimelineStore.test.ts's hostile-key reads BEFORE ANY WRITE fail.
//
// Log-free by construction — no `console.*` on any path, and the rule bites harder here than in the
// twin: a diagnostic on this path would carry not just the untrusted id but ASSISTANT MESSAGE TEXT. The
// content-free diagnostics rule (ADR 0007, #126) keeps both out of a file. A read miss and an eviction
// are both silent BY DESIGN, not swallowed errors. Nothing is persisted either, and must not be:
// `defaultWorkspaceStore` and `pushNotificationPrefStore` do use `localStorage`, so the pattern is in
// the repo to copy — but that would write conversation CONTENT to renderer-side web storage, surviving
// the pairing boundary #757 exists to enforce.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  reduceTimeline,
  initialTimelineState,
  type TimelineState,
  type ThreadEvent
} from './threadTimeline'

/**
 * How many conversations' timelines are retained at once.
 *
 * Ten, and not a larger number: the operator's 2026-08-21 ask is about switching between a handful of
 * chats, ten threads of text is trivial memory, and raising it later is a one-literal edit. Exported so
 * the tests assert against the NAME rather than a bare `10`, which is what makes that last claim true
 * rather than aspirational. There is no history backfill in this app — the timeline's only production
 * writers are the live stream and the composer's optimistic echo (activateConversation.ts:42-45) — so an
 * evicted slice is GONE: reopening that conversation shows an empty thread that fills from the next live
 * event, exactly the way every conversation switch behaves today. If ten proves too small in practice
 * the answer is a backfill ticket, not a bigger constant.
 *
 * A BOUND AT ALL is this store's one deliberate divergence from both keyed precedents, so it is stated
 * rather than assumed. backgroundTaskRosterStore.ts:282-289 ("no speculative eviction policy is built
 * for a failure nobody has observed") and conversationActivityStore.ts:163-167 ("deliberately not capped
 * here") each refuse a cap on purpose. Neither refusal transfers, for two reasons that are facts about
 * this slice rather than preferences:
 *
 *   - WHAT AN ENTRY COSTS. An activity entry is four booleans plus a bounded id; a roster entry is
 *     daemon-capped at 8 rows inside a 65519-byte envelope. A timeline slice is a whole thread of
 *     assistant text with no wire-side ceiling on its length. "Not a plausible exhaustion vector" is
 *     load-bearing for those two and false for this one.
 *   - WHAT CLEARS IT. Both siblings empty wholesale on the `connected` edge, so a reconnect is a floor.
 *     A timeline must SURVIVE a reconnect, so #757's clears are the pairing boundary and a conversation
 *     deletion only. This map has no periodic floor and grows across a long-lived pairing.
 *
 * What it bounds is the NUMBER of slices, not their bytes. A hostile daemon inside the session can grow
 * one thread without limit via `assistantDelta`; this store does not introduce that exposure — today's
 * flat `timelineStore` holds exactly the same unbounded single thread — it multiplies the worst case by
 * at most ten, which is the cost of the behaviour asked for. A per-slice byte cap has UI consequences
 * (which rows to drop) that belong in their own ticket, and would be a change to `reduceTimeline`.
 */
export const MAX_RETAINED_TIMELINES = 10

/** The whole state. A key ABSENT from the map means "nothing is held for that conversation" — no event
 *  has ever arrived and it was never opened, or it was evicted — and is a DISTINCT state from a present
 *  empty slice ("observed; nothing in the thread"). See `selectTimelineFor`, which preserves that
 *  distinction rather than collapsing it. `ReadonlyMap` signals the write paths REPLACE the map, never
 *  mutate it in place, is what makes the hostile-key property hold (see the header), and is also what
 *  makes the bound enforceable, since `size` is a real count. */
export interface ConversationTimelineState {
  timelines: ReadonlyMap<string, TimelineState>
}

/** Store shape = state + the two write paths.
 *
 *  `dispatchFor`, NOT `dispatch`: the flat store's write path is `dispatch(event)` with one argument
 *  (timelineStore.ts:25), and a same-name-different-shape pair in one directory is the trap
 *  conversationActivityStore.ts:64-67 documents for `apiRetry`. The `For` suffix also pairs it with
 *  `selectTimelineFor`.
 *
 *  `markViewed` is the "this conversation was made active" write path, DISTINCT from folding an event
 *  in, because a conversation working in the background is written constantly and viewed never;
 *  evicting on write order would throw away exactly the thread the operator stepped away from.
 *
 *  Two named write paths rather than a reducer over a keyed action union: a fold and a view-stamp are
 *  two independent operations, so a discriminated-union action set is ceremony without benefit (the
 *  twin's posture). There is deliberately NO generic `write(id, key, value)`, which would reintroduce a
 *  stringly-typed key beside the one hostile string this store exists to contain. */
export type ConversationTimelineStore = ConversationTimelineState & {
  dispatchFor: (conversationId: string, event: ThreadEvent) => void
  markViewed: (conversationId: string) => void
}

export const initialConversationTimelineState: ConversationTimelineState = { timelines: new Map() }

/**
 * THE EVICTION INVARIANT — the map's ITERATION ORDER *is* the eviction order, and the head is the next
 * slice to go. Three rules maintain it and nothing else re-orders:
 *
 *   1. A fold into a key ALREADY PRESENT replaces its value and does NOT move it (`Map.set` on an
 *      existing key preserves its position — that is what makes "written, not viewed" fail to protect).
 *   2. A fold that CREATES a key inserts it at the HEAD, ahead of every slice already held.
 *   3. `markViewed(id)` moves the key to the TAIL, creating it there if absent.
 *
 * The consequence is the whole policy: every never-viewed slice sits ahead of every viewed slice, and
 * the viewed ones are ordered least-recently-viewed first. So the victim is a never-viewed slice
 * whenever one exists, and otherwise the least recently viewed.
 *
 * WHY NEVER-VIEWED RANKS OLDEST is a security decision, not a taste one. A noisy or hostile relay
 * fanning frames for ids the operator has never opened mints an entry per id. If new keys entered at the
 * TAIL, N unknown ids would evict N viewed threads and the bound would become the mechanism that
 * destroys the operator's chats rather than the thing protecting them. Entering at the head makes the
 * newest never-viewed slice the standing eviction candidate, so an unbounded burst of unknown ids
 * displaces AT MOST ONE viewed slice and thereafter evicts only its own predecessors. The second reason
 * is that there is no backfill: discarding a never-viewed slice discards content the operator has never
 * seen, which is not symmetric with discarding a thread he was reading. The structural backbone: THE
 * DAEMON CAN ONLY EVER INSERT AT THE HEAD, AND ONLY THE OPERATOR CAN MOVE A KEY TO THE TAIL —
 * `dispatchFor` is the daemon-driven path and never promotes, while `markViewed` is renderer-local,
 * reachable only from the operator's own activation. The protected region is populated by operator
 * action alone.
 *
 * Ordering data comes ONLY from write and view sequence. The id's VALUE must never influence eviction:
 * no sorting of keys, no comparison, no normalisation, lowercasing, trimming or length check anywhere. A
 * lexicographic sort would hand a hostile id (`''` sorts first) the choice of which conversation dies.
 */

/** Rule 2 — insert a NEWLY CREATED slice at the head, evicting the current head first when the map is
 *  already at the bound. `Map` has no insert-at-head operator, so this REBUILDS: a fresh map, the new
 *  key set first, then every survivor set in iteration order. At a bound of ten that is trivially cheap.
 *
 *  Eviction happens BEFORE the insert, against the map as held, so a newcomer can never be its own
 *  victim. It removes the key entirely, so an evicted conversation reads as ABSENT again rather than as
 *  an empty slice — honest, because nothing is held.
 *
 *  Every survivor is copied BY REFERENCE, so `next.get(otherId)` is `Object.is`-identical to
 *  `previous.get(otherId)`; with a selector that hands back the held slice itself, a component watching
 *  another conversation does not re-render (backgroundTaskRosterStore.ts:415-417 states exactly this
 *  property). That is the whole of AC3, and it must survive this rebuild as well as the plain clone. */
function withNewSliceAtHead(
  timelines: ReadonlyMap<string, TimelineState>,
  conversationId: string,
  slice: TimelineState
): ReadonlyMap<string, TimelineState> {
  const next = new Map<string, TimelineState>([[conversationId, slice]])
  let evicting = timelines.size >= MAX_RETAINED_TIMELINES
  for (const [id, held] of timelines) {
    // The head, and only the head, is dropped — `evicting` falls on the first iteration either way.
    if (evicting) {
      evicting = false
      continue
    }
    next.set(id, held)
  }
  return next
}

/** Rule 3 — put a slice at the tail, whether it was already held (a MOVE, size unchanged) or not (a
 *  CREATE, which evicts the head first when at the bound). Same rebuild discipline and same
 *  by-reference copy of every survivor as `withNewSliceAtHead`. */
function withSliceAtTail(
  timelines: ReadonlyMap<string, TimelineState>,
  conversationId: string,
  slice: TimelineState
): ReadonlyMap<string, TimelineState> {
  // Only a write that CREATES a key can exceed the bound; a move re-orders and does not grow. The
  // guard reads `has`, so the head being dropped is never the key being moved.
  let evicting = !timelines.has(conversationId) && timelines.size >= MAX_RETAINED_TIMELINES
  const next = new Map<string, TimelineState>()
  for (const [id, held] of timelines) {
    if (evicting) {
      evicting = false
      continue
    }
    if (id !== conversationId) next.set(id, held)
  }
  next.set(conversationId, slice)
  return next
}

/** The tail key, or `undefined` for an empty map — "who was viewed most recently". `undefined` is never
 *  `===` a string, so `''` compares correctly rather than aliasing the empty-map reading. */
function tailKey(timelines: ReadonlyMap<string, TimelineState>): string | undefined {
  let tail: string | undefined
  for (const id of timelines.keys()) tail = id
  return tail
}

/**
 * DI-friendly, React-free store — one isolated instance per test.
 *
 * `dispatchFor` folds one event into one conversation's slice, creating the slice from
 * `initialTimelineState` when the key is absent. Three branches:
 *
 *   - KEY PRESENT, THE REDUCE CHANGED NOTHING (`reduceTimeline` hands back the same reference — an
 *     orphan or duplicate `toolResult` is the live example, threadTimeline.ts:345-346) → return the
 *     state OBJECT itself, so zustand's `Object.is` short-circuit fires and no subscriber wakes. No map
 *     is cloned either.
 *   - KEY PRESENT, THE REDUCE CHANGED SOMETHING → clone the outer map and `set` the key, whose position
 *     is preserved (rule 1).
 *   - KEY ABSENT → ALWAYS create, even when the fold is a no-op against `initialTimelineState`: "a fold
 *     for an id the client has never opened creates that id's slice rather than dropping it" is
 *     unconditional, and the twin's guard has the same property for a first write of `false`
 *     (conversationActivityStore.ts:148-152).
 *
 * `markViewed` stamps a conversation as most recently viewed. Three branches:
 *
 *   - ALREADY THE MOST RECENTLY VIEWED (the tail) → the state object itself, no churn. The COMMON case
 *     rather than an edge one: `onOpen` fires for every row click including a re-click of the
 *     already-active row (activateConversation.ts:42).
 *   - PRESENT, NOT THE TAIL → moved to the tail; size unchanged, so nothing is evicted.
 *   - ABSENT → created at the tail seeded with `initialTimelineState`, evicting the head first when at
 *     the bound. Creating on an absent key is LOAD-BEARING rather than a convenience: at the #758 seam
 *     the operator opens a conversation BEFORE any event for it has arrived, so a no-op here would let a
 *     later fold create the slice AT THE HEAD, making the conversation currently on screen the next
 *     eviction victim — precisely the failure the word "viewed" exists to prevent.
 *
 * Seeding a new slice with the shared `initialTimelineState` reference is safe BECAUSE `reduceTimeline`
 * IS PURE — it always builds fresh arrays and never mutates `items` in place. An in-place `items.push`
 * anywhere in that reducer would silently alias every empty slice.
 *
 * Every write is a synchronous `set` under zustand's own store lock with no `await` inside it, so there
 * is no check-then-act gap across a suspension point for a concurrent handler to interleave into.
 * Unidirectional is preserved: one read-only selector, two store-owned write paths, and neither is
 * two-way-bound from a component. The bound is enforced on writes, not at construction: an injected
 * `init` is trusted test input and is not re-checked.
 */
export function createConversationTimelineStore(
  init: ConversationTimelineState = initialConversationTimelineState
) {
  return createStore<ConversationTimelineStore>((set) => ({
    ...init,
    dispatchFor: (conversationId, event) =>
      set((s) => {
        const held = s.timelines.get(conversationId)
        if (held === undefined) {
          return {
            timelines: withNewSliceAtHead(
              s.timelines,
              conversationId,
              reduceTimeline(initialTimelineState, event)
            )
          }
        }
        const folded = reduceTimeline(held, event)
        if (folded === held) return s
        const next = new Map(s.timelines)
        next.set(conversationId, folded)
        return { timelines: next }
      }),
    markViewed: (conversationId) =>
      set((s) => {
        if (tailKey(s.timelines) === conversationId) return s
        return {
          timelines: withSliceAtTail(
            s.timelines,
            conversationId,
            s.timelines.get(conversationId) ?? initialTimelineState
          )
        }
      })
  }))
}

/** App-wide singleton — the one source of truth #756 writes, #757 clears and #758 reads. */
export const conversationTimelineStore = createConversationTimelineStore()

/** Narrow-slice React binding for #758. Selecting a single conversation's slice avoids cross-facet
 *  re-renders. */
export function useConversationTimelineStore<T>(selector: (s: ConversationTimelineStore) => T): T {
  return useStore(conversationTimelineStore, selector)
}

/**
 * The only read surface — a selector FACTORY bound to one `conversationId`.
 *
 * `?? null` is the `selectRosterFor` / `selectActivityFor` posture
 * (backgroundTaskRosterStore.ts:395-424), adopted rather than re-derived. The three readings stay
 * distinct:
 *
 *   key absent                       → `null`       nothing is held — no event has ever arrived and it
 *                                                   was never opened, or it was evicted
 *   `initialTimelineState`-shaped    → that slice   observed; nothing in the thread
 *   populated slice                  → that slice   observed; rows held
 *
 * `null` is a STABLE reference by construction, so no hoisted `EMPTY_*` constant is needed and no fresh
 * object is built per selector call — it hands back the HELD SLICE ITSELF. The nullable return type
 * forces #758 to branch, so the distinction cannot be ignored accidentally. `?? initialTimelineState` at
 * a read site is the collapse the header bans.
 *
 * A bare `Map.get` with `?? null` is also what makes an unknown id an EXPLICIT no-match that can never
 * resolve onto a neighbour's slice — the misattribution #751-#754's required `conversationId` was
 * introduced to push down here.
 *
 * There is deliberately no whole-map `selectAllTimelines`, and no re-export of `selectItems` /
 * `selectPhase` / the chrome selectors: a caller branches on `null` and then applies the existing
 * `threadTimeline` selectors to the slice. Shipping a whole-map read surface nothing reads would ship an
 * unread read surface (the backgroundTaskRosterStore.ts:418-419 rule).
 */
export const selectTimelineFor =
  (conversationId: string) =>
  (s: ConversationTimelineState): TimelineState | null =>
    s.timelines.get(conversationId) ?? null
