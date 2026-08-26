# #778 — Derive a conversation's unread mark from its last-read mark

## Design source

N/A — per the ticket body, this slice renders nothing; it exposes a predicate. #676 draws the green
"New messages" dot and carries the Figma reference. The visual-fidelity check is intentionally skipped.

## Files to read first

- `src/renderer/src/store/conversationTimelineStore.ts:383-412` — `selectTimelineFor(id)` →
  `TimelineState | null`. Read the docstring's three-reading table (absent / present-empty / populated)
  and the header's ban at `:46-51` on `?? initialTimelineState` at a read site. **This ticket is that
  read site.**
- `src/renderer/src/store/conversationTimelineStore.ts:96-115` — `MAX_RETAINED_TIMELINES` and why an
  evicted key reads absent rather than empty. This is the discontinuity AC4 answers.
- `src/renderer/src/store/conversationLastReadStore.ts:378-409` — `selectLastReadFor(id)` →
  `LastReadMark | null`, and why `||` breaks it where `??` does not. `0` is a real, producible mark.
- `src/renderer/src/store/conversationLastReadStore.ts:118-125` — `LastReadMark` is a **count of timeline
  items seen**, never a timestamp. Settled upstream; do not re-derive.
- `src/renderer/src/store/threadTimeline.ts:189-200` — `TimelineState`, whose `items: readonly ThreadItem[]`
  at `:191` is the only live per-conversation quantity that moves on content arrival.
- `src/renderer/src/store/conversationLastReadBridge.ts:100-115` — `stampLastReadFor`, the one writer.
  Note `:114`: an absent slice stamps `0`. Understanding what the mark means when it was written is what
  makes the read side's branches honest. **Read the header at `:1-30` too** — it states the invariant this
  ticket reads back ("the open conversation's mark equals its own held item count").
- `src/renderer/src/store/timelineBridge.ts:389-435` — the fan-out that routes each id-carrying arm into
  `conversationTimelineStore.dispatchFor` regardless of which conversation is open. **This is what makes
  AC3 true**, and it already ships and is already tested; AC3's job here is to close the loop, not to
  rebuild the feed.
- `src/renderer/src/screens/channels/channelListViewModel.ts:1-49` and
  `src/renderer/src/screens/archive/archiveViewModel.ts:1-49` — the framework-free pure-derivation shape
  to copy: plain exported functions, no React, no store import, injected inputs, every branch unit-testable.
- `docs/knowledge/features/conversation-last-read-store.md:113-118` — the "a recreated timeline slice can
  restart below a stale mark" open question, left explicitly for this ticket. AC4 and the ordering rule
  below are the answer.
- `CLAUDE.md` § "Build and test" — renderer tests are **static server renders in a `node` environment**.
  There is no DOM, no `jsdom`, no `@testing-library`. Nothing in this ticket may need one.

## Context

`conversationLastReadStore` (#775) holds a per-conversation count of timeline items seen, persisted (#776)
and stamped for the open conversation (#777). `conversationTimelineStore` (#755/#756/#757/#786) holds a
per-conversation `TimelineState`. Both ship with a `?? null` selector factory and no reader for the pair.

This ticket is the read boundary between them, and nothing else: **a conversation is unread when its held
timeline has more items than its last-read mark.** No new store, no new bridge, no new IPC arm, no render.

Why a count and not `ConversationSummary.last_message_ts`: that field only moves when the renderer
re-requests `list_conversations`, which `conversationListBridge.ts:53-60` does at mount and on
`conversationUpdated` / `conversationDeleted` / `conversationCreated` — and the daemon's
`conversation_updated` broadcast fans out on promote, rename and archive, **not** on message arrival. A
derivation on `last_message_ts` unit-tests green and never fires in the running app. Settled upstream; this
spec records it so it is not walked back into.

## Design

### One new file, one new export

`src/renderer/src/store/conversationUnread.ts` — a framework-free pure module. Not a store: no `Store`
suffix, no `createStore`, no zustand import, mirroring how `threadTimeline.ts` (pure) sits beside
`timelineStore.ts` (a store) in this same directory.

It lives in `store/` rather than under a `screens/` directory because its inputs are **store slices**, not
`ConversationSummary` wire rows, and because its consumer (#676) is the sidebar of the new desktop layout
rather than any one existing screen. The two view-model precedents are the model for its *shape* — pure,
injected inputs, framework-free — not for its location.

```ts
export function isConversationUnread(
  timeline: TimelineState | null,
  lastRead: LastReadMark | null
): boolean
```

**HARD IMPORT CONSTRAINT, checkable by grep: this module's only two imports are `import type`,** and it has
**no value import at all**. `TimelineState` from `./threadTimeline`, `LastReadMark` from
`./conversationLastReadStore`. This is stated as a constraint rather than a style note because dropping the
`type` keyword is no type error and no failing test, and it changes what the module *is*: a value import of
`conversationLastReadStore` constructs its app-wide singleton, pulling the `localStorage` port into this
module's graph and into every test that imports the predicate. Written as `import type`, both are erased at
compile time, so the module has **zero runtime dependencies** — which is what lets scenarios 1–8 below test
it with no store, no port and no singleton in scope. Code review checks the import block.

### The branch order is the contract

Three branches, evaluated in this order. The order is the design, because AC4 and AC5 disagree about the
`(absent timeline, absent mark)` state and the ticket rules that AC4 wins:

1. `timeline === null` → **`false`** (read). AC4. Nothing is held for this conversation — never fed, or
   evicted at the ten-slice cap — so there is no content this client can see, whatever mark it carries.
   *A stuck mark nobody can clear is worse than a missed one.* **This branch is first**, and that
   precedence is what resolves the collision: at launch no slices are held and no marks exist for
   conversations never opened, and a mark-first reading would light the entire sidebar on every start —
   the exact failure #776's persistence was built to prevent.
2. `lastRead === null` → **`true`** (unread). AC5. A timeline is held and this client has no record of
   having read it, so a chat another client has driven is never invisible. Opening it clears the mark by
   the ordinary path (`stampLastReadFor`); nothing here writes.
3. otherwise → **`timeline.items.length > lastRead`**. AC1 and AC2. Strict `>`: equal counts read as read.

**No `?? 0`, no `?? initialTimelineState`, no `||`, no default parameter, no non-null assertion.** Both
inputs are nullable on purpose and each absent case is a written-out branch. `items.length > (lastRead ?? 0)`
collapses branch 2 into branch 3 and type-checks identically — it is the same collapse both source-store
headers ban at their read sites, and it also silently changes the decided corner below. The nullable
parameter types are the whole structural defence: a caller cannot reach this function with a collapsed
value without deliberately writing the collapse itself.

### Two corners that are decided, not open

**A present but EMPTY slice with no mark reads as UNREAD.** This falls out of branch 2 running ahead of
branch 3, and it is deliberate rather than an oversight. It is reachable: `dispatchFor` creates a slice on
an absent key *unconditionally* (`conversationTimelineStore.ts:279-282`), including for arms that never
touch `items` — `turnState`, `stallDetected`, `apiRetry`, `compacting`, `reconnected` — so a turn running
in a conversation the operator has never opened mints an empty slice with no mark. Reading that as unread
is the honest answer: an event that creates a slice without adding a row is still evidence of activity in a
conversation this client has never read. The alternative reading (`0 > 0` → read) requires exactly the
`?? 0` the ticket bans. **Pin it with a named test** so neither a later edit nor code review "fixes" it.

**A recreated slice below a stale mark reads as READ.** Mark `47` against a recreated count of `1` is
`1 > 47` → `false`. This is the open question
`docs/knowledge/features/conversation-last-read-store.md:113-118` left for this ticket, and it is answered
in the direction the ticket states: a missed mark beats a stuck one. **Pin it with a named test** — it is
the case most likely to look like a bug to a future reader.

### What is NOT in this ticket

- **No React hook.** `useConversationUnread(id)` was considered and declined. The collapse hazard it would
  centralise is already closed by the nullable parameter types above, and this repo's vitest runtime is
  `node` with no DOM, so a hook would ship an untestable surface. #676 composes the two existing bindings
  at its own render site: `useConversationTimelineStore(selectTimelineFor(id))` and
  `useConversationLastReadStore(selectLastReadFor(id))`, both handing back `Object.is`-stable references,
  then calls this predicate. If #676 finds the composition wants a home, that is #676's call to make with
  a real consumer in hand.
- **No change to either source store.** Neither selector, neither header, no new export from either.
- **No whole-map read surface.** No `selectAllUnread`, no set of unread ids. The sidebar reads one row at a
  time (`conversationActivityStore.ts:258-260`), so a whole-map surface would ship unread.
- **No widening into #777's teardown edge.** The documented, deliberately-unfixed case where a teardown
  clear persists a spurious `0` over a true mark is #777's, with a proposed fix already recorded in
  `paired-shell.md`. Leave it alone.
- **No defence against a negative or non-integer mark.** `decodeLastReadMarks` already rejects them at the
  persistence boundary and `recordLastRead`'s only caller passes `items.length`. Shipping a guard for an
  unobserved failure is the anti-pattern both source stores name.

## State and concurrency model

None introduced. The function is pure, synchronous, total over its declared parameter types, and holds no
state. It reads no store; its inputs are passed in. Nothing to cancel, nothing to tear down, no effect, no
subscription, no timer.

Both source stores are unchanged. Their existing re-render narrowness carries over as-is: `selectTimelineFor`
hands back the held slice itself and `selectLastReadFor` a `number` or `null`, so at #676's eventual call
site a row re-renders only when its own conversation's slice or mark changes.

**Reading two stores is not a torn read, and must not be "fixed" into a combined snapshot.** The two reads
happen back to back with no `await` between them; zustand's vanilla `setState` reassigns state and *then*
calls its listeners, and the renderer is single-threaded, so there is no suspension point for a write to
interleave into. At #676's eventual call site the two `useStore` subscriptions are independently
tearing-free within a render, and a pair drawn from adjacent commits is at most one render stale and
self-corrects on the next — a momentary dot, never a wrong resting state. Do not introduce a merged
snapshot, a combined store, or a `useMemo` over both to close a gap that does not exist.

## AC3 — the liveness criterion

AC3 ("reads as unread without waiting for a conversation-list re-request") is a property of the **feed**,
which already ships: `timelineBridge.ts:428-433` routes every id-carrying arm into
`conversationTimelineStore.dispatchFor` under the event's own `conversationId`, with no dependence on which
conversation is open and no `list_conversations` round trip. That half is already covered by
`timelineBridge.test.ts`.

This ticket's job is to close the loop, and it does so with one store-level test rather than by rebuilding
the feed — see scenario 9. Do not add a second per-conversation arrival holder; the ticket names that
explicitly and `conversationLastReadStore.ts:38-45` records the reasoning.

## Error handling

There are no failure modes to surface. Both inputs are already-validated in-memory renderer state:
`LastReadMark` is a non-negative integer enforced at the persistence boundary, and `TimelineState` is built
by `reduceTimeline`. The function cannot throw, does not parse, does not touch the network, the filesystem
or IPC, and has no result type beyond `boolean`.

It is **log-free by construction**, matching both source stores: no `console.*` on any path. The only value
a diagnostic here could carry is the untrusted conversation id, which ADR 0007's content-free-diagnostics
rule keeps out of a file. There is no read miss to report — an absent input is a defined reading, not an
error.

## Security

The conversation id is daemon-asserted untrusted text. In this module it is **not a parameter at all** —
the predicate takes the two already-resolved slices, so the id never enters this file. That is the strongest
available form of the constraint and it should stay that way: do not add a `conversationId` parameter and do
not have this module perform its own `Map` lookups.

At the call site (#676, and the AC3/hostile-key tests here) the id remains a `Map` key and nothing else.
`Map.prototype.get('__proto__')` performs no prototype-chain lookup, so `'__proto__'`, `'constructor'` and
`''` are three unremarkable keys by construction in both source stores. Nothing in this ticket may
re-materialise that hazard: no object literal keyed by an id, no computed object keys, no
`Object.fromEntries`, no spreading either store's map into an object. The id must never reach a raw-markup
sink, an attribute, a URL, a filename, a cache key or a log.

## Testing strategy

`src/renderer/src/store/conversationUnread.test.ts`, vitest, `node` environment. No DOM, no render, no
React — scenarios 1–8 and 10 call the function directly; scenario 9 constructs two real stores. Test-first.

Scenarios 1–8 build a `TimelineState` by folding events through the existing `reduceTimeline` from
`initialTimelineState`, or use `initialTimelineState` itself for the empty-slice cases — do not hand-write
a `TimelineState` object literal, which would drift from the real shape.

1. **AC1 — more items than the mark → unread.** A slice holding 3 items against a mark of `1`.
2. **AC2 — exactly the mark → read.** A slice holding 3 items against a mark of `3`. Pins the strict `>`;
   a `>=` would fail here.
3. **AC2 — the recreated-slice case → read.** A slice holding 1 item against a stale mark of `47`. Named
   for the eviction discontinuity, so the decided corner is legible in the test output.
4. **AC4 — absent timeline, mark present and non-zero → read.** `null` timeline, mark `5`.
5. **AC4 beats AC5 — absent timeline AND absent mark → read.** The branch-ordering test: swapping branches
   1 and 2 fails only this one. Name it for the launch state it protects (no slices held, no marks
   recorded, the sidebar must not light up).
6. **AC5 — present populated slice, absent mark → unread.** A slice holding 2 items, mark `null`.
7. **AC5 — present EMPTY slice, absent mark → unread.** `initialTimelineState`, mark `null`. The decided
   corner; the test name should say it is deliberate and why (a slice minted by a non-row-adding arm is
   still activity in a conversation never read).
8. **`0` is a real mark, not "never read".** `initialTimelineState` against a mark of `0` → read.
   Distinguishes branch 2 from branch 3 in the other direction; a `||`-based selector or a `?? 0` collapse
   makes this and scenario 7 agree, which is the bug.
9. **AC3 — liveness, without a conversation-list re-request.** Construct a `createConversationTimelineStore()`
   and a `createConversationLastReadStore(<in-memory fake port>)`. Stamp conversation `A` as read via
   `recordLastRead`. Then `dispatchFor('B', <a row-adding event>)` — one call, nothing else. Read
   `selectTimelineFor('B')` and `selectLastReadFor('B')` off the two stores and assert the predicate is
   `true`, and that `A` still reads `false`. The assertion that carries AC3 is what the test does **not**
   do: no `list_conversations` reply, no `conversationUpdated` / `conversationDeleted` /
   `conversationCreated`, no reconnect, no restart, no `markViewed`. State that in a comment — it is the
   criterion. **Call `recordLastRead` and `dispatchFor` directly; do not mount `useConversationLastRead()`**
   (`conversationLastReadBridge.ts:160-180`) to make the test look more realistic. That helper opens a
   store→store subscription with a teardown this test has nowhere to run, and the write path it exercises
   is #777's, already covered by `conversationLastReadBridge.test.ts`. Two direct writes is the whole
   fixture.
10. **Hostile keys resolve to their own conversation.** Using `'__proto__'`, `'constructor'` and `''` as
    conversation ids against the two real stores: dispatch a row-adding event under `'__proto__'` only,
    then assert `'__proto__'` reads unread while `'constructor'` and `''` both read **read** — i.e. no
    neighbour's slice and no prototype-chain lookup resolves the miss. Reads before any write are the
    diagnostic half; a `Record`-backed store would fail this and nothing else.

Type-level coverage rides on `npm run typecheck`: the two nullable parameter types are what force every
consumer to branch, and a caller passing a collapsed value is a deliberate act rather than an accident.

Gates: `npm test` and `npm run build`.

## Scope

One new production file (`src/renderer/src/store/conversationUnread.ts`, one exported function) and one new
test file. No existing production file is modified. Comfortably inside `size:s` — the shape is XS; the label
is left alone as an upper bound rather than relabelled.

## Open questions

None blocking. Two things are deliberately deferred rather than open:

- **Where the two-store composition eventually lives** is #676's call, made with a real consumer in hand.
  This ticket ships the predicate and no binding.
- **Whether an evicted-then-recreated slice should be recoverable** (so a stale mark cannot hide new
  content indefinitely) is a backfill question, not a read-boundary one. The ticket's stated preference —
  a missed mark over a stuck one — settles the behaviour for now; a change would need a history backfill
  that does not exist in this app (`conversationTimelineStore.ts:88-93`).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and one property worth pinning. Two untrusted values *could* reach
  this design and neither enters the module: the conversation id is resolved to a slice and a mark by the
  two callers' `Map` lookups **before** the predicate is called, so the id is not a parameter and cannot be
  added as one without changing the signature; and daemon message text lives inside `TimelineState.items`,
  of which this module reads **only `.length`** and never an element. Untrusted content therefore has no
  path into this file at all. The one boundary that does bear on the design is `decodeLastReadMarks`
  (`conversationLastReadStore.ts:212-232`), which is where a hand-edited `localStorage` blob becomes a
  `LastReadMark`; it enforces `string` key, `Number.isInteger`, `>= 0`, and rejects the blob whole. This
  spec adds no second decode path and re-validates nothing, which is correct — a second boundary would be
  a second thing to get wrong.
- **[Trust boundaries] SHOULD FIX (accepted, not gated) — a forged large mark suppresses a conversation's
  dot.** An attacker with write access to the user's renderer `localStorage` can store a mark of, say,
  `Number.MAX_SAFE_INTEGER`; `decodeLastReadMarks` accepts it (it bounds the *type*, not the magnitude),
  and branch 3 then reads that conversation as read for as long as the mark stands. The impact is
  denial-of-visibility on one conversation's dot — no memory or CPU cost, no injection, no data disclosure.
  It is bounded and self-healing by mechanisms that already ship: `stampLastReadFor` **assigns** the sampled
  count and never `Math.max`es it (`conversationLastReadStore.ts:306-308` makes replacement-not-monotonic an
  explicit design property), so simply opening the conversation resets the mark downward, and #779's
  pairing-boundary clear floors the whole map. Not fixed here: adding a magnitude cap would edit #776's
  decoder — another ticket's file, for a failure nobody has observed, against an attacker who already holds
  write access to the user's own profile. Named so code review sees it decided rather than missed.
- **[Tokens, secrets, credentials]** No findings. This ticket introduces no token, key or credential, reads
  none, and writes nothing to any storage. The `pyry.conversationLastRead` key it reads *through* holds
  conversation ids and small integers only — ruled non-secret at #776 — and the predicate cannot widen what
  is stored there because it has no write path.
- **[File / storage operations]** No findings. No `fs`, no `path`, no `node:*`, no URL, no filename, no
  cache key: the module's inputs are one state object and one number, and its output is a `boolean`, so
  there is no traversal, TOCTOU or atomicity surface to reason about. The tests stay off real storage too —
  scenario 9 injects an in-memory fake port rather than letting the store reach for the real one.
- **[Inter-process / Electron attack surface]** No findings. No `BrowserWindow`, no `webPreferences`, no
  `contextBridge` API, no `ipcMain` channel, no custom protocol, no navigation or window-open handler —
  nothing crosses the process boundary in either direction. Process placement is satisfied structurally
  rather than by convention: the **hard import constraint** in § Design makes this a renderer-side module
  with *zero runtime imports*, so it holds no key, no socket and no Noise state, and a renderer compromise
  reaching this module reaches nothing through it. The constraint is the load-bearing part — dropping the
  `type` keyword is no type error and would silently pull the last-read singleton and its `localStorage`
  port into the graph, which is why it is written as a grep-checkable rule for code review rather than left
  to the developer's memory.
- **[Cryptographic primitives]** Not applicable, with the reason rather than the label: the module performs
  exactly one comparison, `items.length > lastRead`, and **neither operand is a secret** — both are
  client-side counts of rows the operator can see. So there is no MAC, token or key compare here for
  `crypto.timingSafeEqual` to protect, and no RNG, hash, KDF, nonce or Noise state anywhere in scope. If a
  future edit ever compares one of these values against something secret, that is a different function.
- **[Network & I/O]** No findings, and the design decision *is* the mitigation. No socket, no frame, no
  relay URL, no TLS, no timeout, no reconnect — the function is synchronous and does no I/O. The one
  network-shaped threat that touches this feature is a hostile paired daemon minting conversation ids to
  grow per-conversation state; this ticket adds **no new holder**, per the ticket body's explicit "do not
  re-derive a second per-conversation arrival holder", so its contribution to that vector is exactly zero.
  The existing bounds are unchanged and inherited: `MAX_RETAINED_TIMELINES` caps the timeline map at ten
  slices, and the last-read map's deliberate uncapped-ness was ruled at #775 and re-ruled at #776 (~50
  bytes per entry against a megabyte budget).
- **[Error messages, logs, telemetry]** No findings. Log-free by construction and stated as such in
  § Error handling: no `console.*` on any path, no throw, no error object built from either input. This is
  a real constraint here rather than boilerplate — the only values a diagnostic could carry are the
  untrusted conversation id (which never enters the module) and daemon text (which the `.length`-only read
  never touches), and ADR 0007's content-free-diagnostics rule keeps both out of a file. An absent input is
  a defined reading, not a swallowed error. The standing risk is a debug `console.log` left behind while
  working scenarios 9–10; code review checks for it.
- **[Concurrency]** No findings. Nothing async is introduced: no `await`, no timer, no listener, no
  subscription, no `AbortController`, and therefore no teardown, no cancellation and no shutdown path. The
  predicate holds no state, so there is no check-then-act critical section. The one concurrency-shaped
  question — that the timeline and the mark are read in two separate steps — is analysed in § State and
  concurrency model and is **not** a torn read (synchronous zustand `setState`, single-threaded renderer,
  no suspension point between the reads), with the "do not fix it into a combined snapshot" instruction
  attached so the analysis is not quietly reversed. Scenario 9 is explicitly barred from mounting
  `useConversationLastRead()`, which would open a store→store subscription the test has nowhere to tear
  down.
- **[Threat model alignment]** No findings; each applicable desktop threat is addressed or inherited.
  *Malicious/compromised relay* — content-blind and outside the Noise session, so it cannot mint a timeline
  arm at all; the most it can do is drop or delay frames, which suppresses a dot, and that is the direction
  the ticket already prefers ("a missed mark is better than a stuck one"). *Hostile paired daemon* — can
  fold events under ids the operator never opened and thereby light dots, and per
  `conversationTimelineStore.ts:189-199` (#786) can displace viewed slices via `conversationCreated`. That
  exposure is inherited and accepted upstream on the actor (the paired daemon already owns the entire
  content stream and can reset the flat timeline the screen renders); this ticket reads that state and
  widens it by nothing, so it is recorded rather than re-litigated. *Token theft from disk* — no token in
  scope. *Renderer compromise reaching the transport* — blocked structurally by the zero-runtime-import
  rule above. *Hostile daemon response parsed defensively* — no parsing in this ticket; the only decode on
  this path is #776's, unchanged.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-26
