# #329 — Renderer relay-link status store + bridge

**Size:** S (confirmed — 3 production files: 2 new + `App.tsx` edit; ~310 total LOC incl. tests; 0 reject branches; 1 consumer site). Split child of #149, blocked-by #328 (merged, PR #331).

## Design source

N/A — headless/dormant slice. This store + bridge populate renderer state but render nothing; there is no visual surface. The two-dot indicator that reads this leg (and owns the Figma anchor) is the next slice, #330.

## Files to read first

Read these before writing code. The two `sessionId*` files are the **direct templates** — this slice is a near-verbatim clone of that pair, swapping the arm and the value type.

- `src/renderer/src/store/sessionIdStore.ts:1-58` — **the store template to mirror.** Scalar-value store with a `null` sentinel, DI-factory → singleton → hook → selector, one setter, whole-value replace. Clone it; swap `sessionId: string`→`status: RelayLinkStatus`, `setSessionId`→`setRelayLinkStatus`, `null`-means-"no-marker-seen"→`null`-means-"initial not-connected".
- `src/renderer/src/store/sessionIdBridge.ts:1-73` — **the bridge template to mirror.** Reactive-only: `translate…` filter (`default: null`), `subscribe…` with the `!== null` guard, and the headless `SessionIdData(): null` leaf — one subscribe effect, **no request half, no connected-gate, no `useRef`/`useState`/`useSessionStore`.**
- `src/renderer/src/store/sessionIdStore.test.ts:1-64` — store test idiom: plain-function tests over isolated `createSessionIdStore()` instances, no React.
- `src/renderer/src/store/sessionIdBridge.test.ts:1-186` — bridge test idiom: `fakeBridge()` listener-capture spy, `translate` filter table, not-seen→held seam wiring the real store, and the `renderToStaticMarkup(createElement(SessionIdData)) === ''` container sanity test.
- `src/shared/ipc/events.ts:42-50` — `RelayLinkStatus = 'connected' | 'offline' | 'daemon-absent'` — the closed 3-category union to import (from `@shared/ipc/events`).
- `src/shared/ipc/events.ts:235-242` — the `relayLinkChanged` arm: `{ type: 'relayLinkChanged'; status: RelayLinkStatus }`. Content-free; ships dormant; the three exhaustive bridges no-op it and are **not touched here**.
- `src/renderer/src/App.tsx:110-123` — the reactive-only-leaf mount fragment (`<SessionIdData/>`, `<QueueData/>`, `<ScreenSnapshotData/>`). Add `<RelayLinkData/>` here.
- `src/renderer/src/store/queueBridge.ts:1-73` — a second reactive-only precedent (`QueueData`), confirming the sessionIdBridge posture is the norm for unsolicited push arms.
- `src/renderer/src/store/conversationListStore.ts` / `conversationListBridge.ts` — the #208 precedent the ticket names. **Note the divergence:** `conversationListBridge` has a request half + a `connected`-edge trigger. Ours does **not** — the relay arm is unsolicited. Use `sessionId*`, not `conversationList*`, as the direct template. (`@shared` alias is available in the renderer — `conversationListStore` imports from `@shared/wire/types`; you import `RelayLinkStatus` from `@shared/ipc/events` the same way.)

## Context

#328 (merged) added the `relayLinkChanged` `DaemonEvent` arm — `{ type: 'relayLinkChanged'; status: RelayLinkStatus }`, `RelayLinkStatus = 'connected' | 'offline' | 'daemon-absent'` — a content-free category (no token, key, raw frame, or close code; the relay's `4404` maps to `daemon-absent`, ordinary retryable closes to `offline`). The arm ships **dormant**: all three exhaustive bridges (`daemonEventBridge` / `timelineBridge` / `modalBridge`) no-op it.

This slice is its **first real consumer**: a NEW dedicated store + a NEW dedicated headless bridge — the same posture #208 took for the conversation-list arm (its own store + leaf rather than folding into the session store). The three exhaustive bridges keep no-op'ing it and are untouched.

The store owns **only the relay-socket leg**. The daemon-session leg already lives in `sessionStore`'s `ConnectionStatus`; do not model it here. #330 combines the two legs at render time.

Ships **dormant** — no UI reads this store yet.

## Design

Two new files under `src/renderer/src/store/`, plus a one-line mount in `App.tsx`. Both new files are near-verbatim clones of their `sessionId*` twins.

### Store — `relayLinkStore.ts`

Mirror `sessionIdStore.ts` exactly; the only substantive difference is the held value type and the meaning of `null`.

Contract (signatures, not bodies):
- `interface RelayLinkState { status: RelayLinkStatus | null }` — `null` is the distinct initial **not-connected** sentinel (AC1); it is definitionally none of the three categories.
- `type RelayLinkStore = RelayLinkState & { setRelayLinkStatus: (status: RelayLinkStatus) => void }` — the single mutation entry point.
- `const initialRelayLinkState: RelayLinkState = { status: null }`
- `createRelayLinkStore(init = initialRelayLinkState)` — DI factory over `createStore` from `zustand/vanilla`; `setRelayLinkStatus` does `set({ status })`, whole-value replace, no merge/coerce/validate.
- `const relayLinkStore = createRelayLinkStore()` — app singleton.
- `useRelayLinkStore<T>(selector)` — narrow-slice React binding via `useStore` (exported now, ahead of #330, exactly as `useSessionIdStore` shipped ahead of #257).
- `selectRelayLinkStatus = (s: RelayLinkState): RelayLinkStatus | null => s.status` — the only read surface. No component-facing setter beyond `setRelayLinkStatus`; it is invoked only by the bridge (AC4).

Import `RelayLinkStatus` (`import type`) from `@shared/ipc/events`. Do **not** redeclare or re-export a parallel copy — reuse the wire-owned type so the store stays drift-free against the arm.

### Bridge — `relayLinkBridge.ts`

Mirror `sessionIdBridge.ts` exactly — **reactive-only**, no request half.

Contract (signatures, not bodies):
- `translateRelayLink(event: DaemonEvent): RelayLinkStatus | null` — `switch (event.type)`: `case 'relayLinkChanged': return event.status`; `default: return null`. Uses `default: null`, **not** `assertNever` — this is a 4th independent subscriber that deliberately/permanently consumes one arm, the `sessionIdBridge`/`queueBridge`/`toRunConfigSnapshot` posture. A rename of the arm is still caught (a non-overlapping `case` label is a type error). Returning `event.status` directly is a single-field select (a filter), not a field-remap — no fresh-literal reconstruction needed.
- `subscribeRelayLink(onDaemonEvent, setRelayLinkStatus): () => void` — one `onDaemonEvent` listener; `const status = translateRelayLink(event); if (status !== null) setRelayLinkStatus(status)`. Returns the off-handle as effect cleanup. Injected `onDaemonEvent` + setter keep it React-free and spy-testable.
- `RelayLinkData(): null` — headless app-level leaf. One subscribe effect: `return subscribeRelayLink(window.pyry.onDaemonEvent, (status) => relayLinkStore.getState().setRelayLinkStatus(status))`. `window.pyry` is dereferenced **only inside the effect**, never during render (preserves the server-render-to-`''` invariant). No request effect, no `useRef`/`useState`/`useSessionStore`.

### Mount — `App.tsx`

Add `import { RelayLinkData } from './store/relayLinkBridge'` and drop `<RelayLinkData />` into the existing headless-leaf fragment (App.tsx:110-123), alongside `<SessionIdData />` / `<QueueData />` / `<ScreenSnapshotData />`. One import line + one JSX line; no other change.

## State + concurrency model

- **Single source of state:** the `relayLinkStore` singleton. Unidirectional — read through `selectRelayLinkStatus`, written only by `RelayLinkData` via `setRelayLinkStatus`. No component-facing setter, no two-way binding (AC4).
- **One mutation, whole-value replace:** the arm carries the FINAL category, so there is exactly one mutation ("record the latest status") — no fold, no dedup, no reducer. `sessionStore`'s multi-arm reducer + `dispatch` is the wrong shape here (the ticket's Technical Notes call this out); borrow only `createStore`/selector/singleton scaffolding. Because it's a single closed category (not a per-arm payload), this is **not** a discriminated-union-on-`type` like the modal store.
- **Reactive-only subscription:** the arm is unsolicited (the daemon pushes it), so there is no request command, no `connected`-edge trigger, and no connected-gate. This is the key divergence from the #208 `conversationList` bridge the ticket names, and the reason `sessionId*`/`queue*` are the better templates.
- **App-lifetime listener:** mounted at App root as a headless leaf so it survives every route flip — a relay-link change can arrive at any time, including before #330 exists. StrictMode double-mount nets exactly one live listener via the returned off-handle cleanup (the `daemonEventBridge` idiom). Teardown is the effect cleanup; no `AbortController` needed (the preload `onDaemonEvent` off-handle is the teardown primitive).

### Sentinel decision — `null`, not a named 4th literal (recommended, decided)

AC1 needs "a distinct initial not-connected state that is none of the three." Use `status: null`, matching **every** sibling store (`sessionIdStore`, `conversationListStore`, `queueStore`, `runConfigStore`, `screenSnapshotStore` all use `null` as the "not yet arrived" sentinel). `null` is definitionally none of the three categories, keeps the stored domain identical to the wire's `RelayLinkStatus` (no invented value), and is the drift-free choice. #330 interprets `null` as the not-connected relay leg (a clean 4-way read: `connected` / `offline` / `daemon-absent` / `null`). Rejected alternative: adding a `'not-connected'` string literal — it would fabricate a category the wire never emits and diverge from all five sibling stores.

### The `!== null` guard

`subscribeRelayLink` writes on `status !== null`, not `if (status)`. Here all three `RelayLinkStatus` values are truthy, so the two behave identically at runtime — but `!== null` matches the sibling idiom verbatim and documents "the sentinel is `null`, not falsiness." Use it for consistency and future-proofing, not because a falsy category exists today.

## Error handling

Minimal by construction — no failure modes to surface:
- The arm is pre-validated and content-free (#328 dropped the raw close code at `daemonConnection`; only the closed category crosses IPC). The store stores it verbatim; there is nothing to parse, coerce, or reject.
- `translateRelayLink` is total over the sealed `DaemonEvent` union (`default: null`) — no throw path.
- The listener only translates + dispatches; it never throws into React.
- No network/socket/permission surface reaches this layer — it lives entirely in the renderer, one subscription behind the preload bridge.

## Testing strategy

Plain `vitest` (`npm test`), no DOM beyond the one server-render sanity check. Lift the `fakeBridge()` helper and the `createElement`-server-render idiom from `sessionIdBridge.test.ts`. Scenarios (bullets — write them in the project idiom, not as pre-written bodies):

**`relayLinkStore.test.ts`** (mirror `sessionIdStore.test.ts`):
- Starts not-connected — `status` is `null`; `selectRelayLinkStatus` returns `null` (AC1, AC3).
- `setRelayLinkStatus('connected')` records it; `selectRelayLinkStatus` returns `'connected'` (AC5).
- Each of the three categories round-trips through the setter/selector (`connected` / `offline` / `daemon-absent`) (AC5).
- A later `setRelayLinkStatus` replaces the held value — most-recent wins, whole-value replace.
- Two `createRelayLinkStore()` instances stay independent (DI).
- Starts from an injected initial state (DI).
- `initialRelayLinkState` equals `{ status: null }`.
- `setRelayLinkStatus` reference is stable across updates.

**`relayLinkBridge.test.ts`** (mirror `sessionIdBridge.test.ts`):
- `translateRelayLink` maps a `relayLinkChanged` event to its `status` (one case per category).
- `translateRelayLink` returns `null` for a sample of unrelated `DaemonEvent`s (the filter, AC3 — reuse the sessionId test's sample list).
- `subscribeRelayLink` subscribes exactly once.
- Writes `status` on a `relayLinkChanged` event; writes again on a second — last-write-wins (AC5).
- Does not call the setter for an unrelated event (AC3).
- Returns the off-handle from `onDaemonEvent` as cleanup.
- **Seam (AC1→AC5, the key transition test):** wire a real `createRelayLinkStore()` to `subscribeRelayLink`; assert `selectRelayLinkStatus` is `null` before any event, then equals the emitted category after each of `connected` / `offline` / `daemon-absent`. This is the AC5 "each status → store-state transition, plus the initial state" coverage.
- `RelayLinkData` server-renders to `''` without touching `window.pyry` (the `SessionIdData`/`ConversationListData` invariant; keep `App.test.tsx`'s `renderToStaticMarkup(<App/>) === ''` green — effects don't run under server render).

Type-level coverage rides on `npm run typecheck`: `RelayLinkStatus` is imported from the wire type, so a drift in the arm breaks the build.

## Open questions

None blocking. One forward note for #330 (not this slice's work): #330 must decide how to present the relay dot after a **fatal** session close (`4401`/`4421`/`4426`) — per #328's forward decision those are session rejections, deliberately NOT relay-leg events, so this store's `status` stays at its last value (likely stale `connected`) while `sessionStore` goes `failed`. #330 owns that terminal-state presentation since it holds both legs; this store correctly does not model it.
