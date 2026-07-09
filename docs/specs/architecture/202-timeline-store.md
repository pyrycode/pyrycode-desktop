# #202 — land the streamed assistant events in a conversation-timeline store

**Size:** S · **Security-sensitive:** No · **Figma:** N/A (headless — no render surface)

The renderer data-path slice of the Phase-2 structured-streaming vertical (split from #199).
Two new renderer pieces, purely additive: a Zustand **timeline store** wrapping the already-built
pure `reduceTimeline` (#121), and a `daemonEventBridge`-shaped **translator + binding** that maps
the two `DaemonEvent` stream arms into `ThreadEvent`s and feeds the store. Nothing renders here —
the render half is #203. The coarse `message` path (`sessionStore` / `daemonEventBridge`) is
untouched (Strangler Fig: nothing cuts over, nothing reads the timeline store yet).

## Design source

N/A — headless data-path slice; no render markup. Visual design lands in the render slice #203.

## Files to read first

- `src/renderer/src/store/threadTimeline.ts` — **the reducer you wrap, done in #121; do not touch it.**
  `ThreadEvent` union (`:42-49`), `TimelineState` (`:52-55`), `reduceTimeline` (`:113-155`),
  `initialTimelineState` (`:157`), `selectItems` / `selectPhase` (`:160-161`). Note the two arms
  `assistantDelta` (`:45`) and `turnEnd` (`:49`) are **field-for-field identical** to their
  `DaemonEvent` counterparts.
- `src/shared/ipc/events.ts:55-84` — the `DaemonEvent` union. The two arms this bridge owns are
  `assistantDelta` (`:77`) and `turnEnd` (`:78`); every other arm the bridge returns `null` for.
- `src/main/daemonConnection.ts:283-302` — where those two arms are emitted (context only, no edit):
  `conversation_id` is **already dropped** at the transport (`:285`), fresh literal with named
  fields. So the arms carry no scoping — the bridge dispatches unconditionally.
- `src/renderer/src/store/runConfigStore.ts:46-70` — **the store shape to mirror** (leaner than
  `sessionStore`): `initial…State` const → `create…Store(init)` factory → singleton → narrow-slice
  `use…Store<T>(selector)` hook → selectors. Mirror this structure, but wrap a **real reducer +
  `dispatch`** (below) instead of its single `setSnapshot`.
- `src/renderer/src/store/sessionStore.ts:145-157` — `createSessionStore`: the reducer-wrapping
  `dispatch` shape to copy (`set((s) => reduce(s, action))`). **Omit its `observe?` param** — the
  `#134` diagnostics seam is session-only; the timeline store takes no observer.
- `src/renderer/src/store/daemonEventBridge.ts:27-89` — **the translator + hook to mirror.**
  `translateDaemonEvent` (`:27-70`, pure `DaemonEvent → X | null` switch with `assertNever`
  exhaustiveness — the two stream arms already `return null` here at `:58-62`, so this file is
  unchanged) and `useDaemonEventBridge` (`:80-89`, the StrictMode-safe hook returning the off handle).
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts:56-70` — `subscribeRunConfig`: the
  **pure, injected-`onDaemonEvent` subscription that returns the off handle.** This is the testable
  binding pattern (no `@testing-library/react` in this repo — see Testing).
- `src/renderer/src/screens/conversation/runConfigSnapshot.test.ts` (the `subscribeRunConfig`
  describe block, ~`:90` on) — the `fakeBridge()` spy harness to mirror for the bridge test:
  captures the listener, hands back an `off` spy, exposes `emit`.
- `src/renderer/src/store/daemonEventBridge.test.ts` — the per-arm translate test idiom (each arm →
  expected action or `null`; dispatch into a fresh store via a `dispatchIfAction` null-guard).
- `src/renderer/src/store/threadTimeline.test.ts:57-90` — the reducer's coalescing is **already fully
  covered here.** Your tests must NOT re-test the reducer; assert coalescing exactly once, driven
  end-to-end through the bridge+store (AC2).

## Context

The blocking transport slice (#199, merged PR #207) decodes the v2 `assistant_delta` / `turn_end`
frames and emits them as typed `DaemonEvent` arms (`events.ts:77-78`, emitted at
`daemonConnection.ts:289-302`). The pure timeline model — the `ThreadItem` union, the renderer-local
`ThreadEvent` input union, and `reduceTimeline` — already exists (#121, ADR 0008). This slice adds
the two missing renderer pieces so the render slice (#203) has a single ordered source of truth to
read. Symmetry to note: `daemonEventBridge` returns `null` for these two arms; this new bridge
returns `null` for everything **else** — two independent subscribers on the same channel.

## Design

### New file 1 — `src/renderer/src/store/timelineStore.ts` (the store)

Mirror `runConfigStore`'s minimal `factory → singleton → hook → selectors`, but wrap the real
`reduceTimeline` + a `dispatch` (the `createSessionStore` shape), with **no observer param**.

Contract sketch (not the implementation — mirror `createSessionStore:145-157` for the `dispatch` body):

```ts
export type TimelineStore = TimelineState & { dispatch: (event: ThreadEvent) => void }

export function createTimelineStore(init?: TimelineState): StoreApi<TimelineStore>
  // createStore((set) => ({ ...init, dispatch: (event) => set((s) => reduceTimeline(s, event)) }))
  // default init = initialTimelineState

export const timelineStore = createTimelineStore()          // app-wide singleton
export function useTimelineStore<T>(selector: (s: TimelineStore) => T): T  // narrow-slice hook
```

- Import `reduceTimeline`, `initialTimelineState`, and the `TimelineState` / `ThreadEvent` types
  from `./threadTimeline`. Do **not** redefine them.
- **Re-export the two selectors** so #203 has one import site:
  `export { selectItems, selectPhase } from './threadTimeline'`. (They already exist; don't rewrite.)
- No diagnostics observer, no `logSessionTransition` analog — the timeline store is not
  instrumented. Adding a speculative observer param would be a defense for an unobserved need.
- `dispatch` is the sole mutation path; the only read surface is the selectors. No exposed setter,
  no two-way binding — unidirectional, per CLAUDE.md.

### New file 2 — `src/renderer/src/store/timelineBridge.ts` (translate + subscribe + hook)

Mirror `daemonEventBridge.ts` (pure choke + React binding in one file), with the subscription
extracted into a pure `subscribeTimeline` for testability (the `subscribeRunConfig` idiom).

**Pure translator** — `translateTimelineEvent(event: DaemonEvent): ThreadEvent | null`:

- Owns exactly two arms. Each is reconstructed as a **fresh literal with named fields** — not
  `return event`, not a spread — matching the codebase discipline (`daemonEventBridge`'s
  `messageReceived`, the transport emit at `daemonConnection.ts:289`). The two unions are declared
  separately per layer, so reconstruction keeps the translator immune to a `DaemonEvent` arm gaining
  an unrelated field later:
  - `assistantDelta` → `{ type: 'assistantDelta', turnId, seq, text }`
  - `turnEnd` → `{ type: 'turnEnd', turnId, stopReason }`
- **Every other arm returns `null` via explicit fall-through cases**, then `default: assertNever(event)`
  (copy the local `assertNever` from `daemonEventBridge.ts:12-14`). The exhaustiveness guard is
  load-bearing: a future `DaemonEvent` arm is then a compile error in **both** bridges until each
  decides its mapping. **Do not use a catch-all `default: return null`** — that would silently
  swallow new arms. (This is the opposite choice from `toRunConfigSnapshot`'s `default: null`, which
  is deliberate there because that path permanently consumes one arm; here the guard must stay hard.)
- This is a **filter, not a rename**: the two owned arms are field-identical to their `ThreadEvent`
  counterparts (verified above), so there is no field-mapping — just arm selection + fresh copy.

**Pure subscription** — `subscribeTimeline(onDaemonEvent, dispatch): () => void` (mirror
`subscribeRunConfig:62-70`):

```ts
export function subscribeTimeline(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: ThreadEvent) => void
): () => void
  // return onDaemonEvent((event) => { const te = translateTimelineEvent(event); if (te) dispatch(te) })
```

Returns the exact off handle from `onDaemonEvent` (the cleanup handle). Injecting `onDaemonEvent` +
`dispatch` keeps it React-free and unit-testable with plain spies.

**React binding** — `useTimelineBridge(): void` (mirror `useDaemonEventBridge:80-89`):

- `useEffect(() => subscribeTimeline(window.pyry.onDaemonEvent, (e) => timelineStore.getState().dispatch(e)), [])`.
- Returns `subscribeTimeline`'s off handle as the effect cleanup → a StrictMode double-mount runs
  mount → cleanup → mount and nets exactly **one** live listener. `window.pyry` is dereferenced only
  inside the effect (never during render), matching the `useDaemonEventBridge` / `RunConfigData`
  discipline. #203 calls this hook where it mounts the timeline.

### Data flow

```
daemon frame ─(#199 transport, snake→camel, conversation_id dropped)→ DaemonEvent{assistantDelta|turnEnd}
   → window.pyry.onDaemonEvent (preload channel)
   → subscribeTimeline listener → translateTimelineEvent → ThreadEvent (or null → skip)
   → timelineStore.dispatch → reduceTimeline → TimelineState
   → selectItems / selectPhase  (read by #203, not here)
```

## State + concurrency model

- **One store slice** — the timeline `{ items, phase }`, a singleton, orthogonal to `sessionStore`
  and `runConfigStore`. A stream arrival re-renders only components selecting a timeline slice.
- **Subscription lifecycle** — a single `onDaemonEvent` listener established on mount inside the
  hook's effect, torn down via the returned off handle on unmount. No timers, no `AbortController` —
  the preload `onDaemonEvent` off handle is the only teardown needed. No fire-and-forget promise
  outlives the window.
- **Ordering** — arrival order is authoritative (ADR 0004); `seq` is carried but not consulted (the
  reducer already ignores it). No reordering, no per-conversation scoping (single active
  conversation; `conversation_id` was dropped upstream).

## Error handling

- No new failure modes. The events are already-typed `DaemonEvent`s over IPC — no network, socket,
  parse, or permission surface in this slice (that boundary was defended in the #199 transport
  decode).
- The listener only translates + dispatches; it never throws into React. Unowned arms translate to
  `null` and are skipped by the `if (te)` guard — a benign no-op, never an error.
- Orphan / duplicate `toolResult`-style edge cases are the reducer's concern (#121, already
  same-reference no-ops) — not re-handled here.

## Testing strategy

`npm test` (vitest), no React renderer (no `@testing-library/react` in this repo). Two new test
files; keep each assertion off the reducer's internals (already covered by
`threadTimeline.test.ts`).

**`timelineStore.test.ts`** — the store wrapper:
- `createTimelineStore()` starts at `initialTimelineState` (empty items, `phase: 'idle'`).
- Dispatching an `assistantDelta` `ThreadEvent` appends one `assistantText` item; a second same-turn
  `assistantDelta` coalesces into one growing item (assert via `selectItems`). One assertion that the
  store threads the reducer — not a re-test of every reducer branch.
- Dispatching a `turnEnd` appends a `turnBoundary`; `selectPhase` unchanged.
- Two `createTimelineStore()` instances are isolated (DI factory — dispatching into one leaves the
  other at initial state).

**`timelineBridge.test.ts`** — translator + subscription (mirror `daemonEventBridge.test.ts` +
`runConfigSnapshot.test.ts`'s `fakeBridge`):
- `translateTimelineEvent` per arm: `assistantDelta` → a `ThreadEvent` `assistantDelta` with the
  same `turnId`/`seq`/`text` **and a fresh object** (`.not.toBe(event)`); `turnEnd` → a `ThreadEvent`
  `turnEnd` (same `turnId`/`stopReason`, fresh object); **every other `DaemonEvent` arm → `null`**
  (enumerate all: connecting, connected, disconnected, failed, messageReceived, messagesReceived,
  the three debugBundle arms, snapshotReceived, conversationsReceived).
- `subscribeTimeline` with a `fakeBridge`: subscribes exactly once; an emitted `assistantDelta`
  dispatches a translated event; an emitted unowned arm (e.g. `connecting`) dispatches nothing;
  calling the returned cleanup invokes the `off` spy exactly once (proves unsubscribe → the
  StrictMode one-listener guarantee).
- **AC2 end-to-end**: build a `DaemonEvent[]` sequence of two same-turn `assistantDelta`s, drive them
  through `subscribeTimeline` into a fresh `createTimelineStore()` (via `emit`), and assert
  `selectItems` shows exactly one `assistantText` whose `text` is the concatenation — no React.

**Type-level** — `npm run typecheck` covers: the `assertNever` default (a new `DaemonEvent` arm
fails to compile until it has a case), and `TimelineStore` / selector generics.

The hook `useTimelineBridge` gets **no dedicated test** — a bare hook is untestable without a React
renderer, exactly as `useDaemonEventBridge` has none; its behavior is fully carried by the pure
`subscribeTimeline` tests above. State this in the PR so code-review reads it as intentional, not a
gap.

## Acceptance Criteria (restated for the developer)

- [ ] `timelineStore.ts` wraps `reduceTimeline` / `initialTimelineState` (ADR 0004 factory mirroring
  `createSessionStore`, no observer), exposing `selectItems` / `selectPhase` (re-exported). Nothing
  in the coarse `message` path imports it or is changed by it.
- [ ] `translateTimelineEvent` maps `assistantDelta` → `ThreadEvent` `assistantDelta` and `turnEnd` →
  `turnEnd` (a filter, fresh literals), and returns `null` for every other `DaemonEvent` arm
  (`assertNever` default). Injected `DaemonEvent` sequences drive the store; two same-turn
  `assistantDelta`s coalesce into one `assistantText` via `selectItems`, no React.
- [ ] `useTimelineBridge` subscribes the daemon-event channel, dispatches translated events into
  `timelineStore`, and unsubscribes on unmount (StrictMode-safe — the returned off handle nets one
  live listener), mirroring `useDaemonEventBridge`.
- [ ] Not security-sensitive. `npm run build` + `npm test` green; the coarse `message` path
  unaffected (0 existing prod files modified).

## Open questions

- **Selector home.** The spec re-exports `selectItems` / `selectPhase` from `timelineStore.ts` for a
  single #203 import site. If the developer finds a cleaner single-import shape (e.g. #203 imports the
  hook from `timelineStore` and selectors directly from `threadTimeline`), either is acceptable —
  the selectors must not be redefined. Non-blocking.
