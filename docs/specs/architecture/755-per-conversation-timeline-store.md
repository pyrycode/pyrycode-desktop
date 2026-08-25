# #755 — hold a timeline per conversation, bounded and least-recently-viewed evicted

**Size:** S (confirmed, not overridden)
**Labels:** `enhancement`, `size:s`, `security-sensitive`
**Parent:** #675, split into #751–#754 (the transport arms) → **#755 (this store)** → #756 (the writer)
→ #757 (the clears) → #758 (the reader cutover)

## Design source

N/A — pure renderer state with no writer and no reader in this slice. The ticket body carries no
`## Figma` section, correctly: nothing this ticket ships renders. The visual-fidelity check is
intentionally skipped.

## Files to read first

- `src/renderer/src/store/conversationActivityStore.ts` — **the twin, read it end to end (265 lines).**
  #747, merged 2026-08-25: the same slice of the same problem one family over. `ReadonlyMap` state
  (`:86-93`), copy-on-write write helper (`:121-136`), factory → singleton → hook → selector factory
  (`:174-265`), and the `?? null` three-way read (`:238-265`). This spec is that file with the payload
  swapped and two write paths instead of four setters. Do not re-derive any of it.
- `src/renderer/src/store/conversationActivityStore.ts:26-52` — the two header blocks this store copies
  almost verbatim: the **hard import constraint** (`:26-34`) and the **`ReadonlyMap`-not-`Record`
  security block** (`:36-52`). AC4 and AC5 are these two paragraphs applied to a timeline payload.
- `src/renderer/src/store/conversationActivityStore.ts:163-167` — the twin **declining** a cap
  ("deliberately not capped here; #676, the first reader, is where a real ceiling would go"). Read it
  so you know this ticket's bound is a *stated divergence*, not an oversight — see § The bound.
- `src/renderer/src/store/conversationActivityStore.test.ts:1-45` — the test file's header and the
  `activityFor` helper: the plain-function, React-free idiom over isolated factory instances.
- `src/renderer/src/store/conversationActivityStore.test.ts:204-241` — the hostile-key tests. **The
  shape to copy for AC5**, including the comment explaining why the read *before any write* is the
  assertion that catches a `Map`→`Record` swap.
- `src/renderer/src/store/threadTimeline.ts:189-225` — `TimelineState`: the ordered `items`, `phase`,
  and the four chrome scalars. **This whole interface is the per-conversation payload** — the store
  holds it unchanged, adds no field, and renames nothing.
- `src/renderer/src/store/threadTimeline.ts:289` — `reduceTimeline`, already a pure
  `(TimelineState, ThreadEvent) => TimelineState`. Reused, never rewritten. Note the same-reference
  return on a no-op (`:345-346` is one such branch) — § The write paths depends on it.
- `src/renderer/src/store/threadTimeline.ts:609-616` — `initialTimelineState`. The seed for a newly
  created slice, and **already exported** — read § The read path for why that matters here and did not
  in the twin.
- `src/renderer/src/store/timelineStore.ts` (47 lines) — the flat store this one runs *alongside*. Read
  it to confirm the shape you are mirroring and to confirm **you are not editing it**.
- `src/renderer/src/store/backgroundTaskRosterStore.ts:31-37` — the keying-beats-a-flat-slot argument
  (the daemon fans frames to every interactive connection, so a single "hold the latest" slot lets one
  conversation clobber another). The chain's origin; the twin cites it and so does this.
- `src/renderer/src/store/backgroundTaskRosterStore.ts:398-417` — `selectRosterFor`'s docstring: the
  three-way reading table (`:398-413`) and the narrow-slice `Object.is` property that makes AC3 true
  (`:415-417`).
- `src/renderer/src/store/backgroundTaskRosterStore.ts:282-289` — the other precedent refusing a cap
  ("no speculative eviction policy is built for a failure nobody has observed"). Same reason as the
  twin's `:163-167`: know what you are diverging from.
- `src/shared/ipc/pairing.ts:22-28` — `MAX_PASTE_LENGTH`: the house idiom for a **named bound whose
  reason is stated in the docstring above it**. `MAX_RETAINED_TIMELINES` follows this shape.
- `src/shared/ipc/pairing.test.ts:42-44` — the matching boundary-test idiom: assert *exactly at* the
  bound and *one over*. AC2's bound tests follow this.
- `src/renderer/src/activateConversation.ts:36-45` — the switch seam (#758's, not yours) and the
  **no-history-backfill** premise: the timeline's only production writers are the live stream and the
  composer's optimistic echo. This is why an evicted slice is simply gone and no fetch is added here.
- `vitest.config.ts:15-33` — `environment: 'node'` is already global at `:27` and the `@renderer` /
  `@shared` aliases already exist. Choose nothing here; add no per-file environment pragma.

## Context

The renderer holds exactly one timeline — `timelineStore.ts:24-26` types it, `:42` is the app-wide
singleton — belonging to whichever conversation is open, and `activateConversation.ts:74-77` resets it
on every switch to a different id. Leaving a chat and coming back throws the thread away.

This slice ships the **keyed holder and nothing else**: no writer, no reader. The flat `timelineStore`
stays exactly as it is and keeps serving the open conversation. #756 wires the writer, #757 the clears,
#758 the reader cutover. That staging is what keeps this ticket at one production file with zero edits
to existing ones.

## Size check

| Red line | Limit | This design | |
|---|---|---|---|
| New files | > 3 | 3 (store, test, this spec) | pass |
| **Production source files** created or modified | ≥ 5 | **1** (`conversationTimelineStore.ts`) | pass |
| Total written **code** lines | > ~600 | ~65 production + ~160 test ≈ 225 | pass |
| New exported **types / interfaces** | > 5 | 2 (`ConversationTimelineState`, `ConversationTimelineStore`) | pass |
| Consumer call sites to update simultaneously | > 10 | **0** — a new file with no writer and no reader | pass |
| Acceptance criteria | > 5 | 5 | pass |
| Distinct error / reject branches | > ~10 | **0** — no state machine, no reject path, no log call | pass |

Measured against the twin rather than judged. `conversationActivityStore.ts` shipped `size:s` as
**265 lines raw / 82 code**, with `conversationActivityStore.test.ts` at 410 raw — so #747's actual
shipped total was ~675 raw lines at ~340 code lines. This house documents at roughly 2:1
comment:code, so **size against code lines, not `wc -l`**; the raw total here will land in the same
600–700 band and that is the normal shape of an S store ticket in this repo.

This slice is the twin's shape **plus** the bound and the viewed path (~15 code lines) and **minus** the
four setters and the entry interface (`reduceTimeline` and `TimelineState` are both reused), so it is
marginally smaller in production code than the file it copies.

Six exported *values* accompany the two exported types — `MAX_RETAINED_TIMELINES`,
`initialConversationTimelineState`, the factory, the singleton, the hook, the selector. That is the
four-part house shape plus the bound constant, identical in kind to the twin's five; the red line
counts types, classes, components and interfaces, and this design adds two.

**Branch-overlap check** (`git fetch origin --prune` first, then every `origin/feature/<n>` branch
diffed against `origin/main`, so in-flight work with no PR yet is visible): **no remote feature branch
touches `src/renderer/src/store/` at all**, and none touches `threadTimeline.ts`, `timelineStore.ts` or
`activateConversation.ts`. No `addBlockedBy` needed. Both files are new, so a merge conflict is
structurally impossible for this slice.

> Note for the developer: codegraph is wired for this repo but the index is empty (`.codegraph/` holds
> config only), so every `codegraph_*` call errors. Use grep and Read; the reading list above was built
> that way.

## Design

One new file: **`src/renderer/src/store/conversationTimelineStore.ts`**, in the four-part house shape —
DI factory → app-wide singleton → `useStore` hook → selector factory bound to one id.

### The held value

The payload is `TimelineState` itself, imported from `threadTimeline.ts:190-225`. There is no
`ConversationTimelineEntry` interface, no wrapper, no per-slice metadata field: the whole flat timeline
— the ordered `items`, `phase`, and all four chrome scalars — is what a key holds. That is AC1
verbatim, and it is why this store is smaller than the twin, which had to define its own entry type.

**Nothing is deduplicated against `conversationActivityStore`.** It already holds `stalled`,
`apiRetrying` and `compacting` per conversation and a slice here holds its own copies of the same three.
That overlap is **decided, not pending** — `conversationActivityStore.ts:22-24` states the two run
alongside each other and that the chrome scalars migrate nowhere, because their per-fact clear semantics
span 28 renderer references. Do not unpick it; CLAUDE.md forbids refactoring adjacent code in passing.

### State and store shape

```ts
export interface ConversationTimelineState {
  timelines: ReadonlyMap<string, TimelineState>
}

export type ConversationTimelineStore = ConversationTimelineState & {
  dispatchFor: (conversationId: string, event: ThreadEvent) => void
  markViewed: (conversationId: string) => void
}

export const MAX_RETAINED_TIMELINES = 10
export const initialConversationTimelineState: ConversationTimelineState = { timelines: new Map() }
```

`dispatchFor`, **not** `dispatch`. The flat store's write path is `dispatch(event)` with one argument
(`timelineStore.ts:25`); a same-name-different-shape pair in the same directory is exactly the trap the
twin documents for `apiRetry` (`conversationActivityStore.ts:64-67`). The `For` suffix also pairs it
with `selectTimelineFor`.

`markViewed` is the "this conversation was made active" write path AC2 requires — distinct from folding
an event in, because a conversation working in the background is written constantly and viewed never.

Two write paths, not a reducer over a keyed action union: a fold and a view-stamp are two independent
operations, so a discriminated-union action set is ceremony without benefit (the twin's
`:17-20` posture). There is **no** generic `write(id, key, value)`, which would reintroduce a
stringly-typed key beside the one hostile string this store exists to contain.

### The bound

`MAX_RETAINED_TIMELINES = 10`, exported, with its reason stated in the docstring above it — the
`MAX_PASTE_LENGTH` idiom (`pairing.ts:22-28`). Exported so the tests assert against the named constant
rather than a bare `10`, which is what makes "raising it later is a one-literal edit" true rather than
aspirational. Unlike the twin's `idleActivity`, an exported number invites no semantic collapse.

The reason, to state in the code: the operator's 2026-08-21 ask is about switching between a handful of
chats; ten threads of text is trivial memory; and there is no history backfill, so if ten proves too
small the answer is a backfill ticket, not a bigger constant.

**This is the ticket's one deliberate divergence from both keyed precedents, and the code must say so.**
`backgroundTaskRosterStore.ts:282-289` and `conversationActivityStore.ts:163-167` each refuse a cap on
purpose. Neither refusal transfers, for two reasons that are facts about this slice:

- **What an entry costs.** An activity entry is four booleans plus a bounded id; a roster entry is
  daemon-capped at 8 rows inside a 65519-byte envelope. A timeline slice is a whole thread of assistant
  text with no wire-side ceiling. "Not a plausible exhaustion vector" is load-bearing for those two and
  false here.
- **What clears it.** Both siblings empty wholesale on the `connected` edge, so a reconnect is a floor.
  A timeline must *survive* a reconnect, so #757's clears are the pairing boundary and a conversation
  deletion only. This map has no periodic floor and grows across a long-lived pairing.

### Eviction order — the invariant

**The map's iteration order *is* the eviction order: the head is the next slice to go.** Three rules
maintain it, and nothing else re-orders:

1. A fold into a key **already present** replaces its value and does **not** move it. (`Map.set` on an
   existing key preserves its position — that is what makes "written, not viewed" fail to protect.)
2. A fold that **creates** a key inserts it at the **head** — ahead of every slice already held.
3. `markViewed(id)` moves the key to the **tail**, creating it there (seeded `initialTimelineState`) if
   absent.

The consequence is the whole policy: every never-viewed slice sits ahead of every viewed slice, and the
viewed ones are ordered least-recently-viewed first. So the victim is a never-viewed slice whenever one
exists, and otherwise the least recently viewed.

| step | map, head → tail | note |
|---|---|---|
| fold c1, fold c2 | `c2, c1` | never-viewed, newest at the head |
| `markViewed('c1')` | `c2, c1` | c1 moves to the tail; it was already last here |
| `markViewed('c2')` | `c1, c2` | c2 now most recently viewed |
| fold c1 ×100 | `c1, c2` | **writes do not re-order** — c1 stays the victim |
| fold c3 (at bound) | `c3, c2` | c1 evicted: least recently viewed |

**Why never-viewed ranks oldest** — this is a security decision, not a taste one. The body names the
threat: a noisy or hostile relay fanning frames for ids the operator has never opened mints an entry per
id. If new keys entered at the *tail*, N unknown ids would evict N viewed threads and the bound would
become the mechanism that destroys the operator's chats rather than the thing protecting them. Entering
at the head makes the newest never-viewed slice the standing eviction candidate, so an unbounded burst
of unknown ids **displaces at most one viewed slice and thereafter evicts only its own predecessors**.
The second reason is that there is no backfill (`activateConversation.ts:42-45`): discarding a
never-viewed slice discards content the operator has never seen, which is not symmetric with discarding
a thread he was reading.

The structural backbone, worth stating in the header: **the daemon can only ever insert at the head;
only the operator can move a key to the tail.** `dispatchFor` is the daemon-driven path and it never
promotes; `markViewed` is renderer-local, reachable only from the operator's own activation. So the
protected region of the map is populated by operator action alone.

**Eviction happens before the insert**, against the map as held, so a newcomer can never be its own
victim. Eviction removes the key entirely: an evicted conversation reads as **absent** (`null`) again,
not as an empty slice — honest, because nothing is held, and per the body reopening it shows an empty
thread that fills from the next live event, exactly as every conversation switch behaves today.

Both write paths enforce the bound, since both can create a key. `markViewed` creating an 11th slice
evicts the head just as a fold does.

Ordering data comes **only** from write and view sequence. The id's *value* must never influence
eviction: no sorting of keys, no comparison, no normalisation, lowercasing, trimming or length check
anywhere. A lexicographic sort would hand a hostile id (`''` sorts first) control over which
conversation dies. See § Security review.

### The write paths

Both are one `set` each, copy-on-write, never mutating `s.timelines` or a held slice.

`dispatchFor(conversationId, event)` — fold `event` into that id's slice with `reduceTimeline`,
creating the slice from `initialTimelineState` when the key is absent. Contract:

- **Key present, reduce changed nothing** (`reduceTimeline` returns the same reference — an orphan or
  duplicate `toolResult` is the live example, `threadTimeline.ts:345-346`) → return the state **object**
  itself, so zustand's `Object.is` short-circuit fires and no subscriber wakes. No map clone.
- **Key present, reduce changed something** → clone the outer map, `set` the key (position preserved),
  return fresh state.
- **Key absent** → **always create**, even when the fold is a no-op against `initialTimelineState`. AC1
  says a fold for an id the client has never opened creates that id's slice rather than dropping it, and
  the twin's guard has the same property for a first write of `false`
  (`conversationActivityStore.ts:148-152`). Create at the head, evicting first if at the bound.

`markViewed(conversationId)` — stamp the conversation as most recently viewed. Contract:

- **Already the most recently viewed** (the tail) → return the state object itself; no churn. This is
  the common case rather than an edge one: `activateConversation`'s `onOpen` fires for every row click
  including a re-click of the already-active row (`activateConversation.ts:42`).
- **Present, not the tail** → move it to the tail. Size unchanged, so no eviction.
- **Absent** → create it at the tail seeded with `initialTimelineState`, evicting the head first if at
  the bound.

`markViewed` **must** create on an absent key, and this is load-bearing rather than a convenience: at
the #758 seam the operator opens a conversation *before* any event for it has arrived. If `markViewed`
no-opped, the slice would later be created by a fold — **at the head** — making the conversation
currently on screen the next eviction victim. That is precisely the failure the word "viewed" exists to
prevent.

Rule 2 needs an insert-at-head, which `Map` has no operator for, so the create path **rebuilds** the
map: a fresh `Map`, the new key `set` first, then every survivor `set` in iteration order. At a bound of
ten this is trivially cheap.

> **Read this before code-review flags it.** The twin's header forbids `Object.fromEntries`, spreading
> the map, and `JSON.stringify` of the map. That prohibition is about materialising the map into an
> **object**, which re-creates the prototype hazard the `Map` removes. A `Map` → entries → `Map` rebuild
> materialises no object keys: `new Map(iterable)` uses `Map.prototype.set` semantics, so `'__proto__'`
> stays an ordinary own entry. The rebuild is in bounds; an object literal anywhere on this path is not.

Reference stability holds through both the rebuild and the re-order, because every survivor is copied
**by reference** — `next.get(otherId)` is `Object.is`-identical to `previous.get(otherId)`. That,
combined with a selector that hands back the held slice itself, is the whole of AC3
(`backgroundTaskRosterStore.ts:415-417` states exactly this property).

Seeding a new slice with the shared `initialTimelineState` reference is safe **because `reduceTimeline`
is pure** — it always builds fresh arrays and never mutates `items` in place. That dependency is worth a
comment: an in-place `items.push` anywhere in the reducer would silently alias every empty slice.

### The read path

```ts
export const selectTimelineFor =
  (conversationId: string) =>
  (s: ConversationTimelineState): TimelineState | null =>
    s.timelines.get(conversationId) ?? null
```

The `selectRosterFor` / `selectActivityFor` posture, adopted rather than re-derived. Three readings stay
distinct (AC4):

| map state | selector returns | meaning |
|---|---|---|
| key absent | `null` | nothing is held — no event has ever arrived and it was never opened, **or** it was evicted |
| `initialTimelineState`-shaped slice | that slice | observed; nothing in the thread |
| populated slice | that slice | observed; rows held |

`null` is a stable reference by construction, so no hoisted `EMPTY_*` constant is needed and no fresh
object is built per selector call. The nullable return type forces #758 to branch.

**The twin's structural defence is unavailable here, and this needs stating.** The twin's review says:
do not export the store's default/empty slice constant, because an exported one invites
`selectActivityFor(id) ?? idleActivity`, collapsing absent-vs-observed-empty with no type error and no
failing test. Here the equivalent constant — `initialTimelineState` — is **already exported**
(`threadTimeline.ts:609`) because the flat store needs it, and removing that export is an adjacent
refactor this ticket must not do. So the prohibition lands as three compensating controls instead:

1. The module header states it outright: `selectTimelineFor(id) ?? initialTimelineState` is banned at
   every read site, and names the consequence.
2. This module does **not** re-export `initialTimelineState`, so a reader reaching for the collapse must
   import it from `threadTimeline` deliberately, where it is at least visible in the import list.
3. The AC4 tests assert the distinction through the read surface alone.

#758 inherits control 1 — flag it in that ticket's spec.

There is **no whole-map selector**, no `selectAllTimelines`, and no re-export of `selectItems` /
`selectPhase` / the chrome selectors. A caller branches on `null` and then applies the existing
`threadTimeline` selectors to the slice. Shipping a whole-map read surface nothing reads is the
`backgroundTaskRosterStore.ts:418-419` anti-pattern.

### The hard import constraint

Stated at the top of the module and checkable by grep:

> **This store's only imports are `zustand/vanilla`, `zustand`, and `./threadTimeline`. It imports
> nothing from `activeConversationStore`, nothing from `./timelineStore`, and nothing from
> `src/renderer/src/screens/`.**

That is AC4's teeth. With no reference to the open conversation in scope, the `?? activeConversation`
fallback — banned in prose at `events.ts:116-117` and designed against by #751–#754's required
`conversationId` — is not something a developer must remember to avoid. It is unavailable.

### Explicitly out of scope

- **No writer.** #756 wires the four turn-stream arms into `dispatchFor`. Add no bridge, no
  subscription, no `App.tsx` wiring.
- **No clears.** #757 owns the pairing boundary and the conversation-deletion clear; the deletion seam
  it will need is `src/renderer/src/exitActiveConversation.ts`. Add no `clearAll`, no `dropConversation`,
  and do **not** register this store in `clearPairingScopedState`.
- **No reader, and no edit to `timelineStore.ts` or `activateConversation.ts`.** #758 does the cutover
  and wires `markViewed` at the switch seam (`activateConversation.ts:74-77`, which already takes a
  timeline dep). The viewed path ships **unwired here and that is correct** — the whole slice ships
  dormant, as the third of four merges that lands as a verified no-op from the operator's side. It is
  not dead code.
- **No change to `threadTimeline.ts`.** `TimelineState`, `ThreadEvent`, `reduceTimeline` and
  `initialTimelineState` are imported as they are. No field added, nothing renamed, no second reducer.
- **No history backfill and no fetch.** `activateConversation.ts:42-45` records that the timeline's only
  production writers are the live stream and the composer's echo; #603 already established that premise
  against this codebase. An evicted slice is gone.

## State + concurrency model

Pure renderer state. No IPC, no preload bridge, no transport, no async task, no timer, no
`AbortController`, no teardown, no subscription to cancel. Both write paths are a synchronous `set`
under zustand's own store lock with no `await` inside, so there is no check-then-act gap across a
suspension point for a concurrent handler to interleave into — the same-value guard reads and writes
within one `set` callback.

Unidirectional is preserved: one read-only selector, two store-owned write paths, no setter two-way
bound from a component.

Growth: at most `MAX_RETAINED_TIMELINES` slices. In *this* slice growth is exactly zero — the store has
no writer. The bound is enforced on writes, not at construction; an injected `init` is trusted test
input and is not re-checked.

## Error handling

There are no failure modes to surface, and therefore no `Result` type, no UI surface, no banner and no
dialog. Every write succeeds: a fold for an unknown id creates the slice rather than rejecting, so there
is no miss branch. Every read either finds a slice or reports `null`, and `null` is a legitimate value
rather than an error. Eviction is a normal outcome, not a failure — it is silent by design.

The store is **log-free by construction** — no `console.*` on any path. This is stronger than the twin's
version of the same rule: there, the only value a diagnostic could carry was the untrusted id; here a
log line would carry **assistant message text**. ADR 0007's content-free diagnostics rule (#126) keeps
both out of a file. There is nothing to log anyway.

## Testing strategy

`src/renderer/src/store/conversationTimelineStore.test.ts` — plain-function tests over isolated
`createConversationTimelineStore()` instances, the `conversationActivityStore.test.ts` idiom. No React,
no DOM, no bridge, no render. `environment: 'node'` is already global (`vitest.config.ts:27`), so add no
environment pragma. Follow the twin's helper shape: a local `timelineFor(store, id)` wrapping
`selectTimelineFor(id)(store.getState())`, and locally-constructed `ThreadEvent` literals.

Scenarios, as behaviour statements:

**AC1 — the keyed holder**
- A fresh store reads `null` for every id.
- A fold for an id never opened **creates** that id's slice holding the folded row.
- Interleaved `assistantDelta`s for `c1` and `c2` never merge into one thread — the clobber a flat slot
  causes, and the reason this ticket exists.
- Every scalar is held per id, not just `items`: a `stallDetected` fold for `c1` leaves `c2`'s `stalled`
  false, and the same for `phase`, `apiRetry`, `compacting` and `localSendPending`. One scenario
  covering the set is enough; the point is that the payload is the whole `TimelineState`.
- A fold that reduces to a no-op against a fresh state (an orphan `toolResult`) for an **unknown** id
  still creates a present-and-empty slice — `not.toBeNull()`.

**AC2 — the bound and the eviction order**
- `MAX_RETAINED_TIMELINES` is 10, and the bound tests are written against the constant, not a literal.
- Exactly `MAX_RETAINED_TIMELINES` distinct never-viewed ids are all retained; the map size equals the
  bound. One more fold leaves the size **at** the bound — the *exactly-at / one-over* pair from
  `pairing.test.ts:42-44`.
- The evicted id reads `null` again — absent, **not** a present-and-empty slice.
- **Viewed beats never-viewed:** mark `c1` viewed, fill the remaining slots with never-viewed ids, push
  one more never-viewed id — `c1` survives and a never-viewed slice went.
- **Least-recently-viewed goes first among viewed:** view `c1`…`c10` in order, then create `c11` — `c1`
  is evicted and `c2`…`c10` survive.
- **Written is not viewed** — the test that pins the policy word. `cBusy` is never viewed but folded
  into repeatedly; `cAway` was viewed recently and is now silent. A new id arrives: **`cBusy` is
  evicted and `cAway` survives.** An implementation that re-orders on write passes every other scenario
  and fails this one.
- **`markViewed` promotes:** view `c1` first, then `c2`…`c10`; re-view `c1`; create `c11` — `c2` is
  evicted and `c1` survives.
- **`markViewed` on an absent id** creates an empty, most-recently-viewed slice, so the conversation
  just opened cannot be the next victim even when the map was already full.
- The bound is enforced on **both** write paths: a run of `markViewed` calls for distinct new ids also
  holds the map at the bound.

**AC3 — reference stability**
- After a fold for `c2`, `selectTimelineFor('c1')` returns the **same object reference** as before.
- Stability survives the **rebuild**: after a fold that *creates* a new key, every surviving slice is
  still `Object.is`-identical. (The rebuild is this store's one path the twin never had — a naive
  implementation that reconstructs slices passes the simple case and fails this.)
- Stability survives `markViewed`'s re-order.
- A fold that `reduceTimeline` resolves to a no-op **on an existing key** returns the same *state*
  object (`Object.is` on the whole state), so no subscriber is notified.
- `markViewed` for the already-most-recently-viewed id returns the same state object.
- Negative control: a fold that does change the slice produces a new state object and a new slice for
  that id, so the guards cannot pass by never writing at all.

**AC4 — the three-way read**
- An id never written reads `null`, and reads `null` even while other conversations hold populated
  timelines — it never returns a neighbour's slice.
- A present-and-empty slice (created by `markViewed`) reads `not.toBeNull()` and equals the empty
  timeline shape — distinct from a never-written id's `null`, asserted through the read surface alone.
- The no-fallback constraint is checked by inspection, not by a unit test: the module's import list is
  the assertion. Code-review greps for `activeConversationStore` in this file.

**AC5 — hostile keys**
- `'__proto__'`, `'constructor'` and `''` each, in a loop over the three (the twin's `:204-220` shape):
  reading **before any write** returns `null`; a fold creates an ordinary slice readable only under that
  exact key; an unrelated id still reads `null`; `size` is 1.
- After a fold under `'__proto__'`, `({} as Record<string, unknown>).someKey` is `undefined` and
  `Object.prototype` gained no property — nothing escaped the store's own keyspace.
- `''` and `'__proto__'` hold independent slices; neither aliases the other.
- **New for this ticket:** hostile keys survive the eviction rebuild. Insert `'__proto__'`, then push
  past the bound so the map is rebuilt and re-ordered several times; reads still behave and
  `Object.prototype` is still untouched.
- **New for this ticket:** a hostile id cannot choose the victim. `''` — which sorts first
  lexicographically — is the most recently viewed key, and a fold that forces an eviction takes a
  never-viewed slice instead. An implementation that sorts keys fails this.

**DI**
- Two stores from the factory are independent.
- A store starts from an injected initial state.

Type-level coverage rides `npm run typecheck`. Run `npm test` and `npm run build` before handing off.

## Open questions

None blocking. Three decisions recorded so #756, #757 and #758 do not relitigate them:

1. **Never-viewed ranks as infinitely stale.** AC2 says "least recently viewed" and is silent on where a
   never-viewed slice ranks. This spec ranks it ahead of every viewed slice, for the hostile-fan-out
   reason in § Eviction order. If #758 finds the operator wants the opposite, it is a change to rule 2
   alone.
2. **`markViewed` creates on an absent key.** Required by the #758 seam, not a convenience — see
   § The write paths. #758 calls it at activation and may rely on the slice existing immediately after.
3. **The slice holds its own copies of `stalled` / `apiRetry` / `compacting`,** duplicating
   `conversationActivityStore`. Decided at `conversationActivityStore.ts:22-24`; not this ticket's to
   unpick, and not #756's either.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. Two untrusted inputs cross into this module, one more than the
  twin had. (a) The `conversationId`, daemon-asserted, used **only** as a `Map` lookup key — never
  stored inside a slice, never rendered, never concatenated, never a filename, cache key or URL, never
  compared against a secret. (b) The `ThreadEvent` payload, which unlike the twin's four booleans
  carries **daemon message text**. The boundary is explicit and single: one named type
  (`ReadonlyMap<string, TimelineState>`) and one already-shipped pure reducer (`reduceTimeline`), with
  no parsing added here — the fail-closed decode happened upstream (`events.ts:110-112`: a missing or
  non-string `conversation_id` fails the whole line without emitting), and
  re-validating it here would be a second, weaker boundary competing with the real one. The text is
  held, never rendered: CLAUDE.md's rule that daemon text may be rendered escaped and length-bounded but
  must never reach a raw-markup sink, an attribute, a URL, a filename or a log stays entirely with the
  render layer, and this store widens nothing — `selectTimelineFor` hands back the same `TimelineState`
  the flat store already hands the screens today.

- **[Prototype pollution — the ticket's stated security surface]** No findings; the property holds **by
  construction**. `ReadonlyMap` is mandated and `Record<string, …>` forbidden:
  `Map.prototype.get('__proto__')` performs no prototype-chain lookup and `Map.prototype.set('__proto__',
  v)` creates an ordinary own entry, so `'__proto__'`, `'constructor'` and `''` are three unremarkable
  keys. Three consequences pinned in the spec because none is a type error: nothing is keyed into an
  object literal; no computed object keys anywhere on either write path; and `Object.fromEntries`,
  spreading the map into an object, and `JSON.stringify` of the map are all out. **This ticket adds a
  hazard the twin did not have** — the insert-at-head rebuild — so § The write paths states explicitly
  that a `Map` → entries → `Map` rebuild materialises no object keys and is in bounds, while an object
  literal on that path is not, and § Testing strategy adds a hostile-key-survives-eviction test that the
  twin had no need for. AC5 is tested rather than merely asserted because a future `Map`→`Record` swap
  produces no type error and breaks no other assertion; the read *before any write* is the assertion
  that catches it. The house rule already holds repo-wide (`queueStore.ts:39`,
  `runSettingsWriteStore.ts:65`, `backgroundTaskRosterStore.ts:212`, `conversationActivityStore.ts:92`).

- **[Resource exhaustion — the ticket's reason for existing]** No findings, and this category got the
  design's real attention. Two sub-questions:
  - *Slice count.* Bounded at `MAX_RETAINED_TIMELINES = 10` with eviction on every creating write. The
    non-obvious risk is not the bound's existence but its **ordering**: with new keys entering at the
    tail, a hostile relay fanning frames for N ids the operator has never opened would evict N of his
    threads, making the bound the attack's mechanism. Head-insert makes the newest never-viewed slice
    the standing eviction candidate, so an unbounded burst displaces **at most one** viewed slice and
    thereafter evicts only its own predecessors. Reinforced structurally: `dispatchFor` (daemon-driven)
    can only ever insert at the head, and only `markViewed` — renderer-local, reachable only from the
    operator's own activation — moves a key to the tail. The protected region is populated by operator
    action alone.
  - *Slice size.* **OUT OF SCOPE, named.** The bound caps the number of slices, not bytes; a hostile
    daemon inside the session can grow one thread without limit via `assistantDelta`. This ticket does
    not introduce that exposure — today's flat `timelineStore` has exactly the same unbounded single
    thread — it multiplies the worst case by at most ten, which is the cost of the behaviour the
    operator asked for. No per-slice byte cap or row-count truncation is specified, because none has
    been observed to be needed and a truncation policy has UI consequences (which rows to drop) that
    belong in their own ticket with the operator's input. If it is ever wanted, it is a change to
    `reduceTimeline`, not to this store.

- **[Misattribution / confused deputy]** No findings. Two structural defences. The read is a bare
  `Map.get` with `?? null`, so an unknown id is an explicit no-match that can never resolve onto a
  neighbour's slice; and the module imports neither `activeConversationStore` nor anything from
  `src/renderer/src/screens/`, so the `?? activeConversation` fallback that #751–#754's required
  `conversationId` was designed to prevent has no reference available to write. Asserted by the AC4 test
  that reads `null` for an unwritten id *while other conversations hold populated timelines*. One
  additional rule this store needs and the twin did not, because this one has an ordering: **eviction
  order derives only from write and view sequence, never from the id's value.** No sorting, comparing,
  normalising, lowercasing, trimming or length-checking of keys anywhere — a lexicographic sort would
  hand a hostile id (`''` sorts first) the choice of which conversation dies. Pinned in
  § Eviction order and covered by the AC5 victim-choice test.

- **[Error messages, logs, telemetry]** No findings. Log-free by construction, and the rule bites harder
  here than in the twin: a diagnostic on this path would carry not just the untrusted id but assistant
  message text. ADR 0007's content-free rule (#126) keeps both out of a file. A read miss and an
  eviction are both silent by design, not swallowed errors. Nothing throws, so no error object, message
  or stack trace can carry either value.

- **[File / storage operations]** No findings, and the rule is live rather than vacuous: nothing here
  touches disk and nothing may — no `localStorage`, `sessionStorage`, IndexedDB or `userData` file.
  `defaultWorkspaceStore` and `pushNotificationPrefStore` do persist to `localStorage`, so a developer
  has an in-repo pattern to copy from, and copying it here would be materially worse than in the twin:
  it would write **conversation content** to renderer-side web storage, surviving the pairing boundary
  #757 exists to enforce and landing message text in a store readable by anything that can open DevTools.
  No path traversal, TOCTOU or atomic-write question arises — there is no path and no file.

- **[Inter-process / Electron attack surface]** No findings — the design adds none. No `contextBridge`
  API, no `ipcMain` channel, no `BrowserWindow` option, no protocol handler, no navigation. Pure
  renderer state reaching no IPC; the transport, keys and Noise handshake stay in the main process
  untouched (CLAUDE.md), and this store holds no key, token or socket, so it widens no path from the
  renderer toward the main process.

- **[Cryptographic primitives]** Not applicable — no randomness, no hashing, no key material, no
  comparison against a secret. Key lookup is `Map`'s SameValueZero on a non-secret string, where
  constant-time comparison is meaningless; there is no token or MAC compare anywhere in the file.

- **[Network & I/O]** Not applicable — no socket, no fetch, no URL, no frame handling, no timeout to
  set. Frame-size caps, relay URL validation and TLS all live upstream in the main process and are
  untouched.

- **[Concurrency]** No findings. No async task, timer, listener or `AbortController`, so nothing to
  cancel on teardown and no duplicate-connection question. Both writes are a synchronous `set` with no
  `await` inside, so there is no check-then-act race across a suspension point — the same-reference
  guards read and write within one `set` callback under zustand's own store lock. Shutdown safety is
  vacuous: the store is in-memory only and persists nothing, so there is no partial write to recover.

- **[Threat model alignment]** A hostile relay is on-path but content-blind and cannot reach this
  store's inputs except through the Noise session; its flooding capability is the exhaustion vector
  addressed above. A hostile daemon *inside* the session is the actor AC5 models for keys and the
  slice-size finding names for content. Renderer compromise reaching the transport is unchanged.
  **Out of scope, named:** the pairing-boundary and conversation-deletion clears that stop one pairing's
  threads appearing under the next are **#757**; until they land this store is written by nobody
  (**#756**), so no stale-across-pairings state can exist on `main` at any point in the chain — the same
  leak-never-exists-on-`main` ordering that put #757 ahead of #758.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
