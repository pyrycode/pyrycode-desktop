# Spec — Translate daemon events into SessionActions in the renderer (#19)

**Size:** S. One new production file (`src/renderer/src/store/daemonEventBridge.ts`), one modified (`src/renderer/src/App.tsx`), plus one unit test (`daemonEventBridge.test.ts`). 2 new exported symbols (`translateDaemonEvent`, `useDaemonEventBridge`). ~180 total LOC (≈20 translate + ≈12 hook + ≈3 App + ≈90 test + doc). **Zero consumer cascade** — nothing imports the new symbols yet except App and the test; the union (`DaemonEvent`, #18) and the store (`SessionAction`, #2) already exist and are untouched.

> Numbering note: `sessionStore.ts` and ADR 0004 predate a renumber; their doc comments say "**#3** translates daemon envelopes into the SessionActions dispatched here" and "#12 binds the UI." "#3" was split into #17 (renderer→main commands), #18 (main→renderer events, shipped), and **#19 (this ticket — translate events → `SessionAction`)**. Read "#3 translates" in the store as "this ticket."

## Files to read first

- `src/renderer/src/store/sessionStore.ts:39-45` — the **`SessionAction`** union (the mapping **target**). Also `:27-31` `ConnectionError` (the `failed` arm's payload — the one non-identity conversion), `:59-61` the local **`assertNever`** exhaustiveness pattern to mirror, and `:93-101` `createSessionStore` / the app-singleton `sessionStore` (`dispatch` is the sole write path — `sessionStore.getState().dispatch(action)`).
- `src/shared/ipc/events.ts:31-37` — the **`DaemonEvent`** union (the mapping **source**); the header comment (`:19-29`) explains why its member/field names mirror `SessionAction` so the mapping is near-identity. Import from `@shared/ipc/events` (renderer alias resolves — see aliases below).
- `src/shared/wire/types.ts:56-68,86-90` — `HelloAckPayload`, `MessagePayload`, `ErrorPayload`. The pass-through arms carry these verbatim; the `failed` arm copies `ErrorPayload`'s three fields into `ConnectionError`. **Do not redefine or drift them.**
- `src/renderer/src/store/sessionStore.test.ts:1-29,138-161` — the exact test idiom to reuse: fixtures (`ack`, `msg(...)`), a fresh `createSessionStore()` per test, `store.getState().dispatch(...)`, then assert `store.getState().status` / `.messages`. Mirror this shape.
- `src/preload/index.ts:17-21` — `window.pyry.onDaemonEvent(listener) => unsubscribe`, the bridge the hook consumes. Returns the unsubscribe the effect must return as cleanup. **Do not reach for `ipcRenderer`; subscribe only through this.**
- `src/preload/index.d.ts` (7 lines) — confirms `window.pyry` is typed `PyryApi`, so `window.pyry.onDaemonEvent` is already typed in the renderer with no edit here.
- `src/renderer/src/App.tsx` (7 lines) — the wiring site. The hook is called once at the top of `App()`; nothing else in this file changes.
- `src/renderer/src/main.tsx` (11 lines) — App is wrapped in `React.StrictMode`, which double-invokes effects in dev. This is **why** the effect must return the unsubscribe (see State + concurrency).
- `docs/knowledge/features/daemon-event-channel.md` — §"Configuration and usage" names this ticket's subscriber contract verbatim: `const off = window.pyry.onDaemonEvent(cb); off()` in a `useEffect` cleanup. §"Security posture" explains the receive-only, no-token guarantee this ticket must preserve.
- `docs/knowledge/decisions/0004-renderer-session-store-reducer-wire-types.md` — the `failed → ErrorPayload → ConnectionError` rationale (why `ConnectionError` is a store-owned shape distinct from the wire `ErrorPayload`).
- `CLAUDE.md` (repo root) — *Unidirectional state* (store reads, window dispatches), *Sealed event shapes on a `type` discriminant*, *No crypto/sockets/tokens in the renderer*, *Test-first*.

> **Aliases.** The renderer and vitest resolve `@shared/*` (proof: `sessionStore.ts:12` and `sessionStore.test.ts:2` already import `@shared/wire/types`). So this ticket's renderer file and its test use `@shared/ipc/events`. The main/preload restriction (relative-path only) does **not** apply here — everything this ticket writes lives under `src/renderer`.
>
> Codegraph is not initialized for this repo (`mcp__codegraph__*` errors here); this reading list was built by hand from the store, the union, and the preload surface.

## Context

The session store (#2, shipped) is the renderer's single source of truth; its `SessionAction` union is the only write surface. The typed daemon-event channel (#18, shipped) delivers `DaemonEvent`s to the window via `window.pyry.onDaemonEvent`, but nothing consumes them yet. This ticket builds the **renderer translation half** of the background→window bridge — the seam the store's own doc-comment reserves ("translates daemon envelopes into the SessionActions dispatched here"):

1. a **pure, total** function mapping each `DaemonEvent` variant to the matching `SessionAction`;
2. a **thin React subscription** that pipes `onDaemonEvent → translate → dispatch` into the app-singleton store, and unsubscribes cleanly on teardown.

`DaemonEvent` was deliberately shaped with the same member and field names as `SessionAction` (#18 spec §1), so the mapping is near-identity. The **only** non-pass-through arm is `failed`: `DaemonEvent.failed` carries a wire `ErrorPayload`; `SessionAction.failed` carries the store-owned `ConnectionError`. The two are structurally identical (`{ code, message, retryable }`) but nominally distinct per layer, so the translation **copies the three fields** into a fresh `ConnectionError` rather than spreading the wire object.

There is no `## Figma` section in the ticket and this ticket renders nothing (a pure function + a `void` hook — no component, no visual surface). No Design source section applies.

## Design

### Module layout

| File | Status | Purpose |
|---|---|---|
| `src/renderer/src/store/daemonEventBridge.ts` | **new** | `translateDaemonEvent` (pure) + `useDaemonEventBridge` (subscription hook). Beside the session store, per CLAUDE.md layout. |
| `src/renderer/src/App.tsx` | **modified** | call `useDaemonEventBridge()` once at the top of `App()`. |
| `src/renderer/src/store/daemonEventBridge.test.ts` | **new** | unit-tests `translateDaemonEvent` against a fresh `createSessionStore()` (AC5). |
| `src/renderer/src/store/sessionStore.ts` | untouched | reused: `SessionAction`, `ConnectionError`, `sessionStore`, `createSessionStore`. |
| `src/preload/index.ts` / `index.d.ts` | untouched | `window.pyry.onDaemonEvent` already typed and exposed by #18. |

Both symbols live in one cohesive module: the hook is the only caller of the translate function in production, and both belong to the same "daemon-event → store" concern. Splitting them into two files would add a file for no boundary.

### 1. The pure translation (`translateDaemonEvent`) — contract

Imports: `type { DaemonEvent } from '@shared/ipc/events'`; `type { SessionAction, ConnectionError } from './sessionStore'`.

```ts
/** Map one typed daemon event to the session-store action it produces.
 *  Total by construction: a new DaemonEvent variant with no case fails to
 *  compile (assertNever). Every arm is pass-through except `failed`, which
 *  copies the wire ErrorPayload's fields into a store-owned ConnectionError. */
export function translateDaemonEvent(event: DaemonEvent): SessionAction
```

Mapping (the contract — all arms; only `failed` is non-identity):

- `connecting` → `{ type: 'connecting' }`
- `connected` → `{ type: 'connected', ack: event.ack }` (same `HelloAckPayload`, by reference)
- `disconnected` → `{ type: 'disconnected' }`
- `failed` → `{ type: 'failed', error: { code: event.error.code, message: event.error.message, retryable: event.error.retryable } }` — **explicit three-field copy**, a fresh `ConnectionError`, not `{ ...event.error }`
- `messageReceived` → `{ type: 'messageReceived', message: event.message }` (same `MessagePayload`, by reference)
- `messagesReceived` → `{ type: 'messagesReceived', messages: event.messages }` (same `readonly MessagePayload[]`, by reference)
- `default` → `assertNever(event)`

Implementation notes for the developer:

- **Exhaustiveness guard.** Use a `switch (event.type)` with a `default: return assertNever(event)`, mirroring `sessionStore.ts:59-61`. Define a **local** `assertNever(x: never): never` in this module (a 3-line copy of the store's pattern) rather than exporting the store's — this satisfies AC1's compile-time totality without widening the store's public surface. Adding a 7th `DaemonEvent` member with no case makes `event` in `default` non-`never`, so `assertNever(event)` fails `npm run typecheck`. That type error **is** the "adding a variant with no mapping is a compile-time error" acceptance criterion.
- **Why explicit copy on `failed`, not spread.** The field-by-field copy makes the wire→store boundary visible and keeps the store-owned `ConnectionError` immune to `ErrorPayload` gaining an unrelated field later (a spread would silently leak it). ADR 0004 defines `ConnectionError` as the one renderer-owned model precisely so transport/handshake failures that carry *no* wire envelope populate the same shape — this ticket copies the wire-envelope case into it.
- **No mutation, no side effects, no logging.** Pure `DaemonEvent → SessionAction`. A `console.log(event)` here would leak `MessagePayload.text` (message bodies) to the DevTools console — forbidden (same guardrail as #18's emit helper).

### 2. The subscription hook (`useDaemonEventBridge`) — contract

Imports: `useEffect` from `react`; `sessionStore` and `translateDaemonEvent` from `./` (same module for the latter); the store singleton from `./sessionStore`.

```ts
/** Wire the daemon-event channel into the app-singleton session store for the
 *  lifetime of the mounting component. Subscribes on mount, translates each
 *  event to a SessionAction and dispatches it into `sessionStore`, and calls
 *  the unsubscribe handle on unmount. Returns nothing — it is a side-effecting
 *  binding, not a state source (the store is the single source of truth). */
export function useDaemonEventBridge(): void
```

Required behavior (the developer writes the ~10-line body):

- A single `useEffect(() => { … }, [])` (empty deps — subscribe once per mount).
- Inside: `const off = window.pyry.onDaemonEvent((event) => sessionStore.getState().dispatch(translateDaemonEvent(event)))`.
- `return off` — the effect cleanup **is** the unsubscribe handle from `onDaemonEvent`, so teardown removes exactly the listener it registered (AC3). Do not wrap it in an extra closure that drops the reference.
- Dispatch goes to the **app-singleton** `sessionStore` (`sessionStore.getState().dispatch`), not a per-hook store — this is the "one source of truth" #12 will read (AC3/AC4).
- The hook reads nothing from `window` beyond `window.pyry.onDaemonEvent`; it never touches `ipcRenderer`, raw frames, keys, or the transport (AC4 — enforced already by the bridge, preserved here by only calling `onDaemonEvent`).

### 3. Wiring site (`src/renderer/src/App.tsx`)

Add one call at the top of `App()`:

```tsx
function App(): JSX.Element {
  useDaemonEventBridge()
  return <ConversationScreen />
}
```

Plus the import. Nothing else in `App.tsx` changes. App is the renderer composition root (mounted once by `main.tsx`), so this is where the app-lifetime subscription belongs.

### Data flow

```
 #18 preload bridge            useDaemonEventBridge (this ticket)                     store (#2)
 webContents.send ──IPC──►  window.pyry.onDaemonEvent(cb)  ──►  translateDaemonEvent  ──►  sessionStore.dispatch
 DAEMON_EVENT_CHANNEL       cb(event: DaemonEvent)              (DaemonEvent→SessionAction)   reduceSession → state
                            useEffect cleanup: off()           failed: ErrorPayload→ConnectionError
```

`translateDaemonEvent` is a pure choke point; the hook is the only production caller. The renderer reads status/messages **only** through `sessionStore` this feeds (#12 will bind the selectors) — it never re-parses frames or holds transport state.

## State + concurrency model

- **No new state.** The store (#2) remains the single source of truth; this ticket only *feeds* it. The hook holds no `useState`, no ref — just the subscription lifecycle. The translate function is stateless.
- **Subscription lifetime = mount lifetime.** Subscribe on mount, unsubscribe on unmount, via the effect's return. Since App mounts once for the app's life, the practical lifetime is app-wide; the cleanup fires on window close, HMR reload, and StrictMode remount.
- **StrictMode correctness (the load-bearing concurrency point).** `main.tsx` wraps App in `React.StrictMode`, which in dev runs the effect **twice**: mount → subscribe (handler A) → cleanup → unsubscribe A → mount → subscribe (handler B). Because #18's `onDaemonEvent` unsubscribe removes the *exact* handler it registered, the net result is exactly **one** live listener — no duplicated dispatch, no doubled message append. The empty-deps effect returning the unsubscribe is what guarantees this; a body that ignored the returned handle would leak a listener per remount and double every `messageReceived`.
- **Synchronous dispatch.** `onDaemonEvent`'s callback runs synchronously on IPC delivery; `translate` + `dispatch` + `reduceSession` are all synchronous and pure. No `AbortController`, no timers, no async iteration here — the transport (#4/#7) owns those upstream.
- **Multiple mounts allowed but not used.** Each `useDaemonEventBridge()` call registers its own listener; App calls it once. (If a second consumer ever mounts it, each event would dispatch once per listener — call the hook in exactly one place.)

## Error handling

- **The translation cannot fail on well-typed input** — it is a total mapping over a sealed union; the only "error" path is `assertNever`, which is unreachable at runtime for a valid `DaemonEvent` and exists solely as the compile-time totality guard.
- **Failure *events* are data, not exceptions.** A connection failure arrives as `{ type: 'failed'; error: ErrorPayload }`, is translated to `{ type: 'failed'; error: ConnectionError }`, and dispatched — `reduceSession` sets `status: { type: 'error', error }`. #12 renders that as a banner later; this ticket only lands it in the store.
- **No runtime validation at the boundary.** The producer is our own trusted main process delivering already-validated `DaemonEvent`s (#18 forwards types built from validated wire envelopes upstream in #5/#10). Per evidence-based-fix, no `zod`-style guard is added in the renderer — it would defend against a bug, not an attacker, and a compromised main process is already game-over. Revisit only if a less-trusted producer ever sends on this channel.
- **`window.pyry` presence.** In the Electron renderer the preload runs before the window script, so `window.pyry` is always defined when App mounts; no guard is added (no observed failure). See Open questions for the jsdom-render caveat.

## Testing strategy

`npm test` (vitest, node env) covers the pure `translateDaemonEvent`; `npm run build` / `npm run typecheck` cover the hook wiring, the exhaustiveness guard, and the `window.pyry.onDaemonEvent` type flow (per the ticket — the subscription is not unit-tested, there is no Electron/IPC harness). Test-first: write these RED before the module exists.

**`src/renderer/src/store/daemonEventBridge.test.ts`** — reuse the `sessionStore.test.ts` idiom (fixtures + fresh `createSessionStore()` + `dispatch` + assert). Each case: `const store = createSessionStore(); store.getState().dispatch(translateDaemonEvent(event)); expect(...)`. Scenarios (bullets — developer writes the assertions):

- **`connecting`** → `store.getState().status` equals `{ type: 'connecting' }`.
- **`connected`** (with an `ack: HelloAckPayload` fixture) → status equals `{ type: 'connected', ack }`, and the `ack` is passed through **by reference** (`.toBe(ack)`).
- **`disconnected`** → status equals `{ type: 'disconnected' }`.
- **`failed`** (with an `ErrorPayload` fixture `wireErr`) → status equals `{ type: 'error', error: { code, message, retryable } }` with the **same field values**, **and** the stored `error` is a **fresh object** — `expect(status.error).not.toBe(wireErr)`. This asserts the `ErrorPayload → ConnectionError` conversion is a copy, not a pass-through (the one behavior the ticket calls out explicitly).
- **`messageReceived`** (with a `MessagePayload` fixture) → `store.getState().messages` is `[message]`, the message passed through **by reference**.
- **`messagesReceived`** (a 2–3 element batch) → `messages` equals the batch **in order** (assert `.map(m => m.message_id)`).
- **Totality (optional, type-only — no runtime test needed):** the `switch` + `assertNever(event)` default is the deterministic AC1 enforcement, verified by `npm run typecheck`. Optionally add the `Record<DaemonEvent['type'], true>` cross-check tripwire from #18's spec §Testing, but it is redundant with the switch and not required.

The hook (`useDaemonEventBridge`) is intentionally **not** unit-tested (no IPC harness); `npm run build` + `npm run typecheck` confirm `window.pyry.onDaemonEvent` is typed and the effect returns a valid cleanup.

## Open questions

1. **Guarding `window.pyry` for renderer-side component tests.** The hook assumes `window.pyry` exists (true under Electron). If a future test renders `<App />` in jsdom without the preload, `window.pyry` is `undefined` and the effect throws. No guard is added now (no such test exists — evidence-based-fix). When `App` first gets a render test, either stub `window.pyry` in the test setup or inject the bridge via a prop/param. Flag at that point, not now.
2. **Where the app-lifetime subscription lives.** This spec mounts it via a hook in `App` (React lifecycle → clean teardown, matching the ticket's "unsubscribe on teardown" AC). An alternative is a module-scope subscription in `main.tsx` (app-lifetime, no teardown). The hook is chosen because the AC explicitly requires a clean unsubscribe and because a hook keeps the wiring inside React's lifecycle where #12 already lives. Revisit only if a non-React entry point ever needs the same feed.
3. **Backfill dedupe (inherited from ADR 0004).** `messagesReceived` appends unconditionally; a re-delivered backfill batch with repeated `message_id`s would double-append. Out of scope here (no reconnect/backfill path exists yet) — owned by whichever ticket wires reconnect. This ticket faithfully translates whatever the channel delivers.
