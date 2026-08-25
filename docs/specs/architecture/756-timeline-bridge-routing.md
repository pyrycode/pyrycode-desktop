# #756 — write every timeline event into its own conversation's slice

Child F of #675. The keyed holder (#755) has a writer after this lands. Nothing reads it yet (#758) and
nothing clears it yet (#757), so this ships as a verified no-op from the operator's side.

## Design source

N/A — no visible change by construction. The fourth acceptance criterion IS the design contract: the
flat `timelineStore` keeps receiving exactly what it receives today, so every rendered surface is
byte-identical before and after. There is no Figma node because there is no pixel to match.

## Files to read first

Codegraph is wired but not indexed for this repo (`.codegraph/` holds only `config.json`; every
`codegraph_*` call errors `CodeGraph not initialized`, probed 2026-08-24). This list is hand-built from
the ticket's own citations plus a `grep` sweep of the flat store's production writers.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/timelineBridge.ts:1-10` | The header's "owns exactly the two stream arms" framing — it predates the eleven-arm reality below it and needs a routing sentence, not a rewrite. |
| `src/renderer/src/store/timelineBridge.ts:37-218` | `translateTimelineEvent` — the pure choke point. **Its signature and body do not change.** Read the eleven owned `case` arms and the fall-through null group; note that eight read `event.conversationId` in their comments and say the id "STOPS here". |
| `src/renderer/src/store/timelineBridge.ts:227-235` | `subscribeTimeline` — the seam this ticket widens. Two injected deps, translate-then-dispatch. |
| `src/renderer/src/store/timelineBridge.ts:244-252` | `useTimelineBridge` — the single production caller and the composition root that gains the fan-out. |
| `src/renderer/src/store/conversationTimelineStore.ts:5-11` | The paragraph this ticket falsifies ("no writer and no reader", "ships dormant", "#756 wires the four turn-stream arms"). Comment-only correction, in scope. |
| `src/renderer/src/store/conversationTimelineStore.ts:31-35` | HARD IMPORT CONSTRAINT. It binds the **store module**, not this bridge — do not read it as forbidding `timelineBridge.ts` from importing the store. |
| `src/renderer/src/store/conversationTimelineStore.ts:133-136` | `dispatchFor(conversationId, event)` — argument order is `(id, event)`, the reverse of how the bridge will read them. |
| `src/renderer/src/store/conversationTimelineStore.ts:140-169` | THE EVICTION INVARIANT. Read before touching anything: this ticket is what first arms it. |
| `src/renderer/src/store/conversationTimelineStore.ts:261-263` | "`reduceTimeline` IS PURE — it always builds fresh arrays and never mutates `items` in place." The licence to hand one `ThreadEvent` reference to two stores. |
| `src/renderer/src/screens/conversation/composerSend.ts:16-20` | `ComposerSendDeps` — the interface gaining one required field. |
| `src/renderer/src/screens/conversation/composerSend.ts:41-70` | `submitMessage`; `:47-48` are the two `false` guards, `:48` the null-id refusal that makes the id non-null below it, `:67` the echo. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1930-1933` | The in-file precedent for required-vs-optional: "requiring it costs no edit cascade and makes 'forgot to wire it' a compile error." This ticket applies that rule twice and gets opposite answers; read why. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1942`, `:1950`, `:1959-1963` | The composer's `dispatch` selection, the `activeConversationId` selection, and the deps object literal — the three lines the container edit touches. |
| `src/shared/ipc/events.ts:130`, `:141`, `:156`, `:176`, `:203`, `:230`, `:500`, `:522` | The eight arms carrying `conversationId: string`. Confirm all eight are REQUIRED, never optional — the routing key's non-nullability is load-bearing below. |
| `src/renderer/src/store/threadTimeline.ts:127` | The `userText` ThreadEvent arm the composer echo dispatches. |
| `src/renderer/src/store/timelineBridge.test.ts:438-818` | The existing `subscribeTimeline` block — 21 call sites that must keep compiling **and passing, unedited**. They are this ticket's AC4 proof; treat any edit to them as a design failure. |
| `src/renderer/src/store/conversationTimelineStore.test.ts` | The holder's hostile-burst and eviction-order tests. Do not duplicate them here. |

## Context

`useTimelineBridge` (`timelineBridge.ts:244-252`) dispatches every translated event into the one flat
`timelineStore`, and the composer's optimistic echo (`composerSend.ts:67`) writes into the same flat
store. A `grep` of production references confirms the ticket's claim exactly: those two are the only
writers that ADD a row. The other three (`PairedShell.tsx:47`/`:70`/`:76`) are `reset` writers and
belong to #757.

The daemon fans turn-stream frames out to every interactive connection, each carrying `conversation_id`
(`backgroundTaskRosterStore.ts:31-34`), so frames for different conversations arrive interleaved and a
single flat slot lets one clobber another. #755 built the keyed holder; #675 (finished with #766) made
all eight turn-stream and chrome arms carry their id. The bridge is now the one place routing belongs.

This ticket makes both row-adding writers write to the keyed holder **as well as** the flat store —
Strangler Fig, ADR 0008. The reader cutover is #758.

## Design

### D1 — attribution is a second pure function, not a change to `translateTimelineEvent`

`translateTimelineEvent` keeps its exact signature `(event: DaemonEvent) => ThreadEvent | null` and its
exact body. Attribution lands beside it:

```ts
/** The conversation an owned event belongs to, or `null` when the arm carries no routing key. */
export function timelineTargetFor(event: DaemonEvent): string | null
```

**Why not widen the existing return type.** Making `translateTimelineEvent` return
`{ event, conversationId } | null` would be the single-switch answer, and it is the wrong one here:
`translateTimelineEvent` is asserted on at 21 sites in `timelineBridge.test.ts`, every one of which
would need its expectation rewrapped. That is a 21-site cascade over the ticket's own no-op proof —
above the split threshold, and it would destroy the evidence for AC4 in the act of proving it. Two
functions cost one extra switch and keep 21 green assertions untouched.

**Why not a structural probe.** `'conversationId' in event` is banned. Structured clone preserves an
`undefined` property across the IPC bridge, so `in` is true for a hypothetical future
`conversationId?: string` arm whose value is `undefined` — and `Extract<DaemonEvent, { conversationId: string }>`
would not include that arm, making the guard's return type a lie while `Map.get(undefined)` silently
misses. Read the field BY NAME off a narrowed union instead.

**Shape.** A `switch (event.type)` in three groups:

1. The eight id-carrying owned arms as grouped fall-through cases — `assistantDelta`, `turnEnd`,
   `turnState`, `toolUse`, `toolResult`, `stallDetected`, `apiRetry`, `compacting` — sharing one
   `return event.conversationId`. TypeScript narrows across grouped cases, so the field resolves with no
   cast and no probe.
2. The three id-less owned arms named explicitly — `sessionTransition`, `unrecognizedMessage`,
   `connected` — sharing one `return null`, with the comment saying why each has nothing to attribute
   (`sessionTransition` carries `newSessionId` and no conversation id; `unrecognizedMessage` drops
   `conversation_id` at the emit; a connection edge has no conversation by nature).
3. `default: return null`.

**The `default` is not the catch-all the file bans, and the comment must say so.** The header's
prohibition (`timelineBridge.ts:32-35`) protects a different property: there, a catch-all would let a new
`DaemonEvent` arm be silently dropped from the timeline entirely. That guarantee is untouched — it lives
in `translateTimelineEvent`'s explicit fall-through group plus `assertNever`, fifteen lines above, and in
`daemonEventBridge`. This function answers a strictly narrower, downstream question — *given an event
translate already owned, where does it go?* — and group 2 enumerates every owned arm that answers "here".
So `default`'s domain is exactly the arms this function is never called with in production, and its
failure direction is the safe one: an unattributed event still reaches the flat store unchanged (AC4) and
is never routed onto a wrong slice (AC3). Do not add a second `assertNever` and do not re-list the ~26
no-op arms; duplicating that group is the cost this design exists to avoid.

### D2 — the bridge seam widens by arity, not by a new parameter

```ts
export function subscribeTimeline(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: ThreadEvent, conversationId: string | null) => void
): () => void
```

The parameter **count** is unchanged; the injected callback gains a second argument. This is the whole
reason the ticket fits in one slice: a function of arity 1 is assignable to a parameter typed at arity 2,
so all 22 existing call sites — 21 in `timelineBridge.test.ts`, one in
`interactiveRoundtrip.test.tsx:37` — compile and pass **with zero edits**. Do not add a third parameter
and do not make one optional.

Body: translate, and on a non-null result call `dispatch(threadEvent, timelineTargetFor(event))`. Call
`timelineTargetFor` only on the non-null path — that is what makes group 3 of D1 unreachable in
production. `subscribeTimeline` itself performs no fan-out and imports no store; it stays the React-free,
spy-testable helper it is today.

### D3 — `useTimelineBridge` is the fan-out composition root

It supplies a two-statement callback: the flat `timelineStore.getState().dispatch(event)`
**unconditionally and first**, then `conversationTimelineStore.getState().dispatchFor(conversationId, event)`
guarded by `conversationId !== null`. Both writes are synchronous, so no interleaving is possible between
them. Flat-first is not cosmetic: it makes AC4 hold even if the keyed write were to throw.

`timelineBridge.ts` importing `conversationTimelineStore` is correct and does **not** breach the holder's
HARD IMPORT CONSTRAINT (`conversationTimelineStore.ts:31-35`), which binds what the *store module*
imports. The constraint this bridge must satisfy is its own, stated below in D6.

Note the argument-order flip — the bridge reads `(event, conversationId)` and `dispatchFor` takes
`(conversationId, event)`. Two `string`-adjacent positions is not the hazard; `ThreadEvent` and `string`
are not interchangeable, so a swap is a compile error.

### D4 — the composer echo takes a required second dep

`ComposerSendDeps` gains one field:

```ts
dispatchFor: (conversationId: string, event: ThreadEvent) => void
```

REQUIRED, not optional, and not an arity widening of `dispatch` — the opposite call from D2, for the
reason `ConversationScreen.tsx:1930-1933` already documents in this codebase's own words: the cascade
decides. `submitMessage` has 6 deps-object call sites (`composerSend.test.ts` ×6, plus the container),
well under the split threshold, so requiring it costs six mechanical test edits and buys a compile error
for "forgot to wire it". At 22 sites that trade is unavailable, which is why D2 goes the other way.

`submitMessage` builds the echo **once** as a local const and hands the same reference to both write
paths. Sharing one `ThreadEvent` across two stores is safe for the reason
`conversationTimelineStore.ts:261-263` already states: `reduceTimeline` is pure and builds fresh arrays.
The keyed write sits immediately after `deps.dispatch(...)` at `:67`, inside neither `try` — the AC4
guarded-send contract at `:58-63` covers `sendCommand` only and must not grow to cover a store write.

`conversationId` is non-null at that point because `:48` already returned `false` on null. No new guard,
no `?? ''`, no non-null assertion — the parameter narrows by control flow.

**This is not an AC3 fallback.** The composer reads the active conversation id
(`ConversationScreen.tsx:1950`) because that is the conversation the message was *sent to* — it rides the
wire as `conversation_id` at `composerSend.ts:53`. AC3 bans inventing an id for an event that *arrived*
without one; it does not ban knowing where you just sent something. Say this in the comment, or review
will read `activeConversationId` as the banned fallback.

### D5 — the container edit

`Composer` selects `dispatchFor` alongside the existing `dispatch`
(`useConversationTimelineStore((s) => s.dispatchFor)`) and adds it to the deps literal at `:1959-1963`.
The selected function identity is stable for the same reason `:1937` already gives for `dispatch`, so no
re-render churn is added.

### D6 — AC3 is structural

`timelineBridge.ts` must import nothing from `activeConversationStore` and nothing from
`src/renderer/src/screens/`. With no reference to the open conversation in scope, the
`?? activeConversation` fallback that #751–#754's required `conversationId` was designed to prevent is
not something to remember to avoid — it is unavailable. Mirror the holder's phrasing at
`conversationTimelineStore.ts:31-35` and keep it grep-checkable. There is no `??`, no `||`, no default
parameter and no non-null assertion anywhere on the routing path.

### D7 — comment true-ups, and one that is deliberately out of scope

**In scope, comment-only:** `conversationTimelineStore.ts:5-11`. Three claims go false when this lands —
"has no writer and no reader", "ships dormant", and "#756 wires the four turn-stream arms into
`dispatchFor`". The last one under-counts by half: eight arms route, not four. Rewrite the paragraph to
say the slice now has a writer (this ticket), still no reader (#758) and still no clears (#757), and that
eight of the bridge's eleven owned arms route while three carry no id. No executable line in that file
changes.

Also correct `timelineBridge.ts:8-10` ("owns exactly the two stream arms") in the same pass if the
sentence is touched — but only if. It is pre-existing drift, already false at eleven arms, and widening
the diff for it is not required.

**Explicitly out of scope — do not fix:**

- `activateConversation.ts:43` cites the live-stream writer as `timelineBridge.ts:206`; the dispatch is
  at `:248` and the cite was already stale before this ticket. Fixing it would make this a fifth
  production file and trip the spec's own scope gate. Leave it.
- `events.ts:422-424` and `:443-445` claim "all three exhaustive bridges no-op it" for
  `unrecognizedMessage` and `sessionTransition`. Both are false today — `timelineBridge.ts:82-97` and
  `:123-136` own them and `reduceTimeline` tail-appends real rows (`threadTimeline.ts:421-440`,
  `:441-469`). This ticket does not make them more false. They need their own sweep ticket; see Open
  questions.
- The arm-level "the consumers that route by conversation are #756" sentences in `events.ts` (on
  `assistantDelta` and its seven siblings) stay true once this lands and stay put — this ticket IS that
  consumer. Do not rewrite them to past tense.

## State + concurrency model

Two stores, one write path each, no shared mutable state. Every write is a synchronous zustand `set`
with no `await` inside it, so there is no check-then-act gap for a concurrent handler to interleave
into — the argument `conversationTimelineStore.ts:265-267` already makes, inherited rather than
re-derived. No new subscription, no new timer, no new teardown: `subscribeTimeline` still returns
`onDaemonEvent`'s own unsubscribe handle verbatim, and `useTimelineBridge`'s effect cleanup is unchanged,
so a StrictMode double-mount still nets exactly one live listener.

**One consequence worth pinning.** `markViewed` is #758's wiring and is still unwired after this ticket.
Every slice this creates is therefore never-viewed, so under the holder's rule 2 every one enters at the
head and eviction order is pure creation-recency until #758 lands. That is correct and needs no
compensation — nothing reads the holder yet — but it means the ten-slice bound is now genuinely
reachable, where before this ticket it was theoretical.

## Error handling

No new failure mode. There is no network, socket, parse or permission surface on this path — it is two
in-memory store writes downstream of an already-validated, already-decoded IPC event. `dispatchFor` on an
absent key creates the slice rather than failing (`conversationTimelineStore.ts:279-287`), so there is no
miss to handle. Nothing is surfaced to the UI because nothing reads the holder.

Log-free by construction, and the rule bites harder here than usual: a diagnostic on this path would
carry both the untrusted conversation id and assistant message text (ADR 0007, #126). No `console.*` is
added anywhere, and in particular `composerSend.ts:62`'s existing `console.error('composer send failed')`
must not gain the id.

## Testing strategy

Test-first. Bullet scenarios; the developer writes them in the file's existing idiom.

**`timelineTargetFor` — `timelineBridge.test.ts`**

- Table-driven over the eight id-carrying arms: each returns that arm's own `conversationId`, not a
  neighbour's. Use a distinct id per row so a copy-paste error fails.
- Each of `sessionTransition`, `unrecognizedMessage`, `connected` returns `null`.

**`subscribeTimeline` — spy level**

- An id-carrying arm invokes the injected dispatch with the translated `ThreadEvent` **and** that arm's
  id as the second argument.
- An id-less owned arm invokes it with the `ThreadEvent` and `null`.
- A non-owned arm invokes it zero times (existing coverage; assert it still holds).

**`subscribeTimeline` — two real stores.** Build a `createTimelineStore()` and a
`createConversationTimelineStore()` and wire them with a callback **identical in shape to
`useTimelineBridge`'s** (D3). Factor that callback into one local helper in the test file so review can
diff it against the hook — the hook itself stays untested window glue, and this is what covers its logic.

- AC1: an `assistantDelta` for `conv-a` lands as a row in both the flat store's `items` and
  `selectTimelineFor('conv-a')`'s slice.
- AC2, the fan-out scenario: events for `conv-a` then `conv-b` then `conv-a` in sequence each land in
  their own slice, and neither slice clobbers the other. This is the failure the ticket exists to fix —
  assert both slices' contents, not just the map size.
- AC2, never-opened: an event for `conv-unowned` (an id the holder has never seen and no one has viewed)
  creates that slice rather than being discarded, and does **not** append to any other slice.
- AC3: a `sessionTransition` appends its `sessionBoundary` row to the flat store and leaves
  `timelines.size` at `0`. Repeat for `unrecognizedMessage`.
- AC3, the sharp version: pre-seed the keyed store with a slice for `conv-open`, then fire an id-less
  arm; `conv-open`'s slice must be unchanged **by reference**. A no-fallback claim asserted only on an
  empty map passes for the wrong reason.
- AC4: the three id-less arms still produce exactly the flat-store rows they produce today.

**`composerSend.test.ts`**

- The echo reaches `dispatchFor` with the conversation id passed to `submitMessage` and the same
  `userText` event handed to `dispatch` — assert the second argument is `Object.is`-identical to
  `dispatch`'s first, which is what pins D4's build-once.
- Both `false` returns (whitespace-only, null id) call `dispatchFor` zero times, exactly as they already
  call `dispatch` zero times.
- A throwing `sendCommand` still reaches `dispatchFor` — the guarded-send contract is unchanged.

**Do not write:** eviction, ordering or hostile-key tests. Those are
`conversationTimelineStore.test.ts`'s and already exist; duplicating them here tests #755, not #756.

**Regression gate:** `timelineBridge.test.ts:438-818`'s 21 existing `subscribeTimeline` calls and all 21
`translateTimelineEvent` assertions must pass **unedited**. If the developer finds themselves editing
them, the D2 arity widening was not applied and the design has been mis-implemented.

`npm run typecheck`, `npm test`, `npm run build`.

## Security review

Ticket carries `security-sensitive`. Pass run against this spec before commit.

**Trust boundaries.** The only untrusted input on this path is `conversationId`, daemon-asserted text
that has already crossed the fail-closed decode (a missing or non-string `conversation_id` fails the
whole line without emitting — stated on `assistantDelta` at `events.ts:110-112` and repeated on each of
the seven sibling arms). This
ticket adds no IPC channel, no wire field, no preload surface, and no renderer-side crypto, socket or
token handling. It moves no data across the main/renderer boundary that does not already cross it.

**Walked categories.**

1. *Injection / raw-markup sinks.* The id is used as a `Map` lookup key and nothing else — never
   rendered, never concatenated, never an attribute, URL, filename or cache key. `dispatchFor` stores it
   as a key, never inside a slice (`conversationTimelineStore.ts:44-46`). No `innerHTML`, no
   `dangerouslySetInnerHTML`, no new DOM sink. The already-untrusted render fields (`text`, `raw`,
   `name`, `inputSummary`, `workspaceCwd`) are copied by the unchanged `translateTimelineEvent` and reach
   no new sink — the second store holds the same `ThreadEvent` the first one already holds.
2. *Prototype pollution.* `ReadonlyMap` is mandated by the holder and this ticket introduces no keying
   into an object literal, no computed object key, no `Object.fromEntries` and no `JSON.stringify` of the
   map. `''`, `__proto__` and `constructor` stay three unremarkable keys by construction.
3. *Resource exhaustion — the one category this ticket genuinely changes.* Before it, nothing wrote the
   holder, so `MAX_RETAINED_TIMELINES` was theoretical. After it, a hostile or noisy daemon can mint a
   slice per unknown id for the first time. The holder's head-insert rule
   (`conversationTimelineStore.ts:153-164`) is the mitigation and it holds unmodified: the daemon can
   only ever insert at the head, only the operator can move a key to the tail, so an unbounded burst
   displaces at most one viewed slice. Per-slice byte growth is unbounded, as it already is in today's
   flat store; this multiplies that worst case by at most ten, which
   `conversationTimelineStore.ts:100-104` states as the accepted cost of the behaviour. **Verdict:
   accepted, unchanged from #755's analysis, and no new test needed here** — the holder's own hostile-burst
   coverage already asserts it. What this pass adds is the note in State + concurrency that the bound is
   now reachable in fact and not only in principle.
4. *Misattribution as a security property.* Routing content into the wrong thread is a confidentiality
   bug: one conversation's assistant output appearing under another. AC3's structural defence (D6 — no
   `activeConversationStore` import, no `??`, no default) is what prevents it, and it is enforced by
   unavailability rather than by discipline. The `default: return null` in D1 fails toward "flat store
   only", never toward "some other conversation's slice".
5. *Logging / diagnostics.* No `console.*` added. The existing `composerSend.ts:62` error must not gain
   the id or the text. ADR 0007 holds.
6. *Persistence.* Nothing written to `localStorage` or any web storage; conversation content must not
   survive the pairing boundary #757 exists to enforce.

**Verdict: PASS.** No finding requires a spec revision. One residual is recorded rather than fixed: the
eviction bound becomes reachable, mitigated by #755's head-insert design and accepted there on the
record.

## Open questions

1. **The `events.ts` dormancy comments are unowned-false.** `:422-424` and `:443-445` claim all three
   exhaustive bridges no-op `unrecognizedMessage` and `sessionTransition`; both have been owned by
   `timelineBridge.ts` since #286 and the parser-gap slice. This is the third ticket in this family to
   step around them (#764 and #767 each noted a sibling case). They need an Inbox ticket, not a
   drive-by — flagging here so PO can file it.
2. **`activateConversation.ts:43`'s `timelineBridge.ts:206` cite** is stale and this ticket moves the
   real line further. Same follow-up ticket as (1) would be the natural home.
3. **`useTimelineBridge`'s fan-out callback stays untested window glue.** The mitigation is the shared
   local helper in the integration tests (Testing strategy) plus review diffing the two. If the developer
   finds a cleaner way to make the hook body assertable without adding a fifth export, take it — but not
   by adding a file.
