# Spec #323 — Screen-snapshot store: hold the daemon's latest rendered-screen text in renderer state

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/323
**Size:** S — 3 production files (2 new + 1 mount edit), 2 new test files, ~210 LOC total.
**Split from:** #318. Sibling: #324 (action + display, blocked by this).

## Design source

N/A — no UI surface. `ScreenSnapshotData` is a headless leaf that renders `null` and ships dormant; the visible display and its trigger are #324. There is nothing for code-review's visual-fidelity check to validate here.

## Files to read first

- `src/renderer/src/store/conversationListStore.ts` — **the store to mirror.** DI-factory → singleton → narrow-slice hook → read-only selector, single setter, `null` = not-loaded. Copy this shape verbatim; the only diff is `text`/`ts` instead of a `conversations` array.
- `src/renderer/src/store/runConfigStore.ts` — the second store precedent; `RunConfigSnapshot` is the exact shape to mimic for a held-object-or-null slice (`snapshot: RunConfigSnapshot | null`). Read the doc comments on why a single setter, not a reducer.
- `src/renderer/src/store/conversationListBridge.ts:24-33,72-132` — **the observer to mirror, minus two things.** `translateConversationsEvent` (the pure `event → value | null` filter with `default: null`), `subscribeConversations` (the injected-`onDaemonEvent` subscription returning the off-handle), and `ConversationListData` (the headless app-level leaf). Your slice DROPS the request half (`requestConversationList`) and the refresh trigger (`isConversationUpdated` / `refreshOnChange`) — it is subscribe-only.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts:27-70` — the alternate observer precedent; `toRunConfigSnapshot` shows the explicit-field-copy idiom (not spread) and `subscribeRunConfig` shows the minimal subscribe-only listener (`if (snapshot) setSnapshot(snapshot)`). Your bridge is closer to *this* than to conversationListBridge, because you also fire no request.
- `src/shared/ipc/events.ts:83-93` — the `screenSnapshotReceived` arm: `{ type: 'screenSnapshotReceived'; text: string; ts: string }`. Read the comment block — `text` is UNTRUSTED daemon-relayed content; the plain-text-never-HTML discipline is inherited by #324, not enforced here (this slice has no DOM sink).
- `src/renderer/src/App.tsx:104-116` — the headless-leaf mount cluster (`<ConversationListData/>`, `<SessionIdData/>`, `<RunSettingsWriteData/>`, `<QueueData/>`). You add one sibling here. Read the `QueueData` / `SessionIdData` comments (lines 93-103) — reactive-only leaves with **no connected-gate**, which is exactly your case.
- `src/renderer/src/store/conversationListBridge.test.ts` — the test idiom to clone: the `fakeBridge()` capture-the-listener helper, the `subscribeCalls`/`emit`/`off` spies, and the `server-renders to empty markup` container test (lines 255-267). Framework-free, injected spies, `renderToStaticMarkup`.
- `src/renderer/src/store/conversationListStore.test.ts` — the store-test idiom (create isolated store, drive the setter, assert via the selector).

## Context

The transport surfaces the daemon's rendered screen to the window as a `screenSnapshotReceived` event (#316), carrying the rendered-screen `text` and its `ts`. Today all three exhaustive renderer bridges no-op that arm (it ships dormant) — no store holds it. This slice adds the missing state: a dedicated renderer store plus a headless observer that writes each arriving snapshot into it. No UI surface, no user action, no request — the display and the trigger are #324.

This mirrors the run-config data path (`runConfigStore` + `runConfigSnapshot`, #187) and the conversation-list data path (`conversationListStore` + `conversationListBridge`, #208), both of which introduced a store + observer before a render slice consumed it. The **key divergence** from those mirrors: this observer is **subscribe-only** — it fires no request (there is no `requestScreenSnapshot`; #324 owns the trigger) and mounts for the **whole app lifetime** in `App` (the `QueueData` / `SessionIdData` reactive-only pattern), not on a screen-open effect.

## Design

### 1. Store — `src/renderer/src/store/screenSnapshotStore.ts` (new)

Mirror `runConfigStore.ts` field-for-field, holding a two-field snapshot instead of five. Contract:

```ts
// The held rendered-screen value. text/ts held VERBATIM — never parsed, coerced, or validated
// (untrusted daemon-relayed content; the plain-text rendering discipline belongs to #324).
export interface ScreenSnapshot { text: string; ts: string }

// snapshot: null = "no screen received yet" (mirror runConfig's snapshot: null). An empty-text
// snapshot { text: '', ts } is a REAL held value, NOT null.
export interface ScreenSnapshotState { snapshot: ScreenSnapshot | null }
export type ScreenSnapshotStore = ScreenSnapshotState & { setSnapshot: (s: ScreenSnapshot) => void }

export const initialScreenSnapshotState: ScreenSnapshotState = { snapshot: null }
export function createScreenSnapshotStore(init?: ScreenSnapshotState): StoreApi<ScreenSnapshotStore>
export const screenSnapshotStore   // app-wide singleton — the source of truth #324 reads
export function useScreenSnapshotStore<T>(selector: (s: ScreenSnapshotStore) => T): T
export const selectScreenSnapshot = (s: ScreenSnapshotState): ScreenSnapshot | null => s.snapshot
```

- `setSnapshot` replaces the whole `snapshot` object **unconditionally** — most-recent-wins, no merge, no accumulation (AC1). It never coerces or validates; `{ text: '', ts }` is stored as-is (AC1 empty-`text`-held-as-`""`).
- Single setter, not a reducer: exactly one mutation ("record the latest screen"), so a discriminated-union action set would be a one-member union — ceremony without benefit. Matches both store precedents.
- Unidirectional (AC2): read-only selector, one write path, `setSnapshot` invoked only by the observer wiring — never two-way-bound from a component. `useStore` selects a narrow slice so a snapshot arrival re-renders only components selecting it.

### 2. Observer — `src/renderer/src/store/screenSnapshotBridge.ts` (new)

Mirror `runConfigSnapshot.ts`'s subscribe-only shape (NOT conversationListBridge's request+refresh shape). Contract:

```ts
// The filter: the one owned arm → its two fields; every other DaemonEvent → null. default: null
// (NOT assertNever) — ignoring the rest is the intended, permanent behavior (AC3). Explicit field
// copy { text: event.text, ts: event.ts }, NOT spread — keeps the store shape immune to the event
// arm gaining an unrelated field later (the toRunConfigSnapshot rationale).
export function translateScreenSnapshot(event: DaemonEvent): ScreenSnapshot | null

// Subscribe-only: one listener; each non-null translation writes via setSnapshot; returns the
// onDaemonEvent off-handle (the effect-cleanup idiom). NO request, NO refresh trigger.
export function subscribeScreenSnapshot(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setSnapshot: (s: ScreenSnapshot) => void
): () => void

// Headless app-level leaf: one app-lifetime effect that wires subscribeScreenSnapshot into the
// singleton's setter and returns its off-handle as cleanup. Renders null.
export function ScreenSnapshotData(): null
```

- `translateScreenSnapshot`: `case 'screenSnapshotReceived'` returns `{ text: event.text, ts: event.ts }`; `default: null`. Kept as a separate exported pure function so the "unrelated events no-op" behavior (AC3) is unit-testable without React (the `toRunConfigSnapshot` idiom).
- `subscribeScreenSnapshot`: inside the listener, `const snapshot = translateScreenSnapshot(event); if (snapshot !== null) setSnapshot(snapshot)`. **Use `!== null`, not `if (snapshot)`** — makes it unmistakable that the guard is on the *snapshot object's presence*, never on the text content, so an empty-`text` snapshot writes (AC1/AC5). (A non-null object is always truthy, so both work — but `!== null` mirrors conversationListBridge's deliberate clarity choice and reads correctly next to the empty-string AC.)
- `ScreenSnapshotData`: a single `useEffect(() => subscribeScreenSnapshot(window.pyry.onDaemonEvent, (s) => screenSnapshotStore.getState().setSnapshot(s)), [])`. **No connected-gate** — reactive-only, like `SessionIdData` / `QueueData` (there is no request half to fire on connect, so no `useSessionStore` read, no `useRef` one-shot flag). `window.pyry` is dereferenced only inside the effect, never during render, so `<App/>` still server-renders to `''`.

### 3. Mount — `src/renderer/src/App.tsx` (edit, +2 lines + comment)

Add `import { ScreenSnapshotData } from './store/screenSnapshotBridge'` and mount `<ScreenSnapshotData />` inside the existing `<>…</>` alongside `<QueueData />` (App.tsx:104-109). Add a one-paragraph comment in the existing headless-leaf comment block (App.tsx:88-103) matching the `QueueData` rationale: a fifth sibling headless leaf, reactive-only (no connected-gate), lands each unsolicited `screenSnapshotReceived` into the screen-snapshot store; ships dormant — it populates the store, but nothing renders it yet (#324). This is the only edit to an existing file.

## State + concurrency model

- **One store slice**, orthogonal to session / conversation-list / run-config / queue stores — a screen-snapshot arrival never touches connection or messages state and vice versa, so it re-renders only its own selecting components.
- **One subscription**, app-lifetime. The `onDaemonEvent` off-handle is the effect cleanup, so a StrictMode double-mount nets exactly one live listener (the `daemonEventBridge` off-handle idiom). No `AbortController` — teardown is the returned off-handle.
- **No async, no streams beyond the shared daemon-event channel.** The observer is a synchronous listener that dispatches into the store. No fire-and-forget promise, no request round-trip.

## Error handling

No new failure modes. The observer only translates and dispatches; it never throws into React (a bad event just fails the `case` match and hits `default: null`). `text` is untrusted, but this slice has **no DOM sink** — it holds a string. The plain-text-never-HTML boundary is inherited by #324. The upstream fail-closed decode (`parseScreenSnapshotPayload`, #180) already defends the wire boundary; nothing to re-validate here (AC1: held verbatim).

## Testing strategy

`npm test` (vitest), framework-free with injected spies (the `conversationListBridge.test.ts` idiom). No jsdom needed — the container test uses `renderToStaticMarkup`.

**`screenSnapshotStore.test.ts`** — scenarios:
- Fresh store: `selectScreenSnapshot(store.getState())` is `null` (not-loaded).
- `setSnapshot({ text: 'hi', ts })` → selector returns that snapshot.
- Newer replaces older: two `setSnapshot` calls; selector returns the second, verbatim (most-recent-wins, no merge — AC1).
- Empty `text`: `setSnapshot({ text: '', ts })` → selector returns `{ text: '', ts }`, held as `""` not dropped (AC1).

**`screenSnapshotBridge.test.ts`** — scenarios:
- `translateScreenSnapshot` maps a `screenSnapshotReceived` to `{ text, ts }` (the owned arm).
- `translateScreenSnapshot` maps an empty-`text` `screenSnapshotReceived` to `{ text: '', ts }` — not null.
- `translateScreenSnapshot` returns `null` for a sample of unrelated events (`connecting`, `disconnected`, `messageReceived`, `snapshotReceived`, `conversationsReceived`) — AC3 filter.
- `subscribeScreenSnapshot` subscribes exactly once (the `fakeBridge()` `subscribeCalls` spy).
- On a `screenSnapshotReceived`, `setSnapshot` is called once with `{ text, ts }` (AC1/AC3).
- On an empty-`text` `screenSnapshotReceived`, `setSnapshot` is called once with `{ text: '', ts }` (the `!== null` guard — AC5 empty-held-as-`""`).
- Newer replaces older via the real store: `createScreenSnapshotStore()` wired through the setter, emit two snapshots, assert the selector returns the second (AC5 replaces).
- On an unrelated event, `setSnapshot` is not called (AC3/AC5 untouched).
- `subscribeScreenSnapshot` returns the `onDaemonEvent` off-handle as cleanup (calling it invokes `off` once).
- `ScreenSnapshotData` server-renders to empty markup (`''`) without touching `window.pyry` (the `RunConfigData` / `ConversationListData` container idiom).

Type-level coverage under `npm run typecheck`: the `default: null` filter over the sealed `DaemonEvent` union means a rename of the `screenSnapshotReceived` arm is caught (a `case` label that no longer overlaps the union is a type error). `npm run build` is the salvage gate.

## Open questions

None. The two mirrors (`runConfigStore`/`runConfigSnapshot`, `conversationListStore`/`conversationListBridge`) settle every structural choice; the only deltas — drop the request half, drop the connected-gate, use `!== null` for the empty-string clarity — are all called out above. #324 will add `useScreenSnapshotStore` + `selectScreenSnapshot` consumers and the plain-text render; nothing in this slice pre-commits those.
