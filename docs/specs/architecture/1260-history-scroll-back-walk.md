# #1260 — scrolling back through a thread walks its history until the log's start

## Files read

- `src/renderer/src/store/historyPageBridge.ts` → `requestOpeningHistory`, `OpeningHistoryDeps`,
  `openingHistoryDeps`, `subscribeHistoryPage`, `useHistoryPageBridge` — #1259's opening ask and the
  module that already owns the whole round trip. Its header names this ticket as the consumer of the
  `cursor` and `atStart` it records; the second asker goes beside the first.
- `src/renderer/src/store/conversationTimelineStore.ts` → `ConversationSlice`, `emptySlice`,
  `prependHistoryFor`, `markHistoryRequested`, `recordHistoryPage`, `selectHistoryRequestFor`,
  `withNewSliceAtHead`, `withSliceAtTail` — the four readings this ticket branches on, and the
  non-idempotent prepend whose "#1224's walk must not re-apply a page" note is this ticket's to honour.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`,
  `reassertPinnedToBottom`, `ThreadScrollPin`, `Timeline` — the scroll handler the detector hangs on, and
  **the index-keyed row map that § Design 3 corrects**. Its `useThreadScrollPin` inventory records that a
  growth involving no React render is anchoring's job, not the pin's.
- `src/renderer/src/screens/conversation/threadScrollPosition.ts` → `ThreadScrollMetrics`, `isAtBottom`,
  `AT_BOTTOM_TOLERANCE_PX` — the framework-free arithmetic module the top-of-thread predicate joins, and
  the named-fields convention that keeps the untested glue correct by inspection.
- `src/renderer/src/screens/conversation/conversation.css` → the `Scrollable thread` rule — `overflow-anchor`
  is absent on purpose (#1046) and the one line that defeats it is named there. Read, not edited.
- `e2e/thread-scroll-pin.spec.ts` → `primeOverflowingThread`, `readThreadMetrics`, `settleScrollEvent`,
  `viewportTop`, `firstFullyVisibleAssistantRow`, `distanceFromBottom`, `withheldThumbnails` — the
  withhold-then-release shape AC2's case copies, and the two anchoring tests that measured 172px with and
  without `overflow-anchor: none`.
- `e2e/history-on-open.spec.ts` → `storedMessageEntry`, `historyPageFrame`, `capturingFake` — #1259's
  fake-tier history builders, which the walk drive reuses in shape.
- `docs/specs/architecture/1259-history-on-open.md` § *The request state*, § *Security review* — the four
  readings, and the cursor's stated trust class (daemon-minted, stored verbatim, read by nothing until here).
- `docs/knowledge/features/conversation-timeline-store.md`, `.../request-history-send.md` — the package
  overviews for the holder and the ask.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

`Message area` `132:4171`, read as a node tree on 2026-09-07. It holds assistant message containers, user
message containers, the `Session reset` divider and tool-use rows (including the `Consequent tool uses`
group) — **and nothing else**. There is no spinner, no "load older" control, no top-of-thread affordance
and no end-of-history marker. **The reference is a measured absence**, so this ticket draws NO new chrome:
a page in flight shows nothing, a fully-walked thread shows nothing, and what the operator sees is older
rows appearing above where they were reading. `get_metadata` was used rather than `get_design_context`
because the node is being read to confirm what is *not* in it — no token, layout or component is lifted.

## Context

#1259 made a conversation ask for its newest page on open and record the `cursor` to ask with next plus
whether `at_start` was reached. Nothing reads either field. This ticket is the rest of the walk: the ask
fired when the operator scrolls back to the top, and the stop once the daemon reports the start of the log.

It also corrects a mechanism the ticket body assumes and the code does not provide — see § Design 3. No
ADR is warranted: no new store, no new process boundary, no new wire type.

## Design

### 1. The detector — a pure predicate beside `isAtBottom`

`threadScrollPosition.ts` gains a second total function of the same three numbers:

```ts
export const HISTORY_ASK_BAND_PX = 200
export function isNearTop(metrics: ThreadScrollMetrics): boolean
```

One comparison, `metrics.scrollOffset <= HISTORY_ASK_BAND_PX`, so an elastic overshoot to a negative
offset and a thread too short to scroll both read as near the top without a branch of their own — the
shape `isAtBottom`'s docblock argues for.

**Why a band rather than "at the top", and why the number is fenced rather than chosen freely.** Chromium
suppresses scroll anchoring when a scroller's offset is exactly zero — the fact `thread-scroll-pin.spec.ts`
records as *"Zero is the ONE offset at which scroll anchoring does not run at all"*. A walk that fired only
at the wall would therefore fire at the one position where the mechanism holding the reader's place is off,
and AC2 would be unsatisfiable. So the ask must fire while the reader is still above zero. 200 is:

- two of Chromium's ~100px wheel notches of headroom, so a reader scrolling back with the wheel enters the
  band a frame or more before reaching the wall;
- an order of magnitude above `AT_BOTTOM_TOLERANCE_PX`, whose 4px is a subpixel-error band and not a
  proximity reading;
- a quarter of the app's 800px minimum window height, so it is a rim rather than a viewport.

Named and exported so the e2e parks inside it by import rather than by a copied literal.

**Known bound, stated rather than defended.** A reader who lands on exactly zero — a fling, `Home`, a
programmatic jump — asks from the one offset anchoring ignores, and that page arrives without their place
held. Closing it needs production code that measures the growth and writes `scrollTop` itself, which is
both a second mechanism over anchoring and the "nothing new needs to observe the region" this ticket rules
out. Likewise: a page that does not overflow the viewport produces no scroll event, so the walk has no
further trigger until the operator scrolls again. Both are operator-visible at worst as "scroll once more".

### 2. The decision — a fourth reading, three of which decline

`historyPageBridge.ts` gains the walk's asker beside the opening one:

```ts
export function requestOlderHistory(
  deps: HistoryAskDeps,
  conversationId: string | null,
  nearTop: boolean
): void
```

Behaviour, in order: return unless `nearTop`; return on a falsy id (`requestOpeningHistory`'s guard
verbatim, for its reason); read `deps.getHeld(id)` and return unless it is `{ status: 'loaded' }` with
`atStart` false; `deps.markRequested(id)`; send a fresh three-key literal
`{ conversation_id: id, cursor: held.cursor, limit: 0 }`.

- **`nearTop` is a parameter, not a measurement.** The geometry is § Design 1's pure function and the
  decision is this one; taking the boolean is what lets a vitest spy exercise all four readings *and*
  both positions with no DOM, and it leaves the scroll handler with no branch of its own.
- **The three declining readings are exactly the ticket's.** `requested` — an ask is already on the wire,
  which is what holds the walk to one ask in flight while a top-parked reader's handler fires at frame
  rate, and what keeps the non-idempotent `prependHistoryFor` from applying one page twice. `failed` —
  terminal; nothing branches on `reason` and nothing reads `retryable`, so there is no timer, no backoff
  and no automatic re-ask. `null` — nothing is held, which belongs to the opening path: a walk never
  restarts itself mid-screen from an empty cursor.
- **`atStart` is the only stop.** An empty `entries` list and a short page each settle as `loaded` with
  whatever `atStart` the daemon sent, so neither ends the walk. Nothing here counts entries or compares
  page sizes, which is what makes "a short page is not an end-of-log signal" structural rather than
  remembered.
- **The cursor is echoed verbatim** — read off the held reading and placed in the payload, never parsed,
  compared, derived from, reused across conversations or logged.
- **Mark before send**, `requestOpeningHistory`'s ordering and its argument: both calls are synchronous
  with no `await` between the read and the write, so nothing interleaves on the renderer's single thread.

`OpeningHistoryDeps` / `openingHistoryDeps` are renamed `HistoryAskDeps` / `historyAskDeps` — six call
sites across two production files plus the spec, well under the call-site ceiling. The shape is unchanged;
the module now has two askers and the old name would read as a claim about which.

### 3. The correction: an index-keyed row list cannot survive a prepend

**The ticket body assumes Chromium's scroll anchoring is sufficient for AC2. It is not, and the reason is
in this repo rather than in the browser.** `Timeline` keys item rows by their array index, on a premise its
own comment states: *"The list is append-only with tail-mutation and never inserts or reorders mid-list …
so index identity is stable per logical item."* A history prepend is exactly the insertion that premise
excludes. Prepending N rows makes React match key 0 to key 0, so every already-drawn row is **updated in
place with a different item's content** and N fresh nodes appear at the *end* of the list. Anchoring then
measures its anchor node's offset before and after and compensates by the wrong delta — the anchor node
never moved, it merely started rendering a different message — so the reader is left at their offset
looking at content from a page earlier in the log. The DOM ends up correct; the reader's place does not.

The fix is to key a row by its position **from the conversation's origin** instead of from the head of the
held array, which is stable under both mutations the list actually performs:

| | store | view |
|---|---|---|
| new | `ConversationSlice.prependedRows: number` (0 on `emptySlice` and both create-at-head branches) | `Timeline`'s optional `firstRowKey?: number`, default 0 |
| written by | `prependHistoryFor`, `+ fresh.length` on the branch that actually prepends | — |
| read by | `selectPrependedRowsFor(id)`, `?? 0` | item-row `key={firstRowKey + index}` |

`ConversationScreen` passes `firstRowKey={-prependedRows}`. An append leaves `prependedRows` alone, so
every drawn row keeps its key and the streaming tail bubble is not remounted (the property the existing
comment protects). A prepend of N lowers `firstRowKey` by N while every surviving row's index rises by N,
so their keys are unchanged and React inserts N new nodes at the head — which is what makes anchoring's
measurement correct.

- **The count lives on the slice, not on `TimelineState`.** `ConversationSlice` is constructed in three
  places, all inside `conversationTimelineStore.ts`; `TimelineState` is the render model the whole screen
  and thirty-odd specs build. It also has to die with the timeline, which membership of the slice makes
  structural — the argument #1259 made for the request state, unchanged.
- **The prop is optional**, so the existing `<Timeline` render sites pass nothing and stay green — the
  no-edit-cascade reason `scrollPin` and `queued` are optional there already.
- **The queued tail rows keep their `q`-prefixed keys.** They are a replacement snapshot with their own
  identity and are unaffected; a negative item key cannot collide with that namespace.
- **This is not testable in vitest.** React keys are not markup, and the renderer tier renders to a static
  string. The e2e case in § Testing strategy is the only detector, which is why it addresses its reference
  row **by that row's own text** rather than by index: an index-addressed row passes vacuously here,
  because with the bug present the node stays put and only its content changes.

### 4. The wiring

`useThreadScrollPin` takes the open conversation's id (already in the container's scope) and its `onScroll`
gains one call after the existing flag write:

```
const metrics = { scrollOffset, viewportHeight, contentHeight } off currentTarget
following.current = isAtBottom(metrics)
requestOlderHistory(historyAskDeps, conversationId, isNearTop(metrics))
```

The one metrics object replaces the existing inline literal, so the named-field mapping is written once.
The handler's existing early return on the pin's own echo stands in front of both: a write the pin made
moved the view to the bottom and is not the operator scrolling back. `historyAskDeps` dereferences
`window.pyry` inside its own arrow bodies, so nothing is touched during render and the static renderer
tier — where no handler ever fires — is unaffected.

## State + concurrency model

One store slice, no new store, no new screen state, and no async task, promise, timer, interval or
`AbortController` anywhere in this ticket. Every write is a synchronous zustand `set`; the reply path is
#1259's app-lifetime `subscribeHistoryPage`, whose cancellation path is the unsubscribe handle used as the
effect cleanup, unchanged.

The one check-then-act is `requestOlderHistory`'s read of `getHeld` followed by `markRequested` and
`sendCommand`, fully synchronous with no suspension point — the same argument `requestOpeningHistory` makes.
Concurrency here is *event frequency*, not threads: `onScroll` fires at frame rate while the reader sits in
the band, and `requested` is what collapses that to one ask. `markHistoryRequested` replaces the outer map
but hands the same `TimelineState` back by reference, so `selectTimelineFor` is `Object.is`-stable and a
store write on a scroll frame wakes no thread renderer.

## Error handling

No new failure arm, by design. A refusal mid-walk settles through #1259's `recordHistoryFailure` into
`failed`, and this ticket's only contribution is declining to ask again. The daemon merges its three cursor
failure causes into one indistinguishable answer on purpose, so nothing here tries to tell them apart; the
published repair for all three is restarting the walk with an empty cursor, which happens on the next
opening after the slice is evicted or cleared.

| case | outcome |
|---|---|
| empty page, `at_start` false | `loaded` with the new cursor; nothing drawn; the walk continues |
| short page, `at_start` false | same — no entry count is read anywhere |
| `at_start` true | `loaded` with `atStart` true; every later scroll declines |
| refusal (any of the six) | `failed`; terminal; nothing drawn, no banner, no retry |
| page for an evicted conversation | store no-op / create-at-head; nothing held ⇒ re-asks on the next opening |
| falsy conversation id | guarded before the store is consulted; no frame reaches the wire |

There is no new UI error surface — see § Design source.

## Testing strategy

**vitest (`environment: 'node'`)**

- `threadScrollPosition.test.ts` — `isNearTop` at zero, inside the band, exactly at it, one pixel past it,
  and on a negative overshoot; and that it reads `scrollOffset` alone (a transposed pair does not change
  the answer only because the other two are unread, which the cases state).
- `historyPageBridge.test.ts` — `requestOlderHistory`: sends on `loaded` + `atStart` false + `nearTop`;
  the payload is exactly `{ conversation_id, cursor: <the held cursor, verbatim>, limit: 0 }`; declines on
  each of `null` / `requested` / `failed` / `loaded`-with-`atStart`; declines when `nearTop` is false even
  on the asking reading; declines on `null` and `''` ids before reading the store; marks before sending;
  two firings in the band produce exactly one send, and a page recorded between them produces a second
  carrying the new cursor.
- `conversationTimelineStore.test.ts` — `prependedRows` starts 0, rises by the number of rows actually
  prepended (so a page whose rows are all held echoes does not move it), is untouched by `dispatchFor`,
  and dies with the slice on `clearTimelineFor`, `clearAllTimelines` and eviction.

**Playwright, fake tier — `e2e/history-walk.spec.ts` (AC1, AC3).** A scripted `buildReplyFrames` that
answers each `request_history` from a table keyed by the cursor it was asked with, and captures every ask.
The opening page is large enough to overflow the thread on its own, so the drive needs no send at all. The
sequence walks `'' → c1 → c2 → c3 → done`: a full page, then an **empty** page, then a **short** page, each
with `at_start` false, then a page with `at_start` true. After each, scroll into the band and assert the
next ask went out carrying the previous page's cursor verbatim; after the last, scroll again and assert the
ask count is unchanged. The closing absence is ordered behind a positive, auto-waiting read — the drawn row
count from the final page — so it cannot pass before the click's own work resolves.

**Playwright, fake tier — `e2e/thread-scroll-pin.spec.ts` (AC2).** One case, in the file AC2 names, copying
the `withheldThumbnails` shape: the walk's ask is recorded and answered with **no** frames, so the reader's
position and the reference row's viewport-relative top are captured after the ask has provably gone out;
only then is the correlated `history_page` pushed. Assertions: the thread grew by a floor; the reference row
— addressed **by its own text** — has the same viewport top; `scrollTop` advanced by that growth; and the
reader was not yanked to the bottom. Driven from a park inside `HISTORY_ASK_BAND_PX` and above zero, which
is the position the walk actually fires from.

## Open questions

1. Does a park inside the band leave the thread far enough from the bottom for the pin's `following` flag
   to be clear, in a thread whose only content is one served history page? If the opening page does not
   overflow far enough, the drive grows it with a second page before parking. Resolved in Phase B.
2. Does the `prependedRows` count need to exclude rows dropped by `withoutHeldEchoes`? The design says yes
   — it counts `fresh.length`, not `items.length` — and Phase B confirms that branch is the one that runs.

## Size

**This plan exceeds the one-ticket line boundary and is being built anyway, deliberately.** The ticket's own
estimate was ~800 lines; § Design 3's correction adds roughly 150 the refiner could not have scoped, putting
the total near 950. The split it wants is (a) the prepend-stable row key, provable on its own by the
existing opening prepend, then (b) the walk on top of it. `#1260`'s parent is `#1224` and its grandparent is
`#1088`, so the split-depth rule bars a third cut; `needs-human:sizing` is applied and the work is built as
one. Every other line of the boundary holds: 4 production source files, 0 new exported types, 6 call sites,
3 acceptance criteria, 0 new reject branches.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. Two values are in scope and their provenance is different, which
  the design keeps distinct. `conversationId` is CLIENT-OWNED — the container's own open-conversation id on
  the ask side, and on the reply side the id resolved from `pendingHistoryRequests`, never a string read off
  an inbound payload; there is no `?? openConversation` anywhere. `cursor` is DAEMON-MINTED and untrusted,
  and the design's whole answer is that it is moved: read out of the slice and placed in a payload value,
  never parsed, split, compared, concatenated, used as a `Map` key, a path or a React key, and never logged.
  Replayed `entries` take no new path — `reduceHistoryPage` → `translateTimelineEvent` → the components
  #1223 wired — so they carry exactly the trust class of the live frames they mirror and are rendered as
  escaped plain text by the same code. **No new sink.**
- **[Tokens, secrets, credentials]** Not applicable, structurally. Nothing on this path reads, writes,
  derives or transports a credential. The `cursor` is the one value that could be mistaken for one: it is
  unsigned, is not a capability, and authorization is pairing enforced at the Noise handshake, so holding
  it in renderer memory grants nothing. It is not persisted — the slice dies with the timeline and this
  store is `localStorage`-free by construction.
- **[File / storage operations]** None. No filesystem path, no web storage, no `safeStorage`. Named rather
  than skipped: the temptation this ticket specifically invites is persisting the cursor so a relaunched app
  resumes a walk mid-log. That is explicitly NOT in this design and must not be added — it would write
  daemon-minted state into renderer-side storage, surviving the pairing boundary `clearAllTimelines` exists
  to enforce.
- **[Inter-process / Electron attack surface]** No new IPC channel, no new `contextBridge` API, no new
  `ipcMain` handler, no window, no protocol handler, no navigation. The `requestHistory` command and its
  `isRequestHistoryPayload` boundary guard shipped with #1222 and #1259 became its first renderer sender;
  this ticket sends the same three-scalar payload from a second call site. Process placement holds: no key,
  socket or raw frame is in renderer scope.
- **[Cryptographic primitives]** Not applicable — no RNG, no hash, no comparison against a secret. Named
  because the wrong instinct with an opaque token-shaped string is to compare it with `===` against
  something or hash it into a key; the design does neither. The one place a cursor is *read* is
  `held.cursor` into a payload slot.
- **[Network & I/O]** No socket, URL, TLS decision or timeout is introduced. Two remote-behaviour risks
  apply and both are answered. **A hostile daemon serving an endless walk** — every page reporting
  `at_start` false with a fresh cursor — grows one conversation's timeline without bound. It is
  operator-paced rather than automatic (each page costs a deliberate scroll into the band, and nothing
  re-asks on its own), and it is the SAME accepted, pre-existing exposure the live lane already has via
  `assistantDelta`: `MAX_RETAINED_TIMELINES` bounds the number of slices, not their bytes, and the store's
  own header records that deferral. Not widened here and explicitly out of scope. **A daemon answering one
  ask with many `history_page` frames** cannot double-apply: `pendingHistoryRequests` is consumed on the
  first match, so a second frame under the same id resolves no conversation and emits nothing — and an
  unsolicited page is that case exactly. A relay merely *withholding* the frame leaves the conversation at
  `requested`, which is terminal by design and is why there is no timer.
- **[Error messages, logs, telemetry]** Nothing on any path this ticket adds logs — no `console.*`, no
  diagnostic, no telemetry, no error object constructed. Stated as a property rather than an omission: the
  values in scope are a conversation id, an opaque cursor, three scroll integers and replayed message text.
- **[Concurrency]** No promise, timer, interval or `AbortController`; no listener added or removed. The
  frame-rate firing of `onScroll` is the real concurrency question and it is answered by state rather than
  by a lock: `requested` is written before the send and every later firing reads it and declines. The
  check-then-act has no `await` in it. SHOULD FIX carried into Phase B: prove by test that a second firing
  in the band, with nothing having settled in between, sends nothing — a `markRequested` moved after the
  send would still pass every single-firing case.
- **[Threat model alignment]** *Malicious relay* — content-blind and on-path; it can drop or delay a page,
  which leaves the conversation at `requested` and the walk stalled, with no plaintext leak and no spin.
  *Hostile daemon inside the session* — replayed content (finding 1, no new sink) and the unbounded walk
  (finding 6, accepted and out of scope). *Renderer compromise reaching the transport* — unchanged; nothing
  here holds a key, a socket or a raw frame. *Token theft from disk* — not applicable; nothing is written.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07

## Revisions

### 2026-09-07 — the walk CASCADES while the reader stays in the band, and that shaped the drive's barriers

Not a design change; a behaviour the design implies that the plan had not named, found by the fake-tier
drive reddening twice. A page that does not push the reader out of `HISTORY_ASK_BAND_PX` leaves them still
near the top, and Chromium's anchoring adjustment after a prepend **is itself a scroll event** — so a small
page carries the walk one step further with no second scroll from the operator. The empty page (no growth,
no event) and the one-entry short page (≈40px of growth, still inside the band) both did this.

That is the correct product behaviour — keep loading until there is enough above the reader, bounded by
`atStart` — and no production code changed for it. What it invalidates is a whole class of *assertion*:
anything that encodes a MOMENT. Two shapes were replaced in `e2e/history-walk.spec.ts`:

- an ask-**count** barrier (`expect.poll(...).toBe(3)`) raced the cascade and read 4;
- an intermediate row-**count** and a `userBubbles.first()` read raced it the same way, because the next
  page had already landed.

Both are now facts rather than moments: barriers wait for a specific **cursor** to appear among the asks,
rows are addressed by their own **text**, and the sequence is pinned once at the end by an equality on the
ordered cursor list — which is a strictly stronger claim, since it also proves no page was asked for twice
across dozens of real scroll events.

### 2026-09-07 — both open questions resolved as the design predicted

1. **The park inside the band is well clear of the bottom.** The primer's twenty turns put the reader a
   full viewport-plus above it, so the pin's `following` flag is clear and the pin writes nothing during the
   prepend — asserted as a precondition (`distanceFromBottom(before) > before.clientHeight`) rather than
   assumed, so anchoring is provably the only mechanism in play.
2. **`prependedRows` counts `fresh.length`, not the page's size.** Confirmed as written: the key-present
   branch is the one that runs, and a page whose rows are all held echoes moves the count by the number
   actually inserted. Covered by *rises by the rows a page actually inserted, never by the rows it asked to*.

### 2026-09-07 — § Design 3 verified by mutation, not by argument

The row key is invisible to every gate but this one, so the claim was proved rather than reasoned about.
With `key={firstRowKey + index}` reverted to `key={index}` and the app rebuilt, the AC2 case fails with the
reference row's viewport top moving from **112 to 848** — the reader's row pushed clean off the bottom of
the viewport by a page prepended above them. Restored, it holds at 112. That number is the measurement
behind § Design 3 and behind the `⭐` note on the row map.
