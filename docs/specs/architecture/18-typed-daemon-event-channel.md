# Spec — Typed daemon-event channel: shared contract + background emit + preload subscribe (#18)

**Size:** S. Two new production files (`src/shared/ipc/events.ts`, `src/main/emitDaemonEvent.ts`), one modified (`src/preload/index.ts`), plus one unit test. 4 new exported symbols. ~150 total LOC. **Zero consumer cascade** — the session store is untouched; the union's consumers (#19 mapping, #10/#12 emitters) land in later tickets. No edit fan-out.

> Numbering note: `sessionStore.ts`'s doc comments say "#3 translates daemon envelopes … #12 binds the UI." That predates a renumber. "#3" (the typed background↔window channel) was split into **#17** (renderer→main commands), **#18** (this — main→renderer events), and **#19** (translate events → `SessionAction`). Read "#3" in the store as "this channel work." The current ticket numbers are used throughout this spec.

## Files to read first

- `src/renderer/src/store/sessionStore.ts:39-45` — the **`SessionAction`** union (the mapping target). The daemon-event union has exactly one member per arm. Also `ConnectionError` at `:27-31` — the `failed` arm's payload; note the wire↔store relationship below.
- `src/shared/wire/types.ts:56-72,86-90` — `HelloAckPayload`, `MessagePayload`, `MessageChunkPayload`, `ErrorPayload`. **The union reuses these verbatim; do not redefine or drift them.** Confirm none carries a token, key, or raw bytes → that's the AC4 guarantee, by construction.
- `src/shared/wire/types.ts:16-22,92-98` — `InnerFrameV2` (base64 `data`) and `QrPayload` (`token`, `server_static_pubkey`). **These are the types the union must NOT reference.** Read them to know exactly what AC4 excludes.
- `src/preload/index.ts` (whole file, 20 lines) — the existing `window.pyry` bridge. `onDaemonEvent` is **added to the `api` object**; `PyryApi = typeof api` flows the new method's type automatically. Preserve the `process.contextIsolated` guard and the `exposeInMainWorld('pyry', …)` shape.
- `src/preload/index.d.ts` (7 lines) — the `Window.pyry` global augmentation. **Unchanged** — read only to confirm it re-exports `typeof api`, so the renderer sees `window.pyry.onDaemonEvent` typed with no edit here.
- `src/main/index.ts:8-20` — `mainWindow.webContents`. The emit helper's structural sink models `webContents.send`. **#18 does NOT modify this file** (there is no transport to emit yet — the helper is the seam #10/#12 call). Note the `sandbox: false` setting for the security review.
- **`tsconfig.node.json` and `tsconfig.web.json`** — the load-bearing gotcha. `tsconfig.node.json` (covers `src/main`, `src/preload`, `src/shared`) has **no `@shared` path alias**; only `tsconfig.web.json` (renderer) does. `electron.vite.config.ts` likewise aliases `@shared` only in the `renderer` block. **Therefore `src/main/emitDaemonEvent.ts` and `src/preload/index.ts` must import the shared module by RELATIVE path (`../shared/ipc/events`), never `@shared/ipc/events`** — the latter fails both the node typecheck and the main/preload build. The renderer (#19) uses `@shared/ipc/events`, which resolves.
- `src/shared/wire/types.test.ts` (17 lines) — the vitest constant-pinning idiom (`describe`/`it`/`expect`, node env). Mirror it for the channel-constant test.
- `vitest.config.ts` — node environment; `@shared`/`@renderer` aliases available **in tests** (vitest config aliases them regardless of the node tsconfig). So test files may use `@shared/...`; production `src/main`/`src/preload` files may not.
- `docs/knowledge/decisions/0004-renderer-session-store-reducer-wire-types.md` — the `SessionAction`/`ConnectionError` rationale this channel dispatches into. The `failed → ErrorPayload → ConnectionError` seam continues it.
- `CLAUDE.md` (repo root) — *Keep the transport out of the window*, *Sealed event shapes on a `type` discriminant*, *No crypto/sockets/tokens in the renderer*, *Test-first*.

> Codegraph is not initialized for this repo (`mcp__codegraph__*` errors here); this reading list was built by hand from the store, the wire types, and the preload surface.

## Context

The connect-send-stream milestone needs the background process — where the Noise transport will live ([0001](../../knowledge/decisions/0001-stack-electron-react-typescript.md)) — to hand **already-typed** events to the React window without the renderer ever holding a socket, key, or raw frame. This ticket builds the **event-pipe half** of the background→window bridge:

1. a **sealed daemon-event union** in a new shared IPC module, one member per `SessionAction` arm, each reusing the wire payload types;
2. a **background emit helper** — the single, typed path an event takes to the renderer;
3. a **preload subscription** on `window.pyry` that delivers typed events and returns an unsubscribe handle, without ever exposing `ipcRenderer`.

No transport is wired here. The union's **producers** are #10 (hello/hello-ack) and #12 (render reply), which will call the emit helper; its **consumer** is #19, which maps the union onto `SessionAction`. #17 (renderer→main commands) extends the same `src/shared/ipc/` module and the same `window.pyry` object — this spec keeps both additive and conflict-free.

There is no `## Figma` section in the ticket and no rendered component in #18 — the channel has no visual surface. No Design source section applies.

## Design

### Module layout

The "new shared IPC module beside `src/shared/wire/`" (per the ticket) is the **directory `src/shared/ipc/`**, mirroring how `src/shared/wire/` is the wire module. #18 creates one file in it; #17 later adds its command file (`commands.ts`) or extends — the directory is the shared surface both sides import.

| File | Status | Purpose |
|---|---|---|
| `src/shared/ipc/events.ts` | **new** | `DaemonEvent` union + `DAEMON_EVENT_CHANNEL` constant. Imported by both process sides. |
| `src/main/emitDaemonEvent.ts` | **new** | `emitDaemonEvent(sink, event)` — the one path to the renderer. Plain-Node testable (no `electron` import). |
| `src/preload/index.ts` | **modified** | add `onDaemonEvent` to the `api` object. |
| `src/main/emitDaemonEvent.test.ts` | **new** | unit test against a structural fake window. |
| `src/shared/ipc/events.test.ts` | **new** | pins `DAEMON_EVENT_CHANNEL` (constant idiom). |
| `src/preload/index.d.ts` | untouched | `PyryApi = typeof api` flows `onDaemonEvent` automatically. |
| `src/main/index.ts` | untouched | no live emitter yet; helper is the seam #10/#12 call. |

### 1. The sealed union (`src/shared/ipc/events.ts`) — contract

Imports use the **relative** path within `shared`: `import type { HelloAckPayload, MessagePayload, ErrorPayload } from '../wire/types'`.

```ts
/** The IPC channel every typed daemon event travels on, main → renderer.
 *  Single source of truth: the emit helper sends on it, the preload subscribes
 *  to it. A mismatch would silently drop every event, so both sides reference this. */
export const DAEMON_EVENT_CHANNEL = 'pyry:daemon-event' as const

/** A single typed event from the background process to the renderer window.
 *  Sealed discriminated union on `type`, one member per session-store SessionAction
 *  arm (connecting | connected | disconnected | failed | messageReceived | messagesReceived).
 *  Spans transport-lifecycle events (connecting/disconnected, emitted by the transport
 *  supervisor) and daemon-originated events (connected/failed/messages, derived from
 *  validated wire envelopes). Carries ONLY the wire payload types — never a token, key,
 *  or raw frame (AC4). */
export type DaemonEvent =
  | { type: 'connecting' }
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'disconnected' }
  | { type: 'failed'; error: ErrorPayload }
  | { type: 'messageReceived'; message: MessagePayload }
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] }
```

Member-by-member rationale (these are the architect's calls the ticket delegates):

- **Names mirror `SessionAction` arm names 1:1**, and the payload field names match too (`ack`, `error`, `message`, `messages`). This makes AC1's "no gaps, no spares" self-evident at a glance and makes #19's mapping nearly an identity. The two types remain **separately declared in separate layers** (`DaemonEvent` in `shared/ipc`, `SessionAction` in the renderer store) — the IPC contract can evolve independently of the store's action vocabulary. The 1:1 correspondence is a convenience for #19, not a coupling.
- **`connected.ack: HelloAckPayload`** — the wire `hello_ack` payload, reused verbatim; #19 passes it straight to `SessionAction.connected.ack` (same type).
- **`failed.error: ErrorPayload`** — the wire error payload. `SessionAction.failed` carries the renderer-owned `ConnectionError`, which is **structurally identical** to `ErrorPayload` (`{ code, message, retryable }`). #19 maps `ErrorPayload → ConnectionError` with a trivial field copy. Transport-level failures with no wire envelope (silent Noise-handshake failure, dropped socket — detected in #4/#7) are emitted by **synthesizing** a valid `ErrorPayload`, e.g. `{ code: 'transport' | 'handshake', message, retryable }` — see [0004](../../knowledge/decisions/0004-renderer-session-store-reducer-wire-types.md), which defined `ConnectionError` for exactly this. The union stays wire-typed per AC1; the store-owned shape is #19's boundary.
- **`messagesReceived.messages: readonly MessagePayload[]`** — the batch carries **complete messages, not partial tokens** (mirrors the wire `message_chunk` / `MessageChunkPayload.messages` — a backfill batch). The member flattens to the `messages` array so it matches `SessionAction.messagesReceived.messages` field-for-field; #19 maps it as an identity. `MessageChunkPayload` is the corresponding wire envelope but is not itself a member (its only field is `messages`, which the member carries directly). `readonly` is a compile-time signal that consumers must not mutate; it is erased across the IPC structured-clone boundary (harmless).

**AC4 is enforced by the type, not by a convention.** The union references only `HelloAckPayload`, `ErrorPayload`, `MessagePayload` — none of which has a token, key, or raw-byte field. `QrPayload` (token, `server_static_pubkey`), `HelloClientPayload` (token), and `InnerFrameV2` (base64 `data`) are **not** members and must never become members. A developer cannot put a token on the wire here because no member has a field to hold one — a deterministic, compile-checked guarantee.

### 2. The emit helper (`src/main/emitDaemonEvent.ts`) — contract

Imports by **relative** path (no `@shared` in the node tsconfig): `import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'`. **No `electron` import** — the helper is structural, so its test runs in plain Node.

```ts
/** The minimal window surface the emitter needs. A real Electron BrowserWindow
 *  satisfies this structurally (its webContents.send accepts (channel, ...args));
 *  the unit test passes a fake `{ webContents: { send: vi.fn() } }`. */
export interface DaemonEventSink {
  webContents: { send(channel: string, event: DaemonEvent): void }
}

/** The one and only path a typed event takes from the background process to the
 *  renderer. Transport code (#10/#12) calls this; nothing else sends on the channel.
 *  A pure forwarder: sends `event` on DAEMON_EVENT_CHANNEL. No transform, no logging. */
export function emitDaemonEvent(sink: DaemonEventSink, event: DaemonEvent): void
```

Behavior (one line): `sink.webContents.send(DAEMON_EVENT_CHANNEL, event)`.

- **Structural sink, not `BrowserWindow`.** Typing the parameter as `DaemonEventSink` (only `webContents.send`) is what makes it plain-Node testable with no Electron harness — exactly the ticket's testing note. A real `mainWindow` is assignable (`BrowserWindow.webContents.send(channel, ...args: any[])` is assignable to the narrower `send(channel, event: DaemonEvent)`).
- **`send`'s second param typed `DaemonEvent`.** The sink's `send` accepts only a `DaemonEvent`, so `emitDaemonEvent` cannot be called with an arbitrary payload — a second type-level backstop for AC2/AC4.
- **Pure forwarder — no logging, no transform.** Message bodies (`MessagePayload.text`) pass through; the helper must not `console.log` the event (would leak message bodies to main-process stdout — see Security review §7).
- **Window-lifecycle guard is deliberately out of scope.** `webContents.send` on a destroyed window throws; there is no live window/transport in #18 to observe this, so per evidence-based-fix no `isDestroyed()` guard is added, and the structural sink stays minimal (just `send`). Lifecycle ownership belongs to the composition root when #10/#12 wire a real window — see Open questions.

### 3. The preload subscription (`src/preload/index.ts`) — contract

Add one method to the existing `api` object. Import by **relative** path: `import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'` and `type IpcRendererEvent` from `electron`. Keep `ping` and the `contextIsolated` guard unchanged.

Method signature added to `api`:

```ts
/** Subscribe to typed daemon events. Returns an unsubscribe handle.
 *  ipcRenderer never crosses the bridge — only this typed callback surface does. */
onDaemonEvent(listener: (event: DaemonEvent) => void): () => void
```

Required behavior (the developer writes the ~4-line body in the preload idiom):

- Registers a wrapper `handler(_e: IpcRendererEvent, event: DaemonEvent)` via `ipcRenderer.on(DAEMON_EVENT_CHANNEL, handler)`. **The `IpcRendererEvent` first argument is stripped** — the wrapper calls `listener(event)` only. The renderer must never receive the raw ipc event object (it exposes `.sender`, `.ports` — a capability leak). Security review §4.
- Returns an unsubscribe closure that calls `ipcRenderer.removeListener(DAEMON_EVENT_CHANNEL, handler)` with **the exact same `handler` reference** — so the returned handle removes precisely the listener it added (no leak, no double-fire). AC3, Security review §8.
- `ipcRenderer` stays inside the preload module; only `onDaemonEvent` is added to `api`. `PyryApi = typeof api` flows the method's type to `window.pyry` through the untouched `index.d.ts`. AC3.
- The subscription is **receive-only** — it adds no `ipcRenderer.send`/`invoke` and no `ipcMain` handler, so it grants the renderer no new command capability toward the background process (that is #17). Security review §4/§9.

### Data flow

```
 #10/#12 transport (later)          emitDaemonEvent            preload bridge              #19 (later)
 wire Envelope ──validate/parse──►  emitDaemonEvent(win, e) ──► webContents.send ──IPC──► onDaemonEvent(cb)
   hello_ack/message/error          (the ONLY send path)        DAEMON_EVENT_CHANNEL       cb(DaemonEvent)
                                                                 ipcRenderer.on(strip e)   → map → sessionStore.dispatch(SessionAction)
```

`emitDaemonEvent` is the single choke point outbound; `onDaemonEvent` is the single subscription inbound. Neither #18 file parses raw bytes — parsing/validation of hostile daemon input happens **upstream** in #5 (codec) / #10 (hello), before a `DaemonEvent` is ever constructed. #18 forwards already-typed, already-validated events.

## State + concurrency model

- **No store, no async work in #18.** The emit helper is synchronous; the preload subscription registers a listener and returns. No timers, no sockets, no `AbortController` here — those belong to the transport (#4/#7).
- **Subscription lifecycle is the one concurrency contract.** `onDaemonEvent` returns an unsubscribe handle; the renderer subscriber (#19/#12) **must** call it in a `useEffect` cleanup so listeners don't accumulate across remounts (duplicate dispatch + leak). #18's obligation: return an unsubscribe that removes the exact handler. Renderer-side cleanup is named as #19/#12's responsibility, not built here.
- **Multiple subscribers allowed.** Each `onDaemonEvent` call registers its own handler and returns its own unsubscribe; they are independent. Intended.

## Error handling

- **The emit helper does not catch.** It is a pure forwarder; a throw from `webContents.send` (e.g. destroyed window, once a real window exists) propagates to the caller (#10/#12), which owns window lifecycle. No swallow, no log. See Open questions for the destroyed-window guard deferral.
- **The preload wrapper does not transform errors.** It forwards the typed event; there is no failure mode inside `onDaemonEvent` beyond registration itself.
- **Failure *events* are data, not exceptions.** A connection failure travels as `{ type: 'failed'; error: ErrorPayload }` — the transport constructs it (wire `error` fields copied, or synthesized `code: 'transport'|'handshake'`), emits it via `emitDaemonEvent`, and #19 maps it to `SessionAction.failed`. #18 provides the member; it does not originate the error.
- **No user-facing surface in #18.** Banner/dialog rendering of `status.error` is #12/#19.

## Testing strategy

`npm test` (vitest, node env) for the emit helper; `npm run build` / `npm run typecheck` for the union and the contextBridge wiring (per the ticket's testing note). Test-first: write these RED before the modules exist. Scenarios (developer writes assertions in the wire-test idiom — bullets, not pre-written bodies):

- **Emit helper — `src/main/emitDaemonEvent.test.ts`** (structural fake, `vi.fn()` spy on `send`; no Electron):
  - Calling `emitDaemonEvent(fake, event)` calls `fake.webContents.send` **exactly once**, with `DAEMON_EVENT_CHANNEL` as the first arg and the **same `event` reference** as the second (pure forward, no clone/transform).
  - Cover a representative event per shape: a lifecycle event (`{ type: 'connecting' }`), a payload-bearing event (`{ type: 'connected', ack }`), and a batch (`{ type: 'messagesReceived', messages: [...] }`) — asserting the payload passes through unchanged.
  - The channel argument equals the exported `DAEMON_EVENT_CHANNEL` (not a hard-coded string in the test — import it), so a channel rename can't silently pass.
- **Channel constant — `src/shared/ipc/events.test.ts`** (mirrors `wire/types.test.ts`): `DAEMON_EVENT_CHANNEL` equals `'pyry:daemon-event'`. Pins the string both sides depend on.
- **Type-level (`npm run typecheck`, no runtime):**
  - Each union member's payload is a wire type (compile-checked by construction — reusing `../wire/types`).
  - `onDaemonEvent` appears on `PyryApi` / `window.pyry` typed as `(listener: (event: DaemonEvent) => void) => () => void` (flows via `typeof api`).
  - **Optional, recommended** — a renderer-side type-only check that `DaemonEvent['type']` and `SessionAction['type']` are the **same discriminant set** (a mapped-type `Record<DaemonEvent['type'], true>` cross-checked against `SessionAction['type']`). It belongs in the renderer (which may import both `@shared/ipc/events` and the local store — this does not make `shared` import `renderer`). Marked optional because #19's exhaustive mapping switch is the deterministic enforcement of AC1's "no gaps/no spares"; include it here only as an early tripwire, and keep it type-only.

The contextBridge/preload wiring itself is intentionally **not** unit-tested (no Electron harness) — `npm run build` + `npm run typecheck` cover it, per the ticket.

## Open questions

1. **Destroyed-window guard.** Once #10/#12 wire a real `mainWindow`, `emitDaemonEvent` may fire during teardown and `webContents.send` will throw on a destroyed window. #18 defers the `isDestroyed()` guard (no live emitter to observe it; evidence-based-fix). The composition root that owns the window (main/index.ts, when the transport lands) should either guard before emitting or the helper gains an `isDestroyed?()` check on the sink then. Flag when #10 wires the first emitter.
2. **`connected.ack` width.** The member carries the whole `HelloAckPayload` (drift-free from #10's `hello_ack`). Narrow to `{ server_id, conn_id }` later only if #19/#12 prove the UI needs less — mirrors [0004](../../knowledge/decisions/0004-renderer-session-store-reducer-wire-types.md)'s deferral.
3. **Runtime shape validation at the preload.** The producer is our own trusted main process, so no `zod`-style validator is added (a compromised main process is already game-over; adding one would pull in a dependency for defense against a bug, not an attacker). Revisit only if a future, less-trusted producer ever sends on this channel. See Security review §4.
4. **`src/shared/ipc/` file split with #17.** #17 (renderer→main commands) extends this module. Recommended seam: a sibling `src/shared/ipc/commands.ts` with its own `COMMAND_CHANNEL`, so #18 and #17 never edit the same file (conflict-free even if run near-simultaneously). #17's architect owns the final call; this spec only reserves the directory.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. The single boundary is the IPC channel `DAEMON_EVENT_CHANNEL`, crossed **main → renderer only**. The emit helper (`src/main/emitDaemonEvent.ts`) is the sole send path; the preload `onDaemonEvent` is the sole receive path. #18 parses **no** raw daemon bytes — it forwards already-typed `DaemonEvent`s built upstream by #5 (codec) / #10 (hello) from validated wire envelopes. Assumption named: payloads reaching `emitDaemonEvent` are already-validated wire types; validation of hostile daemon input is enforced upstream (#5/#10), not here.
- **[Tokens, secrets, credentials]** No findings. AC4 is enforced **by the type, not a convention**: the union references only `HelloAckPayload` / `ErrorPayload` / `MessagePayload`, none of which has a token, key, or raw-byte field. `QrPayload` (token, `server_static_pubkey`), `HelloClientPayload` (token), and `InnerFrameV2` (base64 frame `data`) are **not** members and must not become members — a developer cannot serialise a token here because no member holds one. `MessagePayload.text` (message body) does cross to the renderer — that is the product (messages are displayed), not a leak; it must not be logged (see §7).
- **[File / storage operations]** N/A — #18 performs no filesystem or storage I/O.
- **[Inter-process / Electron attack surface]** No MUST FIX for #18's additions.
  - The added surface is **receive-only**: `onDaemonEvent` calls `ipcRenderer.on` and returns an unsubscribe; it adds no `ipcRenderer.send`/`invoke` and no `ipcMain` handler, so it grants the renderer **zero** new command capability toward the transport/keys (the command direction is #17).
  - `ipcRenderer` is **never** exposed — only the typed `onDaemonEvent` callback goes on `window.pyry` (AC3). The raw `IpcRendererEvent` first arg is **stripped** in the preload wrapper before the renderer's listener is called (it exposes `.sender`/`.ports` — withholding it prevents a capability leak).
  - **SHOULD FIX / OUT OF SCOPE — `sandbox: false`.** `src/main/index.ts:17` sets `sandbox: false` (pre-existing scaffold value; #18 does not touch this file). With `contextIsolation: true` + `nodeIntegration: false` (Electron 33 default) the page is still walled from Node, so #18's receive-only channel is **not exploitable as designed** via this setting — hence not a MUST FIX for #18. But it should be hardened: our entire bridge surface (`contextBridge`, `ipcRenderer.on/removeListener/invoke`) is fully compatible with `sandbox: true`. Route to a dedicated hardening ticket (or fold into #17, which also touches the bridge); do **not** expand #18 to flip it (respects the "don't refactor adjacent code" rule).
- **[Cryptographic primitives]** N/A — no crypto, RNG, or handshake in #18. `DAEMON_EVENT_CHANNEL` is a static, non-secret string, not security-relevant randomness.
- **[Network & I/O]** N/A — no socket, relay, or `ws` in #18; those belong to #4/#7.
- **[Error messages, logs, telemetry]** No findings, one guardrail. #18 adds **no logging**. The emit helper and preload wrapper must stay log-free — a `console.log(event)` in either would leak `MessagePayload.text` (message bodies) to main-process stdout or the renderer DevTools console. Called out for the developer and code-review.
- **[Concurrency]** No MUST FIX. The one contract: `onDaemonEvent` must return an unsubscribe that calls `removeListener` with the **exact handler** it registered (no listener leak / double-fire). Renderer-side cleanup (calling the handle in a `useEffect` teardown) is #19/#12's responsibility, named here. No long-lived async task, timer, or socket is introduced by #18.
- **[Threat model alignment]** The desktop threat this design advances: **a compromised renderer cannot reach the transport, keys, or socket through #18** — the channel is receive-only and exposes only typed events, so a script-injection/supply-chain bug in the renderer gains no command capability here. **Hostile-daemon** malformed/oversized input is caught **upstream** (#5 codec / #10 hello) before a `DaemonEvent` exists; #18 assumes validated input and names #5/#10 as the enforcers. **Malicious relay** (drop/delay/reorder) and **token-theft-from-disk** are out of scope for #18 (no socket, no disk) — owned by #4/#7 and #8 respectively.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-03
