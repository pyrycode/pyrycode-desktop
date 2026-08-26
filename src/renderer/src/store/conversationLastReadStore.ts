// HOW FAR THE OPERATOR HAS READ in each conversation, held per conversation id (#775, split from #677)
// — so the sidebar has something true to compare a chat's latest activity against. Pure renderer state:
// no IPC, no preload bridge, no transport, no async task, no timer, no teardown.
//
// A last-read mark is a CLIENT-SIDE FICTION. The daemon carries no read marker: `ConversationSummary`
// (src/shared/wire/types.ts:917-925) has `last_message_ts` and `last_used_at` and no read cursor, and
// adding one would be a wire change with no daemon behind it. Per-installation is the honest scope for
// one desktop app, and it needs no protocol work.
//
// This slice ships the HOLDER and nothing else — it is DORMANT, exactly as conversationActivityStore
// (#747) and conversationTimelineStore (#755) were before their feeds landed. #776 persists it, #777
// writes it, #778 derives the unread predicate from it, #779 clears it at the pairing boundary, and
// #676 draws the green dot. Nothing imports this module yet.
//
// Keyed by `conversationId`, NOT a flat slot. The family's usual reason — the daemon fans frames out to
// every interactive connection, so a single "hold the latest" slot lets one conversation clobber another
// (backgroundTaskRosterStore.ts:31-33) — does not apply, because nothing on the wire writes this at all.
// The reason here is the READER's: #778 asks "is there content newer than the mark?" about a
// conversation that is NOT the open one, so a flat slot would answer the only question ever asked with
// the wrong conversation's answer. The two direct structural precedents are conversationActivityStore.ts
// (#747) and
// conversationTimelineStore.ts (#755): same `ReadonlyMap` state, same copy-on-write, same named write
// path rather than a reducer, same `?? null` selector factory.
//
// THE VALUE IS A COUNT OF TIMELINE ITEMS SEEN, and it is client-originated. That is a decision, so the
// reasoning is here rather than in a commit message — #777 writes it and #778 compares it, and neither
// can revisit it cheaply:
//
//   - NO TIMESTAMP EXISTS ANYWHERE THE RENDERER CAN REACH. The turn-stream arms carry `conversationId`,
//     `turnId` and render fields and no time field (events.ts:130, :141), a grep for a timestamp-shaped
//     field across the whole IPC event union returns zero, `ConversationActivityEntry` is four booleans
//     with no arrival marker, and the daemon's two timestamps do not move on message arrival.
//   - A CLIENT CLOCK READING WOULD NOT ANSWER THE QUESTION. #778 must decide "is there content newer
//     than the mark?" for a conversation that is NOT open, which needs a live per-conversation ARRIVAL
//     quantity to compare against. A clock-reading mark would force #778 to invent a second
//     per-conversation holder, and #777's AC4 ("content arriving for a conversation that is not the
//     open one leaves that conversation's mark untouched") forbids #777 from writing one.
//   - THE COMPARAND ALREADY EXISTS. `conversationTimelineStore`'s per-conversation `items`
//     (threadTimeline.ts:191) has been fed per conversation since #756, and `items.length` is the only
//     live per-conversation quantity in the renderer that moves on content arrival. Per keyed slice it
//     is APPEND-ONLY: `reduceTimeline`'s `reset` arm truncates to `[]` (threadTimeline.ts:540) but
//     `reset` is dispatched only to the FLAT `timelineStore` (activateConversation.ts:75), and the
//     bridge routes only the eight id-carrying arms into the keyed store (timelineBridge.ts:349), none
//     of which is `reset`. The one discontinuity is eviction at `MAX_RETAINED_TIMELINES`, which #778
//     can see for itself — an evicted key reads ABSENT, distinctly from a present empty slice.
//   - ITEM IDENTITY WAS CONSIDERED AND DOES NOT EXIST. `ThreadItem` (threadTimeline.ts:40-92) has no
//     stable per-item id across kinds: `userText` and `unrecognizedMessage` carry none and `turnId`
//     repeats across every item in a turn. A positional count is the only workable marker.
//
// The meaning is carried by the parameter NAME (`itemsSeen`) and by `LastReadMark`'s docstring, not by
// the type system, and no branded type is asked for: the repo's posture is plain primitives at named
// call sites (`setTurnRunning(id, boolean)`) and a brand would buy nothing with exactly one writer.
//
// SAMPLING `items.length` IS #777'S JOB, at #777's call site — not this module's. See the hard import
// constraint below, which is what makes that a fact rather than an instruction.
//
// NO BOUND, NO EVICTION, NO LRU — deliberately, and this is the one place the newer of the two keyed
// precedents is NOT copied. conversationTimelineStore.ts:93-111 caps at ten slices on a two-part
// justification: what an entry COSTS (a whole thread of assistant text, no wire-side ceiling) and what
// CLEARS it (no periodic floor, because a timeline must survive a reconnect). Only the second half
// transfers. An entry here is ONE NUMBER plus one bounded id string — the cheapest in the family, below
// conversationActivityStore's four booleans, which declines a cap (:163-167), and far below
// backgroundTaskRosterStore's ~5 KB, which also declines one (:282-289). "Not a plausible exhaustion
// vector" is load-bearing for both those refusals and is MORE true here, and no speculative eviction
// policy is built for a failure nobody has observed. The map is emptied wholesale at the pairing
// boundary by #779. THE PERSISTED SIZE QUESTION THIS COMMENT LEFT OPEN IS NOW ANSWERED (#776), and the
// answer is the same NO: no ceiling, no prune-on-load, no LRU, even though the map now survives restarts
// with only #779 flooring it. Measured: an entry is one conversation id plus one small integer plus JSON
// punctuation, on the order of 50 bytes, against a `localStorage` budget in the megabytes — roughly a
// hundred thousand conversations since the last pairing. The keyspace is also bounded by the operator's
// own opening of conversations rather than by anything the daemon can mint (#777 stamps the OPEN
// conversation), and an id's length is capped transitively by MAX_FRAME_BYTES (types.ts:22), so this is
// not a storage-exhaustion vector either. No growth failure has been observed.
//
// HARD IMPORT CONSTRAINT, checkable by grep: this module's only imports are the two below. It imports
// nothing from `./threadTimeline`, nothing from `./conversationTimelineStore`, nothing from
// `activeConversationStore`, and nothing from `src/renderer/src/screens/`. With no reference to the open
// conversation and no timeline in scope, the `?? activeConversation` fallback this family exists to
// prevent is not something a developer must remember to avoid — it is UNAVAILABLE.
//
// SECURITY: the `conversationId` is daemon-asserted untrusted text used here ONLY as a lookup key —
// never stored inside a value (a mark is a bare `number`, so there is structurally nowhere to put it),
// never rendered, never concatenated, never a filename, a cache key or a URL, and never compared against
// a secret. `ReadonlyMap` is MANDATED and `Record<string, …>` is forbidden:
// `Map.prototype.get('__proto__')` performs no prototype-chain lookup and
// `Map.prototype.set('__proto__', v)` creates an ordinary own entry, so `__proto__`, `constructor` and
// `''` are three unremarkable keys by construction rather than by validation. Three consequences, pinned
// here because none of them is a type error: nothing is keyed into an object literal; there are no
// computed object keys anywhere on the write path; and `Object.fromEntries`, spreading the map into an
// object, and `JSON.stringify` of the map are all out, each re-materialising the hazard the `Map`
// removes. That last one constrained how #776 encodes the map for persistence, and #776 SOLVED IT
// STRUCTURALLY: one whole-map value under a single FIXED key, encoded as an ARRAY OF ENTRIES, so the
// untrusted string is a JSON array element on disk and a `Map` key in memory and an object key NOWHERE,
// in either direction (see `encodeLastReadMarks`). Spreading the map into an ARRAY (`Array.from(marks)`)
// is a different operation from spreading it into an object and is fine. A future swap of `Map` for `Record`, written consistently, is no type
// error at all, and the assertions that catch the prototype-chain lookup it reintroduces are
// conversationLastReadStore.test.ts's hostile-key reads BEFORE ANY WRITE — verified 2026-08-25: on a
// `Record`, `'__proto__'` reads back `Object.prototype` and `'constructor'` the `Object` function,
// neither nullish, so `?? null` never fires; a `Record` also drops `rec['__proto__'] = 42` silently, so
// the round-trip fails too. `''` is NOT diagnostic — it reads `undefined` either way.
//
// Log-free by construction — no `console.*` on any path. The only value a diagnostic here could carry is
// the untrusted id or the raw blob containing it, and the content-free diagnostics rule (ADR 0007, #126)
// keeps it out of a file. A read miss, a same-value write and a REJECTED PERSISTED BLOB are all silent BY
// DESIGN, not swallowed errors.
//
// PERSISTED (#776), through an injected port, copying the `defaultWorkspaceStore` (#403) /
// `pushNotificationPrefStore` (#408) shape: the marks hydrate at construction and write through as they
// are recorded, so a restart no longer lights up every conversation the operator already read. Three
// places this slice could not simply copy those two, each of which has its own paragraph below: it is a
// keyed MAP rather than a scalar, so the round trip has a decode step over untrusted input
// (`decodeLastReadMarks` — the blob is hand-editable on disk and its keys are daemon-asserted); a corrupt
// blob is rejected WHOLE and silently; and the write-through sits BEHIND the same-value guard rather than
// ahead of it, because unlike a scalar setter this write path HAS one and it fires on the common case.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** How far the operator has read in ONE conversation: a COUNT OF TIMELINE ITEMS SEEN, sampled from that
 *  conversation's own `items` (threadTimeline.ts:191) at the moment it was read. Client-originated — it
 *  is NOT a timestamp, and no daemon value is ever assigned to it (see the header for why no timestamp
 *  is reachable). A plain `number` rather than `number | null`: the "never read" reading lives at the
 *  ENTRY level, where `selectLastReadFor` returns `null`, exactly as backgroundTaskRosterStore.ts:398-413
 *  puts it. `0` is a REAL, producible mark — opening a conversation whose timeline is empty stamps it —
 *  which is what makes the absent-vs-recorded distinction below load-bearing rather than boilerplate. */
export type LastReadMark = number

/** The persistence backend the store depends on — the injected DI seam (#776), the reason being that the
 *  dependency which varies between prod and test is the persistence backend. The vitest runtime is `node`
 *  (no jsdom, no `localStorage`, no `window`), so a store reaching for `window.localStorage` directly
 *  could not be unit-tested and would throw on import; the port makes the hydrate-then-read round trip
 *  testable with an in-memory fake.
 *
 *  `read` returns a MAP, never `null` — the one deliberate deviation from `PushNotificationPrefStorage`,
 *  whose `read(): boolean | null` keeps "never set" distinguishable from a stored `false` because a real
 *  consumer needs that distinction. Nothing here does: absent, unparseable and non-conforming all hydrate
 *  to the same empty map, so a nullable return would be a distinction with exactly one consumer that
 *  immediately discards it. The port stays a faithful "what is persisted, decoded" reporter; it just has
 *  nothing to be faithful about in the empty case.
 *
 *  There is deliberately NO `clear()`. #779's pairing-boundary clear is served by `write(new Map())` —
 *  `encodeLastReadMarks(new Map())` is `'[]'`, which round-trips to empty — so shipping one would ship an
 *  unused seam, the same refusal #775 made about the DI seam itself. Synchronous: backs onto
 *  `localStorage`, whose access is synchronous. */
export interface ConversationLastReadStorage {
  read(): ReadonlyMap<string, LastReadMark>
  write(marks: ReadonlyMap<string, LastReadMark>): void
}

/** The renderer-pref key; sibling to `pyry.defaultWorkspace` (#403) and `pyry.pushNotificationsEnabled`
 *  (#408). ONE FIXED key holding the whole map, which is what keeps the untrusted `conversationId` out of
 *  the key space entirely (the header's requirement).
 *
 *  THE THIRD-KEY RULING, which two comments deferred to exactly this moment
 *  (`defaultWorkspaceStore.ts:34-35` "if a second is ever added", `pushNotificationPrefStore.ts:43-46`
 *  "until a genuine third case"): NO shared key-namespacing helper. The deferral's own counter-argument
 *  is the stronger one — "the const NAME is a preference, but the STRING is the contract" — and a
 *  `pyry.${name}` helper turns three greppable literals into three derived values, costing the ability to
 *  enumerate the app's whole persisted keyspace with one grep for `'pyry.`. The three keys share a
 *  five-character prefix and nothing else: no shared serialization, no shared lifecycle, no shared clear.
 *  No collision or drift has been observed. Recorded here so a fourth key finds it answered rather than
 *  re-litigating it; the two older comments are left exactly as they are, because sweeping them would be
 *  refactoring adjacent code (CLAUDE.md). */
export const CONVERSATION_LAST_READ_KEY = 'pyry.conversationLastRead' as const

/** Encode the whole map for persistence: a JSON ARRAY OF `[id, mark]` PAIRS, e.g. `[["c1",4],["c2",9]]`.
 *
 *  The array-of-entries shape is the STRUCTURAL answer to the header's constraint, not a stylistic
 *  choice, and every tidier-looking alternative is a bug:
 *
 *    - `JSON.stringify(marks)` yields `'{}'` — a `Map`'s entries are not own enumerable properties, so
 *      that is silent TOTAL data loss.
 *    - `Object.fromEntries(marks)` / `{...marks}` / an `obj[id] = mark` loop each put the untrusted id
 *      back into an object key space. Note the actual symptom, which is not the one usually assumed:
 *      because a mark is a NUMBER, the `__proto__` setter ignores the assignment, so the entry VANISHES
 *      SILENTLY and no prototype is altered. `constructor` survives as a shadowing own key; `''`
 *      survives. One quietly dropped mark, not a polluted prototype.
 *
 *  `JSON.parse` itself is NOT the hazard and never was: `JSON.parse('{"__proto__":3}')` creates an
 *  ordinary OWN property and alters nothing (verified 2026-08-25 under this repo's `node`). Assignment is.
 *  `conversationLastReadStore.test.ts` pins the exact encoded string so a rewrite into any of the above
 *  fails a test rather than compiling clean. */
export function encodeLastReadMarks(marks: ReadonlyMap<string, LastReadMark>): string {
  return JSON.stringify(Array.from(marks))
}

/** Decode a persisted blob back to the marks, or an EMPTY map for anything that is not exactly what
 *  `encodeLastReadMarks` emits. This is the untrusted-input boundary: the blob is hand-editable on disk
 *  and its keys are daemon-asserted conversation ids.
 *
 *  REJECT WHOLE, NEVER SALVAGE PER ENTRY. One malformed element costs every mark for that run, and that
 *  is the intended trade: the marks are cheap to re-earn, and per-entry salvage is a second decode path
 *  to get wrong. It is also what makes a torn blob safe — Chromium flushes `localStorage` asynchronously,
 *  so a hard kill can in principle leave a truncated value, and rejecting whole costs the marks rather
 *  than the app's start-up.
 *
 *  `Number.isInteger` is the load-bearing value check, not `typeof === 'number'`: it excludes `NaN`,
 *  `Infinity` and fractions in one call. The `typeof` beside it is what narrows for `tsc`. And the
 *  non-number case is reachable through this app's OWN encoder — `JSON.stringify` turns `NaN`/`Infinity`
 *  into `null` — so it is not a hypothetical hand-edit.
 *
 *  THE REJECT PATH IS SILENT ON PURPOSE, and that is a design constraint rather than a swallowed error.
 *  A `console.warn` here is the natural instinct and it would put the untrusted, daemon-asserted id (or
 *  the raw blob containing it) into the renderer console and any capture of it, violating ADR 0007 and
 *  this module's log-free rule. So: the `catch` does not rethrow, does not log, and does not build a
 *  message out of `raw`. Note this `try`/`catch` is NOT in tension with the two precedents' deliberate
 *  refusal to try/catch `localStorage` itself — they refuse a defence against an UNOBSERVED quota/disabled
 *  failure, whereas this one implements a required behaviour over input the ticket states is hand-edited.
 *  The codec catches; the port below does not.
 *
 *  Returns a fresh `new Map()` per reject rather than `initialConversationLastReadState.marks`: a codec
 *  should not import a state object, and a fresh map costs nothing. */
export function decodeLastReadMarks(raw: string | null): ReadonlyMap<string, LastReadMark> {
  if (raw === null) return new Map()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new Map()
  }
  if (!Array.isArray(parsed)) return new Map()

  const entries: [string, LastReadMark][] = []
  for (const entry of parsed) {
    if (!Array.isArray(entry) || entry.length !== 2) return new Map()
    const [conversationId, mark] = entry
    if (typeof conversationId !== 'string') return new Map()
    if (typeof mark !== 'number' || !Number.isInteger(mark) || mark < 0) return new Map()
    entries.push([conversationId, mark])
  }
  return new Map(entries)
}

/**
 * The real `localStorage`-backed port, wired at the singleton composition root. The `typeof window` guard
 * is the import-safety guard: it makes constructing the singleton safe under `node`/`renderToStaticMarkup`,
 * where `read()` yields an empty map (so the store starts with nothing read) and `write()` is a no-op —
 * and it is also what makes the real port safe as `createConversationLastReadStore`'s DEFAULT argument.
 *
 * There is no `removeItem` path, because there is no `clear()` (see the port interface). It is
 * deliberately NOT a defensive try/catch — a `localStorage` quota/disabled failure is not an observed
 * failure mode in the Electron renderer, and shipping a defence for an unobserved failure is
 * Evidence-Based Fix Selection's anti-pattern; if it ever surfaces, the fix is localized here. The
 * decode's catch is a different thing entirely: a required behaviour over untrusted input, not a defence.
 */
export function localStorageConversationLastRead(): ConversationLastReadStorage {
  return {
    read: () =>
      typeof window === 'undefined'
        ? new Map()
        : decodeLastReadMarks(window.localStorage.getItem(CONVERSATION_LAST_READ_KEY)),
    write: (marks) => {
      if (typeof window === 'undefined') return
      window.localStorage.setItem(CONVERSATION_LAST_READ_KEY, encodeLastReadMarks(marks))
    }
  }
}

/** The whole state. A key ABSENT from the map means "this conversation has never been read" and is a
 *  DISTINCT state from a present mark of `0` ("read, and there was nothing in it at the time") — see
 *  `selectLastReadFor`, which preserves that distinction rather than collapsing it. `ReadonlyMap`
 *  signals the write path REPLACES the map, never mutates it in place, and is the construction that
 *  makes the hostile-key property hold (see the header). */
export interface ConversationLastReadState {
  marks: ReadonlyMap<string, LastReadMark>
}

/** Store shape = state + the one write path. `recordLastRead`, not `markRead`, and deliberately not
 *  `markLastRead`: conversationTimelineStore.ts:153 already exports a `markViewed` that is NULLARY-VALUED
 *  and means something else entirely (eviction ranking), and a same-name-different-shape pair in one
 *  directory is the trap conversationActivityStore.ts:64-67 documents for `apiRetry`. `record…` says a
 *  VALUE is being written; `mark…` in this directory says it is not.
 *
 *  One named write path rather than a reducer over an action union: a single whole-value write per key
 *  models no state machine, so a discriminated union would be ceremony without benefit (both keyed
 *  precedents' posture). There is deliberately NO generic `write(id, key, value)`, which would
 *  reintroduce a stringly-typed key beside the one hostile string this store exists to contain.
 *
 *  There are deliberately NO clears here. #779 owns the pairing-boundary clear, mirroring the family:
 *  #747 shipped the holder and #749 added its eviction paths. */
export type ConversationLastReadStore = ConversationLastReadState & {
  recordLastRead: (conversationId: string, itemsSeen: LastReadMark) => void
}

/** The named empty baseline. Its role NARROWED at #776 from "the factory's default" to just this: the
 *  port is now the store's single hydration source, and two hydration sources would be a genuine smell. */
export const initialConversationLastReadState: ConversationLastReadState = { marks: new Map() }

/**
 * DI-friendly, React-free store — one isolated instance per test.
 *
 * The write is a same-value guard over a copy-on-write replace: clone the OUTER map, set the key, return
 * a fresh state. `s.marks` is never mutated in place. Three properties, none of which is a type error
 * and each of which has a named test:
 *
 *   - A FIRST record always CREATES the entry, INCLUDING a first record of `0`. The guard is `===`
 *     against the RAW `get` result, so `undefined === 0` is `false` and the create path runs. Any
 *     falsy-shaped guard — `!s.marks.get(id)`, or `(s.marks.get(id) ?? -1) === itemsSeen` — drops that
 *     record and leaves the conversation reading as never-read. This is the numeric analogue of the
 *     first-write-of-`false` property conversationActivityStore.ts:148-152 documents, and it is sharper
 *     here: `0` is not an edge case but what opening an empty conversation stamps.
 *   - A VERBATIM REPEAT churns no listener. Returning the state OBJECT makes zustand's `Object.is`
 *     short-circuit fire, so no subscriber wakes, at the cost of one comparison. This is the common
 *     case rather than an edge one: #777 stamps on each arm arrival while a conversation stays open, so
 *     most records after the first carry an unchanged count.
 *   - REPLACEMENT, never accumulation and never `Math.max(held, incoming)`. A monotonic guard is not
 *     replacement and would make a legitimate lower mark unrecordable — which #778's eviction case
 *     needs, since a recreated slice restarts its count near zero.
 *
 * `new Map(s.marks)` copies by value for numbers, so an untouched key's reading is unchanged and a
 * component watching another conversation does not re-render (the backgroundTaskRosterStore.ts:415-417
 * property). Note the identity assertion those object-holding precedents use to prove it is DEGENERATE
 * here — `Object.is(5, 5)` holds however the map was built — so the test that actually catches an
 * in-place `set` asserts the previously held map is untouched.
 *
 * Growth is bounded by the number of distinct `conversationId`s the daemon names since the last pairing,
 * at one number plus one bounded id string per entry, and is deliberately not capped — see the header.
 *
 * Every write is a synchronous `set` under zustand's own store lock with no `await` inside it, so the
 * check-then-act in the guard has NO suspension point for a concurrent handler to interleave into.
 * `localStorage.setItem` is synchronous too, so persisting introduces none either. Unidirectional is
 * preserved: one read-only selector, one store-owned write path, never two-way-bound from a component.
 *
 * PERSISTENCE (#776). Hydration is `storage.read()` at construction — there is no explicit load step at
 * any call site, because constructing the store IS the load. Write-through is the ONE new line inside the
 * updater, and BOTH its position and its placement are load-bearing:
 *
 *   - BEHIND THE GUARD, not ahead of it. Both scalar precedents persist unconditionally because their
 *     setters have no guard to be behind; this one has one at the top of the updater, and it fires on the
 *     COMMON case. `appendDelta` (threadTimeline.ts:239-250) grows the tail `assistantText` item in place
 *     rather than appending, so `items.length` does not move across the deltas of a streamed assistant
 *     message, while #777 stamps the open conversation on EVERY arriving delta. Persisting ahead of the
 *     guard would fire one synchronous `localStorage.setItem` per delta for the length of every reply.
 *   - INSIDE THE UPDATER rather than in the action body. Guard, clone, persist and return are then one
 *     expression, so no future edit can hoist the write above the guard without deleting the guard.
 *     Vanilla zustand invokes an updater exactly once, synchronously, per `set` — there is no React
 *     StrictMode double-invocation for a vanilla store and no middleware in this store's stack that
 *     re-runs it — and that is not taken on trust: the test file pins it with a `write` call count. The
 *     rejected alternative, reading through `get()` in the action body to keep the updater pure, is
 *     equally correct and equally race-free; it just moves the guard away from the write for no gain.
 *
 * The port DEFAULTS to the real one, where both precedents require theirs. That is a test-ergonomics
 * affordance with no production cost: under `node` the real port's window guard makes `read()` empty and
 * `write()` a no-op, so a zero-argument construction behaves exactly as the pre-#776 factory did, keeping
 * the edit fan-out across this store's 19 existing tests at 2 rather than 19. The failure mode a default
 * normally introduces — someone forgets to inject and silently loses persistence — does not exist here,
 * because the default IS the production wiring. The singleton still names it explicitly anyway, matching
 * the two sibling stores, so a reader of the composition root sees the dependency.
 */
export function createConversationLastReadStore(
  storage: ConversationLastReadStorage = localStorageConversationLastRead()
) {
  return createStore<ConversationLastReadStore>((set) => ({
    marks: storage.read(),
    recordLastRead: (conversationId, itemsSeen) =>
      set((s) => {
        if (s.marks.get(conversationId) === itemsSeen) return s
        const next = new Map(s.marks)
        next.set(conversationId, itemsSeen)
        storage.write(next)
        return { marks: next }
      })
  }))
}

/** App-wide singleton — the one source of truth #777 writes and #778 reads, backed by the real
 *  `localStorage` port. */
export const conversationLastReadStore = createConversationLastReadStore(
  localStorageConversationLastRead()
)

/** Narrow-slice React binding for #778. Selecting a single conversation's mark avoids cross-facet
 *  re-renders. */
export function useConversationLastReadStore<T>(selector: (s: ConversationLastReadStore) => T): T {
  return useStore(conversationLastReadStore, selector)
}

/**
 * The only read surface — a selector FACTORY bound to one `conversationId`.
 *
 * `?? null` is the `selectRosterFor` / `selectActivityFor` / `selectTimelineFor` posture
 * (backgroundTaskRosterStore.ts:395-424), adopted rather than re-derived. The two readings stay distinct:
 *
 *   key absent      → `null`      never read
 *   a `number`      → that mark   read up to that many items — INCLUDING `0`
 *
 * `??` IS THE WHOLE MECHANISM, and `||` breaks it. `s.marks.get(id) || null` hands back `null` for a real
 * mark of `0`, with the same `LastReadMark | null` return type, no type error and no failing test unless
 * one is written for it — and `0` is producible, so this is not the usual defensive note. It is the
 * numeric shape of the collapse queueStore's `?? EMPTY_BACKLOG` makes and
 * backgroundTaskRosterStore.ts:398-405 warns against inheriting.
 *
 * `null` is a STABLE reference by construction, so no hoisted `EMPTY_*` constant is needed and no fresh
 * object is built per selector call. The nullable return type forces #778 to branch, so the distinction
 * cannot be ignored accidentally.
 *
 * A bare `Map.get` with `?? null` is also what makes an unknown id an EXPLICIT no-match that can never
 * resolve onto a neighbour's mark — the misattribution #675's required `conversationId` was introduced
 * to push down here.
 *
 * There is deliberately no whole-map `selectAllLastRead`: all three keyed precedents omit their whole-map
 * analogue and nothing downstream needs one — the sidebar reads one row at a time
 * (conversationActivityStore.ts:258-260) — so shipping one would ship an unread read surface (the
 * backgroundTaskRosterStore.ts:418-419 rule).
 */
export const selectLastReadFor =
  (conversationId: string) =>
  (s: ConversationLastReadState): LastReadMark | null =>
    s.marks.get(conversationId) ?? null
