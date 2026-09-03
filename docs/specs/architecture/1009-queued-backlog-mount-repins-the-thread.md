# #1009 — a queued-backlog mount re-pins the thread

`useThreadScrollPin`'s re-assert runs on **screen** renders. A `queue_state` push does not produce one, because
`QueuedBacklogControl` holds its own queue-store subscription — so the backlog region mounts between the thread
and the composer, the thread's viewport shrinks by ~116px, and the view is left short of the bottom until some
unrelated frame re-renders `ConversationScreen`. This ticket makes the backlog's appearance *and* its growth a
screen render, and corrects the docblock inventory that claims every mount in that region already is one.

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin` — the dep-free layout
  effect and the `following` ref; its docblock is what AC4 corrects. → `ConversationScreen` — the render tree,
  and the `selectOpenTimelineFor` / `useMemo` idiom the new backlog read mirrors. → `QueuedBacklogControl` —
  the leaf whose own subscription is the bug's mechanism. → `QueuedBacklog` — the pure view (unchanged).
  → `ComposerSlot`, `ComposerErrorSlotControl`, `ConnectionBannerControl` — the other store-bound leaves the
  corrected inventory must name accurately.
- `src/renderer/src/store/queueStore.ts` → `selectBacklogFor`, `EMPTY_BACKLOG`, `setBacklog` — replacement-truth
  writes with a fresh array per snapshot (so a growth changes the selector's result by reference), and the
  documented `Object.is` stability for a *different* conversation's snapshot (so the hoisted read costs no churn).
- `src/renderer/src/screens/conversation/threadScrollPosition.ts` → `AT_BOTTOM_TOLERANCE_PX`, `isAtBottom` — the
  band the spec imports; unchanged by this ticket.
- `src/renderer/src/screens/conversation/dropQueuedMessage.ts` → `dropQueuedMessage` — the drop send the control
  binds; its header comment names the container by name.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → the two comments citing
  `QueuedBacklogControl` as the memo-stable-selector idiom (one with a line-number citation).
- `e2e/thread-scroll-pin.spec.ts` → `primeOverflowingThread`, `expectPinnedToBottom`, `readThreadMetrics`,
  `queueStateFrame`, `QUEUED_BACKLOG` — the harness the new criteria extend, and the fourth criterion's comment
  block that currently explains why the immediate case is *not* asserted.
- `e2e/queued-backlog-interrupt.spec.ts` → its header note that `QueuedBacklogControl` reads
  `selectBacklogFor(activeConversation.id)` — the routing precondition, still true of the screen after the hoist.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `QueuedBacklog` pure describe and the
  container smoke test asserting no `conversation__queued` against the empty store — both must stay green.
- `docs/knowledge/features/conversation-shell.md` § "Thread scroll pin" — the accumulated history: #796 and #967
  each had to re-point the fourth criterion when its subject stopped shrinking the region, and the measured
  116px gap this ticket closes. Read-only.
- `CLAUDE.md` § Build and test — renderer tests are `renderToStaticMarkup` server renders with no DOM and no
  effects, so Playwright is the only tier that can prove any of this.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Nothing new is drawn. The anchor is the desktop layout's message-area / input-area stack: the scrolling message
area fills the pane and the input area — one fixed status line (working label left, connection slot right) above
the message box and its footer controls — sits directly beneath it, with no gap between them. That adjacency is
the geometry under test: the message area is the flex child that gives up height to anything occupying the strip
between it and the message box, so a region mounting there shrinks the thread's viewport and nothing else.

## Context

The pin (#601) decides from a tracked flag, never from a measurement taken after new content lands, and
re-asserts in a layout effect with no dependency array. That form covers everything the *screen* renders. It does
not cover a leaf that re-renders alone, and `QueuedBacklogControl` is exactly that: it subscribes to the queue
store itself, so a `queue_state` push re-renders the control, mounts the dimmed backlog rows, shrinks
`.conversation__thread`'s `clientHeight`, and never runs the screen's effect.

The shrink leaves the flag *correct* — no scroll event fires, because a shrinking viewport raises the maximum
scroll offset and the browser clamps nothing — so the next screen render re-pins. That is why this is a latency
gap rather than a broken pin, and why #967 could file it (measured at 116px with a two-item backlog) instead of
fixing it.

Two candidate fixes were on the table. A `ResizeObserver` on the scroll container would cover every occupant of
that region, but it is the larger build and no other occupant is under test here. The one taken is the ticket's
cheaper option: the screen reads the open conversation's backlog, so the region's appearance and its growth are
both screen renders and the existing re-assert covers them under the rule it already claims. No ADR is warranted —
this restores a documented invariant rather than establishing a new one.

## Design

### The hoist

`ConversationScreen` gains one subscription, in the shape it already uses for the timeline: a `useMemo`-stable
selector per conversation id, then the read.

```ts
const selectOpenBacklog = useMemo(() => selectBacklogFor(openConversationId ?? ''), [openConversationId])
const queuedBacklog = useQueueStore(selectOpenBacklog)
```

`QueuedBacklogControl` is deleted and the screen renders the pure view directly, `WorkspaceChip`-style:

```tsx
<QueuedBacklog items={queuedBacklog} onDrop={/* the control's closure, verbatim */} />
```

Three points the implementation must not drift on:

- **The `?? ''` sentinel is carried verbatim from `QueuedBacklogControl`,** and it is deliberately *not* the
  `selectOpenTimelineFor` branch-to-a-null-selector treatment beside it. That treatment exists because `''` is an
  ordinary key in the timeline holder (`dispatchFor` mints a slice for whatever id the daemon asserts), so the
  sentinel could render another conversation's thread. The queue store is written only by `queueBridge` from a
  decoded `conversation_id`, `selectBacklogFor` falls back to the shared `EMPTY_BACKLOG` for an unheld key, and
  `BackgroundTaskPanel` uses the same sentinel for the same reason. Changing it is a different ticket.
- **The screen reads no field of any item** — the array is passed straight through. Nothing derives a key, a
  label, a title or a length-based branch from daemon-supplied `text`.
- **`window.pyry.sendCommand` stays dereferenced inside the `onDrop` closure**, at interaction time, never at
  render. That is what keeps the container's smoke render bridge-free.

Deleting the control rather than passing `items` into it: once the screen holds the backlog, the control's only
remaining input is `activeConversationId`, which the screen already reads for the timeline, the workspace chip,
the composer slot and three sheets. Keeping it would be a second subscription to the same slice behind a name
that no longer describes what it does.

### Why this read is safe to hoist, when two neighbours are documented as deliberately un-hoisted

`ComposerErrorSlotControl` keeps its own `sessionStore` read because "a read here would re-render the whole
screen, timeline included, on every connection-status change"; `ComposerSlot` keeps its question-batch read so a
batch (and every keystroke in the panel it mounts) never wakes the timeline. Both arguments are about *traffic
the screen has no use for*. The backlog read is the opposite case on both axes:

- **Frequency.** A `queue_state` snapshot arrives when a message is enqueued behind a busy turn or dropped —
  operator-paced, orders of magnitude below connection-status churn or keystrokes.
- **Relevance.** The screen *needs* this render. The event changes the height of a region the screen lays out
  above the composer, and the screen owns the pin that must re-assert when it does. This is not a leaf's private
  fact leaking upward; it is screen geometry that was being decided in a leaf.
- **Cost.** `selectBacklogFor` returns the same array reference (or the shared `EMPTY_BACKLOG`) when another
  conversation's snapshot lands, so `Object.is` short-circuits and a backlog for a chat the operator is not
  looking at re-renders nothing.

### The docblock inventory (AC4)

`useThreadScrollPin`'s dep-free-effect paragraph currently asserts that everything mounting between the thread
and the composer is a screen render. The corrected inventory names each surface in that region and which it is,
accurate against the file after this change:

| Surface | Store it reads | On a change there |
|---|---|---|
| The queued backlog (`.conversation__queued`) | queue store — **read by the screen** after this ticket | screen render → the re-assert runs |
| The status row + its label (`ComposerStatusArea` / `ThinkingIndicator`) | none of its own; derived from the `thread` slice the screen destructures | screen render (and since #796 the row is fixed-height and mounted always, so it moves no geometry) |
| The status row's trailing slot (`ComposerErrorSlotControl`) | `sessionStore`, deliberately un-hoisted | its own leaf only — #963's button grows the row ~8px with no re-assert |
| The composer slot's question panel (`ComposerSlot` → `QuestionPanelSlot`) | question-batch store, deliberately un-hoisted | its own leaf only — the panel takes the height the covered composer vacates, with no re-assert |

The paragraph keeps its "no dependency array" argument, restated honestly: a dependency array would enumerate the
screen's own state and rot; what it could never cover is a leaf that re-renders alone. Those two leaves are named
as a known, uncovered latency gap — the flag stays correct through their shrink, so the next screen render
re-pins — and the two ways to close it (hoist the read, as here; or a `ResizeObserver` over the whole region) are
named without being built. Per § Citations the inventory names symbols, never line numbers, and the stale
`QueuedBacklogControl:993-996` citation in `BackgroundTaskPanel` is repaired to a symbol reference in passing.

### Blast radius outside the screen

Deleting a symbol leaves comment references dangling. Repaired, comment-only, no behaviour: `dropQueuedMessage.ts`
(its header calls the control "thin glue over this"), `BackgroundTaskPanel.tsx` (two idiom citations),
`ConversationScreen.test.tsx` (the `QueuedBacklog` describe's header and the container smoke's note),
`e2e/queued-backlog-interrupt.spec.ts` (its routing precondition note). Package overviews under
`docs/knowledge/features/` also describe the old mechanism; those belong to the documentation phase and are not
touched here — the PR body carries the lesson instead.

## State + concurrency model

One added subscription, `useQueueStore(selectOpenBacklog)`, whose lifetime is the screen's — zustand's `useStore`
unsubscribes on unmount, so there is nothing new to tear down. No async work, no timer, no listener, no
`AbortSignal`: the whole mechanism is a synchronous layout effect inside one React commit.

Ordering, which is the fix's load-bearing property: `setBacklog` → the screen's selector result changes by
reference → React re-renders the screen → the DOM mounts (or grows) `.conversation__queued` → the dep-free layout
effect runs before paint and, if `following.current`, assigns `scrollTop = scrollHeight`. Mount and re-pin are the
same commit, so no observable state exists in which the rows are on screen and the pin has not been applied —
which is what makes the e2e's plain (non-polling) assertion correct.

The effect stays idempotent: it writes only while following, and assigning a value `scrollTop` already holds is a
no-op that fires no scroll event, so there is no feedback loop and a StrictMode double-invoke is free.

## Error handling

No new failure mode. No I/O, no IPC boundary, no parse, no result type: the change is a store read and a
`scrollTop` assignment. The existing null-guard in the effect (`ref.current === null`) still covers the thread's
late mount — `Timeline` renders `EmptyThread` at zero items, so the scroll node may not exist when a backlog
arrives for an empty conversation, and the effect returns early. `onDrop`'s existing null-id guard moves verbatim.

## Testing strategy

**Playwright, `e2e/thread-scroll-pin.spec.ts` — the only tier that can prove any of it.** Renderer specs are
`renderToStaticMarkup` server renders: no layout, no `scrollTop`, no effects. All four criteria land in the
existing spec, reusing its harness (`primeOverflowingThread`'s overflow + settle gates, `readThreadMetrics`,
`expectPinnedToBottom`, `queueStateFrame`) and its imported `AT_BOTTOM_TOLERANCE_PX`.

- **AC1 — the mount.** In the first test, where the fourth criterion already pushes `queueStateFrame`: await the
  two queued rows, then assert pinned *immediately*, with no other frame pushed and no send between. Red on main
  at ~116px. The comment block explaining why the immediate case was not asserted is replaced by what the
  criterion now proves; the reason the criterion exists at all (a glue that re-measured at arrival time would
  read "not at bottom" here) survives.
- **AC2 — the growth.** A second `queue_state` carrying a three-item backlog (replacement truth, so the whole
  list is re-sent), await three rows, assert pinned. This is what a fix keyed on "the backlog is non-empty"
  fails: that boolean does not change, and the viewport shrinks again.
- **AC3 — scrolled away.** In the second test (`…leaves the scroll offset unchanged when the operator has
  scrolled up`), after its existing tool-row step: push both snapshots in turn, await the rows, and assert
  `scrollTop` is still exactly `0` after each. The flag, not the geometry, is what governs.
- The stall step that follows AC1's push in the first test stays: it is #967's proof that the folded status
  reaches the row's shared label, and it remains a screen render that must keep the thread pinned.

**vitest:** `ConversationScreen.test.tsx` must stay green unchanged in substance — the pure `QueuedBacklog`
describe is untouched (the view's props are identical), and the container smoke test still renders
`<ConversationScreen />` against the initial queue store, where `selectBacklogFor` yields `EMPTY_BACKLOG` and the
view returns `null`, so no `conversation__queued` appears. No new unit test is added: there is no new pure
function, and the seeded-store path is invisible under server render (zustand v5 reads `getInitialState()`).

**Gate:** `npm test -- src/renderer/src/screens/conversation/ConversationScreen.test.tsx`, `npm run build`, and
`npx playwright test e2e/thread-scroll-pin.spec.ts` — run once before the fix to see AC1/AC2 red, once after.

## Open questions

- Whether the two remaining leaves (`ComposerErrorSlotControl`'s ~8px row growth, `ComposerSlot`'s question
  panel) deserve the same hoist or the `ResizeObserver`. Deliberately **not** decided here — the ticket says do
  not widen — but the corrected docblock names them, so the next reader inherits the question rather than
  re-deriving the wrong conclusion.
- Whether awaiting the queued rows is a sufficient settle gate for the immediate assertion. Resolved by
  construction above (mount and re-pin share one commit); if the RED run shows the assertion passing on main, that
  premise is wrong and the plan gets a `## Revisions` entry rather than a weakened assertion.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. The only untrusted data in this path is the daemon-supplied `QueuedItem`
  backlog, and its boundary is unchanged: `parseInboundMessage` decodes the frame under the existing
  `MAX_PLAINTEXT_BYTES` cap, `queueBridge` writes the typed snapshot, and `QueuedBacklog` renders `item.text` as
  auto-escaped React children. This ticket moves *which component subscribes*, adds no parse, no coercion and no
  new sink. Design decision that keeps it that way: the screen passes the array straight through and reads no
  field of any item — no key, label, title, log or length-based branch derived from daemon text.
- [Tokens, secrets, credentials] Not applicable, and structurally so: the renderer holds no token, key or
  handshake material (CLAUDE.md's process split), and the queued backlog is the operator's own pending message
  text. Nothing in the diff reads, stores or transports a credential.
- [File / storage] Not applicable — no filesystem access, no path built from any field, nothing persisted, no
  web storage touched. The change is a store read and a `scrollTop` assignment.
- [Inter-process / Electron attack surface] SHOULD FIX (a discipline the implementation must not regress):
  `dropQueuedMessage`'s call site moves with the JSX, and `window.pyry.sendCommand` must stay dereferenced
  *inside* the `onDrop` closure. Hoisting it to render would put the bridge in every container smoke render's
  path. The verifier can check it by inspection. No new IPC channel, no new preload surface, and the untrusted
  `queued_msg_id` echoed back to the daemon on a drop is the pre-existing shape, unchanged.
- [Cryptographic primitives] Not applicable — no randomness, no comparison against a secret, no key or nonce
  handling anywhere in the diff.
- [Network & I/O] Considered, no finding. The hoist does widen the re-render footprint of a `queue_state` for the
  *open* conversation from one leaf to the screen, so a hostile daemon pushing a huge backlog now re-renders the
  timeline too. It is not a new capability: the payload is already capped at decode, the leaf already rendered
  every row, and the same daemon can force screen renders at will with `assistant_delta`. A snapshot for a
  *different* conversation still returns the same array reference, so it re-renders nothing.
- [Error messages, logs, telemetry] No findings. The change adds no logging, and must not: item text is transit
  content that may never reach a log (the wire type's own rule). No `console.*` in the new code. The e2e
  assertions read geometry, counts and client-owned label copy only — no token, key or plaintext is serialised in
  any failure diagnostic.
- [Concurrency] No findings. One subscription whose lifetime is the screen's (zustand unsubscribes on unmount);
  no async task, timer, listener or `AbortSignal` added; no check-then-act across an `await` — the flag read and
  the `scrollTop` write are synchronous inside one commit. The effect is idempotent, so a double-invoke is a
  no-op.
- [Threat model alignment] Considered. A hostile relay is on-path and can drop, delay or reorder frames: a
  reordered pair of `queue_state` snapshots can show a stale backlog, which is the pre-existing replacement-truth
  semantics (the daemon re-sends per conversation on reconnect) and is unchanged here. A daemon-driven *scroll* is
  the one capability worth naming — after this change a `queue_state` can move the operator's viewport — but it is
  gated by the same flag as every timeline arrival, so a daemon gains nothing it did not already have via
  `assistant_delta`, and AC3 pins the scrolled-away case as a test. Renderer compromise reaching the transport is
  unaffected: no new capability crosses the bridge. OUT OF SCOPE, named by the ticket itself: the other two
  occupants of the region are a fidelity gap, not a security one, and belong to a future ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
