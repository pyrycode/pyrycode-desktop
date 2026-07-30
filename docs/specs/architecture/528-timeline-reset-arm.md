# #528 — a `reset` arm on `ThreadEvent`

**Size:** XS (confirmed — 1 production file, 1 test file). **Split from** #508. **Blocks** #530, #531.

## Files to read first

Codegraph is not initialised for this repo (`codegraph_impact` → *"CodeGraph not initialized"*), so this
list was built by reading + grep over `src/` and `e2e/`.

- `src/renderer/src/store/sessionStore.ts:52-55,125-128,134-137` — **the whole design, already written.**
  #166 added a nullary `reset` to `SessionEvent` and answers it with `return initialSessionState`, with
  the comment that names the reason ("immutable shared const … makes a second reset a no-op reference").
  Clone this arm's shape, its placement, and its rationale-comment discipline.
- `src/renderer/src/store/sessionStore.test.ts:115-133` — the matching test: build a genuinely dirty
  state, **assert the precondition** ("otherwise reset proves nothing"), then assert each facet cleared
  plus `expect(next).toBe(initialSessionState)`. The new tests mirror this shape.
- `src/renderer/src/store/threadTimeline.ts:90-132` — the `ThreadEvent` union. The new arm appends after
  `unrecognizedMessage` (:126-132).
- `src/renderer/src/store/threadTimeline.ts:150-166` — `TimelineState`: the five fields a reset must
  return (`items`, `phase`, `stalled`, `apiRetry`, `compacting`).
- `src/renderer/src/store/threadTimeline.ts:224-232,412-432` — the reducer's `switch`, its per-arm
  "carry the other four fields" idiom, and the `default: return assertNever(event)` guard at :429-430.
  The new `case` goes immediately above that `default`.
- `src/renderer/src/store/threadTimeline.ts:434-440` — `initialTimelineState`, declared *after* the
  reducer. Referencing it from inside `reduceTimeline` is a forward reference in a function body: legal
  TS, no TDZ at runtime, and already done exactly this way in `sessionStore.ts`. **Do not move it.**
- `src/renderer/src/store/threadTimeline.test.ts:15-74` — fixture builders + the `run([...])` fold
  helper. The new `reset()` builder joins the block, next to `stall()` (:50-52), the other nullary.
- `src/renderer/src/store/threadTimeline.test.ts:559-563` — the module's same-reference idiom
  (`expect(state.items).toBe(initialTimelineState.items)`), reused below.
- `src/renderer/src/store/timelineStore.ts:24-37` — read to confirm **no edit is needed**: `dispatch`
  is already typed `(event: ThreadEvent) => void`, so it accepts the new arm the moment the union widens.

## Design source

N/A — reducer-only capability with no dispatch site (AC4), so nothing renders differently in this
ticket. The user-visible behaviour lands in #530 / #531, which own the call sites and the Figma anchor
if one is needed there. No PO Figma gap.

## Context

`timelineStore` is an app-lifetime singleton and `dispatch` is its sole write path, so once rows
accumulate there is no way to empty the timeline for the rest of the process lifetime. Since #179 the
thread the user reads renders from this store, so that gap is what lets one conversation's rows survive
into the next conversation's thread and one pairing's rows into the next pairing's.

This ticket adds **only the capability**. `sessionStore` already solved the identical problem for the
session facet in #166; this is that arm, ported to the timeline reducer.

## Design

### 1. Widen the union — one arm, nullary

Append to `ThreadEvent` after the `unrecognizedMessage` arm (`threadTimeline.ts:132`):

```ts
| { type: 'reset' }
```

Carry a comment in the shape of the neighbouring arms, saying three things: it returns the whole
timeline to its initial state on a context change (conversation switch, unpair); it is the first arm
that is **not** daemon- or user-content-derived but a lifecycle control event; and it is nullary
following `stallDetected` (:109) — no payload, so there is no field a caller can get wrong.

### 2. Answer it by returning the shared constant

New `case` immediately above `default:` (`threadTimeline.ts:429`):

```ts
case 'reset':
  return initialTimelineState
```

**Return the constant — do not hand-write a fresh literal.** Three properties fall out of that choice,
and all three are lost by writing `{ items: [], phase: 'idle', stalled: false, apiRetry: null, compacting: false }`:

- **Correct by definition, and stays correct.** AC2 demands equality with `initialTimelineState` on all
  five fields. Returning the constant makes that identity, not a coincidence — a sixth `TimelineState`
  field added later is cleared by this arm for free, where a hand-written literal would silently keep
  the stale value (and, worse, would still compile).
- **Idempotence is free.** `reduceTimeline(initialTimelineState, reset)` returns the same reference, so
  a second reset is a no-op — the `sessionStore.ts:126-127` rationale verbatim.
- **No selector churn.** After a reset the state's `items` **is** `initialTimelineState.items`, so
  `selectItems` returns an unchanged reference and no timeline-selecting component re-renders. A fresh
  `[]` per reset would churn every `selectItems` subscriber on every reset, including no-op ones. This
  is the same-reference discipline the rest of the reducer buys with explicit guards (:268, :285, :403,
  :420); here it comes for free.

No same-reference *guard* is added (`state === initialTimelineState ? state : …` is redundant — the
returned value is that constant either way), and no deep-equal guard: nothing has been observed
churning, and the selector analysis above shows nothing can.

**Aliasing is safe** and stays safe because the reducer only ever spreads `items` into a new array and
never mutates it (pinned by the existing `reduceTimeline — purity` block at `:566-592`, and by a new
test below). `initialTimelineState` is already shared this way — every store built from the default
argument (`timelineStore.ts:33`) aliases the same `items` array today.

### 3. Nothing else changes

- `timelineStore.ts` — **untouched.** `dispatch` already accepts any `ThreadEvent`. Do **not** add a
  convenience `reset()` action to the store: that would be a second write path beside `dispatch` and
  would break the unidirectional rule in `CLAUDE.md`. If the store shape seems to need changing, the arm
  is being modelled in the wrong place.
- `timelineBridge.ts` — **untouched.** No daemon event maps to `reset`; it is renderer-lifecycle-driven.
  `translateTimelineEvent` returns `ThreadEvent | null` (produces, never switches on the union), so
  widening breaks nothing there.
- No existing arm's behaviour changes. `reset` is additive and reachable only by an explicit dispatch.

### Compile fan-out: zero — re-verified at `2787223`

`ThreadEvent` is only ever *produced* (`timelineBridge.ts:37`) or *accepted* (`timelineStore.ts:25,36`;
`composerSend.ts:18`). Nothing outside `threadTimeline.ts` switches over it, so widening the union
breaks no call site. Confirmed by `grep -rn ThreadEvent src/ e2e/`: every other hit is an import, a
type annotation, a comment, or a test fixture builder. `threadTimeline.ts:434-440` is unchanged from
`8fa1b1b`, so every line anchor in the ticket body still holds.

**File-overlap check (§1.5):** clear. The only in-flight branch with a diff is
`feature/491-run-config-read` (PR #500); it touches `store/timelineBridge.ts` but **not**
`threadTimeline.ts` or `threadTimeline.test.ts`. No block needed.

## State + concurrency model

Unchanged. Pure synchronous reducer, no async, no IPC, no transport. `reset` is dispatched from the
renderer only, never translated from a daemon frame.

## Error handling

No failure modes. `reset` is nullary and total: it is valid against every reachable state and cannot
fail, throw, or partially apply. The `assertNever` guard at :169-171 remains the compile-time backstop
for any *future* arm — it is not reachable for this one.

## Testing strategy

All tests go in `src/renderer/src/store/threadTimeline.test.ts` (vitest, `npm test`). Add a `reset()`
fixture builder beside `stall()` (:50-52) and one new `describe('reduceTimeline — reset')` block.
Existing tests are **not modified** (AC5).

Scenarios:

1. **Clears all five fields from a fully dirty state (AC2).** Fold a state carrying rows, a non-idle
   `phase`, `stalled: true`, a present `apiRetry` and `compacting: true` — note the ordering constraint
   the module already documents at `:548`: a `turnState` is turn activity and clears a live stall, so
   `stall()` must come after it. Assert the precondition that the state is genuinely dirty on all five
   fields (the `sessionStore.test.ts:121-123` discipline — without it the test proves nothing), then
   dispatch `reset` and assert each of the five fields equals its `initialTimelineState` value.
2. **Returns the shared constant.** `expect(next).toBe(initialTimelineState)` — the property that makes
   scenarios 3 and 4 true, and the guard against a future hand-written literal replacing the arm.
3. **Idempotent (AC3).** Reset twice in succession equals reset once; and reset against an already-initial
   state leaves `initialTimelineState` (same reference).
4. **No `items` churn.** After a reset, `state.items` is `initialTimelineState.items` by reference — the
   `:561` idiom. This is what keeps a no-op reset from re-rendering every `selectItems` subscriber.
5. **The shared constant is not corrupted by a later append.** `run([userText('a'), reset(), userText('b')])`
   yields exactly one item, and `initialTimelineState.items` is still empty afterwards. Pins the one new
   hazard the shared-constant return introduces.
6. **No behaviour regression (AC5).** Covered by the existing suites running green unmodified —
   `threadTimeline.test.ts` and `timelineStore.test.ts`. No new test needed for this AC.

Type-level: `npm run typecheck` / `npm run build` covers the exhaustiveness guard — omitting the `case`
is a compile error at `default: return assertNever(event)`, so the arm cannot ship unhandled.

## AC4 — no dispatch site ships here

This is deliberate, and it is the AC most at risk from a developer who spots an obvious call site.
**#530 owns the conversation-switch dispatch; #531 owns the unpair / pair-another-server dispatch.**
Both are natively blocked on this ticket. Adding either here takes work out of a ticket that already
exists for it and lands a context-clearing behaviour change without that ticket's acceptance criteria.

Deterministic check before opening the PR — `git diff --name-only main` must list exactly:

```
docs/specs/architecture/528-timeline-reset-arm.md
src/renderer/src/store/threadTimeline.ts
src/renderer/src/store/threadTimeline.test.ts
```

Any fourth entry is an AC4 violation. In particular: no `ConversationScreen.tsx`, no `composerSend.ts`,
no `timelineBridge.ts`, no `timelineStore.ts`.

## Open questions

None. The design is a port of an arm that already ships in this codebase (`sessionStore.ts` #166), the
fan-out is zero and re-verified, and every acceptance criterion maps to a named test scenario above.
