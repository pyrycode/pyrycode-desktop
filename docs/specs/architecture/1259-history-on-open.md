# #1259 — opening a conversation asks for its newest page of history and draws it

## Files read

- `src/renderer/src/store/conversationTimelineStore.ts` → `ConversationTimelineState`, `MAX_RETAINED_TIMELINES`,
  `withNewSliceAtHead`, `withSliceAtTail`, `prependHistoryFor`, `markViewed`, `clearTimelineFor`,
  `selectTimelineFor` — the keyed holder the request state must live inside and die with. Its header
  states the eviction invariant, the hostile-key `Map` mandate and the "only three imports" constraint,
  all three of which this ticket has to keep true.
- `src/renderer/src/store/historyPageBridge.ts` → `reduceHistoryPage`, `subscribeHistoryPage`,
  `useHistoryPageBridge` — the drawing half (#1223). Its header declines `historyRequestFailed` and
  defers the walk to "#1224's"; both statements are this ticket's to correct.
- `src/renderer/src/store/systemPromptBridge.ts` → `requestSystemPrompt`, `subscribeSystemPrompt`,
  `SystemPromptData` — the #1231 precedent named by the ticket: an on-open ask fired from the activation
  path, a correlated reply landed by an app-lifetime subscriber, a falsy-id guard in the sender.
- `src/renderer/src/PairedShell.tsx` → `activateDeps.requestConversationConfig` — the one production
  site where an on-open ask is wired, and the only file this ticket adds a call to.
- `src/renderer/src/activateConversation.ts` → `activateConversation`, `ActivateConversationDeps` — why
  `requestConversationConfig` fires on EVERY activation including a re-open of the chat already open.
  That is what forces this ticket's ask to carry its own per-conversation gate rather than ride the seam
  unconditionally.
- `src/shared/ipc/events.ts` → `HistoryRequestFailure`, the `historyPageReceived` and
  `historyRequestFailed` arms — the six-member refusal set, the `retryable` flag's
  computed-at-the-single-emit contract, and `cursor` / `atStart` arriving unread.
- `src/shared/ipc/commands.ts` → `RendererCommand`'s `requestHistory` member, `isRequestHistoryPayload` —
  the command this ticket becomes the first renderer sender of.
- `src/main/index.ts` → the `requestHistory` IPC arm — already routed by conversation through
  `router.route(...)?.requestHistory(payload)`. Nothing main-side needs changing.
- `src/main/transport/requestHistoryEnvelope.ts` → `buildRequestHistory` — normalises a non-positive
  `limit` to the published "you choose" value, which is why the renderer sends `0`.
- `src/main/daemonConnection.ts` → `pendingHistoryRequests` — the correlation map. Its docblock states
  the entry is set after a successful send and **deleted on the match**, which is the fact the security
  review below turns on.
- `src/shared/wire/types.ts` → `RequestHistoryPayload`, `HistoryEntry`, `HistoryPagePayload`,
  `MessagePayload` — the wire shapes the e2e fake has to speak.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `selectTimelineFor` read site —
  proof that the keyed store is what the thread renders from, and the reason `selectTimelineFor`'s
  return type must not move.
- `e2e/fixtures/launchPairedApp.ts`, `e2e/fixtures/conversationStateFake.ts` → `buildReplyFrames`,
  `seedConversationsFrame` — how a fake-tier spec scripts a daemon that answers `request_history`.
- `e2e/fixtures/realDaemon.ts`, `e2e/fixtures/pairingArrival.ts`, `e2e/real-daemon-session-settings.spec.ts`
  → the real-tier fixture, its `spawnClaude` option and the pairing step the new spec reuses.
- `docs/knowledge/features/conversation-timeline-store.md`, `.../conversation-timeline-store-internals.md`,
  `.../inbound-message-decode-history.md`, `.../request-history-send.md` — the package overviews for the
  two halves this ticket joins.
- `docs/knowledge/features/live-e2e-runbook.md` § *Current real-claude gate state* — the authoritative
  record of the tier's spec count (15 at `3a95de1`).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

`Message area` `132:4171`. Read as a node tree and as a render on 2026-09-07: it holds assistant message
containers, user message containers, the `Session reset` divider and tool-use rows, and nothing else —
no spinner, no empty-thread copy, no error banner, no loading affordance. **The reference is a measured
absence**, so this ticket draws NO new chrome: a page in flight shows nothing, a refused page shows
nothing, and what the operator sees is a thread that already holds its history when it opens, drawn by
the components #1223 already wired. `get_metadata` plus `get_screenshot` were used rather than
`get_design_context`: the node is being read to confirm what is *not* in it, and no token, no layout and
no component is being lifted out of it.

## Context

The background process can ask the daemon for a page of a conversation's history and decode the answer
(#1222, #1227), and the window draws a page that arrives (#1223). Nothing asks. This ticket makes the
first ask — a conversation opens, asks for its newest page, and draws it — and claims the
`historyRequestFailed` arm that #1223 deliberately left unclaimed, because an ask that neither draws nor
settles leaves the conversation permanently asking.

The scroll-back walk that consumes `cursor` and `atStart` is #1260's; this ticket only records them
beside the timeline they describe. #1247's status-row "Could not load older messages" banner with a
Retry button is #1247's and is explicitly not built here.

No ADR is warranted: this joins two shipped halves through an existing seam and mints no new store, no
new process boundary and no new wire type.

## Design

### Where the request state lives

The per-conversation request state goes **inside `conversationTimelineStore`'s keyed map**, as a second
field on the map's value. The map's value type changes from `TimelineState` to a slice:

```ts
export interface ConversationSlice {
  timeline: TimelineState
  history: HistoryRequestState | null
}
```

This is chosen over the two alternatives the ticket rules out and over a third:

- **Not a new store.** A new store needs clearing in `activateConversation`, `exitActiveConversation`
  and `clearServerScopedState` — the three-file fan-out #1231 paid for its own.
- **Not a screen-level ref.** A ref outlives a conversation switch and would survive the eviction the
  refill case (AC3) depends on.
- **Not a satellite `ReadonlyMap` beside `timelines` in the same store.** It would need the key dropped
  in four separate places (both eviction helpers, both clears) to keep "dies with the timeline" true,
  and a missed one is a per-id leak keyed by daemon-supplied strings — the growth vector this store's
  own header reasons about. Making it one object under one key makes the property structural instead of
  maintained.

The change is contained because `selectTimelineFor`'s **signature does not move**: it projects
`.timeline` and still returns `TimelineState | null`, so `ConversationScreen`'s read site, the
`?? initialTimelineState`-is-banned rule and the three-reading table in its docblock all stand
unedited. The by-reference survivor copy in `withNewSliceAtHead` / `withSliceAtTail` still hands back
the identical slice object, so the identical `TimelineState` comes out of the selector and the
no-cross-conversation-re-render property is preserved.

### The request state

```ts
export type HistoryRequestState =
  | { status: 'requested' }
  | { status: 'loaded'; cursor: string; atStart: boolean }
  | { status: 'failed'; reason: HistoryRequestFailure; retryable: boolean }
```

`null` (or an absent key) means **never asked** — which is also what an evicted conversation reads as,
and that identity is the whole of AC3. The four readings are exhaustive and the decision is a pure
function of them: ask iff the reading is `null`.

`retryable` is **recorded and never read** by this ticket. There is no timer, no backoff and no
automatic re-ask anywhere in this design; the flag is carried so #1260's walk can read it without
re-deriving the list, per its docblock's contract.

This forces one new import into `conversationTimelineStore.ts` — a type-only
`HistoryRequestFailure` from `@shared/ipc/events`. The header's "HARD IMPORT CONSTRAINT, checkable by
grep" paragraph is updated to name four imports and to restate the property it actually defends: that
nothing putting the OPEN CONVERSATION in scope is importable here, so the `?? activeConversation`
fallback stays unavailable. A type-only import of a string union does not weaken that.

### Store write paths — three new, all absent-key no-ops

| path | effect |
|---|---|
| `markHistoryRequested(id)` | `history` ← `{ status: 'requested' }` |
| `recordHistoryPage(id, cursor, atStart)` | `history` ← `{ status: 'loaded', cursor, atStart }` |
| `recordHistoryFailure(id, reason, retryable)` | `history` ← `{ status: 'failed', reason, retryable }` |

**All three no-op when the key is absent**, and that is a design decision rather than defensiveness:
the request state must die with the timeline, so a slice minted by a history write alone would be a
timeline-less holder that outlives the thing it describes. It is also unreachable in production —
`activateConversation` calls `markViewed` (which creates the slice) before
`requestConversationConfig` — and for a reply arriving after an eviction the correct outcome is
precisely "nothing is held, ask again on the next opening".

None of the three re-orders the map: they take the `dispatchFor` key-present branch's shape (clone the
outer map, `set` the key, position preserved by rule 1 of the eviction invariant). Each returns the
state object unchanged when the key is absent, so zustand's `Object.is` short-circuit fires.

`prependHistoryFor` is **not** widened to carry the cursor and is otherwise untouched. Its
absent-key create-at-head branch stays as #1223 built it.

### The ask

`historyPageBridge.ts` gains the sender, so one module owns the opening round trip end to end:

```ts
export interface OpeningHistoryDeps {
  sendCommand: (command: RendererCommand) => void
  getHeld: (conversationId: string) => HistoryRequestState | null
  markRequested: (conversationId: string) => void
}
export function requestOpeningHistory(deps: OpeningHistoryDeps, conversationId: string | null): void
export const openingHistoryDeps: OpeningHistoryDeps
```

Behaviour: return on a falsy id (`requestSystemPrompt`'s guard, for the same reason — an unaddressable
id must not reach the wire); return when `getHeld(id) !== null`; otherwise `markRequested(id)` and then
send `{ type: 'requestHistory', payload: { conversation_id: id, cursor: '', limit: 0 } }`.

- **`cursor: ''`** is the normal opening value of a walk, not a missing one — the wire's published start
  position.
- **`limit: 0`** asks the daemon to choose; `buildRequestHistory` normalises it to the same value, so
  this is the safe default stated twice rather than a magic number.
- **Mark before send.** The invariant that matters is "never ask twice" (AC2): a duplicate ask
  duplicates rows, where a mark left standing over a send that threw is repaired by the next eviction
  and costs one conversation's backfill. `sendCommand` is `void` and fire-and-forget, so there is no
  suspension point between the read and the write and no interleaving to guard.
- **A fresh three-key literal**, never a spread of a caller's object — the bound `buildRequestHistory`
  keeps on the wire side, held here too.
- **Not a retry, and structurally unable to become one.** The gate is on the reading being `null`, and
  every terminal reading is non-null.

The production wiring object is exported beside the function (the `conversationLastReadDeps` shape), so
`PairedShell` gains ONE line inside `activateDeps.requestConversationConfig` rather than a fourth
`getState()` arrow. `window.pyry` is dereferenced inside an arrow body, never at module load.

### The reply

`subscribeHistoryPage` widens from two parameters to three, claiming both arms:

```ts
export function subscribeHistoryPage(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  applyPage: (id: string, items: readonly ThreadItem[], cursor: string, atStart: boolean) => void,
  settleFailure: (id: string, reason: HistoryRequestFailure, retryable: boolean) => void
): () => void
```

A cross-wire swap of the two callbacks is a compile error under `strictFunctionTypes`:
`readonly ThreadItem[]` and `HistoryRequestFailure` are mutually unassignable in the second parameter
slot. That is the property, stated so the next person adding a fourth callback re-runs the check.

`useHistoryPageBridge` wires `applyPage` to `prependHistoryFor` followed by `recordHistoryPage` — draw
first, then settle, so a page that creates a slice through the create-at-head branch is present by the
time the record runs — and `settleFailure` to `recordHistoryFailure`.

**All six refusals settle identically**: the arm reads `reason` and `retryable` off the event and
writes them, with no branch on the value. Nothing is drawn, no banner, no unrecognized row. The
`unclassified` member needs no special case for exactly that reason.

### Data flow, end to end

```
row click → activateConversation → markViewed (slice created)
          → requestConversationConfig → requestOpeningHistory
              → held === null? → markHistoryRequested + sendCommand(requestHistory)
main: requestHistory → pendingHistoryRequests.set(envelopeId, conversationId) → wire
wire: history_page → in_reply_to match (entry DELETED) → historyPageReceived{conversationId,…}
      relay_error → in_reply_to match (entry DELETED) → historyRequestFailed{conversationId,…}
window: subscribeHistoryPage → prependHistoryFor + recordHistoryPage  |  recordHistoryFailure
```

## State + concurrency model

One store slice (`conversationTimelineStore`), no new store, no new screen state. Every write is a
synchronous zustand `set` with no `await` inside it, so there is no check-then-act gap across a
suspension point — the store's existing single-writer argument carries over verbatim to the three new
paths.

No async task, no promise, no timer, no interval and no `AbortController` is introduced. The whole
cancellation path is the unsubscribe handle `onDaemonEvent` already returns, used as the effect
cleanup in `useHistoryPageBridge` exactly as #1223 shipped it, so a StrictMode double-mount nets one
live listener and window teardown removes it.

The subscriber stays app-lifetime and mounted in `App`, not screen-scoped: a reply can land after the
operator has navigated on, and a screen-scoped listener would unmount before it arrives. Attribution is
by the event's client-owned `conversationId` — never `?? openConversation`, so a reply for a chat the
operator has left lands on that chat's slice rather than the one on screen.

## Error handling

| failure | where | outcome |
|---|---|---|
| all six `HistoryRequestFailure` members | `recordHistoryFailure` | `{ status: 'failed' }`; ask settles; nothing drawn |
| empty page (conversation predates the log) | `prependHistoryFor` early return + `recordHistoryPage` | no rows, state `loaded`; reads as an empty thread |
| page for an evicted conversation | store no-op / create-at-head | nothing held ⇒ re-asks on the next opening |
| unroutable / falsy conversation id | `requestOpeningHistory` guard, then `main/index.ts`'s `router.route(...)?.` | no frame reaches the wire |
| `buildRequestHistory` encode failure | main-side, caught by its sole caller | dropped send; the client stays `requested` until eviction |

There is no new UI error surface, by design (see § Design source). Nothing on any of these paths logs —
this slice inherits the store's log-free-by-construction rule, which bites here because the values in
scope are a conversation id, an opaque cursor and replayed message text.

## Testing strategy

**vitest (`environment: 'node'`) — the whole decision, since renderer specs are static renders:**

- `conversationTimelineStore.test.ts`
  - each new write path against an absent key is a no-op returning the state OBJECT
  - each sets its reading on a present key, leaving `timeline` `Object.is`-identical
  - a history write does not re-order the map (eviction order unchanged) and does not change `size`
  - `clearTimelineFor` and `clearAllTimelines` take the history reading with the slice
  - eviction at `MAX_RETAINED_TIMELINES` drops the victim's history reading — the AC3 refill premise
  - `selectHistoryRequestFor` on an absent key is `null`, and hostile keys (`__proto__`, `constructor`,
    `''`) read as absent before any write
- `historyPageBridge.test.ts`
  - `requestOpeningHistory`: sends once on `null`; sends nothing on each of `requested` / `loaded` /
    `failed`; sends nothing on `null` and on `''` ids; marks before sending; payload is exactly
    `{ conversation_id, cursor: '', limit: 0 }`
  - two activations of the same conversation produce exactly one send (AC2), and one after an evicted
    (⇒ `null`) reading produces a second (AC3)
  - `subscribeHistoryPage`: a page calls `applyPage` with the event's `cursor` / `atStart`; a
    `historyRequestFailed` calls `settleFailure` with `reason` and `retryable` and never `applyPage`;
    each of the six reasons settles identically; every other arm no-ops; the returned handle is the
    exact unsubscribe handle

**Playwright, fake tier — `e2e/history-on-open.spec.ts`:** a scripted `buildReplyFrames` that answers
`list_conversations` from a seed and `request_history` with a correlated `history_page` carrying one
stored `message` entry. Assertion: after the fixture's row click and with no send, the stored text is
visible in the thread. This is the drawing proof; nothing in a static render can click.

**Playwright, real tier — `e2e/real-daemon-history-on-open.spec.ts`:** pair against a real `pyry`, open
the conversation, send a distinctive marker, wait for it drawn, `page.reload()` (which discards the
entire renderer store — every Zustand slice is renderer-side and unpersisted, so the retained timeline
is gone while the main process keeps the Noise session), re-open the conversation, and assert the marker
is drawn again **with no second send**. The reload is what makes the assertion non-vacuous: after it,
history is the only route by which the marker can reach the thread.

## Open questions

1. Does `page.reload()` re-enter `PairedShell` cleanly against a real daemon (preload re-runs, pairing
   status resolves paired)? If not, fall back to archive → restore → re-open, which reaches the same
   cleared-slice state through `exitActiveConversation`'s `clearTimelineFor` and is already driven
   against a real daemon by `real-daemon-conversation-lifecycle.spec.ts`.
2. Does a `send_message` persist to the conversation log with `spawnClaude: false`? The spec is written
   `spawnClaude: true` because the marker must be in the daemon's log for the ask to have an answer;
   if the claude-less mode also appends, the cheaper mode is the better one. Resolved in Phase B and
   recorded under `## Revisions` if it moves.

Both are resolved during implementation; neither changes the production design.

## Security review

**Verdict:** PASS

**Findings:**

**1. Trust boundaries.** Two values cross into the window on this path and they have different
provenance, which the design keeps distinct rather than blurring. `conversationId` on both arms is
CLIENT-OWNED — resolved in the background process from `pendingHistoryRequests`, the id this app put in
its own outbound frame — so it is used as-is, with no `?? openConversation` anywhere and no field read
off an inbound payload. `reason` is likewise client-owned, narrowed at the single emit from the
daemon's untrusted `code` by `narrowHistoryRejectReason`. What is genuinely untrusted is `cursor`
(daemon-minted) and the `entries`' content. The design's answer for `cursor` is that it is stored
verbatim in the slice and read by nothing in this ticket: not parsed, not compared, not concatenated,
not a key, not logged. The design's answer for entry content is that it takes no new path — it goes
through `translateTimelineEvent` → `reduceTimeline` → the components #1223 already wired, so replayed
entries carry exactly the trust class of the live frames they mirror and are rendered as escaped plain
text by the same code. **No new sink is introduced by this ticket.**

**2. Tokens, secrets, credentials.** Not applicable, and the reason is structural rather than
incidental: nothing on this path reads, writes, derives or transports a credential. The `cursor` is the
one value that could be mistaken for one — it is deliberately unsigned and is not a capability;
authorization is pairing, enforced at the Noise handshake. Recording it in renderer memory therefore
grants nothing. It is NOT persisted: the slice holding it dies with the timeline and this store is
`localStorage`-free by construction, which the header already forbids widening.

**3. File / storage operations.** No filesystem path, no `localStorage`, no `sessionStorage`, no
IndexedDB, no `safeStorage`. The one thing to state rather than skip: the temptation to persist the
cursor across launches so a reopened app resumes a walk. That is explicitly NOT in this design and must
not be added — it would write daemon-minted state to renderer-side web storage, surviving the pairing
boundary `clearAllTimelines` exists to enforce.

**4. Inter-process / Electron attack surface.** No new IPC channel, no new `contextBridge` API, no new
`ipcMain` handler, no window, no protocol handler. The `requestHistory` command member and its
`isRequestHistoryPayload` boundary guard shipped with #1222 and the routing lookup with it; this ticket
becomes the first renderer sender and adds no surface. Process placement holds: the renderer sends a
three-scalar payload and receives already-typed events, and no key, socket or raw frame is in scope.
Deliberate non-defence, stated: `isRequestHistoryPayload` still accepts `''` as a `conversation_id`,
because refusing an unaddressable id is a behavioural decision that belongs in
`requestOpeningHistory` where a spy can reach it, and `router.route('')` refuses regardless.

**5. Cryptographic primitives.** Not applicable — no RNG, no hash, no comparison against a secret, no
handshake code. Named rather than skipped because the `cursor` is an opaque daemon-minted token-shaped
string and the wrong instinct is to compare it with `===` against something, or to hash it for a key.
The design reads it exactly zero times.

**6. Network & I/O.** No socket, no URL, no TLS decision and no timeout is introduced in the window.
The relevant remote-behaviour risks are two and both are addressed. **A hostile or buggy daemon
answering one ask with many `history_page` frames** would, if each were applied, prepend rows
repeatedly and grow one slice without bound. It cannot: `pendingHistoryRequests` is consumed on the
first match (`daemonConnection`'s docblock: "matched by the reply's `Envelope.in_reply_to` and deleted
in `onDriverEvent`"), so a second frame under the same id resolves no conversation and emits nothing.
An UNSOLICITED `history_page` is the same case — no pending entry, no id, no event. **A relay that
merely withholds the frame** leaves the conversation at `requested` forever; that is a deliberate,
terminal state and NOT a retry loop, which is precisely why the design has no timer and reads
`retryable` nowhere.

**7. Error messages, logs, telemetry.** Nothing on any path added by this ticket logs — no
`console.*`, no diagnostic on the dropped-reply branch, no telemetry. Stated as a property rather than
an omission: the values in scope are a conversation id, an opaque cursor, a refusal code and replayed
message text, and the last of these is the operator's and claude's own content. The store is already
log-free by construction (ADR 0007, #126) and the three new write paths keep it so. No error object is
constructed on these paths, so nothing reaches a crash reporter either — and the `default:`-free shape
of the failure arm is what keeps a `JSON.stringify(event)` out of an `assertNever`, the same
consideration `systemPromptBridge`'s header records for its own arm.

**8. Concurrency.** No promise, no timer, no interval, no `AbortController`, and one listener whose
cancellation path is the unsubscribe handle used as the effect cleanup. The one check-then-act in the
design is `requestOpeningHistory`'s read of `getHeld` followed by `markRequested` + `sendCommand`: it
is fully synchronous on the renderer's single thread with no `await` between the read and the write, so
no concurrent handler can interleave and no double-send is reachable. Ordering is stated rather than
assumed: mark first, send second.

**9. Threat model alignment.** *Malicious relay* — content-blind and on-path; it can drop or delay this
frame, which yields a conversation stuck at `requested` and an empty thread, and no plaintext leak and
no spin. *Hostile daemon inside the session* — it can serve replayed content and an unbounded `entries`
array. The content is handled by finding 1 (no new sink). The unbounded array is an **accepted,
pre-existing exposure explicitly out of scope**: the live lane already lets a hostile daemon grow one
thread without limit via `assistantDelta`, `MAX_RETAINED_TIMELINES` bounds the number of slices and not
their bytes, and a per-slice byte cap has UI consequences that belong in their own ticket — the store's
own header records that deferral and this ticket does not change it. *Renderer compromise reaching the
transport* — unchanged; nothing here holds a key, a socket or a raw frame. *Token theft from disk* —
not applicable, nothing is written to disk.

**Classification:** no MUST FIX. One SHOULD FIX carried into Phase B: verify by test that the failure
arm reads `reason` and `retryable` and writes them WITHOUT branching on the value, so no future
per-reason behaviour can be added without a test moving. Out of scope and named: the unbounded
per-slice byte growth (the store header's deferral), and #1247's status-row error surface.

## Revisions

### 2026-09-07 — the real-tier spec clears the timeline by archiving, not by reloading

**Open question 1 is resolved against the plan's first choice.** The plan proposed `page.reload()` to
discard the renderer's stores and force a second first-opening. Reading `conversationListBridge`'s
`ConversationListData` settled it the other way: the conversation list is requested on the **`connected`
edge** — a `useEffect` keyed on `sessionStore.status.type === 'connected'` — not on mount. After a
reload the main process is still connected and the fresh renderer's session store starts disconnected,
so whether the list ever repopulates depends on main re-announcing a status the window missed. That is
unverifiable here (no `pyry` on this machine) and it would fail as a spec-infrastructure timeout rather
than as a statement about history.

`e2e/real-daemon-history-on-open.spec.ts` therefore uses the plan's own stated fallback: **archive →
restore → re-open**. Archiving the ACTIVE conversation routes through `exitActiveConversation`, whose
`clearTimelineFor` drops that conversation's held slice and, since this ticket, the record that it had
already asked — so the re-open is a first opening as far as the client is concerned. Every step is
transplanted from `real-daemon-conversation-lifecycle.spec.ts`, which drives the same sequence against a
real daemon today, and the `.conversation` 1→0 delta is a positive observable that the exit actually ran,
which is what keeps the closing assertion from passing against a slice that was never cleared.

**No production code changed for this.** The contract the spec exercises is the same one the plan
describes: an opening with nothing held asks, and a page fills the thread.

### 2026-09-07 — open question 2: the real-tier spec spawns claude

Resolved as written rather than as hoped. The marker has to be in the daemon's on-disk log for the ask to
have an answer, and the only route by which this client writes to a conversation's log is a real
`send_message` against a live session, so `spawnClaude` stays at its default. The claude turn is waited
out purely as a barrier; nothing asserts on the reply. The `real-daemon-` prefix names the subject — the
daemon's history verb — and both prefixes run in the same credentialed tier, since each Playwright config
keys on `real-` alone.
