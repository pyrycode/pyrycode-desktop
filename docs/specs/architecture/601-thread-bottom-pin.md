# #601 — Keep the thread pinned to the bottom when it is already at the bottom

## Files to read first

- `src/renderer/src/screens/conversation/threadScrollPosition.ts` (whole file, 64 lines) — the **merged** blocker (`f3e7609`, PR #605). `isAtBottom(metrics)`, `AT_BOTTOM_TOLERANCE_PX = 4`, `interface ThreadScrollMetrics { scrollOffset, viewportHeight, contentHeight }`. This ticket is its first and only call site. Read the docstrings; they contain the reasoning you are consuming, not re-deriving.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:88-152` — the container's hook block. Where the new hook call goes, and the house style for a screen-local value (`sheetOpen`, `channelInfoOpen`, `pickerOpen`, `panelOpen`, `now`).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:153-266` — the `.conversation` flex column. `<Timeline items={items} now={now} />` is at `:175`; every chrome element the fourth criterion names is a `flex: 0 0 auto` sibling *below* it.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:291-331` — `Timeline`. The `now` prop at `:300-303` is the optional-prop precedent to copy verbatim: a default keeps the 30 existing call sites green with zero edits. `:311` is the `items.length === 0 → <EmptyThread />` branch that makes the scroll node mount late.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1795-1810` — the in-file `useRef<HTMLDivElement>(null)` DOM-ref idiom already in this file (`wrapperRef` / `triggerRef`).
- `src/renderer/src/screens/conversation/RunConfigData.tsx:16-40` — the file's `useRef` + `useEffect` shape, including how StrictMode double-invocation is reasoned about in a comment.
- `src/renderer/src/screens/conversation/conversation.css:231-241` — `.conversation__thread`: `flex: 1 1 auto; min-height: 0; overflow-y: auto`. The sole flexible child, which is why chrome mounting shrinks *its* viewport alone.
- `e2e/send-and-stream.spec.ts` (whole file, 123 lines) — the template for the new e2e spec: scripted `buildReplyFrames`, `encodeEnvelope`, the `default` seed arm, the assertion posture.
- `e2e/queued-backlog-interrupt.spec.ts:85-110` — the `daemon.pushFrame` + `turn_state` frame-builder precedent (this is where the chrome trigger comes from).
- `e2e/fixtures/launchPairedApp.ts:108-125` — the `PairedApp` handle (`page`, `daemon`) the new spec destructures.
- `src/shared/wire/types.ts:697-737` — `SessionTransitionPayload` and `ToolUsePayload`, the two frame shapes the e2e pushes to exercise non-assistant item kinds.
- `src/main/index.ts:37-38` — the 1100×800 window, the height the e2e reply must overflow.
- `docs/knowledge/decisions/0006-ephemeral-screen-state-usereducer-not-store.md` — the screen-local-state dividing line this design sits on.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

The Conversation Thread Screen (`16:8`): a single vertically-scrolling message column between a fixed top bar and a fixed status row + composer, with the newest content resting directly above the status row. That is the layout this ticket keeps true at runtime — the design pins the shape, not the behaviour, and **no visual treatment changes here**. No new class, no token, no stylesheet edit (see *Scroll anchoring* below for why the one candidate CSS line is not shipped).

## Context

`.conversation__thread` scrolls, but nothing in the renderer has ever read or written its scroll position. When the operator is reading at the bottom and a reply arrives, the view stays put and the reply lands below the fold.

The blocker (#600) shipped the arithmetic — a pure, unit-tested `isAtBottom` — deliberately dormant. This ticket writes the renderer's first scroll code and is that helper's only caller. #602 (force to bottom on send) and #603 (open at the bottom) are separate triggers riding the mechanism built here.

## Design

### The shape

Three seams, all in `ConversationScreen.tsx`:

1. **A tracked "following the bottom" flag**, owned by the container, moved only by the container's scroll events.
2. **A scroll handler** on `.conversation__thread` that recomputes the flag from the metrics *at that moment*, via the merged `isAtBottom`.
3. **A re-assert**, run after the DOM is updated, that returns the scroller to the bottom iff the flag is set.

The decision of *whether* to pin is therefore always made from a value captured before the arriving content existed. Nothing in this design ever measures the DOM at arrival time to answer "was the operator at the bottom?" — the third criterion's requirement, and the reason the chrome case (below) works at all.

### Where the state lives

Screen-local, in the container. Per ADR 0006 the dividing line is "read by any other component / must survive across screens?" — no on both counts, so this is not a store slice. It is not a `useReducer` either: ADR 0006's last consequence carves out trivial single-value local state, and this is one boolean.

It is a **`useRef`, not `useState`**, and that is a deliberate call rather than an oversight a reviewer should correct:

- The value is **never rendered**. No markup, class, or attribute depends on it. React's own rule for a value that does not participate in output is a ref.
- Scroll events fire at frame rate. `useState` would re-render the whole thread — the most expensive subtree in the app — on every scroll frame, for a value nothing renders.

"State" in the third acceptance criterion means *tracked across time*, not *`useState`*. A ref satisfies it exactly: the flag persists between renders, is written only by the scroll handler, and is read by the re-assert.

Initial value: **`true`**. The thread starts pinned, so the first messages into a fresh conversation follow. This also covers the late-mounting scroll node (`Timeline` renders `<EmptyThread />` at zero items, so `.conversation__thread` mounts only when the first item lands) with no guard of its own — and the merged helper already returns at-bottom for a thread that cannot scroll, so nothing special-cases the short thread either.

### The hook

One in-file hook in `ConversationScreen.tsx`, beside the container it serves:

```ts
/** The two DOM handles the thread's scroll container needs from the screen. Both or neither. */
export interface ThreadScrollPin {
  ref: RefObject<HTMLDivElement>
  onScroll: UIEventHandler<HTMLDivElement>
}

function useThreadScrollPin(): ThreadScrollPin
```

Behaviour, in four statements:

- Holds `useRef<HTMLDivElement>(null)` (the node) and `useRef(true)` (the flag).
- `onScroll` reads `event.currentTarget` synchronously, maps it to `ThreadScrollMetrics`, and assigns `isAtBottom(...)` to the flag. Nothing else — no early return, no branch.
- A layout effect (see below) sets `ref.current.scrollTop = ref.current.scrollHeight` iff `ref.current` is non-null and the flag is set.
- Returns `{ ref, onScroll }`. No `useCallback` / `useMemo`: `Timeline` is not memoized, so a stable identity buys nothing, and React attaches `onScroll` to the element directly.

**In-file, not its own module.** Every one of the twelve `*.ts` helpers in `screens/conversation/` has a sibling `*.test.ts`; this one is untestable under the renderer's node-env posture, so giving it a file of its own would make it the directory's first untested module and misrepresent it as a tested seam. It belongs with the container's other reviewed glue.

### The metric mapping — the one thing this ticket can break invisibly

```
scrollOffset   ← el.scrollTop
viewportHeight ← el.clientHeight
contentHeight  ← el.scrollHeight
```

Get this wrong and there is no type error and no unit test. But every consequential transposition fails the same way, and the e2e catches it:

- `scrollOffset` ↔ `viewportHeight` is **harmless** — the helper sums them.
- Any swap involving `contentHeight` puts a *smaller* number where the total content height belongs, so the distance goes strongly negative and the helper answers "at bottom" **always**.

"At bottom always" is precisely what the scrolled-up test asserts against: the pin would drag the view down and the offset would not be unchanged. The transposition is therefore not silent — it is the failure the second e2e test exists to produce.

### The re-assert: a dependency-free layout effect

The effect takes **no dependency array** — it runs after every render of `ConversationScreen`.

This is the fourth criterion's answer. The seven chrome elements (`.conversation__thinking`, `.conversation__stall`, `.conversation__api-retry`, `.conversation__compacting`, `.conversation__queued`, `.conversation__interrupt`, `.screen-snapshot`) mount and unmount off four different store slices. Enumerating them in a dependency array would be exactly the fragile coupling the criterion warns about, and would silently rot the moment an eighth affordance lands. Every one of those mounts *is* a container re-render, so "after every render" covers items changes and chrome changes with one rule and no bookkeeping.

Two properties make the dep-free form safe:

- **Idempotent.** It writes only when the flag is set, and assigning `scrollTop` a value it already holds is a no-op that fires no scroll event. There is no feedback loop.
- **Chrome cannot corrupt the flag.** A chrome mount shrinks `clientHeight` while leaving `scrollTop` and `scrollHeight` untouched. Shrinking the viewport *raises* the maximum scroll offset, so the browser does not clamp `scrollTop`, so **no scroll event fires** — the handler never runs, and the flag is untouched by definition. The re-assert then returns the view to the (new) bottom. Chrome mounting is structurally incapable of un-pinning a thread the operator never scrolled.

**`useLayoutEffect`, not `useEffect`** — required, not preferred. `useEffect` runs after paint, so every arriving delta would paint one frame at the stale offset (visible jitter during streaming), and the e2e would be genuinely racy: a Playwright `evaluate` could land between paint and the effect. `useLayoutEffect` runs inside the commit, so no observable state exists in which the pin has not been applied.

### The `useLayoutEffect` SSR warning — and the two-line alias that removes it

React 18 logs `Warning: useLayoutEffect does nothing on the server…` whenever a component reached by `renderToStaticMarkup` calls it. Reproduced against this repo's exact `react@18.3.1` / `react-dom@18.3.1`; there are **33 `<ConversationScreen` render sites** in the renderer tests, so this is 33 lines of new noise on every `npm test` run.

Define the standard isomorphic alias at module scope in `ConversationScreen.tsx` and use it for the re-assert:

```ts
// `document` exists in the window and not in vitest's `node` env — see vitest.config.ts:27.
const useThreadLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect
```

This is the fix React's own warning links to. It is not a speculative defence: the warning is observed, not projected. In the app `document` exists, so the pin gets the pre-paint guarantee it needs; under `renderToStaticMarkup` neither hook runs anyway, so behaviour is unchanged and the noise is gone.

### The `Timeline` prop

`Timeline` stays pure props-in / markup-out. It gains **one optional prop**:

```ts
export function Timeline({ items, now = Date.now(), scrollPin }: {
  items: readonly ThreadItem[]
  now?: number
  scrollPin?: ThreadScrollPin
}): JSX.Element
```

applied as `ref={scrollPin?.ref}` and `onScroll={scrollPin?.onScroll}` on the `.conversation__thread` div — written out explicitly rather than spread, so the both-or-neither wiring is visible in markup that is otherwise heavily annotated.

Optional for the `now` precedent's reason, verbatim: the **30 existing `<Timeline` render sites** (29 in `ConversationScreen.test.tsx`, 1 in `interactiveRoundtrip.test.tsx`) pass nothing, get `undefined` for both attributes — legal no-ops under `renderToStaticMarkup` — and stay green with **zero edits**. Bundling the two handles into one prop rather than adding two is what makes "wired one, forgot the other" unrepresentable.

`ConversationScreen` calls the hook beside its other screen-local values and passes the result: `<Timeline items={items} now={now} scrollPin={scrollPin} />`.

### Scroll anchoring — closed

**Indifferent. `overflow-anchor` is not set, and this ticket does not set it.** The stylesheet is untouched.

The browser default (`auto`) compensates for size changes *above* the anchor point so the read position stays steady. This design does not conflict with it in either state:

- **Pinned.** The re-assert runs after every render and overwrites the offset outright, so an anchoring adjustment cannot outvote it.
- **Scrolled away.** Anchoring's job — hold the operator's read position steady — is exactly the wanted behaviour. It preserves position by construction and never moves the scroller *to* the bottom, so it cannot flip the flag to at-bottom. If it does adjust the offset, the resulting scroll event recomputes the flag from real metrics and still reads "not at bottom".

Shipping `overflow-anchor: none` today would be a defence against a failure mode nobody has observed. If a mystery jump ever appears, that one line on `.conversation__thread` is the remedy — as a ticket with a reproduction, not pre-emptively.

### `flex-direction: column-reverse` — not on the table

Recorded so it is not re-litigated in review: it would pin natively, and it is rejected on process grounds, not technical ones. #599 was split around the measured-tolerance approach, the helper is merged on `main`, and #602/#603 are wired to ride this mechanism. Adopting it here strands all three. It is a route-back to PO, never a spec-time redesign.

## State + concurrency model

- **No store touched.** No new slice, selector, action, or bridge. `timelineStore` is read exactly as today.
- **No IPC, no transport, no async.** Everything here is synchronous DOM work inside the renderer's commit.
- **No subscription to tear down.** `onScroll` is a React prop, so the listener's lifetime is the node's — nothing to clean up, and no manual `addEventListener` whose attach could race the late-mounting node.
- **StrictMode double-invocation is a no-op.** `main.tsx:7` mounts under `React.StrictMode`; the layout effect runs twice and, being idempotent, the second run writes a value already in place.
- **Unmount is free.** The screen-local refs die with the component; a re-entered thread starts pinned again, which is the correct reading.

## Error handling

There is no failure mode to surface — no network, socket, parse, or permission boundary is crossed. The two defensive positions:

- **The node may not exist.** `ref.current` is null while `<EmptyThread />` renders. The effect returns early; there is no state to reconcile and nothing to report.
- **A wrong metric mapping is a silent-wrong-answer risk, not an error.** It cannot throw. It is covered by the second e2e test rather than by a guard — adding a runtime check would be a branch nothing can exercise, exactly what the merged helper's docstring rules out.

## Testing strategy

### Unit — nothing new, and the spec should not pretend otherwise

`vitest.config.ts:27` runs the `node` environment: renderer tests are `renderToStaticMarkup` string assertions, effects never run, and there is no layout to read. The hook and the re-assert are **untested reviewed glue** in the documented `ChannelInfoSheet` / `WorkspacePickerSheet` sense. `threadScrollPosition.test.ts` stays exactly as merged — do not extend it, and do not add a unit test for the glue.

The existing `ConversationScreen.test.tsx` / `interactiveRoundtrip.test.tsx` suites must pass **untouched**. If any needs an edit, the prop was not made optional correctly.

### e2e — the liveness proof

One new spec, `e2e/thread-scroll-pin.spec.ts`, driving the built app against the fake relay + fake Noise daemon via `launchPairedApp`. No new shared scaffolding: the fixture and a scripted `buildReplyFrames` already exist, and the spec owns its own reply content.

Spec-local support:

- A `buildReplyFrames` whose `send_message` arm streams **~20 turns** of `[assistant_delta, turn_end]` with distinct `turn_id`s (one bubble per turn — same-turn deltas coalesce into one bubble), and whose `default` arm returns `seedConversationsFrame()`. `.bubble` has no `pre-wrap`, so newlines will not buy height — separate turns are how the 1100×800 window's thread region is overflowed, and 20 leaves generous headroom for font metrics.
- Frame builders for `tool_use` (`ToolUsePayload`) and `session_transition` (`SessionTransitionPayload`), pushed post-launch with `daemon.pushFrame` — the `queued-backlog-interrupt.spec.ts:85-110` idiom.
- A local reader: `page.locator('.conversation__thread').evaluate(el => …)` returning `scrollHeight`, `scrollTop`, `clientHeight`.
- Import **`AT_BOTTOM_TOLERANCE_PX`** from `../src/renderer/src/screens/conversation/threadScrollPosition` rather than hardcoding `4`. That module has zero imports and no DOM or React reference, so it resolves in Playwright's Node transform with no alias config; `e2e/` sits outside both `tsconfig.*.json` projects, so this crosses no typecheck boundary. It is the repo's first e2e import from `src/renderer` — the justification is one constant with one definition. Assert the **raw** distance (`scrollHeight - scrollTop - clientHeight`) against it; do **not** call `isAtBottom` as the oracle, or a test that transposed its own metrics would agree with a production glue that transposed identically.

**Test 1 — an arriving item lands in view when the thread is already at the bottom.**

- Send a message; wait for the last streamed bubble's text (the auto-wait that guarantees the stream landed before anything is measured).
- **Assert `scrollHeight > clientHeight` first.** Without this both pin assertions pass against an app with no feature in it — this is the fifth criterion's non-vacuity gate and it must precede every other assertion in the file.
- Assert the distance is within tolerance.
- Push a `tool_use` frame; wait for `.tool-row`; assert the distance is still within tolerance. *(the `toolCall` kind — a non-bubble row)*
- Push a `session_transition` frame; wait for `.session-delimiter`; assert again. *(the `sessionBoundary` kind — no `data-thread-role` at all)*
- Push `turn_state{thinking}`; wait for `.conversation__thinking`; assert again. *(the fourth criterion — chrome mounts, the thread's viewport shrinks by tens of pixels, the pin must hold)*
- Send a second message; wait for the second `.bubble[data-thread-role="user"]`; assert again. *(the `userText` kind — and the only kind that reaches the store through the local optimistic dispatch instead of an inbound frame)*

That covers all four kinds the first criterion names. The remaining two need no case: `turnBoundary` draws no element, and `unrecognizedMessage` differs from the covered kinds only in the markup a row renders — a dimension the pin provably never reads, since neither the handler nor the effect mentions `kind` or `items`.

**Test 2 — an arriving item leaves the scroll offset unchanged when the operator has scrolled up.** Its own test, per the second criterion.

- Same send-and-overflow setup, including the same `scrollHeight > clientHeight` gate.
- Set `scrollTop = 0` through `evaluate`. Deliberately programmatic rather than `mouse.wheel`: it fires the same DOM `scroll` event the production handler listens to, with no hover position or smooth-scroll timing to go flaky on, and the top is an exact integer offset. The criterion is about the pin logic, not about input plumbing.
- Push a `tool_use` frame and **wait for `.tool-row` to appear** before asserting. Skipping this wait makes the test vacuous — it would assert an unchanged offset before anything had arrived.
- Assert `scrollTop` is still exactly `0`.

Both directions of this test are non-vacuous by construction: if no scroll event had fired, the flag would still be set and the pin would move the view off zero; if the metric mapping were transposed, the flag would read at-bottom and the pin would likewise move the view off zero.

Red on `main`, green after — which is why the proof ships with the fix rather than in a follow-up.

## Acceptance-criteria map

| Criterion | Discharged by |
|---|---|
| 1 — at-bottom arrival stays at the bottom, every kind | Dep-free layout effect + a mechanism that never reads `kind`; e2e test 1 across `assistantText`, `toolCall`, `sessionBoundary`, `userText` |
| 2 — scrolled-up arrival leaves the offset unchanged | The tracked flag gating the re-assert; **e2e test 2**, its own dedicated test |
| 3 — tracked state, not a post-arrival measurement | The flag written only by the scroll handler; the effect reads the flag and never re-measures. Design § *Where the state lives* is the review note |
| 4 — chrome cannot un-pin | A viewport-only shrink fires no scroll event, so the flag is untouched by construction; e2e test 1's `turn_state{thinking}` step |
| 5 — e2e proof, overflow asserted first | `e2e/thread-scroll-pin.spec.ts`; `scrollHeight > clientHeight` asserted before any pin assertion in both tests; no unit test added for the glue |

## Scope

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — modified (the only production source file).
- `e2e/thread-scroll-pin.spec.ts` — new.
- No stylesheet edit. No new module. No store change. No edits to the 30 existing `<Timeline` call sites.

## Open questions

None blocking. Two things to report rather than resolve silently:

- **The 20-turn reply is sized for headroom, not measured.** If the thread does not overflow the 1100×800 window, the `scrollHeight > clientHeight` gate fails loudly — which is the gate working. Raise the turn count; do not weaken the gate.
- **Scroll anchoring is declared indifferent on reasoning, not on an observed run.** If the e2e shows a jump that the re-assert does not correct, say so in the PR rather than adding `overflow-anchor: none` quietly — that would be a real observation and it changes the recommendation.
