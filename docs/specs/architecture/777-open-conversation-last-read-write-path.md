# #777 — Stamp the open conversation as read, and keep it stamped while it stays open

**Size:** S (PO's `size:s` held). **Three production files:** one new (`conversationLastReadBridge.ts`), two
modified (`activateConversation.ts`, `PairedShell.tsx`). Five new exported symbols, one new member on an
existing interface, four `ActivateConversationDeps` literal sites to update (one production, three test).

## Design source

N/A — this slice renders nothing. The ticket body says so outright ("Not UI-visible: this slice renders
nothing"), and #676 owns the green dot and carries the Figma reference. The visual-fidelity check is
intentionally skipped for this ticket.

## Files to read first

Codegraph is wired but **not indexed** for this repo — `mcp__codegraph__codegraph_status` errors
"CodeGraph not initialized for this project", re-verified 2026-08-26. This list was built by direct
reads, not `codegraph_context`. Do not burn a turn re-probing it.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/conversationLastReadStore.ts` (whole file, 232 lines) | **The store being written.** `recordLastRead` (`:181-187`) is the only writer and its same-value guard is `===` against the raw `get`; `selectLastReadFor` (`:228-231`) is the only reader. `:25-48` argues why the mark is an item COUNT, `:54-55` assigns the sampling to *this* ticket, `:70-74` is the hard import constraint (which binds that module's imports, not who may import it), `:156-160` is "replacement, never `Math.max`" — the property this ticket's eviction case depends on. |
| `src/renderer/src/store/conversationTimelineStore.ts:115-123`, `:294-360`, `:371-400` | **The comparand's holder.** `selectTimelineFor` (`:397-400`) is the read surface; `:44-49` bans `selectTimelineFor(id) ?? initialTimelineState` at every read site — see § Sampling the count for how this spec honours that. `dispatchFor` (`:299-316`) returns the state OBJECT when the fold changed nothing, which is what makes the "no emission ⇒ no stamp" claim true. `MAX_RETAINED_TIMELINES` (`:113`) and `withNewSliceAtHead` (`:206-222`) are the eviction case in Open questions. |
| `src/renderer/src/store/conversationActivityBridge.ts` (whole file, 291 lines) | **The structural precedent** the ticket body names (#748). Take: the named-member deps object and its cross-wire rationale (`:150-165`), the injected-subscribe + plain-spy testability posture (`:216-217`), the headless-glue shape (`:253-290`), and the log-free / security paragraph (`:32-39`). This ticket is the same shape with a **store** feed instead of a daemon-event feed. |
| `src/renderer/src/activateConversation.ts` (whole file, 80 lines) | **Restore point 1's seam.** `ActivateConversationDeps` (`:28-33`) gains one member. The id-change gate is `:74-77` and `setActiveConversation` runs unconditionally at `:79` — the stamp goes **outside** the gate, beside `:79`. `:16-23` is the getter-not-a-value argument this spec reuses. |
| `src/renderer/src/activateConversation.test.ts` (whole file, 169 lines) | The test file to extend. Three deps literals to widen: `spyDeps` (`:35-40`), the inline ordering literal (`:95-103`), `realDeps` (`:163-168`). The `order: string[]` idiom at `:94-107` is what the new ordering assertion extends. |
| `src/renderer/src/PairedShell.tsx:44-50`, `:199-263`, `:278-282` | **The composition root.** `activateDeps` (`:44-50`) gains one member. The five existing hook calls (`:221-263`) are where `useConversationLastRead()` joins them. `:36-42` states the "PairedShell subscribes to no store at all / stays server-renderable" invariant this ticket must not break. |
| `src/renderer/src/store/activeConversationStore.ts:60-71` | The singleton and `selectActiveConversation`. The bridge reads the open conversation through these. |
| `src/renderer/src/App.tsx:24-50` | `openConversationId` — the identical two-line getter #785 already wrote, module-private. See § The duplicated getter for why this ticket duplicates rather than relocates it. |
| `src/renderer/src/store/threadTimeline.ts:189-225`, `:291-300`, `:328-346`, `:397-420`, `:421-440`, `:552-575` | `TimelineState.items` (`:191`) is the quantity. Confirm for yourself which arms move `items.length`: `assistantDelta` coalesces into the tail bubble when continuing (`appendDelta`), `toolResult` fills in place (`fillResult`) and never changes the length, `sessionBoundary` (`:421`) and `unrecognizedMessage` (`:441`) append, `reconnected` (`:552`) carries `items` **by reference**. This is why AC3 is an equality, not a bump. |
| `src/renderer/src/store/timelineBridge.ts:282-316`, `:351-367`, `:425-437` | The fan-out this ticket observes but does not touch. `timelineWriteTarget` (#785, `:351-367`) files `sessionBoundary` / `reconnected` into the conversation **on screen**, so those two also move the open conversation's count. The keyed write is `:432` — **the ticket body's `:344` citation is stale.** |
| `src/renderer/src/screens/conversation/composerSend.ts:74-90` | The non-daemon writer: `deps.dispatchFor(conversationId, echo)` (`:88`) grows the open conversation's count with no IPC arm behind it. Read it to see why a daemon-event listener would miss it. |
| `src/renderer/src/store/conversationActivityStore.ts:146-165` | The same-value-guard doctrine this store inherits, and the growth-bound refusal. |
| `CLAUDE.md` § Conventions, § Don't | Test-first, unidirectional state, sealed shapes, renderer tests are static server renders (nothing can click), don't refactor adjacent code. |
| `vitest.config.ts:20-32` | `environment: 'node'`, no DOM. Effects never run in this suite — which is why the subscribe path is extracted as an injectable pure function rather than left inside the hook. |

Do **not** read `src/main/` or `src/preload/` — this slice touches neither, and adds no IPC.

## Context

`conversationLastReadStore` (#775) landed with one write path and no callers. This ticket is that write
path. #776 persists the store, #778 derives the unread predicate, #779 clears it at the pairing boundary,
#676 draws the dot.

#775 settled the value shape and that sharpens the framing the ticket body inherited. A `LastReadMark` is
a **count of timeline items seen**, not a timestamp (`conversationLastReadStore.ts:25-48` argues it out;
no timestamp is reachable from the renderer at all). So the two behaviours in the title collapse into
**one invariant with two restore points**:

> **The open conversation's mark equals its own held item count.**

Opening restores it once. Content landing while it stays open restores it again. Both are the same write
of the same quantity, which is why this spec ships **one** write function called from two places rather
than two write paths.

The second restore point is not decoration. Without it, content arriving in the conversation the operator
is actively reading pushes that conversation's count past its mark and lights its own unread dot — the
feature accusing the operator of not having read what is on screen in front of him.

### Three facts that constrain the design

1. **Arrival does not imply the count moved.** A continuing `assistantDelta` coalesces into the tail
   bubble and leaves `items.length` unchanged; `toolResult` fills a held row in place; `turnState`,
   `stallDetected`, `apiRetry`, `compacting` and `reconnected` never touch `items` at all. So the write
   is an **assignment of the sampled count**, never an increment. A design that bumps a counter on
   arrival is wrong on most arms.
2. **A non-daemon writer moves the count.** The composer's optimistic echo writes the keyed slice
   directly (`composerSend.ts:88`). An observer of `onDaemonEvent` alone misses it, and the operator's
   own sent message makes his own open chat unread.
3. **Sampling order is a live hazard.** The keyed slice is written inside `useTimelineBridge`'s fan-out
   (`timelineBridge.ts:432`). A *second* `onDaemonEvent` listener that sampled the count would depend on
   listener registration order and read a stale count whenever it ran first.

Fact 2 and fact 3 both point the same way: **observe the store, not the feed.** A subscriber on
`conversationTimelineStore` sees every writer, and it runs after the state has already been replaced —
zustand's vanilla `setState` reassigns `state` and *then* calls `listeners`, so `getState()` inside a
listener sees the new value. There is no ordering dependency left to get wrong.

## Design

### Module structure

One new file, `src/renderer/src/store/conversationLastReadBridge.ts` — the renderer data path feeding
`conversationLastReadStore`, in the `conversationActivityBridge` (#748) mould: pure helpers with injected
effects, a module-level production wiring object, and thin React glue. Framework-free apart from the one
`useEffect`, so the whole decision surface unit-tests with plain spies under `environment: 'node'`.

Two existing files are modified, each by a handful of lines:

- `src/renderer/src/activateConversation.ts` — one new required deps member, one new call.
- `src/renderer/src/PairedShell.tsx` — one new member in `activateDeps`, one new hook call, two imports.

**This is the repo's first production store→store subscription.** Every existing bridge under `store/`
subscribes to `window.pyry.onDaemonEvent`; `.subscribe(` appears today only inside store test files. That
is a deliberate departure, justified by facts 2 and 3 above, and it is why the subscribe seam is injected
rather than reached for directly inside the hook — see § Testing strategy.

### Contract sketch

Signatures only; the developer writes the bodies.

```ts
export interface ConversationLastReadDeps {
  getOpenConversationId: () => string | null
  getTimelineFor: (conversationId: string) => TimelineState | null
  recordLastRead: (conversationId: string, itemsSeen: LastReadMark) => void
}

export function stampLastReadFor(deps: ConversationLastReadDeps, conversationId: string): void
export function subscribeConversationLastRead(
  subscribeTimelines: (listener: () => void) => () => void,
  deps: ConversationLastReadDeps
): () => void
export const conversationLastReadDeps: ConversationLastReadDeps
export function useConversationLastRead(): void
```

Behaviour, one line each:

- **`stampLastReadFor(deps, conversationId)`** — sample that conversation's own held item count and
  record it as its mark. **Total**: no return value, no throw path, no failure mode. It reads
  `getTimelineFor` and `recordLastRead` and deliberately never reads `getOpenConversationId` — that is
  what makes it correct at the activate seam, where the open conversation is not yet the one being
  stamped. Asserted directly (§ Testing strategy).
- **`subscribeConversationLastRead(subscribeTimelines, deps)`** — subscribe; on every emission read the
  open conversation id, return immediately when it is `null`, otherwise delegate to `stampLastReadFor`.
  Returns the **exact** handle `subscribeTimelines` gave back (the `subscribeTimeline` /
  `subscribeConversationActivity` idiom) so the React binding can use it as its effect cleanup.
- **`conversationLastReadDeps`** — the production wiring: each member reaches its singleton through
  `getState()` inside the arrow body, the `activateDeps` / bridge idiom, so nothing is dereferenced at
  module load and nothing is read during render.
- **`useConversationLastRead()`** — `useEffect` on mount returning the off handle as cleanup, so a
  StrictMode double-mount nets exactly one live listener. Pass the subscribe seam as
  `(listener) => conversationTimelineStore.subscribe(listener)`, **not** the bare
  `conversationTimelineStore.subscribe` — the arrow does not rely on zustand's `subscribe` being
  `this`-free.

### Sampling the count

The absent-slice branch is the one place this ticket can silently break a neighbour's stated constraint,
so it is pinned here rather than left to the developer.

`conversationTimelineStore.ts:44-49` **bans `selectTimelineFor(id) ?? initialTimelineState` at every read
site**, because it collapses "nothing is held for this conversation" into "observed, nothing in the
thread". This ticket honours that by branching explicitly, **inside the tested pure function**:

> an absent slice contributes **`0`** items seen; a present slice contributes `slice.items.length`.

Two things make that honest rather than a rebranded `??`:

- The branch is `slice === null ? 0 : slice.items.length`, written out. No `??`, no `||`, no optional
  chain, no default parameter, no non-null assertion anywhere on this path.
- The two readings are **not** being collapsed into one *state* — they are being mapped onto the same
  *count*, which is the honest answer for both: a conversation with no slice held holds zero items, and
  so does an empty slice. #775 makes `0` a real, producible mark distinct from an absent mark
  (`conversationLastReadStore.ts:104-110`), and AC1 requires exactly this ("including a mark of `0` when
  nothing is held for it yet").

The branch lives in `stampLastReadFor`, not in the wiring object, precisely so it is covered: with a
`getTimelineFor` spy the developer can drive `null` and a populated slice through the same function. A
branch written inside `conversationLastReadDeps` instead would be structurally uncoverable — the
`conversationActivityBridge.ts:150-165` complaint, in the same suite.

### Restore point 1 — opening (AC1, AC2)

`ActivateConversationDeps` gains one required member:

```ts
stampLastRead: (conversationId: string) => void
```

`activateConversation` calls it **once, unconditionally, after `setActiveConversation`** — outside the
`previous?.id !== conversation.id` gate. Placement matters twice:

- **Outside the gate** is AC2. `setActiveConversation` already runs unconditionally at `:79` because a
  re-click hands over a fresher payload; the stamp joins it for the same reason and because a re-open of
  the conversation the operator is already reading is exactly when a fresh mark is owed.
- **After the set** keeps the store writes in the order a reader expects (clear → activate → stamp) and
  makes the ordering assertion in the existing `order: string[]` test a one-element extension.

It takes the id **explicitly**, never through `getOpenConversationId`. That is what makes it independent
of where in this function it sits and independent of whether `setActiveConversation` has run yet — the
seam-sharing hazard #786 would otherwise introduce (§ Open questions).

**Cross-wire note for the developer and for code-review.** `clearSessionId: () => void` is assignable to
the `stampLastRead: (id: string) => void` slot (TypeScript permits fewer parameters), so mis-wiring those
two compiles. The assertion that catches it is "`stampLastRead` was called with the conversation's `id`",
and it must be written as `toHaveBeenCalledWith(conversation.id)`, not merely `toHaveBeenCalled()`. The
other three members are cross-wire-immune under `strictFunctionTypes` (both tsconfigs set `strict: true`):
`ConversationCreatedPayload` and `ThreadEvent` are not assignable to `string`.

The three sites that must widen: `PairedShell.tsx:44-50`, and in the test file `spyDeps` (`:35-40`), the
inline ordering literal (`:95-103`) and `realDeps` (`:163-168`). **Required, not optional** — forgetting
to wire it is the exact regression the member exists to prevent, so it is a compile error at all four
sites rather than a silent `undefined`.

### Restore point 2 — content landing while it stays open (AC3, AC4)

`useConversationLastRead()` is called from `PairedShell`, beside its five existing subscriber hooks.

**Why PairedShell and not App.** Every other headless bridge is an App-level leaf, and
`ConversationActivityData` says why in as many words: *"the whole point is a chat the operator has NEVER
OPENED, so a screen-scoped listener would miss exactly the case the store exists for."* This bridge is the
exact opposite — it only ever writes the **open** conversation, and "open" is a concept that exists only
inside the paired shell. Scoping the listener's lifetime to the shell that owns the concept is the honest
placement, and it costs no fourth production file.

There is no gap. Every path that unmounts `PairedShell` clears the active conversation first:
`onUnpaired` runs `clearPairingScopedState` (which calls `clearActiveConversation` **and**
`clearAllTimelines`) before flipping App's route, and the only other route into `pairing` is the welcome
CTA, reached with nothing paired. Deletion and archive (`exitActiveConversation`) clear the active
conversation without unmounting the shell. So there is no state in which a conversation is open and this
listener is not mounted.

**AC4 is available by construction.** The listener names exactly one id — `getOpenConversationId()`'s —
on every path. A conversation that is not open is never an argument to `recordLastRead`, so its mark
cannot be touched and an unmarked conversation cannot acquire a `0`. There is no guard to forget: the
wrong write is unavailable, the same posture `conversationLastReadStore`'s hard import constraint takes.
The `null` early return is the second half of the same property — nothing open means nothing is minted
for anybody.

**The listener is nullary and re-samples at fire time.** `subscribeTimelines`'s listener type is
`() => void`, deliberately: zustand hands `(state, prevState)` to a subscriber, and typing the seam
nullary makes it impossible to sample the count off a captured emission argument instead of reading it
back out of the store. `conversationTimelineStore.subscribe` is still assignable to that seam (a nullary
listener is assignable to zustand's two-argument slot), so nothing is lost.

**No re-entrancy.** The listener writes `conversationLastReadStore` — a *different* store — so it cannot
re-trigger `conversationTimelineStore`'s listeners. There is no loop and no need for a guard.

**The common case costs nothing.** Most emissions leave the open conversation's count unchanged (a
continuing delta coalesces, a `toolResult` fills in place, `reconnected` carries `items` by reference,
a background conversation's fold does not touch the open one). Each of those re-records an identical
mark, and `recordLastRead`'s `===` guard returns the state object, so zustand's `Object.is` short-circuit
fires: no subscriber wakes and no map is cloned. `conversationLastReadStore.ts:154-157` names this the
common case rather than an edge one, and this ticket is why.

**Emissions this bridge deliberately does not filter.** It re-stamps on *every* timeline-store change,
including a fold into a background conversation's slice and including an eviction. Filtering to "did the
open conversation's slice change?" would be a second, redundant comparison in front of the store's own
`===` guard, and it would need the previous state — which is exactly the captured-emission-argument shape
the nullary seam rules out. No filter.

### The duplicated getter

`App.tsx:47-50` already holds a two-line `openConversationId` getter with the same body this bridge
needs. It is module-private and it belongs to `App`'s injection into `useTimelineBridge` (#785). This
ticket **duplicates the two lines** rather than relocating them, because relocating means editing
`App.tsx` and `activeConversationStore.ts` for zero behavioural gain — the "don't refactor adjacent code
while you are there" rule. Written the same way in both places, as an explicit `open === null ? null :
open.id` test rather than `open?.id ?? null`, so "no `??` anywhere on this path" stays literally true.

Recorded, not hidden: two consumers is the signal that a `selectOpenConversationId` selector on
`activeConversationStore` would have a home (the `conversationActivityBridge.ts:29-30` "one consumer is
an import, two is a home" rule). That is a separate, three-line ticket, not this one's business.

### Why this bridge imports `activeConversationStore`, and why that is not the banned fallback

`timelineBridge.ts:236-240` and `conversationActivityBridge.ts:183-184` both state a grep-checkable ban
on importing `activeConversationStore`. This bridge imports it. A reviewer will see that and should see
the reason stated rather than have to reconstruct it:

That ban exists to stop an **arriving event that carries its own `conversationId`** from being attributed
to the conversation on screen — the `?? activeConversation` misattribution the whole #675 family was
built to remove. Here **nothing arrives.** There is no event, no `conversationId` on the wire, and
therefore no attribution to get wrong. The open conversation is not a fallback for a missing id; it *is*
the subject of the quantity being written, named by the acceptance criteria themselves. The structural
guarantee runs the other way: because this bridge names only the open conversation, it cannot misattribute
anything to anyone (AC4).

`conversationLastReadStore`'s own hard import constraint is untouched — it binds what *that module*
imports, not who may import it, exactly as `timelineBridge.ts:411-413` already argues for the timeline
holder.

## State and concurrency model

**Stores.** Reads `conversationTimelineStore` and `activeConversationStore`; writes
`conversationLastReadStore` through its single `recordLastRead` path. No new store, no new state field.
Unidirectional is preserved: the bridge is wiring, never two-way-bound from a component, and no component
writes a mark.

**Async tasks.** None. No promise, no timer, no `AbortController`, no IPC, no socket. The only long-lived
resource is one store subscription.

**Ownership and teardown.** The subscription is owned by `useConversationLastRead`'s effect and torn down
by returning `subscribeConversationLastRead`'s handle as the cleanup. Dependency array `[]` — the deps
object is a module-level constant and `conversationTimelineStore` is a singleton, so there is nothing to
re-subscribe on. StrictMode double-mount runs mount → cleanup → mount and nets exactly one listener.

**Interleaving.** Every write on this path is a synchronous zustand `set` with no `await` anywhere in the
chain, on the renderer's single thread. The listener's read-then-write (`getTimelineFor` then
`recordLastRead`) has **no suspension point** for a concurrent handler to interleave into, so the
check-then-act race this category asks about is unreachable rather than merely unlikely. The stamp at the
activate seam is likewise synchronous, and React batches it into the same commit as the surrounding
writes.

**Re-render seams.** `PairedShell` still subscribes to no store — a hook that only runs an effect does not
make it one — so the server-renderable invariant `PairedShell.tsx:36-42` asserts is untouched. Nothing in
this ticket renders, so there is no new re-render path at all; the mark's readers arrive in #778/#676.

## Error handling

**There are no failure modes in this slice.** Nothing is decoded, parsed, fetched, persisted or sent. No
network, no filesystem, no IPC. Every function is total: `stampLastReadFor` has no throw path,
`subscribeConversationLastRead` has a single `null` early return, and neither returns a result type.
There is nothing for the UI to surface — no banner, no dialog, and no silent-swallow either, because
there is no error to swallow.

Two behaviours that could be mistaken for swallowed errors, both **by design**:

- An emission arriving with nothing open records nothing. That is AC4, not a dropped write.
- An absent timeline slice stamps `0` rather than skipping. That is AC1, not a fallback.

**Log-free by construction** — no `console.*` on any path. The only value a diagnostic here could carry is
the untrusted `conversationId`, and ADR 0007 / #126's content-free diagnostics rule keeps it out of a file
the renderer's DevTools can read. This matches both the store it writes
(`conversationLastReadStore.ts:96-98`) and the bridge it is modelled on
(`conversationActivityBridge.ts:36-39`).

## Testing strategy

Test-first: the RED suite lands before the module. All of it runs under `npm test` (vitest,
`environment: 'node'`, no React DOM, no `@testing-library`, nothing clicks). Type-level coverage under
`npm run typecheck`. Tag each test with its AC, following the file-local `(#777 AC1)` convention.

### New — `src/renderer/src/store/conversationLastReadBridge.test.ts`

**`stampLastReadFor` — plain spies (AC1, AC2)**

- `getTimelineFor` returns `null` → `recordLastRead` called exactly once with `(id, 0)`. The absent-slice
  branch; this is the test that fails if anyone writes `?? initialTimelineState`-shaped code or skips the
  write on an absent slice.
- `getTimelineFor` returns `initialTimelineState` → also `(id, 0)`. Assert alongside the previous case in
  the same test, so what is pinned is that both readings map to the same honest count while the branch
  itself stays explicit.
- `getTimelineFor` returns a slice holding N items → `(id, N)`, for at least one N > 1.
- `getOpenConversationId` is **never called**. Assert the spy has zero calls. This is what makes the
  activate seam independent of activation order and of `setActiveConversation` having run.
- The id is passed through verbatim, including for `'__proto__'` and `''` — assert `recordLastRead`'s
  first argument is `===` the id handed in, with no normalisation, trimming or length check.

**`subscribeConversationLastRead` — plain spies (AC3, AC4)**

- Returns the **exact** handle `subscribeTimelines` returned (`toBe`, not `toEqual`).
- Capture the listener the seam received, invoke it with an open conversation → `recordLastRead` called
  with `(openId, count)`.
- Invoke it with `getOpenConversationId` returning `null` → `recordLastRead` **not called at all**. AC4's
  "stays absent rather than acquiring a mark of `0`".
- Invoke it twice with `getTimelineFor` returning different counts between the two → two records with the
  two different counts. This pins that the count is re-sampled at fire time rather than captured at
  subscribe time.
- With conversation `a` open, invoke the listener several times while `getTimelineFor` reports a growing
  slice for `b` → every `recordLastRead` call's first argument is `a`, and `b` never appears in any call.
  AC4 as a property over the whole call list, not a single assertion.

**Integration — real isolated store instances (AC1, AC3, AC4)**

Follow `activateConversation.test.ts`'s `realDeps` idiom: build a deps object over
`createConversationTimelineStore()`, `createActiveConversationStore(...)` and
`createConversationLastReadStore()`, and subscribe to the real timeline store. Never the singletons.

- With `a` open, `dispatchFor(a, userText)` → `selectLastReadFor(a)` reads `1`; a second append reads `2`.
- **Equality, not a bump:** with `a` open holding a running assistant bubble, dispatch a *continuing*
  `assistantDelta` → `a`'s item count is unchanged **and** its mark still equals it. Written as an
  assertion on `selectLastReadFor(a) === items.length`, so it pins the invariant rather than a literal.
  This is the test that fails if the write is implemented as an increment.
- With `a` open, `dispatchFor(b, userText)` → `selectLastReadFor(b)` is `null` and `selectLastReadFor(a)`
  equals `a`'s own count. AC4 end to end.
- With nothing open, `dispatchFor(b, userText)` → `selectLastReadFor(b)` is `null`.
- Call the returned unsubscribe, then `dispatchFor(a, userText)` → `a`'s mark does not move. Teardown is
  real, not decorative.

### Modified — `src/renderer/src/activateConversation.test.ts`

Widen the three deps literals; the seven existing tests must keep passing unchanged, which is this
ticket's own no-op evidence for the activate path.

- **AC1:** activating a conversation with no held slice records `(id, 0)`.
- **AC1:** activating a conversation whose slice holds N items records `(id, N)`.
- **AC2:** re-activating the **already-active** id calls `stampLastRead` exactly once with that id.
  Assert it inside the existing "the same id clears nothing but still records the fresher payload" test,
  beside the two `not.toHaveBeenCalled()` assertions — the point is that the stamp is the one effect that
  does *not* sit behind the gate.
- **Ordering:** extend the existing `order: string[]` expectation to `['reset', 'clearSessionId', 'set',
  'stamp']`.
- **Cross-wire:** every `stampLastRead` assertion uses `toHaveBeenCalledWith(conversation.id)`, never a
  bare `toHaveBeenCalled()`. See the cross-wire note in § Restore point 1.

### Not tested, and why

`useConversationLastRead`'s effect body and `conversationLastReadDeps`' `getState()` forwards are
structurally uncoverable: `vitest.config.ts` is `environment: 'node'` globally, so no test in this repo
runs a React effect. That is the reason the subscribe seam and the deps object are injected —
everything that makes a decision is on the pure side of the seam, and the uncovered remainder is four
`getState()` forwards and one `useEffect` line. The same acknowledged gap
`conversationActivityBridge.ts:150-165` records for its own wiring. `PairedShell.test.tsx` needs no
change: its static server render never runs the effect, and the hook dereferences no `window.pyry`.

## Open questions

1. **#786 shares the activate seam, and the interaction is benign — recorded so neither ticket
   re-derives it.** #786 wires `conversationTimelineStore.markViewed` into `activateConversation`.
   Whichever lands second adds its own member to `ActivateConversationDeps` and to `activateDeps`; the
   widening is additive and conflict-free. On behaviour: `markViewed` seeds an absent slice with
   `initialTimelineState`, so the count this ticket samples at open is `0` either way. If `markViewed`
   runs *before* `setActiveConversation`, its emission reaches this bridge's listener while the
   **previous** conversation is still the open one, and re-stamps that conversation with its own
   unchanged count — a same-value write that the `===` guard short-circuits. No ordering constraint is
   needed between the two, and this ticket deliberately does not impose one.
2. **Eviction lowers a mark, and that is correct here but is #778's problem.**
   `conversationTimelineStore` retains ten slices; a never-viewed slice can be evicted, after which the
   key reads absent and this bridge stamps `0` on the next emission. `recordLastRead` is replacement,
   never `Math.max` (`conversationLastReadStore.ts:156-160`), precisely so a legitimately lower mark is
   recordable — so nothing here is a bug. But it means #778 can see a mark of `47` against a recreated
   count of `1`. #778 should decide that explicitly; `selectTimelineFor(id) === null` is distinguishable
   from a present empty slice, so the information is available. Already flagged in #775's spec; repeated
   here because this ticket is what makes it reachable.
3. **A second `selectOpenConversationId` consumer now exists.** See § The duplicated getter. Two
   consumers is the "a home" signal, but relocating it means editing `App.tsx` and
   `activeConversationStore.ts` for zero behavioural gain. Left as a three-line follow-up for whoever
   needs a third.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** The one untrusted input is `conversationId` — daemon-asserted text that entered
  the renderer through the nine id-carrying timeline arms (`timelineBridge.ts:282-298`) or, for the two
  unattributed arms, was resolved from the operator's own activation (`timelineWriteTarget`,
  `:351-367`). This slice sits **downstream** of that boundary and adds none of its own: it performs no
  decode, no parse, no validation, and it never touches a raw frame. The id is used **only** as a `Map`
  lookup key on the way into `recordLastRead`, and only ever as a *value* argument — there are no
  computed object keys anywhere on this path, so no `{ [x]: v }` whose provenance a reviewer must trace.
  It is never rendered, never concatenated, never a filename, cache key, attribute or URL, and never
  compared against a secret. The mark itself is a bare `number`, so there is structurally nowhere inside
  a value for the id to be stored — `conversationLastReadStore.ts:76-93`'s property, inherited unchanged
  and not weakened by this ticket. **New this ticket:** the id also reaches `getTimelineFor`, which is a
  bare `Map.get` through `selectTimelineFor` — the same hostile-key-safe primitive
  (`Map.prototype.get('__proto__')` performs no prototype-chain lookup), so `'__proto__'`,
  `'constructor'` and `''` remain three unremarkable keys by construction on the read side too. The
  mechanical check is the verbatim-id-passthrough test in § Testing strategy, which drives `'__proto__'`
  and `''` end to end.
- **[Tokens, secrets, credentials]** Not applicable by construction. This slice reads two `Map`s and
  writes one `number`. No token is generated, stored, rotated, revoked or expired; no credential is read
  or written; nothing reaches `safeStorage`, disk, `localStorage`, `sessionStorage` or IndexedDB.
  Persistence remains **#776's** and this ticket must not anticipate it — the write path stays
  `recordLastRead`, so #776 wraps one function rather than untangling two.
- **[File / storage operations]** Not applicable — no path is constructed, joined, resolved or opened;
  no temp file, no rename, no check-then-open. The untrusted id never reaches a path, which is what makes
  path traversal and TOCTOU structurally unreachable rather than merely unexercised. #775's forward note
  for #776 (one whole-map value under a single fixed key, keeping the untrusted string out of the key
  space) is unchanged by this ticket and still lands on #776.
- **[Inter-process / Electron attack surface]** No finding, and it is a real check rather than a vacuous
  one because this ticket *does* add a subscription. It adds **no** `contextBridge` API, no `ipcMain`
  channel, no `ipcRenderer` reference, no `BrowserWindow`, no `webPreferences` change, no protocol
  handler, no navigation and no `window.open`. It does not even dereference `window.pyry` — the seam it
  subscribes to is a renderer-local zustand store, which is precisely what removes the daemon-event
  listener a naive design would have added (and with it, the listener-order dependency in § Context fact
  3). Process placement is correct and unchanged: no key, socket, or Noise state is anywhere near this
  module, and none could be — a `Map<string, number>` cannot carry one. `PairedShell` remains
  server-renderable, so no new render-time global access is introduced.
- **[Cryptographic primitives]** Not applicable — no randomness is drawn (no id is minted; both key and
  value come from state the app already holds), no hashing, no key derivation, no Noise involvement.
  Worth stating explicitly rather than skipping, because this ticket introduces **two `===`
  comparisons** a reviewer will see: `open === null` in the getter and `slice === null` in the sampler.
  Both compare against `null`, neither is a secret comparison, and the pre-existing `===` in
  `recordLastRead`'s guard compares two client-originated counts. `timingSafeEqual` is not indicated
  anywhere on this path.
- **[Network & I/O]** Not applicable — no socket, no `ws`, no URL, no TLS decision, no timeout, no
  reconnect, no frame. The path is reachable *from* the wire (a daemon event ultimately triggers an
  emission), so the volume question is real and answered: the work per emission is two `Map.get`s, one
  `===` compare, and — only when the count actually moved — one clone of a map holding one number per
  conversation. A hostile relay flooding the session cannot amplify that into anything: the store's
  same-value guard means a flood of arms that do not move `items.length` (continuing deltas,
  `toolResult`s, chrome arms) allocates nothing at all.
- **[Error messages, logs, telemetry]** No finding, and the constraint is live rather than vacuous: the
  module is **log-free by construction**, because the only value a diagnostic here could carry is the
  untrusted conversation id and the renderer console is readable by anything that can open DevTools
  (ADR 0007, #126). There is no error object anywhere on this path, so nothing can reach a crash
  reporter; no telemetry is added. The `null`-open early return and the absent-slice `0` are silent
  **by design** (§ Error handling), not swallowed errors.
- **[Concurrency]** No finding, and this is the category this ticket actually moves, so it is answered
  concretely rather than dismissed. **Ownership:** exactly one long-lived resource is created — the
  `conversationTimelineStore` subscription — owned by `useConversationLastRead`'s effect. **Cancellation:**
  `subscribeConversationLastRead` returns the seam's own handle verbatim and the effect returns it as
  cleanup, so unmount removes the listener; a StrictMode double-mount nets one. There is no
  `setTimeout`/`setInterval`, no `AbortController` (nothing async to abort) and no second listener to
  leak. The teardown is covered by a named test (unsubscribe, then dispatch, assert the mark did not
  move), which is what keeps this a verified claim rather than an intention. **Check-then-act:** the
  listener reads the timeline store then writes the last-read store with no `await` between them, on the
  renderer's single thread, so there is no suspension point to interleave into. **Re-entrancy:** the
  write targets a *different* store than the one subscribed, so it cannot re-enter its own listener —
  no loop, no guard needed. **Shutdown:** the state is in-memory only; a killed window loses every mark
  and the next start reads an empty map, which is the honest "never read" state for every conversation.
  **Duplicate subscriptions:** the effect's dependency array is `[]` over a module-level constant and a
  singleton, so no re-render can stack a second listener.
- **[Threat model alignment]** Two desktop threats apply; both are addressed rather than deferred.
  **Hostile daemon / on-path relay minting conversation ids:** a hostile actor inside the session can
  name arbitrary ids and fan frames for them. Those frames land in `conversationTimelineStore` (which
  caps itself at ten slices) and reach *this* slice only as emissions — and because this bridge writes
  **only the open conversation's** id, a flood of unknown ids mints **zero** last-read entries. This
  ticket therefore does not widen the unbounded-growth residual #775 accepted; the only ids that can ever
  reach `recordLastRead` are ones the operator himself activated or that were already open. That is a
  meaningfully stronger position than the "one entry per named id" bound #775 reasoned about, and it is a
  consequence of AC4's by-construction shape rather than of a check. **Renderer compromise reaching the
  transport:** unchanged. This module holds nothing of value to an attacker who already has renderer
  script execution — a count of messages read is not a secret — and it exposes no new capability to pivot
  through, having no IPC surface at all. **Hostile ids as keys** is handled structurally by the
  `ReadonlyMap` mandate on both stores, not by validation. Out of scope and named: the pairing-boundary
  clear that stops one server's ids from being keyed alongside another's is **#779**; persistence, which
  would make any of this survive a restart, is **#776**.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-26
