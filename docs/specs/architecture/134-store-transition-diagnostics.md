# Spec — #134: Log session-store state transitions through the renderer diagnostics channel

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/134
**Size:** S (confirmed — 2 production files, 3 new exports, ~120 LOC total, zero edit fan-out)
**Blocked by:** #131 — MERGED (PR #138). The renderer→main diagnostics channel this consumes is live.
**Security-sensitive:** No label. Skip the security-review pass. (The content-free guarantee is still a first-class design constraint below — see § Content-free contract.)

## Design source

N/A — no UI surface. This is a passive observability instrument on the store's `dispatch`; it renders nothing and changes no pixels. Visual-fidelity review is intentionally out of scope.

## Files to read first

- `src/renderer/src/store/sessionStore.ts` (whole file, 141 lines) — **the file you instrument.** `SessionAction` union (`:39-50`), the pure `reduceSession` (`:96-115`), `createSessionStore` (`:123-128`), the app singleton `sessionStore` (`:131`). The single mutation entry point is the store's `dispatch`; that is the seam.
- `src/shared/ipc/diagnostics.ts:33-100` — `RendererDiagnosticEvent` allowlist (`:33-50`: `event` required; `code?`/`status?`/`bytes?`/`count?`/`host?`/`path?`/`hash?`) and `projectDiagnosticEvent` (`:75-100`), the deterministic main-side net that re-validates the record. Your record must be built only from these fields. `status?` is a **number** (HTTP/WS code), not a status-name string — the connection-status story rides on `code`.
- `src/preload/index.ts:27-38` — `sendDiagnostic(record: RendererDiagnosticEvent): void`. Fire-and-forget, one-way, no reply, no throw path back into the window. This is what `window.pyry.sendDiagnostic` resolves to.
- `src/renderer/src/store/daemonEventBridge.ts:57-64` — dispatch call site #1: `sessionStore.getState().dispatch(translateDaemonEvent(event))`. Confirms daemon-driven actions flow through the singleton's `dispatch`.
- `src/renderer/src/screens/conversation/composerSend.ts:38-68` **and** `ConversationScreen.tsx:56,70-74` — dispatch call site #2 (the local `messageSent` echo). The `dispatch` injected into `submitMessage` is `useSessionStore((s) => s.dispatch)` (`ConversationScreen.tsx:56`) — i.e. the **singleton's** dispatch. So instrumenting the singleton's `dispatch` catches `messageSent` too; you do **not** instrument the bridge or the composer.
- `src/renderer/src/App.test.tsx:23-33` — the `globalThis.window = { pyry: {...} } as unknown as Window & typeof globalThis` stub in `beforeEach` + `Reflect.deleteProperty(globalThis, 'window')` in `afterEach`. **The vitest env is `node` (`vitest.config.ts:17`), so `window` itself is undefined** — not merely `window.pyry`. Your tests follow this idiom; your observer guard must tolerate a genuinely-absent `window`.
- `src/main/diagnosticLog.ts:122-128` — **read-only, do not edit.** Shows the logger owning `seq`: `{ ...fields, seq, ts: now() }` with `seq` strictly monotonic from 0. This is why AC2 forbids a store-supplied sequence number — ordering is the logger's job.

## Context

`sessionStore.ts` is the one store the window renders from. Every state change goes through `dispatch(action: SessionAction)` → the pure `reduceSession`. Actions arrive from exactly two places:

1. the daemon-event bridge (`daemonEventBridge.ts` → `connecting`/`connected`/`disconnected`/`failed`/`messageReceived`/`messagesReceived`), and
2. the local optimistic echo (`composerSend.ts` → `messageSent`).

Today a transition leaves no trace. Bucket 1 of the Diagnostics design lists "state-store transitions" as core content-free diagnostics; #131 shipped the renderer→main channel (`window.pyry.sendDiagnostic`, typed `RendererDiagnosticEvent`). This ticket is that channel's **first consumer**: emit one content-free record per dispatched action so a state-layer fault leaves a footprint in the debug bundle alongside the transport logs.

**Why `dispatch`, not `.subscribe`, not the bridge** (this is the load-bearing design decision — do not deviate):
- **Not zustand `.subscribe`:** it fires only on a *state change*. A duplicate `messageReceived` whose `appendUnique` returns the same array reference (`sessionStore.ts:87`) produces no change → would go unlogged, violating AC3. `.subscribe` also cannot see the action `type` at all.
- **Not the bridge:** `translateDaemonEvent` never sees the local `messageSent` echo (that comes from `composerSend.ts`). Instrumenting the bridge misses it.
- **`dispatch` is the one seam every `SessionAction` flows through**, and it has the action *and* can read the post-reduce state. It is the correct choke point.

## Design

Two production files. The store stays a pure state container; the window/IPC concern lives in a co-located sibling module and is injected as an optional observer.

### New file — `src/renderer/src/store/sessionDiagnostics.ts`

Owns the transition→record mapping and the guarded emit. This is the only place `window.pyry` is touched, so `sessionStore.ts` keeps its documented purity ("Pure renderer state — no IPC, no preload bridge, no transport", `sessionStore.ts:2`).

Two exports (contracts, not bodies):

- `toDiagnosticRecord(action: SessionAction, state: SessionState): RendererDiagnosticEvent`
  Pure. Returns exactly:
  ```ts
  { event: 'store-transition', code: action.type, count: state.messages.length }
  ```
  - `event` — the static transition name (`'store-transition'`, matching the documented example at `diagnostics.ts:34`).
  - `code` — the action `type` (`'messageReceived'`, `'connected'`, …), a static enum member. For status actions this *is* the resulting-status story (1:1 with `ConnectionStatus.type`, modulo the `failed`→`error` naming — documented, not a bug). Content-free by construction.
  - `count` — `state.messages.length` **after** reduce (the "resulting message count" AC1 asks for). Always present; unchanged on status transitions, which is still valid context.
  - **No other fields.** Never `message.text`, ack contents, error `message`, or any payload value. Never a `seq` (the type has no such field — see AC2).

- `logSessionTransition(action: SessionAction, state: SessionState): void`
  The guarded observer — non-throwing by construction (AC5). Contract:
  - Resolve the sender as `typeof window !== 'undefined' ? window.pyry?.sendDiagnostic : undefined`. `typeof` never throws on an undeclared global; the optional chain handles a defined `window` with no `pyry`.
  - If the sender is absent → return (no-op). Otherwise call it with `toDiagnosticRecord(action, state)`.
  - It reads only `action.type` and `state.messages.length` (pure property reads that cannot throw) and the record is plain primitives (always structured-cloneable, so `ipcRenderer.send` cannot throw on it). Non-throwing is therefore structural — **no `try/catch` needed** (evidence-based: no observed throw mode exists; one deterministic guard is the single safety net, not two stochastic layers).

Imports: `import type { SessionAction, SessionState } from './sessionStore'` (type-only — erased at runtime) and `import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'`. The `@shared` alias is available in the renderer (`sessionStore.ts` already uses `@shared/wire/types`).

### Modified file — `src/renderer/src/store/sessionStore.ts`

Add an optional observer injection point and wire the singleton to it. Three small edits:

1. New exported type:
   ```ts
   export type TransitionObserver = (action: SessionAction, state: SessionState) => void
   ```
2. `createSessionStore` gains an optional trailing param and threads `get` so the observer sees post-reduce state:
   ```ts
   export function createSessionStore(
     init: SessionState = initialSessionState,
     observe?: TransitionObserver
   ) {
     return createStore<SessionStore>((set, get) => ({
       ...init,
       dispatch: (action) => {
         set((s) => reduceSession(s, action))
         observe?.(action, get())
       }
     }))
   }
   ```
   `set` is synchronous in zustand, so `get()` immediately after reflects the reduced state. `observe` is optional and **appended after `init`**, so the two existing arg-less callers (`daemonEventBridge.test.ts`, `sessionStore.test.ts`) and the singleton's current `createSessionStore()` are source-compatible — **zero edit fan-out** (verified: only `sessionStore.ts:131` needs the observer wired; every other caller passes no observer and is unaffected).
3. Wire the singleton (the app's one source of truth is the only instance that logs):
   ```ts
   import { logSessionTransition } from './sessionDiagnostics'
   export const sessionStore = createSessionStore(initialSessionState, logSessionTransition)
   ```

**No circular-import hazard:** `sessionStore.ts` imports the *value* `logSessionTransition`; `sessionDiagnostics.ts` imports only *types* back from `sessionStore.ts` (erased). No runtime cycle.

### Data flow

```
daemon event ─► translateDaemonEvent ─┐
                                       ├─► sessionStore.dispatch(action)
composer send ─► messageSent ─────────┘        │
                                               ├─ set(reduceSession)         → state mutated
                                               └─ observe(action, get())     → logSessionTransition
                                                                                    │
                                                          toDiagnosticRecord(action, state)
                                                                                    │
                                              window.pyry?.sendDiagnostic({event,code,count})  ─IPC─►  main projectDiagnosticEvent ─► #126 logger (stamps seq/ts)
```

## Content-free contract

The guarantee is upheld twice (defense in depth, different fabric):
1. **Renderer observer** (this ticket) only ever reads `action.type` + `state.messages.length`. It is structurally incapable of reading a payload value — `toDiagnosticRecord` names the three output fields explicitly.
2. **Main-side `projectDiagnosticEvent`** (#131, already merged) re-validates at the untrusted boundary, rebuilding a fresh allowlisted object and dropping anything else — so even a buggy/compromised renderer cannot leak a field.

The renderer also holds no keys, tokens, or plaintext (CLAUDE.md), so it cannot forward a secret it never receives. This ticket's job is to not *manufacture* a leak from the one payload it does see (the message text on `messageReceived`/`messageSent`).

## State + concurrency model

- No new store slices; state shape is unchanged. The observer is a passive read-after-reduce side effect, invoked synchronously inside `dispatch` after `set`.
- Unidirectional flow preserved: the store still holds state, the window still reads and dispatches, no component two-way-binds into the store. The observer neither reads from nor writes to the UI.
- One record per `dispatch` call ⇒ one record per action (AC3), including same-state reductions (dedup'd duplicate `messageReceived`).
- Emission is fire-and-forget (`ipcRenderer.send`); no promise, no cancellation surface, nothing to tear down.

## Error handling

- **Channel unavailable** (`window`/`window.pyry` absent — the vitest `node` env, or any pre-bridge context): the sender resolves to `undefined`, `logSessionTransition` returns, the store reduces normally. Degrades to a silent no-op; never throws into `dispatch` (AC5).
- **Non-cloneable record:** impossible by construction — the record is `{string, string, number}`. No handling needed.
- No UI surface for this instrument (it is diagnostics-only); failures are invisible by design.

## Testing strategy

New file `src/renderer/src/store/sessionDiagnostics.test.ts` (vitest, `npm test`). Follow `App.test.tsx:23-33` for the `globalThis.window` stub — set it in `beforeEach`, `Reflect.deleteProperty(globalThis, 'window')` in `afterEach` so each test controls whether `window` exists. Reuse the `msg(id, role)` fixture shape from `sessionStore.test.ts`/`daemonEventBridge.test.ts`.

Scenarios (write these as test bodies in the project idiom — do not paste them verbatim):

- **AC1 — record shape (pure):** `toDiagnosticRecord({ type: 'messageReceived', message: msg('m1') }, stateWith1Message)` equals `{ event: 'store-transition', code: 'messageReceived', count: 1 }`. A status action, e.g. `{ type: 'connected', ack }` against a 2-message state, yields `{ event: 'store-transition', code: 'connected', count: 2 }`.
- **AC4 — content-free, asserted against `sendDiagnostic`'s argument (primary):** stub `globalThis.window = { pyry: { sendDiagnostic: vi.fn() } } as unknown as Window & typeof globalThis`. Build a store via `createSessionStore(initialSessionState, logSessionTransition)`, dispatch `{ type: 'messageReceived', message: { …, text: 'PLANTED_SECRET' } }`, then assert the spy was called once and `JSON.stringify(spy.mock.calls[0][0])` contains `'store-transition'`, `'messageReceived'`, `count` — and **not** `'PLANTED_SECRET'`. (Reinforce with the pure `toDiagnosticRecord` variant asserting the same secret-absence, no window needed.)
- **AC3 — one record per action incl. same-state:** with the spy stubbed, dispatch the *same* `messageReceived` (same `message_id`) twice through the store. `appendUnique` drops the second (count stays 1), but the spy is called **twice**; the second record is `{ event: 'store-transition', code: 'messageReceived', count: 1 }`. Asserts the choke-point-not-subscribe decision.
- **AC5 — no-op when channel absent:** with **no** `window` stub (default node env), `expect(() => store.getState().dispatch({ type: 'connecting' })).not.toThrow()` and the store still reduced (`status.type === 'connecting'`). Add a second variant: `globalThis.window = { pyry: {} } as unknown as …` (window defined, no `sendDiagnostic`) → still a no-op, no throw. Calling `logSessionTransition(action, state)` directly under both conditions must also not throw.
- **AC2 — no store-supplied seq:** assert `'seq' in toDiagnosticRecord({ type: 'connecting' }, initialSessionState)` is `false`. The `RendererDiagnosticEvent` type has no `seq` field, so the store cannot emit one; ordering is the logger's (`diagnosticLog.ts:122-128`). This is primarily a type-level guarantee — the runtime assertion documents it.

Type coverage: `npm run typecheck` must pass. The new record is built against `RendererDiagnosticEvent`, so an off-allowlist field is a compile error at the call site. No new type-equality pin is needed (that lives in `diagnostics.test.ts` for the shared type).

**No existing test breaks:** `daemonEventBridge.test.ts` and `sessionStore.test.ts` build isolated stores via `createSessionStore()` (no observer) or call `reduceSession` directly; neither dispatches through the observed singleton. The optional param is source-compatible.

## Open questions

None blocking. One deliberate call recorded for the reviewer: `code` carries the **action type** rather than the resulting connection-status *name*. AC1 permits "action type … and/or connection-status name"; the two are 1:1 for status actions (`connecting`/`connected`/`disconnected`/`failed`→`error`), so the action type is the more direct, uniform signal and covers message actions too (where there is no status change). If a later diagnostics consumer needs the resulting status name distinctly on message transitions, that is an additive follow-up, not a change here.
