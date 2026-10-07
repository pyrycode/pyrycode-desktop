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
import { MAX_CHAT_HISTORY_ITEMS, parseChatHistorySnapshot, type ChatHistorySnapshot, type HistoryGap } from '@shared/chatHistory'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { reconcileHistory } from './historyContributions'
import type { HistoryTimelineEntry, HistoryRequestFailure } from '@shared/ipc/events'
import type { QueuedItem } from '@shared/wire/types'
import {
  reduceTimeline,
  reduceRetainedTimelineEvent,
  markLocalSendQueued,
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

/** Transient page request state. Successful coverage lives separately on the slice,
 * so failure or interruption never resets the next cursor. Cursors remain opaque
 * payload values and never enter paths, URLs, React keys or diagnostics. */
export type HistoryRequestState =
  | { status: 'requested'; cursor?: string; purpose?: 'older' | 'newest' | 'gap'; gapId?: number }
  | { status: 'loaded'; cursor: string; atStart: boolean }
  | { status: 'failed'; reason: HistoryRequestFailure; retryable: boolean; cursor?: string; purpose?: 'older' | 'newest' | 'gap'; gapId?: number }

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
type SavedTimeline = Extract<ChatHistorySnapshot, { kind: 'timeline' }>

export interface ConversationSlice {
  serverId?: string
  localRead?: 'loading' | 'loaded' | 'failed'
  /** Request identity survives transient notice changes; never persisted. */
  localReadOwner?: symbol
  /** Explicit admission evidence for the writer; never a received event. */
  restored?: Pick<SavedTimeline, 'serverId' | 'coverage'>
  timeline: TimelineState
  history: HistoryRequestState | null
  /** Last successful page coverage, independent of transient request status. */
  coverage?: SavedTimeline['coverage']
  served?: SavedTimeline['served']
  display?: SavedTimeline['display']
  gaps?: SavedTimeline['gaps']
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
 * of any single page this client asks for — it sends `HISTORY_PAGE_LIMIT` (200), and the daemon's answer
 * is bounded by that and by its own frame cap — so the opening ask's page can be fully joined against what
 * the live lane drew while it was in flight.
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
  initializeCreatedTimeline: (serverId: string, conversationId: string) => void
  // #1225 adds the OPTIONAL trailing `joinKey` — the live half of the history join key, recorded on the
  // slice only when the fold below actually changes the timeline. Optional and trailing for
  // `subscribeTimeline`'s own #756/#1013 reason: a required parameter cascades over every existing call
  // site, an optional one over none. Absent means this event contributes no key, which is the correct
  // reading for an arm the emit did not stamp and the fail-open default everywhere else.
  beginLocalTimelineRead: (serverId: string, conversationId: string) => {
    complete: (snapshot: SavedTimeline | null) => void
    fail: () => void
    cancel: () => void
  } | null
  dispatchLocalEcho: (serverId: string, conversationId: string, event: Extract<ThreadEvent, { type: 'userText' }>) => void
  dispatchFor: (conversationId: string, event: ThreadEvent, joinKey?: string) => void
  markLocalSendQueued: (conversationId: string, queued: readonly QueuedItem[]) => void
  prependHistoryFor: (conversationId: string, items: readonly ThreadItem[], retainBoundary?: boolean, entries?: readonly HistoryTimelineEntry[]) => readonly number[]
  recordPlacementJoin: (conversationId: string, joinKey: string | undefined) => void
  markHistoryRequested: (conversationId: string, serverId?: string, cursor?: string, purpose?: 'older' | 'newest' | 'gap', gapId?: number) => void
  recordHistoryPage: (conversationId: string, cursor: string, atStart: boolean, servedIds?: readonly number[]) => void
  recordHistoryFailure: (
    conversationId: string,
    reason: HistoryRequestFailure,
    retryable: boolean
  ) => void
  markViewed: (conversationId: string) => void
  clearSessionErrorsForHost: (serverId: string) => void
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
  history: HistoryRequestState,
  serverId?: string
): ConversationTimelineState {
  const held = state.timelines.get(conversationId)
  if (held === undefined || (serverId !== undefined && held.serverId !== undefined && held.serverId !== serverId)) return state
  const newest = held.history?.status === 'requested' && held.history.purpose === 'newest'
  const keepOldest = (newest || (held.history?.status === 'requested' && held.history.purpose === 'gap')) && held.coverage?.status === 'received'
  const coverage = history.status === 'loaded' && !keepOldest
    ? { status: 'received' as const, cursor: history.cursor, atStart: history.atStart } : held.coverage
  const preserveLocalRead = newest && (history.status === 'failed' || held.localRead === 'loaded')
  const next = new Map(state.timelines)
  next.set(conversationId, { ...held, history, coverage, localRead: preserveLocalRead ? held.localRead : undefined,
    localReadOwner: preserveLocalRead ? held.localReadOwner : undefined })
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
  init: ConversationTimelineState = initialConversationTimelineState,
  receiptHost: () => string | null | undefined = () => undefined
) {
  function receivedSlice(held: ConversationSlice | undefined, preserveLocalRead = false): ConversationSlice | undefined {
    if (held === undefined) return undefined
    const origin = receiptHost()
    const base = typeof origin === 'string' && held.serverId !== undefined && held.serverId !== origin
      ? emptySlice : held
    return { ...base, serverId: typeof origin === 'string' ? origin : base.serverId,
      localRead: preserveLocalRead ? base.localRead : undefined,
      localReadOwner: preserveLocalRead ? base.localReadOwner : undefined }
  }
  return createStore<ConversationTimelineStore>((set, get) => ({
    ...init,
    // A confirmed creation is an observed empty live thread, not a pending saved-history read.
    initializeCreatedTimeline: (serverId, conversationId) => set(s => ({
      timelines: withSliceAtTail(s.timelines, conversationId, { ...emptySlice, serverId })
    })),
    beginLocalTimelineRead: (serverId, conversationId) => {
      const held = get().timelines.get(conversationId)
      if (held?.serverId === serverId &&
        (held.localRead !== undefined || held.timeline.items.length > 0)) return null
      const owner = Symbol()
      const pending: ConversationSlice = { ...emptySlice, serverId, localRead: 'loading', localReadOwner: owner,
        history: held?.serverId === serverId ? held.history : null,
        // Opening history must not consume a live notice received while this chat was off-screen.
        timeline: { ...initialTimelineState,
          sessionError: held?.serverId === serverId ? held.timeline.sessionError : undefined }
      }
      set(s => ({ timelines: withSliceAtTail(s.timelines, conversationId, pending) }))
      const ownsRead = (slice: ConversationSlice | undefined): slice is ConversationSlice =>
        slice?.serverId === serverId && slice.localRead === 'loading' && slice.localReadOwner === owner
      const settle = (replacement: ((current: ConversationSlice) => ConversationSlice) | null): void => {
        set(s => {
          const current = s.timelines.get(conversationId)
          if (!ownsRead(current)) return s
          const timelines = new Map(s.timelines)
          if (replacement === null) timelines.delete(conversationId)
          else timelines.set(conversationId, { ...replacement(current), localReadOwner: undefined })
          return { timelines }
        })
      }
      const fail = (): void => settle(current => ({ ...current, localRead: 'failed' }))
      return {
        complete: value => {
          if (!ownsRead(get().timelines.get(conversationId))) return
          try {
            const snapshot = parseChatHistorySnapshot(value ?? {
              version: 1, kind: 'timeline', serverId, conversationId,
              items: [], prependedRows: 0, coverage: { status: 'unknown' }
            })
            if (snapshot.kind !== 'timeline' || snapshot.serverId !== serverId ||
              snapshot.conversationId !== conversationId) {
              fail()
              return
            }
            settle(current => ({ ...emptySlice, serverId, history: current.history, localRead: 'loaded', coverage: snapshot.coverage, served: snapshot.served, display: snapshot.display, gaps: snapshot.gaps, restored: { serverId, coverage: snapshot.coverage },
              timeline: { ...current.timeline, items: snapshot.items,
                rowKeys: snapshot.rowIdentity?.rowKeys ?? snapshot.items.map((_, index) => index - snapshot.prependedRows),
                nextRowKey: snapshot.rowIdentity?.nextRowKey ?? snapshot.items.length - snapshot.prependedRows },
              prependedRows: snapshot.prependedRows }))
          } catch { fail() }
        },
        fail,
        // Navigation cancels the disk read, never the independently correlated page request.
        cancel: () => settle(get().timelines.get(conversationId)?.history == null
          ? null : current => ({ ...current, localRead: undefined }))
      }
    },
    dispatchLocalEcho: (serverId, conversationId, event) =>
      set(s => {
        const held = s.timelines.get(conversationId)
        // Only explicitly owned rows can join a local send; never adopt id-only content.
        const base = held?.serverId === serverId ? held : emptySlice
        const slice: ConversationSlice = {
          ...base, serverId, localRead: undefined,
          timeline: reduceTimeline(base.timeline, event)
        }
        if (held === undefined) {
          return { timelines: withNewSliceAtHead(s.timelines, conversationId, slice) }
        }
        const timelines = new Map(s.timelines)
        timelines.set(conversationId, slice)
        return { timelines }
      }),
    dispatchFor: (conversationId, event, joinKey) =>
      set((s) => {
        if (event.type === 'messageDelivery') {
          const slice = s.timelines.get(conversationId)
          if (slice === undefined || (typeof event.serverId === 'string' && slice.serverId !== event.serverId)) return s
          const timeline = reduceTimeline(slice.timeline, event)
          return timeline === slice.timeline ? s : { timelines: new Map(s.timelines).set(conversationId, { ...slice, timeline }) }
        }
        // This client-owned clear has no receipt host and cannot invalidate a saved-history read.
        if (event.type === 'sessionErrorCleared') {
          const slice = s.timelines.get(conversationId)
          if (slice?.timeline.sessionError === undefined) return s
          const timelines = new Map(s.timelines)
          timelines.set(conversationId, { ...slice, timeline: reduceTimeline(slice.timeline, event) })
          return { timelines }
        }
        const held = receivedSlice(s.timelines.get(conversationId), event.type === 'sessionError')
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
              serverId: receiptHost() ?? undefined,
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
        let retainedRowKey: number | undefined
        if (joinKey !== undefined) {
          const matches = held.display?.filter(d => d.joinKey === joinKey) ?? []
          if (matches.length === 1 && matches[0].rowKey !== undefined &&
            held.timeline.rowKeys?.includes(matches[0].rowKey)) retainedRowKey = matches[0].rowKey
        }
        const folded = retainedRowKey === undefined ? reduceTimeline(held.timeline, event)
          : reduceRetainedTimelineEvent(held.timeline, event, retainedRowKey)
        // #1225 — the same-reference short-circuit ALSO declines to record the join key, and that
        // ordering is the guard rather than a side effect: a fold that changed nothing drew nothing, so
        // a key minted here could suppress a served page's copy of a row neither lane ever showed.
        if (folded === held.timeline) return s
        const next = new Map(s.timelines)
        next.set(conversationId, {
          ...held,
          timeline: folded,
          // Feedback from already-retained display does not establish a new live contribution.
          liveKeys: retainedRowKey === undefined ? withJoinKey(held.liveKeys, joinKey) : held.liveKeys
        })
        return { timelines: next }
      }),
    // #1725 — a queue snapshot can only advance a held slice's open send window. It never creates a
    // slice, and an unchanged fold returns the state object so no subscriber wakes.
    markLocalSendQueued: (conversationId, queued) =>
      set((s) => {
        const held = s.timelines.get(conversationId)
        if (held === undefined) return s
        const origin = receiptHost()
        if (typeof origin === 'string' && held.serverId !== undefined && held.serverId !== origin) return s
        const timeline = markLocalSendQueued(held.timeline, queued)
        if (timeline === held.timeline) return s
        const next = new Map(s.timelines)
        next.set(conversationId, { ...held, timeline })
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
    recordPlacementJoin: (conversationId, joinKey) => set(s => {
      if (joinKey === undefined) return s
      const held = receivedSlice(s.timelines.get(conversationId)) ?? emptySlice
      const liveKeys = withJoinKey(held.liveKeys, joinKey)
      if (liveKeys === held.liveKeys) return s
      const slice = { ...held, liveKeys, serverId: receiptHost() ?? held.serverId }
      return { timelines: s.timelines.has(conversationId)
        ? new Map(s.timelines).set(conversationId, slice)
        : withNewSliceAtHead(s.timelines, conversationId, slice) }
    }),
    prependHistoryFor: (conversationId, items, retainBoundary = false, entries) => {
      let boundaries: readonly number[] = []
      set((s) => {
        const current = s.timelines.get(conversationId)
        // Pages supersede loading reads, while settled saved rows keep their presentation.
        const held = receivedSlice(current, current?.history?.status === 'requested' &&
          current.history.purpose === 'newest' && current.localRead === 'loaded')
        if (entries !== undefined) {
          const base = held ?? emptySlice
          const high = base.served?.highestId
          const disjointNewest = base.history?.status === 'requested' && base.history.purpose === 'newest' &&
            high !== undefined && entries.length > 0 && entries.every(entry => entry.id > high)
          const joined = reconcileHistory(base.timeline, base.display, entries, base.liveKeys, retainBoundary, disjointNewest)
          boundaries = joined.boundaries
          const slice = { ...base, serverId: receiptHost() ?? base.serverId, timeline: joined.timeline,
            display: joined.display, prependedRows: base.prependedRows + joined.inserted }
          return { timelines: held === undefined ? withNewSliceAtHead(s.timelines, conversationId, slice)
            : new Map(s.timelines).set(conversationId, slice) }
        }
        const oldItems = held?.timeline.items ?? []
        const oldKeys = held?.timeline.rowKeys ?? oldItems.map((_, i) => i)
        const base = held?.timeline.nextRowKey ?? oldItems.length
        const fresh = withoutHeldEchoes(items, oldItems)
        const freshKeys = fresh.map((_, i) => base + (retainBoundary ? 1 : 0) + i)
        const keysByItem = new Map(fresh.map((item, i) => [item, freshKeys[i]]))
        boundaries = [...items.map(item => {
          const key = keysByItem.get(item)
          if (key !== undefined) return key
          const echo = oldItems.findIndex(old => old.kind === 'userText' && item.kind === 'userText' && old.messageId === item.messageId)
          return oldKeys[echo] ?? base
        }), oldKeys[0] ?? base]
        if (fresh.length === 0 && !retainBoundary) return s
        const timeline = { ...(held?.timeline ?? initialTimelineState), items: [...fresh, ...oldItems],
          rowKeys: [...freshKeys, ...oldKeys], nextRowKey: base + fresh.length + (retainBoundary ? 1 : 0) }
        if (held === undefined) {
          if (items.length === 0 && !retainBoundary) return s
          return { timelines: withNewSliceAtHead(s.timelines, conversationId, {
            timeline: retainBoundary ? timeline : { ...initialTimelineState, items },
            serverId: receiptHost() ?? undefined, history: null, liveKeys: NO_LIVE_KEYS,
            prependedRows: retainBoundary ? fresh.length : 0
          }) }
        }
        return { timelines: new Map(s.timelines).set(conversationId, { ...held, timeline,
          prependedRows: held.prependedRows + fresh.length }) }
      })
      return boundaries
    },
    // Requests preserve same-host rows and coverage without changing holder order.
    // A different host starts with an empty slice; its cursor cannot come from the old host.
    markHistoryRequested: (conversationId, serverId, cursor, purpose, gapId) =>
      set((s) => {
        const held = s.timelines.get(conversationId)
        if (held === undefined && serverId === undefined) return s
        const base = held === undefined || (serverId !== undefined && held.serverId !== undefined && held.serverId !== serverId)
          ? emptySlice : held
        const timelines = new Map(s.timelines)
        timelines.set(conversationId, { ...base, serverId: serverId ?? base.serverId,
          history: { status: 'requested', ...(cursor === undefined ? {} : { cursor }),
            ...(purpose === undefined ? {} : { purpose }), ...(gapId === undefined ? {} : { gapId }) },
          localRead: purpose === 'newest' && base.localRead === 'loaded' ? base.localRead : undefined })
        return { timelines }
      }),
    // Only a successful page advances coverage, even when it contains no drawable rows.
    recordHistoryPage: (conversationId, cursor, atStart, servedIds) =>
      set(s => {
        if (servedIds === undefined) return withHistory(s, conversationId, { status: 'loaded', cursor, atStart })
        const current = s.timelines.get(conversationId)
        const newest = current?.history?.status === 'requested' && current.history.purpose === 'newest'
        const gapRequest = current?.history?.status === 'requested' && current.history.purpose === 'gap'
          ? current.history.gapId : undefined
        const held = receivedSlice(current, newest && current?.localRead === 'loaded') ?? emptySlice
        const pageIds = [...new Set(servedIds)].sort((a, b) => a - b)
        const receipt = { ids: pageIds, cursor, atStart }
        // Preserve the latest exact cursor even when an identical older receipt is repeated.
        const candidates = [...(held.served?.receipts ?? []).filter(r =>
          r.cursor !== cursor || r.atStart !== atStart || r.ids.length !== pageIds.length ||
          r.ids.some((id, index) => id !== pageIds[index])), receipt]
        let totalIds = candidates.reduce((total, r) => total + r.ids.length, 0)
        let first = 0
        // Expire whole receipts, including their exclusive coverage, before publishing to the writer.
        while (candidates.length - first > MAX_CHAT_HISTORY_ITEMS || totalIds > MAX_CHAT_HISTORY_ITEMS) {
          totalIds -= candidates[first].ids.length
          first++
        }
        const receipts = candidates.slice(first)
        const ids = [...new Set(receipts.flatMap(r => r.ids))].sort((a, b) => a - b)
        const highestId = ids[ids.length - 1]
        const gaps = historyGaps(held.gaps,
          [...new Set([...(held.served?.ids ?? []), ...pageIds])].sort((a, b) => a - b),
          ids, pageIds, cursor, gapRequest)
        const slice: ConversationSlice = { ...held, serverId: receiptHost() ?? held.serverId,
          served: receipts.length === 0 ? undefined : { ids, receipts, ...(highestId === undefined ? {} : { highestId }) },
          gaps, history: { status: 'loaded', cursor, atStart },
          coverage: (newest || gapRequest !== undefined) && held.coverage?.status === 'received'
            ? held.coverage : { status: 'received', cursor, atStart }, localRead: newest ? held.localRead : undefined }
        return { timelines: s.timelines.has(conversationId)
          ? new Map(s.timelines).set(conversationId, slice)
          : withNewSliceAtHead(s.timelines, conversationId, slice) }
      }),
    // Settle without retrying; the next qualifying user input decides whether to ask.
    recordHistoryFailure: (conversationId, reason, retryable) =>
      set((s) => {
        const request = s.timelines.get(conversationId)?.history
        return withHistory(s, conversationId, { status: 'failed', reason, retryable,
          ...(request?.status === 'requested' && request.cursor !== undefined ? { cursor: request.cursor } : {}),
          ...(request?.status === 'requested' && request.purpose !== undefined ? { purpose: request.purpose } : {}),
          ...(request?.status === 'requested' && request.gapId !== undefined ? { gapId: request.gapId } : {})
        }, receiptHost() ?? undefined)
      }),
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
    clearSessionErrorsForHost: (serverId) => set(s => {
      const timelines = new Map(s.timelines)
      let changed = false
      for (const [id, slice] of s.timelines) {
        if (slice.serverId !== serverId || slice.timeline.sessionError === undefined) continue
        timelines.set(id, { ...slice, timeline: reduceTimeline(slice.timeline, { type: 'sessionErrorCleared' }) })
        changed = true
      }
      return changed ? { timelines } : s
    }),
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
export const conversationTimelineStore = createConversationTimelineStore(
  initialConversationTimelineState,
  () => typeof window === 'undefined' ? undefined : window.pyry?.chatHistoryReceipt?.()?.serverId
)

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

function historyGaps(held: readonly HistoryGap[] | undefined, ids: readonly number[],
  retained: readonly number[], page: readonly number[], cursor: string, selected: number | undefined): readonly HistoryGap[] {
  const positions = new Map(retained.map((id, index) => [id, index]))
  const holes: HistoryGap[] = []
  const unresolved = new Set<HistoryGap>()
  let priorIndex = 0
  for (let index = 1; index < ids.length; index++) {
    if (ids[index] - ids[index - 1] <= 1) continue
    const olderId = ids[index - 1], newerId = ids[index]
    while (held?.[priorIndex] && held[priorIndex].newerId <= olderId) priorIndex++
    const prior = held?.[priorIndex]
    const previous = prior && prior.olderId <= olderId && prior.newerId >= newerId ? prior : undefined
    if (previous) unresolved.add(previous)
    const walking = selected !== undefined && previous?.olderId === selected
    const canResume = page.length === 0 ? walking : page[0] === newerId || (walking && page[0] >= newerId)
    const resume = canResume ? (previous?.cursor !== undefined && previous.olderId !== selected ? previous.cursor : cursor) : previous?.cursor
    holes.push({ olderId, newerId, ...(resume === undefined ? {} : { cursor: resume }) })
  }
  for (const gap of held ?? []) {
    if (unresolved.has(gap)) continue
    const first = positions.get(gap.olderId), last = positions.get(gap.newerId)
    // Receipt expiration is unknown coverage, never proof of a completed gap.
    if (first !== undefined && last !== undefined && last - first === gap.newerId - gap.olderId) continue
    holes.push({ ...gap, ...(gap.olderId === selected ? { cursor } : {}) })
  }
  const merged: HistoryGap[] = []
  for (const gap of holes.sort((a, b) => a.olderId - b.olderId)) {
    const prior = merged.at(-1)
    if (prior && gap.olderId < prior.newerId) {
      const resume = gap.newerId > prior.newerId ? gap.cursor : prior.cursor
      merged[merged.length - 1] = { olderId: prior.olderId, newerId: Math.max(prior.newerId, gap.newerId),
        ...(resume === undefined ? {} : { cursor: resume }) }
    } else merged.push(gap)
  }
  return merged.slice(-MAX_CHAT_HISTORY_ITEMS)
}
