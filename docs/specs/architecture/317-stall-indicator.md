# #317 — Stall indicator: show when a turn has stalled, clear on next turn activity

Render slice of the four-way split from #147. The transport slice #315 (merged) decodes the daemon's
one-shot `stall` frame into a **nullary** `stallDetected` daemon event (`{ type: 'stallDetected' }` —
the wire frame's only field `conversation_id` is dropped at the emit). This slice consumes that event
and surfaces an on-thread stall indicator, the exact mirror of how #215's thinking indicator surfaces
`turn_state`. Because the daemon sends stall **onset-only** with no "cleared" frame, the indicator
**self-clears** client-side in the reducer on the next sign of turn activity.

## Design source

N/A — the mobile Figma file (`g2HIq2UyPhslEoHRokQmHG`) draws only the populated steady-state
Conversation Thread (node `16-8`); every transient thread-chrome overlay (thinking indicator #215,
empty-thread #277, session banner #279, composer stop-state #305) shipped N/A-justified. The stall
indicator is the same class of transient overlay in the message-list region of `16-8`; a dedicated
stall visual is a Figma-side follow-up for Juhana if wanted. Visual-fidelity review is intentionally
skipped for this slice.

## Files to read first

- `src/renderer/src/store/threadTimeline.ts:81-213` — `TimelineState`, the `ThreadEvent` union,
  `reduceTimeline`, `initialTimelineState`, `selectItems`/`selectPhase`. The whole edit for the
  store/reducer half lives here; read the churn discipline (same-reference returns) at lines 168/172
  before touching the clearing arms.
- `src/renderer/src/store/threadTimeline.ts:10-11` — `TurnPhase`; the `phase`-beside-`items` scalar
  precedent the new `stalled` scalar follows.
- `src/renderer/src/store/timelineBridge.ts:36-122` — `translateTimelineEvent`. `stallDetected` is
  currently in the null fall-through group at line 104 (ships dormant from #315). Move it to an owned
  arm; the comment at 104-117 must stop claiming stallDetected is dormant (leave the
  `screenSnapshotReceived` note intact — #318 owns that one).
- `src/renderer/src/store/timelineStore.ts:49-51` — the selector re-export site; add `selectStalled`
  to the existing `selectItems, selectPhase` re-export.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:59-65` — the container's
  `useTimelineStore(selectItems)` / `selectPhase` reads; add the `selectStalled` read here.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:93` — the `<ThinkingIndicator ... />`
  mount point; the `<StallIndicator />` mounts as its sibling here.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:374-397` — `ThinkingIndicator`, the
  pure exported view to clone (null-on-false, boolean-not-store-type, client-owned copy constant).
- `src/renderer/src/screens/conversation/conversation.css:338-353` — `.conversation__thinking`
  wrapper + `.bubble--thinking` muted treatment; clone the wrapper's flex shape, diverge the bubble
  treatment.
- `src/renderer/src/screens/conversation/conversation.css:140` and `:1249-1254` — the two existing
  `--color-error` usages (banner `border-left: 4px solid var(--color-error)`; rejection-line
  `color: var(--color-error)`). `--color-error` is the ONLY error role token on desktop — the stall
  treatment must be built from it, no new token.
- `src/renderer/src/store/threadTimeline.test.ts:1-50` — the reducer test harness: fixture builders +
  the `run()` fold helper. Add a `stall()` builder and stall/clear cases here.
- `src/renderer/src/store/threadTimeline.test.ts:164-165` — the toolResult-orphan
  `.toBe(initialTimelineState)` same-reference assertion; the design MUST keep this green (see
  Reducer arm-by-arm below).
- `src/renderer/src/store/timelineBridge.test.ts:250-390` — the `createTimelineStore()`-driven bridge
  integration tests; flip/add the `stallDetected` case here.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:401-412` — the `ThinkingIndicator`
  render-test block (null on false, class assertions on true); the `StallIndicator` block mirrors it
  exactly. Line 785 has the container-smoke `not.toContain('conversation__thinking')` analog to mirror.
- `src/shared/ipc/events.ts:110` — confirms `stallDetected` is `{ type: 'stallDetected' }` (nullary).
  No payload flows into the renderer; no daemon string exists to render.

## Context

When claude goes quiet mid-turn (or the screen parser degrades), the daemon emits a one-shot `stall`
signal. #315 already decodes it to a nullary `stallDetected` event that ships dormant (translated to
nothing). This slice makes it visible: a stall indicator appears on the thread and self-clears on the
next turn activity. There is no "stall cleared" wire event — the mobile client derives the clear the
same way (ADR-025 Phase 2 / mobile #373), and so does this reducer.

## Design

Four production files, all edits (no new files); one CSS file; three test files extended. The store
half adds a coarse `stalled: boolean` scalar beside `phase`; the render half adds a pure
`StallIndicator` view fed a plain boolean.

### 1. `threadTimeline.ts` — the store/reducer half

**State shape.** Extend `TimelineState` (line 82) with a third scalar:

```
export interface TimelineState {
  items: readonly ThreadItem[]
  phase: TurnPhase
  stalled: boolean   // #317: onset-only stall flag; a coarse scalar, NOT a ThreadItem row
}
```

Extend `initialTimelineState` to `{ items: [], phase: 'idle', stalled: false }`.

**New event arm.** Add to the `ThreadEvent` union a nullary arm mirroring the daemon event:
`{ type: 'stallDetected' }`. No payload — the daemon frame carries none, so the renderer arm carries
none either. This is what makes AC4's "no daemon-supplied string is ever rendered" true by
construction: there is no field to render.

**Reducer — arm by arm.** Adding a required `stalled` field means every return object literal in
`reduceTimeline` must now carry it. Three groups (do NOT write a shared helper — the whole point is
each arm's explicit `stalled` disposition is legible; match the existing per-arm literal style):

- **Sets stalled (new arm):** `stallDetected` → set `stalled: true`, `items`/`phase` unchanged.
  Churn discipline: return the SAME state when `state.stalled` is already `true` (a redundant onset is
  a no-op), else `{ items: state.items, phase: state.phase, stalled: true }`.
- **Clears stalled (the four turn-activity arms — AC2):** `assistantDelta`, `toolUse`, `toolResult`,
  `turnState` → set `stalled: false`.
  - `assistantDelta` and `toolUse` already always return a fresh `items` array, so just append
    `stalled: false` to their existing literals.
  - `toolResult` has a same-reference orphan/duplicate no-op (line 168) and `turnState` has a
    same-phase no-op (line 172). An orphan result and an idle-when-already-idle `turnState` are still
    "turn activity" and must clear a live stall — so widen each no-op guard to ALSO require the stall
    is already clear. Contract:
    - `toolResult`: return `state` only when `items === state.items && !state.stalled`; else
      `{ items, phase: state.phase, stalled: false }`.
    - `turnState`: return `state` only when `event.state === state.phase && !state.stalled`; else
      `{ items: state.items, phase: event.state, stalled: false }`.
  - **Regression guard, do not break:** from `initialTimelineState` (`stalled` already `false`), the
    toolResult-orphan path still returns `initialTimelineState` by reference — the widened guard is
    true — so the existing `.toBe(initialTimelineState)` test (line 165) stays green. Call this out in
    the test.
- **Carries stalled unchanged (the three non-activity arms):** `turnEnd`, `userText`,
  `sessionBoundary` → append `stalled: state.stalled` to their existing literals. These are
  deliberately NOT in AC2's clear set: `turnEnd` is a boundary (the daemon emits `turn_state: idle`
  separately, and THAT clears), `userText` is a renderer-sourced echo (not daemon turn activity), and
  `sessionBoundary` is a session rotation. Leaving them unchanged is the design, not an oversight.

**Selector.** Add `export const selectStalled = (s: TimelineState): boolean => s.stalled` beside
`selectItems`/`selectPhase` (line 213).

The `default: assertNever(event)` guard (line 205) keeps the new arm honest: the `stallDetected` case
is a compile requirement.

### 2. `timelineBridge.ts` — the translate half

`translateTimelineEvent` currently returns `null` for `stallDetected` via the fall-through group (line
104). Move it to an owned arm — a filter + fresh literal, exactly like the other owned arms:

```
case 'stallDetected':
  return { type: 'stallDetected' }
```

Remove `case 'stallDetected':` from the null-group case list (line 104) and revise the group comment
(lines 114-117) so it no longer describes stallDetected as dormant — leave the `screenSnapshotReceived`
sentence intact (#318 still owns that; it stays dormant). The `assertNever` default (line 120) keeps
the switch exhaustive across both bridges.

### 3. `timelineStore.ts` — the re-export

Extend the re-export at line 51 to `export { selectItems, selectPhase, selectStalled } from './threadTimeline'`.
No other change — `dispatch` already threads any `ThreadEvent`, and the store spreads
`initialTimelineState`, so the new field flows through the DI factory untouched.

### 4. `ConversationScreen.tsx` — the render half

**Pure view.** Add an exported `StallIndicator`, the `ThinkingIndicator` twin:

- Signature: `StallIndicator({ isStalled }: { isStalled: boolean }): JSX.Element | null`. Takes a
  plain `boolean`, NOT the store type — this is what makes AC4 a type-level guarantee (the view
  structurally cannot receive, hence cannot render, a daemon string).
- `isStalled === false` → `return null` (zero layout footprint, AC — like `ThinkingIndicator` and
  `Timeline` returning null on empty).
- `isStalled === true` → render the client-owned copy constant inside a wrapper + bubble carrying
  stall-distinct classes (see CSS). Plain boolean guard, no switch/assertNever (no union to
  discriminate).

**Copy constant.** A module-level client-owned constant, e.g.
`const STALL_COPY = 'The turn seems to have stalled…'` — apostrophe-free (renderToStaticMarkup escapes
`'` → `&#x27;`, the standing desktop lesson) and using the U+2026 ellipsis character (matching
`'Thinking…'`). Never a daemon string. If mobile's ADR-025 copy is known, aligning to it is fine, but
the exact wording is the developer's call within these constraints.

**Container wiring.** In `ConversationScreen`, add a `selectStalled` read beside the existing
`selectPhase` read (line 65): `const stalled = useTimelineStore(selectStalled)`. Mount
`<StallIndicator isStalled={stalled} />` as the sibling immediately after
`<ThinkingIndicator ... />` (line 93). A narrow single-slice read — `stalled` flips at most twice per
stall, so it adds no meaningful re-render churn beyond the items delta already there.

### 5. `conversation.css` — the distinct treatment

The stall indicator must read as a **problem state**, visually distinct from the thinking indicator's
muted-text treatment (AC4). Build it from `--color-error`, the only error role token on desktop (no
new token — CLAUDE.md forbids drift):

- `.conversation__stall` — clone `.conversation__thinking`'s wrapper shape (`flex: 0 0 auto`, the
  same left-aligned thread-consistent inset) so it never claims a competing flex region beside the
  timeline.
- A stall-distinct bubble class (e.g. `.bubble--stall`) that reuses the `.bubble--daemon` fill/radius
  but diverges the treatment to the error role: `color: var(--color-error)` (the rejection-line
  precedent at :1254) and a leading `border-left: 4px solid var(--color-error)` accent (the connection
  banner precedent at :140) so it reads as a problem, not normal progress. Keep it minimal — one
  clearly distinct visual, token-only, ~8-12 lines.

## State + concurrency model

- **Single store slice.** `stalled` is a scalar on the one `timelineStore` (Zustand vanilla singleton,
  ADR 0008). Unidirectional: the view reads `selectStalled`, never writes it; the only write path is
  `dispatch(threadEvent)` through `reduceTimeline`. No parallel mutable state, no two-way binding.
- **No new subscription/teardown.** The `stallDetected` daemon event already flows through the
  existing `useTimelineBridge` subscription (mounted by #203); this slice only teaches the pure
  translator + reducer to handle it. No new `useEffect`, no `AbortController`, nothing to tear down.
- **Self-clear is pure and synchronous.** The clear is derived in the reducer on the next activity
  event — no timer, no async, no wire round-trip. onset-only in, activity-derived clear out.

## Error handling

No new failure modes. The event is nullary and validated upstream (#315's transport decode); the
renderer path is a total pure function over a sealed union with an `assertNever` guard at both the
bridge and the reducer. There is no network, socket, parse, or permission surface in this slice, and
no daemon-supplied content — so nothing to surface as a banner/dialog and nothing that can throw at
runtime beyond the compile-time exhaustiveness guards.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Bullet-pointed scenarios; the developer writes them in the
project idiom (extend the existing describe blocks, reuse the fixture builders).

**Reducer — `threadTimeline.test.ts`** (add a `stall()` builder returning `{ type: 'stallDetected' }`,
reuse the `run()` fold):
- `stallDetected` sets `stalled` true from the initial state (AC1).
- Each of the four turn-activity events clears a live stall (AC2), one case per arm:
  `stall → assistantDelta`, `stall → toolUse`, `stall → toolResult`, `stall → turnState`. For
  `turnState`, cover BOTH a non-idle state (`thinking`/`responding`) AND `idle` — AC2's "any state,
  including idle" — since `idle` is the case a naive guard would miss.
- A stall with no following activity keeps `stalled` true (`stall` alone → still true). Extend this to
  prove the three non-activity arms do NOT clear: `stall → turnEnd`, `stall → userText`,
  `stall → sessionBoundary` each leave `stalled` true (AC2 lists exactly four clearing events).
- Same-reference discipline: a redundant `stall → stall` returns the same reference (no churn); and
  the existing toolResult-orphan `.toBe(initialTimelineState)` assertion (line 165) still passes with
  the widened guard — assert it explicitly as a regression guard.
- `initialTimelineState.stalled === false` (extend the "empty, idle timeline" test at line 271).
- `selectStalled` returns the flag.

**Bridge — `timelineBridge.test.ts`**:
- `translateTimelineEvent({ type: 'stallDetected' })` now returns `{ type: 'stallDetected' }` (was
  `null` when dormant) — flip/add this assertion.
- Integration (the `createTimelineStore()` pattern already in the file): dispatching a `stallDetected`
  daemon event through `subscribeTimeline` makes `selectStalled(store.getState())` true.

**Render — `ConversationScreen.test.tsx`** (mirror the `ThinkingIndicator` block at 401-412):
- `renderToStaticMarkup(<StallIndicator isStalled={false} />)` is `''` (null, AC).
- `renderToStaticMarkup(<StallIndicator isStalled={true} />)` contains the stall copy AND the
  stall-distinct classes (`conversation__stall`, `bubble--stall`), and does NOT contain
  `bubble--thinking` — the visual-distinctness assertion (AC4).
- Container smoke: the store-bound `ConversationScreen` renders without the stall markup at rest
  (`not.toContain('conversation__stall')`), the analog of the line-785 thinking-indicator smoke.

## Open questions

- **Exact stall copy.** Deferred to the developer within the constraints (client-owned, apostrophe-
  free, U+2026 ellipsis, problem-state tone). Align to mobile ADR-025 wording if readily known; not a
  blocker otherwise.
- **Stall + concurrent thinking indicator.** Both `ThinkingIndicator` (phase === 'thinking') and
  `StallIndicator` (stalled) can be visible at once if a stall onset arrives during a thinking phase.
  This is acceptable — they occupy adjacent flex rows and convey different facts ("working" vs "may be
  stuck"). No coordination between them is specified; if the design later wants them mutually
  exclusive, that is a follow-up, not this slice.
