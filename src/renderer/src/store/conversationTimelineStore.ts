// A WHOLE TIMELINE per conversation id (#755, split from #675) — so leaving a chat and coming back does
// not throw the thread away. Pure renderer state: no IPC, no preload bridge, no transport, no async
// task, no timer, no teardown.
//
// Since #756 this slice has a WRITER and still no reader. `timelineStore.ts` — the single flat timeline
// belonging to whichever conversation is open — stays exactly as it is and keeps serving the screens,
// receiving every event it received before; the two writes run side by side (Strangler Fig, ADR 0008),
// which is what lets the routing land and be verified as a no-op before anything the operator sees
// moves. The writers are `timelineBridge.ts`'s fan-out and the composer's optimistic echo
// (composerSend.ts) — the timeline's only two row-adding writers. Nine of the bridge's eleven owned
// arms route here; the other two (`sessionTransition`, `connected`) carry no
// conversation id, so they reach the flat store only.
//
// #757 built the clears and WIRED them — `clearAllTimelines` at the pairing boundary and
// `clearTimelineFor` on a conversation deletion — NOT the `connected` edge, because a thread must
// survive a reconnect. #786 wired the last write path, `markViewed`, at the activation seam
// (activateConversation.ts's `markViewed` effect, the one production construction of it in
// PairedShell.tsx), which is what ARMS the bound: until then every slice was never-viewed, so eviction
// order was pure creation-recency and degraded to first-write order. #758 remains the READER cutover and
// now depends on this rather than performing it.
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
// HARD IMPORT CONSTRAINT, checkable by grep: this module's only imports are the four below, one of them
// type-only. It imports nothing from `activeConversationStore`, nothing from `./timelineStore`, and
// nothing from `src/renderer/src/screens/`. With no reference to the open conversation in scope, the
// `?? activeConversation` fallback that #751-#754's REQUIRED `conversationId` was designed to prevent is
// not something a developer must remember to avoid — it is unavailable. #1259's fourth import is a
// TYPE-ONLY `HistoryRequestFailure` from `@shared/ipc/events`, needed because this slice now holds the
// refusal that settled a conversation's opening ask; a string union carries no value into scope and
// leaves the property above exactly as strong as it was. The rule to re-run when widening this list is
// that one, not the count: nothing that puts the OPEN CONVERSATION in scope may be importable here.
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
import type { HistoryRequestFailure } from '@shared/ipc/events'
import {
  reduceTimeline,
  initialTimelineState,
  type TimelineState,
  type ThreadEvent,
  type ThreadItem
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

/**
 * Where one conversation's OPENING HISTORY ASK stands (#1259) — held beside the timeline it describes,
 * inside the same slice, so it dies with it. Four readings, and the fourth is the absence of this value:
 *
 *   `null` / absent key  never asked — or asked, drawn, and then EVICTED. Those two are deliberately the
 *                        same reading, and that identity is the whole of #1259's AC3: a re-opened
 *                        conversation whose slice was evicted asks again and refills, where one that
 *                        still holds its page does not.
 *   `requested`          an ask is on the wire and has not been answered. Terminal against a relay that
 *                        withholds the frame, and that is deliberate — see `markHistoryRequested`.
 *   `loaded`             a page was served. `cursor` and `atStart` are carried AS SENT for the
 *                        scroll-back walk (#1260) and are read by nothing today.
 *   `failed`             the ask was refused. All six members of `HistoryRequestFailure` settle here
 *                        identically; nothing branches on `reason` in this file or in its consumer.
 *
 * `retryable` IS RECORDED AND NEVER READ HERE. Its docblock on `historyRequestFailed` is explicit that
 * the flag is computed at the single emit so a walk driver cannot re-derive it wrong into a retry loop
 * against a relay that is merely withholding a frame. Storing it keeps that one computation
 * authoritative; acting on it is #1260's, and there is no timer, no backoff and no automatic re-ask
 * anywhere in this slice.
 *
 * `cursor` IS OPAQUE AND IS NOT A CAPABILITY. It is stored verbatim and never parsed, never compared,
 * never concatenated, never a `Map` key, a lookup path, a filename or a log field — and never reused
 * across conversations, which holding it per-slice makes structural rather than a rule to remember. The
 * daemon merges its three cursor failure causes into one indistinguishable answer on purpose; the
 * repair for all three is restarting with an empty cursor, so there is nothing here to tell apart.
 */
export type HistoryRequestState =
  | { status: 'requested' }
  | { status: 'loaded'; cursor: string; atStart: boolean }
  | { status: 'failed'; reason: HistoryRequestFailure; retryable: boolean }

/**
 * What one key holds: the thread, and the state of the ask that backfilled it (#1259).
 *
 * ONE OBJECT UNDER ONE KEY, rather than a second `ReadonlyMap` beside `timelines`. The request state
 * must die with the timeline it describes, and a satellite map would need the key dropped in four
 * separate places — both eviction helpers and both clears — to keep that true, where a missed one is a
 * per-id leak keyed by daemon-supplied strings. Wrapping makes the property structural: one keyspace,
 * one eviction order, nothing to keep in step.
 *
 * `selectTimelineFor`'S SIGNATURE DID NOT MOVE for this — it projects `.timeline` and still returns
 * `TimelineState | null` — so every read site, the banned `?? initialTimelineState` rule and the
 * three-reading table below stand unedited, and the by-reference survivor copy in the two rebuild
 * helpers still hands back the identical slice object and therefore the identical `TimelineState`.
 */
export interface ConversationSlice {
  timeline: TimelineState
  history: HistoryRequestState | null
  /**
   * How many rows a served history page has ever PREPENDED onto `timeline.items` for this conversation
   * (#1260) — a monotonically rising count, never reset while the slice lives.
   *
   * ⭐ IT EXISTS FOR ONE CONSUMER AND IT IS NOT A STATISTIC: `Timeline` keys its item rows by array
   * index, on the stated premise that the list "never inserts or reorders mid-list". A history prepend is
   * exactly that insertion, and under index keys it makes React update every already-drawn row IN PLACE
   * with a different item's content — after which Chromium's scroll anchoring compensates by the wrong
   * delta, because its anchor node never moved, it merely started rendering a different message. Offset
   * by this count, a row's key names its position from the CONVERSATION'S ORIGIN rather than from the
   * head of the held array, which is stable under both mutations this list performs: an append leaves the
   * count alone so the streaming tail bubble is not remounted, and a prepend of N raises it by N while
   * every surviving row's index rises by N, so their keys do not move.
   *
   * It lives on the SLICE rather than on `TimelineState` for the reason `history` beside it does: it has
   * to die with the timeline it describes, and membership of the slice makes that structural rather than
   * maintained. `ConversationSlice` is also constructed in three places, all in this file, where
   * `TimelineState` is the render model the whole screen and thirty-odd specs build.
   */
  prependedRows: number
  /**
   * The (`type`, `ts`) keys this conversation's LIVE lane has already DRAWN (#1225) — the live half of
   * the history join, read by `withoutLiveEntries` when a served page arrives so an entry both lanes
   * carry draws once instead of twice.
   *
   * ⭐ A KEY IS RECORDED ONLY WHERE THE FOLD CHANGED SOMETHING, IN BOTH OF `dispatchFor`'s BRANCHES —
   * the update branch's same-reference short-circuit and the create branch's own comparison against
   * `initialTimelineState`, which an orphan `toolResult` reaches whenever it is the first live frame held
   * for its conversation. That is the whole safety argument of the join rather than an optimisation: a
   * dedup on remote input is a suppression primitive, so a key must never exist for an event the operator
   * was never shown. It is also why the key rides `dispatchFor` instead of being written by a second
   * store path, which could not see whether the fold took.
   *
   * BOUNDED AT `MAX_LIVE_JOIN_KEYS`, OLDEST EVICTED FIRST. A `Set` preserves insertion order, so the
   * oldest key is the first one it yields. Oldest-first is the right direction because the NEWEST page —
   * the one the opening ask draws — overlaps the NEWEST live keys, and every consequence of evicting too
   * eagerly is a duplicate row rather than a dropped one.
   *
   * A `Set`, NEVER a bare object: half of every key is a daemon-supplied string, and a `__proto__`-shaped
   * one would write through `Object.prototype` on a plain-object index. It lives on the SLICE for the
   * reason `history` and `prependedRows` beside it do — it must die with the timeline it describes, and
   * membership of the slice makes that structural rather than four separate deletions to keep in step.
   * No key of it becomes a lookup path, a filename, a URL, a React key or a log field.
   */
  liveKeys: ReadonlySet<string>
}

/**
 * How many live join keys one conversation retains (#1225). Chosen to comfortably exceed the entry count
 * of any single page this client asks for — it sends `limit: 0`, "you choose", and the daemon's answer
 * is bounded by its own frame cap — so the opening ask's page can be fully joined against what the live
 * lane drew while it was in flight.
 *
 * IT IS A MEMORY BOUND ON REMOTE-KEYED STATE, and the number is a trade rather than a limit the protocol
 * imposes: `MAX_RETAINED_TIMELINES` slices each holding this many keys of at most
 * `MAX_JOIN_TS_CHARS` + a type tag is the whole footprint this join adds. Set it too low and a page
 * overlapping older live rows draws some of them twice; set it too high and a conversation streaming in
 * the background retains keys nothing will ever join against. Both failures are cosmetic, and the low
 * side is the one that fails OPEN.
 */
export const MAX_LIVE_JOIN_KEYS = 512

/** The empty key set every fresh slice starts from — one frozen reference, safe for the same reason
 *  `emptySlice` below shares one: `withJoinKey` REPLACES rather than mutating. */
const NO_LIVE_KEYS: ReadonlySet<string> = new Set()

/**
 * `held` plus `joinKey`, bounded at `MAX_LIVE_JOIN_KEYS` by dropping the OLDEST key (#1225). Hands back
 * the SAME reference when there is no key to add, so a fold that carries none allocates nothing and
 * `dispatchFor`'s slice spread stays cheap on the streaming path.
 *
 * A `Set` yields its keys in insertion order, so the first one it yields is the oldest — which is why the
 * eviction needs no separate queue. Re-adding a key already held is a no-op on the set and therefore does
 * NOT refresh its position; that is harmless here, because the daemon mints one timestamp per logical
 * event, so a repeat is a duplicate rather than a fresh fact. Replaced, never mutated: the store's write
 * paths all copy-on-write, and a mutated set would alias every slice that shares this reference.
 */
function withJoinKey(
  held: ReadonlySet<string>,
  joinKey: string | undefined
): ReadonlySet<string> {
  if (joinKey === undefined || held.has(joinKey)) return held
  const next = new Set(held)
  next.add(joinKey)
  while (next.size > MAX_LIVE_JOIN_KEYS) {
    const oldest = next.values().next()
    if (oldest.done === true) break
    next.delete(oldest.value)
  }
  return next
}

/** A slice for a conversation nothing is yet held for: an empty thread and no ask. Sharing one frozen
 *  reference is safe for the reason the seeding note below gives — `reduceTimeline` is pure and every
 *  write path here replaces rather than mutates. */
const emptySlice: ConversationSlice = {
  timeline: initialTimelineState,
  history: null,
  prependedRows: 0,
  liveKeys: NO_LIVE_KEYS
}

/** The whole state. A key ABSENT from the map means "nothing is held for that conversation" — no event
 *  has ever arrived and it was never opened, or it was evicted — and is a DISTINCT state from a present
 *  empty slice ("observed; nothing in the thread"). See `selectTimelineFor`, which preserves that
 *  distinction rather than collapsing it. `ReadonlyMap` signals the write paths REPLACE the map, never
 *  mutate it in place, is what makes the hostile-key property hold (see the header), and is also what
 *  makes the bound enforceable, since `size` is a real count. */
export interface ConversationTimelineState {
  timelines: ReadonlyMap<string, ConversationSlice>
}

/** Store shape = state + the four write paths.
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
 *  The two clears (#757) are likewise distinct from each other, and the difference is which edge fired.
 *  `clearAllTimelines` is the PAIRING BOUNDARY: conversation ids are scoped to the server that issued
 *  them, so every retained thread is invalidated at once and a slice from server A must never be keyed
 *  under an id server B later reuses. It is NULLARY BY DESIGN — "takes no conversation id at all" is a
 *  property of this signature, so `tsc` enforces it rather than a test, and no daemon-supplied id can
 *  craft a slice that survives the boundary. `clearTimelineFor` is ONE conversation being deleted or
 *  archived out from under the operator, whose other threads are still live and still his. The naming
 *  diverges from the twin's `dropConversation` (conversationActivityStore.ts:214) deliberately: this
 *  file already has a `For` family whose suffix rationale is above, and `All` is kept from
 *  `clearAllActivity` so the blast radius is legible at the call site rather than only in the docstring.
 *
 *  Four named write paths rather than a reducer over a keyed action union: a fold, a view-stamp and two
 *  clears are independent operations, so a discriminated-union action set is ceremony without benefit
 *  (the twin's posture). There is deliberately NO generic `write(id, key, value)`, which would
 *  reintroduce a stringly-typed key beside the one hostile string this store exists to contain.
 *
 *  `prependHistoryFor` (#1223) is the fifth, and the one that takes ROWS rather than an event. That is
 *  not a shortcut around `dispatchFor`: a served page is not one event, and every arm of
 *  `reduceTimeline` appends, so a page reduced INTO a held slice would land its rows behind the rows
 *  already there — backwards. The page is folded to rows first (`historyPageBridge.reduceHistoryPage`,
 *  against a scratch state) and this path puts them at the HEAD. Splitting it that way is also what
 *  makes AC3 structural: rows are all that crosses, so no stored `turn_state`, `stall`, `api_retry` or
 *  `compacting` entry can move the five chrome scalars the live lane owns.
 *
 *  #1259 adds THREE MORE, and they are the first that write the slice's second half rather than its
 *  timeline. `markHistoryRequested` is the ask going out, `recordHistoryPage` the page coming back and
 *  `recordHistoryFailure` the refusal that settles it instead. They are three rather than one keyed
 *  reducer for the reason the four above are: they are independent operations, and a discriminated
 *  action set would be ceremony. All three are ABSENT-KEY NO-OPS — see their implementations. */
export type ConversationTimelineStore = ConversationTimelineState & {
  // #1225 adds the OPTIONAL trailing `joinKey` — the live half of the history join key, recorded on the
  // slice only when the fold below actually changes the timeline. Optional and trailing for
  // `subscribeTimeline`'s own #756/#1013 reason: a required parameter cascades over every existing call
  // site, an optional one over none. Absent means this event contributes no key, which is the correct
  // reading for an arm the emit did not stamp and the fail-open default everywhere else.
  dispatchFor: (conversationId: string, event: ThreadEvent, joinKey?: string) => void
  prependHistoryFor: (conversationId: string, items: readonly ThreadItem[]) => void
  markHistoryRequested: (conversationId: string) => void
  recordHistoryPage: (conversationId: string, cursor: string, atStart: boolean) => void
  recordHistoryFailure: (
    conversationId: string,
    reason: HistoryRequestFailure,
    retryable: boolean
  ) => void
  markViewed: (conversationId: string) => void
  clearAllTimelines: () => void
  clearTimelineFor: (conversationId: string) => void
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
 * Neither #757 clear is an exception. A removal re-orders nothing: `Map.prototype.delete` preserves
 * the position of every remaining entry, and dropping the whole map leaves nothing left to order.
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
 * seen, which is not symmetric with discarding a thread he was reading. The structural half of that, and
 * it is unchanged: THE DAEMON CAN ONLY EVER INSERT AT THE HEAD — `dispatchFor` is the daemon-driven path
 * and never promotes — so everything above holds for the frame fan-out exactly as written.
 *
 * WHAT IS NOT TRUE, AND WAS BEFORE #786: that only the operator can move a key to the tail. `markViewed`'s
 * one call site is the activation seam (activateConversation.ts), and of the three paths that reach it two
 * are the operator's own — a row click and a re-click of the row already open — while the third is the
 * daemon's own `conversationCreated` confirmation, which `useConversationCreatedNav`
 * (conversationCreatedBridge.ts) activates on ungated. The tail is therefore NOT an operator-only region:
 * a compromised paired daemon emitting N `conversationCreated` frames mints N tail entries, each evicting
 * the head, and can displace EVERY viewed slice rather than the at-most-one the head-insert rule bounds
 * its fan-out to. Accepted rather than gated, on the actor: that is the paired daemon inside the Noise
 * session, which on the same path already resets the flat `timelineStore` the screen actually renders,
 * clears the session id and re-keys the pane, and which already owns the entire content stream. The relay
 * is content-blind and outside the session, so it cannot mint a `conversationCreated` at all.
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
  timelines: ReadonlyMap<string, ConversationSlice>,
  conversationId: string,
  slice: ConversationSlice
): ReadonlyMap<string, ConversationSlice> {
  const next = new Map<string, ConversationSlice>([[conversationId, slice]])
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
  timelines: ReadonlyMap<string, ConversationSlice>,
  conversationId: string,
  slice: ConversationSlice
): ReadonlyMap<string, ConversationSlice> {
  // Only a write that CREATES a key can exceed the bound; a move re-orders and does not grow. The
  // guard reads `has`, so the head being dropped is never the key being moved.
  let evicting = !timelines.has(conversationId) && timelines.size >= MAX_RETAINED_TIMELINES
  const next = new Map<string, ConversationSlice>()
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

/**
 * #1223 — drop from a page's rows every `userText` whose `messageId` a held `userText` already carries,
 * returning `page` UNCHANGED (same reference) when nothing matched, so a fully-duplicate page churns no
 * subscriber. The optimistic echo and the operator's stored `message` are the SAME message arriving by
 * two routes, and AC4 says they draw as one row.
 *
 * THE HELD ECHO WINS AND THE PAGE ROW IS DROPPED. The echo sits at its live position carrying the
 * operator's own `createdAt` stamp and its `attachments`; the replayed row has neither, and keeping it
 * instead would move the message earlier in the transcript and silently discard both fields.
 *
 * MATCHED BY A STRICT-EQUALITY SCAN, NEVER A `Set` OR A `Map` OF IDS, and that is a constraint rather
 * than a preference. A page's `messageId` is the id the SENDING client minted, stored by the daemon and
 * replayed — untrusted, unlike the held echo's, which this window minted itself — and the field's
 * contract on the `userText` item (`threadTimeline.ts`) binds it to strict string equality only, never
 * a lookup path, a cache key, a filename, a URL, a Map key or a React key. A keyed collection of them
 * is exactly what that clause names, whatever its prototype safety. `removeUserEcho` already matches
 * this way; this is its shape one array over. Both arrays are small and bounded, and `fillResult`
 * already scans linearly per tool result.
 *
 * An ABSENT or EMPTY id never matches, on either side: `undefined === undefined` would collapse every
 * id-less replayed row against the first id-less echo, and the `kind === 'userText'` guard is what keeps
 * a daemon-authored row — a tool call, a boundary, an assistant bubble — structurally out of this branch
 * whatever the wire says. Nothing here compares text: two rows with different ids and identical text are
 * two messages.
 */
function withoutHeldEchoes(
  page: readonly ThreadItem[],
  held: readonly ThreadItem[]
): readonly ThreadItem[] {
  const isHeld = (messageId: string): boolean =>
    held.some((item) => item.kind === 'userText' && item.messageId === messageId)
  const next = page.filter(
    (item) =>
      !(
        item.kind === 'userText' &&
        item.messageId !== undefined &&
        item.messageId !== '' &&
        isHeld(item.messageId)
      )
  )
  return next.length === page.length ? page : next
}

/** #1259 — the body all three request-state paths share: replace the `history` half of a HELD slice,
 *  leaving its `timeline` half and the map's order untouched, or hand back the state object when the
 *  key is absent. One helper rather than three copies of the same six lines, and one place for the
 *  absent-key rule to be read. It takes and returns the whole state so each caller stays a one-liner
 *  whose name is the entire difference between them. */
function withHistory(
  state: ConversationTimelineState,
  conversationId: string,
  history: HistoryRequestState
): ConversationTimelineState {
  const held = state.timelines.get(conversationId)
  if (held === undefined) return state
  const next = new Map(state.timelines)
  next.set(conversationId, { ...held, history })
  return { timelines: next }
}

/** The tail key, or `undefined` for an empty map — "who was viewed most recently". `undefined` is never
 *  `===` a string, so `''` compares correctly rather than aliasing the empty-map reading. */
function tailKey(timelines: ReadonlyMap<string, ConversationSlice>): string | undefined {
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
 *     the bound. Creating on an absent key is LOAD-BEARING rather than a convenience: at the #786 seam
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
 * Unidirectional is preserved: one read-only selector, four store-owned write paths, and none is
 * two-way-bound from a component. The bound is enforced on writes, not at construction: an injected
 * `init` is trusted test input and is not re-checked.
 */
export function createConversationTimelineStore(
  init: ConversationTimelineState = initialConversationTimelineState
) {
  return createStore<ConversationTimelineStore>((set) => ({
    ...init,
    dispatchFor: (conversationId, event, joinKey) =>
      set((s) => {
        const held = s.timelines.get(conversationId)
        if (held === undefined) {
          // A live reading can only update a retained call; it cannot create or evict a slice.
          if (event.type === 'toolProgress') return s
          // #1225 — the SLICE is created unconditionally (the invariant above), the KEY is not. The fold
          // is taken into a local so this branch asks the same question the update branch below asks: an
          // event whose fold against `initialTimelineState` changed nothing drew nothing, and a key for
          // a row the operator was never shown is exactly what the join must never hold.
          //
          // Reachable on `toolResult`, which is stamped and whose slice this frame may well create: the
          // relay resumes mid-tool-call, or `MAX_RETAINED_TIMELINES` evicted the slice, so the first live
          // frame held for the conversation is a result with no `tool_use` behind it. `threadTimeline`'s
          // `toolResult` arm hands back the same reference for that orphan, and a key recorded here would
          // let the served page's copy of the result be suppressed — the tool row then draws from history
          // permanently unfilled. The other arms that no-op against a fresh state (`turnState`,
          // `apiRetry`'s and `compacting`'s falling edges) are inert only because `reduceHistoryPage`
          // returns `items` and none of them touches `items`; that is not a property worth relying on.
          const created = reduceTimeline(initialTimelineState, event)
          return {
            timelines: withNewSliceAtHead(s.timelines, conversationId, {
              timeline: created,
              history: null,
              prependedRows: 0,
              liveKeys: withJoinKey(
                NO_LIVE_KEYS,
                created === initialTimelineState ? undefined : joinKey
              )
            })
          }
        }
        const folded = reduceTimeline(held.timeline, event)
        // #1225 — the same-reference short-circuit ALSO declines to record the join key, and that
        // ordering is the guard rather than a side effect: a fold that changed nothing drew nothing, so
        // a key minted here could suppress a served page's copy of a row neither lane ever showed.
        if (folded === held.timeline) return s
        const next = new Map(s.timelines)
        next.set(conversationId, {
          ...held,
          timeline: folded,
          liveKeys: withJoinKey(held.liveKeys, joinKey)
        })
        return { timelines: next }
      }),
    // #1223 — a page's rows land AHEAD of the rows already held. Three branches, mirroring
    // `dispatchFor`'s above:
    //
    //   - NOTHING TO ADD (an empty page, or one every row of which was a duplicate) → the state OBJECT
    //     itself, so zustand's `Object.is` short-circuit fires and no subscriber wakes. AC1's "an empty
    //     page adds no rows and no error banner" — there is no error path here at all.
    //   - KEY ABSENT → create through `withNewSliceAtHead`, `dispatchFor`'s unconditional-create branch:
    //     a page for a conversation the client has never opened creates that slice rather than dropping
    //     it. The rows go straight in; against an empty slice there is nothing to prepend them to.
    //   - KEY PRESENT → the held slice SPREAD with a new `items`. The spread is what carries `phase`,
    //     `stalled`, `apiRetry`, `compacting` and `localSendPending` through untouched (AC3): they are
    //     copied, never recomputed, so no future scalar added to `TimelineState` can be forgotten here.
    //
    // `conversationId` is REQUIRED and CLIENT-OWNED all the way from #1222's correlation, so there is no
    // absent-id case to resolve and no `?? openConversation` — the misattribution that field exists to
    // prevent. A hostile id is contained by the `Map` keyspace exactly as it is for the four paths
    // around this one.
    //
    // NOT IDEMPOTENT, and deliberately so: applying the same page twice prepends its rows twice, since
    // only `userText` rows carry a key to dedup on. Unreachable today — nothing asks for a page, and
    // #1222's correlation settles each request once — and the general answer needs the entry-level join
    // key #1225 owns, so a guard built here would be that join built early and wrong. #1224's walk must
    // not re-apply a page.
    prependHistoryFor: (conversationId, items) =>
      set((s) => {
        if (items.length === 0) return s
        const held = s.timelines.get(conversationId)
        if (held === undefined) {
          return {
            timelines: withNewSliceAtHead(s.timelines, conversationId, {
              timeline: { ...initialTimelineState, items },
              history: null,
              // A page drew these rows, the live lane did not, so there is no live key to seed: the
              // join's whole premise is that a key names something the operator has ALREADY seen.
              liveKeys: NO_LIVE_KEYS,
              // A create-at-head prepend lands on nothing, so these rows are the conversation's first
              // and their keys count from zero exactly as an appended row's would. Counting them here
              // would offset a list they are the whole of.
              prependedRows: 0
            })
          }
        }
        const fresh = withoutHeldEchoes(items, held.timeline.items)
        if (fresh.length === 0) return s
        const next = new Map(s.timelines)
        next.set(conversationId, {
          ...held,
          timeline: { ...held.timeline, items: [...fresh, ...held.timeline.items] },
          // `fresh.length`, NOT `items.length`: rows dropped by `withoutHeldEchoes` never entered the
          // list, so counting the ask rather than the insertion would shift every drawn row's key by the
          // number of echoes the page happened to duplicate.
          prependedRows: held.prependedRows + fresh.length
        })
        return { timelines: next }
      }),
    // #1259 — the three request-state paths. Each replaces the slice's `history` half and touches its
    // `timeline` half NOT AT ALL: the spread carries the held `TimelineState` across by reference, so a
    // component reading this conversation's rows is not woken by an ask being marked or settled.
    //
    // ALL THREE ARE ABSENT-KEY NO-OPS, and that is a design decision rather than defensiveness. The
    // reading has to die with the timeline it describes, so a slice minted by a history write alone
    // would be a timeline-less holder outliving the thing it describes — and it would enter at the
    // HEAD, making a conversation the daemon merely answered about the next eviction victim. It is also
    // unreachable on the ask path (`activateConversation` calls `markViewed`, which creates the slice,
    // before `requestConversationConfig`), and for a reply landing after an eviction the correct
    // outcome is exactly "nothing is held, ask again on the next opening" (AC3). The guard returns the
    // state OBJECT, so zustand's `Object.is` short-circuit fires and no subscriber wakes.
    //
    // NONE OF THE THREE RE-ORDERS THE MAP. They take `dispatchFor`'s key-present shape — clone the
    // outer map, `set` the key, position preserved by rule 1 of the eviction invariant — because a
    // history write is not a view: promoting on one would let the daemon's reply, rather than the
    // operator's attention, decide which thread survives the bound.
    markHistoryRequested: (conversationId) =>
      set((s) => withHistory(s, conversationId, { status: 'requested' })),
    // The page came back. `cursor` and `atStart` are carried AS SENT and never derived from each other:
    // an empty cursor with `atStart` true is the terminal page's published shape, and a short page says
    // nothing at all. Neither is read by this ticket — #1260's walk is their only future consumer.
    recordHistoryPage: (conversationId, cursor, atStart) =>
      set((s) => withHistory(s, conversationId, { status: 'loaded', cursor, atStart })),
    // The refusal. `reason` and `retryable` are COPIED, never branched on: all six members of
    // `HistoryRequestFailure` settle a conversation identically — it stops asking and nothing is drawn
    // — and `history-unavailable`'s retryability is recorded for #1260 rather than acted on here.
    recordHistoryFailure: (conversationId, reason, retryable) =>
      set((s) => withHistory(s, conversationId, { status: 'failed', reason, retryable })),
    markViewed: (conversationId) =>
      set((s) => {
        if (tailKey(s.timelines) === conversationId) return s
        return {
          timelines: withSliceAtTail(
            s.timelines,
            conversationId,
            s.timelines.get(conversationId) ?? emptySlice
          )
        }
      }),
    // The pairing boundary. Shaped after `clearAllActivity` (conversationActivityStore.ts:226), guard
    // included, and it deliberately does NOT hand back `initialConversationTimelineState.timelines`:
    // that exported constant holds a module-shared MUTABLE `Map`, so returning it as live state would
    // make every store instance that clears share one object. The `size === 0` guard is what buys the
    // idempotence returning a constant would have, and it is LOAD-BEARING rather than an optimisation:
    // clearPairingScopedState.ts:65-70 claims every one of its clears is idempotent by construction, so
    // a clear that always built a fresh `Map` would make that docstring false and churn a subscriber
    // for nothing. DELETE, never overwrite: `set(id, initialTimelineState)` type-checks identically and
    // would collapse "nothing is held" into "observed; nothing in the thread" — the exact distinction
    // :115-120 and `selectTimelineFor` exist to preserve.
    clearAllTimelines: () => set((s) => (s.timelines.size === 0 ? s : { timelines: new Map() })),
    // One conversation deleted or archived out from under the operator; his other threads are still
    // live and still his. Same clone-then-delete-on-the-clone shape as the twin's `dropConversation`
    // (conversationActivityStore.ts:214-220) — never `s.timelines.delete(...)`, which would mutate the
    // held map. `new Map(s.timelines)` copies references, so every survivor is `Object.is`-identical to
    // the object held before and a component watching another conversation is not woken.
    //
    // `has` rather than `get(...) !== undefined`: both work and `has` states the intent. It is not a
    // derivation from the id's SHAPE either — the same presence lookup `withSliceAtTail` performs at
    // :218 — so `has`, `delete`, `size` and `new Map(...)` are this pair's whole vocabulary and the
    // header's hostile-key property carries over untouched: `Map.prototype.has('__proto__')` and
    // `.delete('__proto__')` perform no prototype-chain lookup. The absent-key guard returns the state
    // OBJECT so zustand's `Object.is` short-circuit fires, and that is the COMMON case rather than an
    // edge one — the exit fires for every deletion and most conversations hold no slice.
    clearTimelineFor: (conversationId) =>
      set((s) => {
        if (!s.timelines.has(conversationId)) return s
        const next = new Map(s.timelines)
        next.delete(conversationId)
        return { timelines: next }
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
    s.timelines.get(conversationId)?.timeline ?? null

/**
 * #1259's read surface — where one conversation's OPENING ASK stands, or `null` when nothing is held.
 *
 * The `?? null` here carries MORE than `selectTimelineFor`'s, because the two `null`s the `?.` and the
 * `??` produce are the same reading on purpose: "no slice at all" and "a slice that has never asked"
 * both mean ASK NOW. That collapse is deliberate and is the whole of AC3 — an evicted conversation is
 * indistinguishable from one never opened, so re-opening it refills from history instead of reading a
 * stale `loaded` and staying empty forever. Do not split the two.
 *
 * A bare `Map.get` again, so an unknown id is an EXPLICIT no-match that can never resolve onto a
 * neighbour's reading, and the hostile-key property of the keyspace carries over untouched.
 *
 * `HistoryRequestState` is handed back BY REFERENCE and must be treated as frozen: it is replaced,
 * never mutated. There is deliberately no `selectHistoryCursorFor` and no boolean
 * `selectIsAwaitingPage` — a caller branches on `status`, which keeps every reading in view at each
 * call site instead of collapsing four into two and losing the one the next consumer needs.
 */
export const selectHistoryRequestFor =
  (conversationId: string) =>
  (s: ConversationTimelineState): HistoryRequestState | null =>
    s.timelines.get(conversationId)?.history ?? null

/**
 * #1260's read surface — how many rows history has prepended onto this conversation, for the row key the
 * slice's own field explains.
 *
 * `?? 0` COLLAPSES rather than preserving, and unlike `selectHistoryRequestFor`'s `?? null` that is the
 * whole point: "no slice at all" and "a slice nothing has been prepended to" are the same fact for a key
 * offset, because a list that was never prepended to counts from zero either way. A caller reading this
 * is asking where the first row's key starts, never whether a conversation is held — `selectTimelineFor`
 * answers that and is the one that must stay nullable.
 *
 * A bare `Map.get` again, so an unknown id is an explicit no-match that can never resolve onto a
 * neighbour's count, and the hostile-key property of the keyspace carries over untouched.
 */
export const selectPrependedRowsFor =
  (conversationId: string) =>
  (s: ConversationTimelineState): number =>
    s.timelines.get(conversationId)?.prependedRows ?? 0

/**
 * #1225's read surface — the (`type`, `ts`) keys this conversation's live lane has drawn, for the join
 * `withoutLiveEntries` performs when a served page arrives. An absent key reads as the EMPTY set rather
 * than `null`, and that collapse is right where `selectTimelineFor`'s would be wrong: "nothing is held"
 * and "nothing has been drawn" both mean the same thing to the join — suppress nothing — so there is no
 * distinction for a consumer to lose. The hostile-key property of the keyspace carries over untouched.
 */
export const selectLiveJoinKeysFor =
  (conversationId: string) =>
  (s: ConversationTimelineState): ReadonlySet<string> =>
    s.timelines.get(conversationId)?.liveKeys ?? NO_LIVE_KEYS
