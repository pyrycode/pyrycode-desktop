# #602 — Scroll the thread to the bottom when the operator sends a message

Rides #601 (`7bfef98`, PR [#611](https://github.com/pyrycode/pyrycode-desktop/pull/611)). Third child of the #599 split: #600 (helper) → #601 (conditional pin) → **#602 (this)** → #603 (open at bottom).

## Files to read first

- `docs/knowledge/codebase/601.md` — the whole mechanism this ticket re-arms. Read it before the code. The "Lessons learned" section is where the rAF-settle ordering rule that this ticket's e2e inherits is written down.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:277-357` — `ThreadScrollPin` (`:281-284`), the isomorphic `useThreadLayoutEffect` alias (`:293`), and `useThreadScrollPin` (`:318-357`): the `following` ref (`:320`), the dependency-free re-assert (`:334-339`), the `onScroll` metric mapping (`:348-355`). **This hook is the only production code that changes.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:156-183` — where the pin is held (`:160`) and handed to `Timeline` (`:183`); `<Composer />` at `:221`. Confirms composer and thread are siblings under the body that owns the flag, so no plumbing crosses a distant part of the tree.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1543-1586` — `Composer` (currently prop-less), `handleSubmit` (`:1561-1574`: the `!canSend` return at `:1565`, the `submitMessage` call at `:1568`, `if (sent) setText('')` at `:1573`), and the Enter path `handleKeyDown` (`:1576-1586`) that funnels into the same `handleSubmit`.
- `src/renderer/src/screens/conversation/composerSend.ts:22-70` — `submitMessage`'s contract. Extract two facts: (a) both `return false` paths (`:47-48`) are **above** the echo dispatch, and (b) the bridge `catch` (`:60-63`) falls through to the dispatch (`:67`) and `return true` (`:69`). This is why `sent === true` ⟺ *a message entered the timeline*.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:400-412` — `Timeline`. Read only to confirm it is not touched: it stays pure props-in / markup-out and its `scrollPin?: ThreadScrollPin` prop type is unchanged.
- `src/renderer/src/screens/conversation/threadScrollPosition.ts:43-70` — `AT_BOTTOM_TOLERANCE_PX` and `isAtBottom`. Read to confirm nothing here changes; its header already says not to add a caller "to prove it works".
- `e2e/thread-scroll-pin.spec.ts` — the whole file (~307 lines). Every helper the new test needs already exists: `assistantDeltaFrame` (`:75`), `turnEndFrame` (`:88`), `buildReplyFrames` (`:156`, and note `:162` — only `PRIMER_TEXT` gets a stream), `readThreadMetrics` (`:180`), `primeOverflowingThread` (`:199`, which carries the `scrollHeight > clientHeight` non-vacuity gate), `expectPinnedToBottom` (`:220`), `settleScrollEvent` (`:232`). Test 2 (`:281-307`) is the named regression target — it must survive unedited.
- `src/renderer/src/main.tsx:6` — `ReactDOM.createRoot`. One line, but load-bearing: it is what makes React 18 automatic batching apply to the store update inside `handleSubmit` (see **Ordering** below).
- `vitest.config.ts:27` — the `node` environment. Confirms there is no DOM tier for a unit test of this glue.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

The Conversation Thread Screen: a single vertically-scrolling column of user (right, filled) and assistant (left, surface) bubbles interleaved with tool chips and the session-boundary delimiter, with the status row and composer fixed beneath it, so the newest item sits directly above the composer. The design draws **no** scroll affordance — no scrollbar treatment, no "jump to latest" button — so this ticket adds no visual element and no stylesheet edit; the node is a layout reference confirming that "bottom" means "newest, next to the composer".

## Context

#601 made the thread follow the conversation *only while the operator was already at the bottom*, tracked by a screen-local `following` ref that is written **only** by `.conversation__thread`'s own scroll events. That is the right default and it deliberately leaves a scrolled-back operator alone.

Sending is the documented exception: it is the operator's own act of moving the conversation forward, so the view should follow unconditionally. And it must leave the thread *pinned*, not merely jump once — the optimistic echo lands immediately but the daemon's reply streams over the following seconds, and a one-shot jump would drop that reply below the fold again.

The blocker's shape makes this nearly free. The re-assert is a **dependency-free** layout effect that runs after every render of `ConversationScreen`, so "jump now" and "stay pinned" are not two behaviours: both are consequences of the flag being `true`. This ticket therefore introduces **one assignment** and the wire that carries it from the composer to the hook.

## Design

### The seam

`Composer` learns nothing about scrolling. It gains one required callback prop — `onMessageSent` — that it invokes exactly where it already branches on the send outcome. `ConversationScreen` supplies the hook's arming function. The Composer's contract stays "a message entered the timeline"; the decision that this means "follow the bottom" stays in the screen that owns the flag.

`useThreadScrollPin` widens its return from the DOM-handle bundle to a two-member object: the bundle, plus the arming function.

```ts
// unchanged, exported, still Timeline's prop type
export interface ThreadScrollPin { ref: RefObject<HTMLDivElement>; onScroll: UIEventHandler<HTMLDivElement> }

// new, file-local (not exported — nothing outside this file names it)
interface ThreadPin {
  scrollPin: ThreadScrollPin
  /** Resume following the bottom. Called when the operator's own message enters the timeline (#602). */
  followBottom: () => void
}

function useThreadScrollPin(): ThreadPin
```

`followBottom` is one statement: `following.current = true`. Nothing else — no measurement, no `scrollTop` write of its own (see **Considered and rejected**).

`ThreadScrollPin` is deliberately **not** widened to a third member. Its docstring's claim — "the two DOM handles the thread's scroll container needs" — is what makes the both-or-neither bundling honest, and `followBottom` goes to a different component and touches no DOM node, so it does not belong in that bundle. It would also widen `Timeline`'s prop type with a value `Timeline` never reads.

### Call sites

Three lines in `ConversationScreen.tsx`, plus the `Composer` signature:

- `:160` — `const { scrollPin, followBottom } = useThreadScrollPin()`. Naming the field `scrollPin` keeps `:183` byte-identical, so `Timeline` and its 30 other render sites are untouched.
- `:221` — `<Composer onMessageSent={followBottom} />`.
- `:1543` — `function Composer({ onMessageSent }: { onMessageSent: () => void }): JSX.Element`.

**Required, not optional.** `<Composer />` at `:221` is the only render site in the repo (`Composer` is not exported and no test renders it), so requiring the prop costs no edit cascade and makes "forgot to wire it" a compile error. This is the opposite call from `Timeline`'s optional `scrollPin`, and for the opposite reason: there, 30 existing call sites made optional the only non-cascading choice.

No `useCallback` on `followBottom` — `Composer` is not memoized, so it re-renders with its parent regardless of prop identity and a stable identity buys nothing. Same reasoning, verbatim, as `onScroll`'s comment at `:346-347`.

### `handleSubmit`

The new call goes inside the existing `if (sent)` branch, beside `setText('')`:

```ts
if (sent) {
  setText('')
  onMessageSent()
}
```

That placement — not a call at the top of `handleSubmit`, not one after the `!canSend` gate — is what satisfies the third and fourth criteria structurally rather than by care:

- `sent === true` ⟺ `submitMessage` dispatched the optimistic echo. Both `false` returns (`composerSend.ts:47-48`, whitespace-only and null conversation id) are above the dispatch, and the `!canSend` gate (`:1565`) returns before `submitMessage` is called at all. So a submit that sends nothing never reaches `onMessageSent`, leaves the flag exactly as the operator's scrolling set it, and leaves **no armed pin behind** — the delayed failure mode where the *next* unrelated arriving item yanks a scrolled-up operator cannot occur.
- A send whose bridge call throws is caught (`:60-63`), still dispatches the echo, and still returns `true` — so it jumps, correctly, because a message did enter the timeline.
- Nothing in the path consults `items`, `kind`, or "an item arrived". The jump's cause is the submit; arriving items remain governed by #601's flag alone, so test 2 keeps passing unedited.

### Ordering — why one assignment is enough

`submitMessage` dispatches the echo into `timelineStore` **before** returning, so `followBottom()` runs after the store already changed. The render that mounts the echo still happens afterwards: the app mounts through `ReactDOM.createRoot` (`src/renderer/src/main.tsx:6`), so React 18 automatic batching applies, and a store update scheduled inside a discrete event handler (`onClick`, and `onKeyDown` via `handleKeyDown` → `handleSubmit`) flushes only once the handler returns. There is no re-render point inside the synchronous body of `handleSubmit`.

So the sequence is: echo dispatched → flag armed → `handleSubmit` returns → React renders `ConversationScreen` with the new item → the dependency-free layout effect reads `following.current === true` and writes `el.scrollTop = el.scrollHeight` before paint. The jump and the pin are the same fact observed at two times, which is why there is no second mechanism for "stay pinned":

- **Criterion 1 (jump on send)** — that first post-echo render.
- **Criterion 2 (left pinned)** — the flag is still `true` when the daemon's reply renders, so the same effect fires again per delta. The pin write moves `scrollTop`, which fires a real scroll event, and `onScroll` recomputes `isAtBottom` → `true`, so the flag is self-consistent rather than merely stale.
- **Criterion 2, second half (not a stronger lock)** — nothing marks the pin sticky or scoped to a turn. If the operator scrolls up mid-stream, `onScroll` writes `false` exactly as before and the view stays put. #601's behaviour is unchanged in every case except the instant of a successful send.

### No new arithmetic, and none should be invented

This ticket adds no pure decision. `isAtBottom` and `AT_BOTTOM_TOLERANCE_PX` are untouched and gain no new caller. There is no threshold, no measurement, and no derived value anywhere in the change — it is one boolean assignment plus the prop that reaches it. A new exported helper existing only to give a unit test something to call would be padding, and `threadScrollPosition.ts`'s own header explicitly forbids that shape. Do not add one.

## State + concurrency model

No store change, no new state, no new subscription. The `following` ref stays screen-local and unrendered (a `useRef`, not `useState` — nothing in the markup depends on it and scroll events fire at frame rate). Writers of that ref go from one to two: `.conversation__thread`'s `onScroll`, and now `followBottom` on a successful send. Both are synchronous, both run in event-handler context, and there is no async path, no timer, and nothing to tear down — `onMessageSent` is a plain prop whose lifetime is the Composer's.

The re-assert stays exactly as #601 shipped it: dependency-free, idempotent, safe under a StrictMode double-invoke.

## Error handling

There is no new failure mode. The only I/O on the path is `submitMessage`'s guarded `sendCommand`, whose failure is already swallowed and logged (`composerSend.ts:60-63`); the design treats that case as a jump on purpose (the echo posted, so the timeline moved). `followBottom` cannot throw — it writes a ref field. The layout effect already null-guards `ref.current` (`:336`), which covers the case where `.conversation__thread` is not mounted (an empty thread renders `<EmptyThread />` instead): a send into an empty thread arms the flag, the echo mounts the container, and the effect on that same render scrolls a container that needs no scrolling. Nothing is surfaced to the operator — this is a view-position behaviour, not an operation that can report a result.

## Testing strategy

**No unit test, and no renderer test edit.** The renderer suite runs vitest's `node` environment (`vitest.config.ts:27`) through `renderToStaticMarkup`: effects never run and no layout exists, so neither the arming nor the scroll is observable there. This is untested reviewed glue in exactly the sense #601's is, and for the same reason. `composerSend.test.ts` needs no change — `submitMessage`'s contract is unchanged. The 33 `<ConversationScreen` render sites are unaffected: the new prop is internal to the file.

**The e2e is the whole proof**: a third `test(...)` appended to `e2e/thread-scroll-pin.spec.ts`. A new spec file re-deriving the primer, the metrics reader and the settle helper would be waste.

Add one spec-local constant beside `PRIMER_TEXT`/`SECOND_TEXT` (`:69-70`) — the sent text for this case, named for it (`SCROLLED_UP_TEXT` or similar), and extend the "Two typed messages" comment at `:67-68` to three. `buildReplyFrames` needs **no** edit: its `:162` arm returns `[]` for any non-primer text, which is what makes the send a pure optimistic-echo plant.

Scenario — *"sending from far up the history jumps to the bottom and leaves the thread pinned"*:

1. `await primeOverflowingThread(page)` — twenty streamed turns, and the `scrollHeight > clientHeight` gate inside it fires before anything else, so no assertion below can run against a thread that does not scroll.
2. Scroll to the top by assigning `scrollTop = 0` through `.conversation__thread`'s `evaluate`, then `await settleScrollEvent(page)`. **Not optional, and the direction of the hazard is inverted from test 2's**: there, skipping the rAF pair makes a correct app fail; here it makes a *broken* app pass, because the flag would still be `true` when the send arrives and the pin would jump with no feature present. State that in a comment.
3. Assert `scrollTop` is `0` (via `readThreadMetrics`) — the precondition guard. Without it the test cannot distinguish "the send pulled the view down" from "the view was never up".
4. Fill the composer with the new constant and click Send (the primer's idiom — the button path; `handleKeyDown` funnels into the same `handleSubmit`, so Enter needs no separate case).
5. Await the second user bubble — `expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(2)` — then `await expectPinnedToBottom(page)`. Awaiting the locator first is what makes the plain (non-polling) assertion correct; that is `expectPinnedToBottom`'s documented contract at `:211-219`.
6. Stream a reply the operator did not ask for, with turn number `REPLY_TURNS + 1` so it is a distinct turn and a distinct bubble: `daemon.pushFrame(assistantDeltaFrame(REPLY_TURNS + 1))`, await assistant-bubble count `REPLY_TURNS + 1`, `await expectPinnedToBottom(page)`. Then `daemon.pushFrame(turnEndFrame(REPLY_TURNS + 1))`, await the last bubble's exact text (the settle gate — the streaming cursor drops on `turn_end`), `await expectPinnedToBottom(page)`. Two arrivals, so "the reply keeps the view" is asserted across a stream rather than at a single instant.
   No rAF settle is needed before these pushes, and the comment should say why: the only scroll event outstanding is the one the pin's own write queued, and when it dispatches it computes at-bottom → `true`, which is the value already held. The settle in step 2 matters because there the pending event carries the *opposite* value.

Non-vacuity, end to end: strip the feature and step 5 fails — the flag is `false`, the effect does not write, and `scrollHeight - 0 - clientHeight` exceeds `AT_BOTTOM_TOLERANCE_PX` by the whole overflow (~700px at the 1100×800 window).

**Do not edit test 2 (`:281-307`).** It is the third criterion's named regression target: it must keep passing untouched, which it does, because nothing in this change reacts to an item arriving.

Run: `npm test` (unchanged, must stay green), `npm run build` (the salvage/QA gate), `npm run e2e`.

## Considered and rejected

- **Having `followBottom` also write `scrollTop` immediately.** It would make the jump independent of when React flushes. But React 18's automatic batching under `createRoot` already guarantees the flush lands after the handler, so this defends a failure mode that cannot occur here and has never been observed; in the normal path it is a redundant second write to a container whose content has not grown yet. Left out.
- **A third member on `ThreadScrollPin`.** Rejected above: it is a DOM-handle bundle whose value is that it is exactly that, and it is `Timeline`'s prop type.
- **Arming before `submitMessage` (e.g. right after the `!canSend` gate).** It would have to re-derive whitespace-only and null-conversation-id to know whether a message will actually go out — a second copy of `submitMessage`'s gate — and getting it wrong leaves the armed-but-unspent flag that the fourth criterion exists to forbid. The existing `sent` boolean already carries the fact exactly.
- **A "sticky until the turn ends" pin.** Explicitly excluded by the second criterion: the operator scrolling up mid-stream must still win.

## Open questions

None. The mechanism, the signal and the test tier are all fixed by the blocker; nothing here needs resolution during implementation.

## Scope check

One production file (`ConversationScreen.tsx`), one test file (`e2e/thread-scroll-pin.spec.ts`), no new files, no new exported types, no store or stylesheet change. Call sites needing simultaneous edit: two (`:160`, `:221`) plus the `Composer` signature. Roughly 25–30 production lines (mostly comment) and ~45 e2e lines. Every red line is clear by a wide margin — this is XS-shaped work; the `size:s` label is left as PO set it, since S costs nothing and the estimate has nowhere to go but down.
