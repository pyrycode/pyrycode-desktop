# Spec — Typed command channel: window → background process (#17)

**Size:** S. Two new production files (`src/shared/ipc/commands.ts`, `src/main/receiveCommand.ts`), one modified (`src/preload/index.ts`, additive), plus two unit-test files. Six new exported symbols — but only **two are type-level** (`RendererCommand`, `CommandSource`); the other four are a const, two pure functions, and one receiver. ~210 total LOC. **Zero consumer cascade** — nothing existing calls the new surface; `PyryApi = typeof api` flows `sendCommand` to `window.pyry` automatically and `src/preload/index.d.ts` is untouched. No edit fan-out.

> **Numbering note.** #17/#18/#19 were split from an earlier "#3" (the typed background↔window channel). #18 (merged) shipped the **event** half (background → window); #19 (merged) maps those events onto `SessionAction`. **This ticket (#17) is the mirror-image command half (window → background).** The session-store doc comments still say "#3 translates … #12 binds" — read "#3" as "this channel work." #11 (composer submit → send-message envelope) and the transport (#4/#7) are the future **consumers** of the seam #17 builds; neither is wired here.

## Files to read first

> Codegraph is not initialized for this repo (`mcp__codegraph__*` errors here — see project memory); this reading list was built by hand from the merged #18 sibling, the wire types, and the preload surface.

- **`docs/specs/architecture/18-typed-daemon-event-channel.md`** — the **sibling spec #17 mirrors**. #17 is its reverse-direction twin. Read it first for the shared conventions (structural fakes, relative-import discipline, AC-by-construction, the `sandbox:false` note) and to keep the two conflict-free. **The one place #17 must NOT copy #18 is the trust-boundary reasoning** — see § Security review below (#18's producer is trusted main; #17's producer is the *untrusted* renderer).
- `src/shared/ipc/events.ts` (whole, 38 lines) — the exact structural sibling: channel constant + sealed union + **relative** import of wire payloads (`../wire/types`). `commands.ts` is its twin (constant + union + a pure constructor + a runtime guard).
- `src/main/emitDaemonEvent.ts` (whole, 25 lines) — the sibling `src/main` seam. `receiveCommand.ts` mirrors it: **structural injected dependency** (there `DaemonEventSink`, here `CommandSource`), **no `electron` import** (plain-Node testable), reverse direction (outbound `webContents.send` → inbound `ipcMain.on`).
- `src/main/emitDaemonEvent.test.ts` (whole, 54 lines) — the **structural-fake + `vi.fn()` spy** idiom to mirror for `receiveCommand.test.ts`. No Electron harness.
- `src/shared/ipc/events.test.ts` (whole, 10 lines) — the channel-constant-pinning idiom to mirror for `commands.test.ts`.
- `src/preload/index.ts` (whole, 36 lines) — the `api` object + `onDaemonEvent`. **`sendCommand` is added to `api` exactly the way `onDaemonEvent` was.** Preserve `ping`, `onDaemonEvent`, and the `process.contextIsolated` guard. `ipcRenderer` stays inside this module — only the typed method goes on `api`.
- `src/preload/index.d.ts` (7 lines) — **untouched.** Read only to confirm `Window.pyry = PyryApi = typeof api`, so `window.pyry.sendCommand` is typed with no edit here.
- `src/shared/wire/types.ts:74-78` — **`SendMessagePayload`** (`conversation_id`, `message_id`, `text`). The send-message command reuses this **verbatim**; do not redefine or drift it.
- `src/shared/wire/types.ts:46-54,92-98` — `HelloClientPayload` (`token`) and `QrPayload` (`token`, `server_static_pubkey`). **These are the types the command must NOT reference** — read them to know exactly what AC5 excludes.
- `src/renderer/src/store/daemonEventBridge.ts` (whole, 64 lines) — the **#19 pure-function pattern** (`translateDaemonEvent`): a pure, exhaustive, unit-tested choke point with an `assertNever` exhaustiveness guard. `sendMessageCommand` is its outbound analog; `isRendererCommand` is the boundary-validation analog. **Read for the pattern only — #17 does not modify this file** (the React wiring that *calls* `sendMessageCommand` is #11's composer, out of scope here).
- `src/main/index.ts:8-19` — the composition root and `sandbox: false` at line 17 (security-review input). **#17 does NOT modify this file** — there is no live receiver to wire until #11/the transport lands; `onCommand` is the seam they will call.
- **`tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`** — the load-bearing gotcha. `src/main` and `src/preload` have **no `@shared` path alias** (only the renderer does). **Therefore `src/main/receiveCommand.ts` and `src/preload/index.ts` must import the shared module by RELATIVE path (`../shared/ipc/commands`), never `@shared/ipc/commands`** — the alias fails the node typecheck and the main/preload build. (See project memory: "@shared alias not in main/preload".) The renderer consumer #11 uses `@shared/ipc/commands`, which resolves. Test files may use `@shared/...` (vitest aliases them regardless of the node tsconfig).
- `docs/knowledge/decisions/0001-stack-electron-react-typescript.md`, `docs/knowledge/decisions/0004-renderer-session-store-reducer-wire-types.md` — stack rationale and the session-store/wire-types relationship this channel feeds into.
- `CLAUDE.md` (repo root) — *Keep the transport out of the window*, *No crypto/sockets/tokens in the renderer*, *Sealed event shapes on a `type` discriminant*, *Unidirectional state*, *Test-first*, *Don't refactor adjacent code*.

## Context

The connect-send-stream milestone needs the React window to hand **user commands** to the background process — where the Noise transport will live — as typed, discriminated-union messages, without the window ever holding a socket, transport handle, or key material. #18 built the **event** half (background → window, typed `DaemonEvent`). This ticket builds the **command** half (window → background), the exact reverse:

1. a **sealed command union** in a new shared IPC module (`src/shared/ipc/commands.ts`), whose first member is a send-message command reusing `SendMessagePayload`; plus a **pure constructor** (`sendMessageCommand`) and a **runtime boundary guard** (`isRendererCommand`);
2. a **preload sender** (`sendCommand`) on `window.pyry` that ships a typed command over IPC, without ever exposing `ipcRenderer`;
3. a **background receiver seam** (`onCommand`) that validates the incoming command at the untrusted→trusted boundary and surfaces it to a single handler-registration point.

**No transport is wired here.** The command's future **producer** is #11 (composer submit); its future **consumer** is #11/the transport (#4/#7), which will register a handler on `onCommand` and build a `send_message` `Envelope`. #17 establishes the typed surface and the boundary check only. The command union is shaped so later transport commands (connect, disconnect) extend it **additively** — the ticket is deliberately narrow: **one** send-message command grounded in #11, no pre-built connect/disconnect taxonomy (evidence-based; avoids an unused surface).

There is no `## Figma` section in the ticket and no rendered component in #17 — the channel has no visual surface. No Design source section applies.

## Design

### Module layout

`src/shared/ipc/` is the shared IPC surface both process sides import (created by #18 for `events.ts`). #18 reserved `commands.ts` as the seam for exactly this ticket (#18 Open question 4), so **#18 and #17 never edit the same file** — conflict-free even run near-simultaneously.

| File | Status | Purpose |
|---|---|---|
| `src/shared/ipc/commands.ts` | **new** | `RendererCommand` union + `COMMAND_CHANNEL` constant + `sendMessageCommand` (pure constructor) + `isRendererCommand` (runtime boundary guard). Imported by both process sides. |
| `src/main/receiveCommand.ts` | **new** | `onCommand(source, handler)` — the single inbound seam; validates at the boundary. Plain-Node testable (no `electron` import). |
| `src/preload/index.ts` | **modified** | add `sendCommand` to the `api` object. |
| `src/shared/ipc/commands.test.ts` | **new** | pins `COMMAND_CHANNEL`; unit-tests `sendMessageCommand` and `isRendererCommand`. |
| `src/main/receiveCommand.test.ts` | **new** | unit-tests the receiver against a structural fake source. |
| `src/preload/index.d.ts` | untouched | `PyryApi = typeof api` flows `sendCommand` automatically. |
| `src/main/index.ts` | untouched | no live receiver yet; `onCommand` is the seam #11/transport call. |

### Naming

`DaemonEvent` names its **producer** (the daemon). The command's producer is the renderer/window, so the mirror name is **`RendererCommand`**. Greppable, unambiguous, no DOM/global collision, and it reads clearly at every call site (`onCommand(source, (command: RendererCommand) => …)`, `sendCommand(command: RendererCommand)`). The channel constant is **`COMMAND_CHANNEL = 'pyry:command'`**, mirroring `DAEMON_EVENT_CHANNEL = 'pyry:daemon-event'`.

### 1. The sealed union + constructor + guard (`src/shared/ipc/commands.ts`) — contract

Imports use the **relative** path within `shared`: `import type { SendMessagePayload } from '../wire/types'`.

```ts
/** The IPC channel every typed renderer command travels on, renderer → main.
 *  Single source of truth: the preload sender ships on it, the main receiver listens on it. */
export const COMMAND_CHANNEL = 'pyry:command' as const

/** A single typed command from the renderer window to the background process. Sealed
 *  discriminated union on `type`. First (and, per #17, only) member: send-message, whose
 *  `payload` reuses the wire SendMessagePayload verbatim so no field is remapped between
 *  layers. Carries ONLY wire payload types — never a token, key, or raw frame (AC5).
 *  Extend additively (connect/disconnect) when their transport tickets land. */
export type RendererCommand =
  | { type: 'sendMessage'; payload: SendMessagePayload }

/** Wrap already-assembled send-message fields into a well-formed command. Pure: it does
 *  NOT generate the message_id (that needs randomness — #11's composer does it and passes
 *  the assembled SendMessagePayload in). The return type guarantees a valid command shape;
 *  an unknown `type` cannot compile (AC4). */
export function sendMessageCommand(fields: SendMessagePayload): RendererCommand

/** Runtime type guard for the untrusted renderer→main boundary. True iff `value` is a
 *  structurally valid RendererCommand (known `type`, payload with string conversation_id /
 *  message_id / text). Co-located with the union so the two evolve in lockstep. Pure;
 *  never throws. */
export function isRendererCommand(value: unknown): value is RendererCommand
```

- **`sendMessageCommand`** returns `{ type: 'sendMessage', payload: fields }` — a one-line pure wrap, the tested factory AC4 requires. It reuses `SendMessagePayload` verbatim (ticket note). The compile-time guarantee ("unknown command shape → compile error", AC4) is inherent to the `RendererCommand` return type: a member with an unmodelled `type` will not type-check. `message_id` generation is **not** here (would break purity) — see Open question 3.
- **`isRendererCommand`** is the boundary validator. Minimum structural checks: `value` is a non-null object; `value.type === 'sendMessage'`; `value.payload` is a non-null object with `typeof … === 'string'` for `conversation_id`, `message_id`, and `text`. It accepts commands with extra/unknown fields (structural minimum — do not reject on excess) and rejects everything else. As the union grows, add a case per new `type`; a union member the guard doesn't check would be **silently dropped at the boundary** (Open question 2). Prefer a `switch (value.type)` shape so a missing case is visible.
- **AC5 by construction:** the union references only `SendMessagePayload` (`conversation_id`, `message_id`, `text`) — no token/key/byte field. `HelloClientPayload` (`token`), `QrPayload` (`token`, `server_static_pubkey`), and `InnerFrameV2` (base64 `data`) are **not** members and must never become members. A developer cannot put a secret on this channel because no member has a field to hold one.

### 2. The receiver seam (`src/main/receiveCommand.ts`) — contract

Imports by **relative** path: `import { COMMAND_CHANNEL, isRendererCommand, type RendererCommand } from '../shared/ipc/commands'`. **No `electron` import** — the source is injected structurally, so the test runs in plain Node (mirrors `emitDaemonEvent.ts`).

```ts
/** The minimal main-process surface the receiver needs. Electron's `ipcMain` satisfies this
 *  structurally (its `.on(channel, listener)` / `.removeListener(...)` accept a
 *  `(event, ...args)` listener); the unit test passes a fake `{ on: vi.fn(),
 *  removeListener: vi.fn() }`, so no Electron harness is required. `event`/`command` are
 *  typed `unknown` on purpose — the first arg is stripped, the second is validated. */
export interface CommandSource {
  on(channel: string, listener: (event: unknown, command: unknown) => void): void
  removeListener(channel: string, listener: (event: unknown, command: unknown) => void): void
}

/** Register the single inbound handler for renderer commands. Returns an unsubscribe handle
 *  that removes the exact listener it added. Validates each incoming command at the
 *  untrusted→trusted boundary: only shape-valid commands reach `handler`; malformed input is
 *  dropped. The IpcMainEvent first arg is never forwarded. */
export function onCommand(
  source: CommandSource,
  handler: (command: RendererCommand) => void
): () => void
```

Required behavior (developer writes the ~8-line body in the seam idiom):

- Registers a wrapper `listener(_event, raw)` via `source.on(COMMAND_CHANNEL, listener)`. **The `IpcMainEvent` first argument is stripped** — the wrapper never forwards it (it exposes `.sender` / `.reply` / `.senderFrame` / `.ports` — a capability leak; Security review §4).
- Applies `isRendererCommand(raw)`. If **valid** → `handler(raw)` (now safely typed `RendererCommand` — the type is *honest* because the guard ran). If **invalid** → **drop** (do not call `handler`). Recommended: a single `console.warn` with a **fixed string and NO renderer data** (e.g. `'pyry:command — dropped malformed command'`) for observability; never log `raw` (Security review §7).
- Returns an unsubscribe closure that calls `source.removeListener(COMMAND_CHANNEL, listener)` with **the exact same `listener` reference** — so the handle removes precisely the listener it added (AC3, no leak/double-fire; mirrors `onDaemonEvent`).
- **Injected `source`, not an imported `ipcMain`.** Keeping `ipcMain` out of this module is what makes it electron-free and unit-testable with a fake — exactly like `emitDaemonEvent` injects the sink. The composition root (`src/main/index.ts`) will call `onCommand(ipcMain, handler)` when #11/the transport lands; a real `ipcMain` is structurally assignable to `CommandSource` (verified by `npm run typecheck` at that call site — deferred, not exercised in #17).

### 3. The preload sender (`src/preload/index.ts`) — contract

Add one method to the existing `api` object. Import by **relative** path: `import { COMMAND_CHANNEL, type RendererCommand } from '../shared/ipc/commands'`. Keep `ping`, `onDaemonEvent`, and the `contextIsolated` guard unchanged.

```ts
/** Ship a typed command to the background process. Fire-and-forget (no reply); the
 *  daemon's response arrives later as typed events over the #18 channel. ipcRenderer never
 *  crosses the bridge — only this typed function does; the channel is fixed here so the
 *  renderer cannot address arbitrary channels. */
sendCommand(command: RendererCommand): void
```

Required behavior: `ipcRenderer.send(COMMAND_CHANNEL, command)`.

- **Fire-and-forget `send`, not `invoke`.** Commands need no synchronous reply — results return as separate `DaemonEvent`s (#18). Using `send`/`ipcMain.on` (not `invoke`/`ipcMain.handle`) means there is no reply channel a handler could leak data back through. Mirrors the event half's `webContents.send` / `ipcRenderer.on`.
- **`COMMAND_CHANNEL` is hardcoded inside `sendCommand`** — the renderer cannot address an arbitrary IPC channel; its only outbound surface is a shape-typed command on this one channel (AC5).
- `ipcRenderer` stays inside the preload module; only `sendCommand` is added to `api` (AC2). `PyryApi = typeof api` flows the method's type to `window.pyry` through the untouched `index.d.ts` (AC3).

### Data flow

```
 #11 composer (later)      commands.ts             preload bridge            receiveCommand           #11 / transport (later)
 user text + ids ───────►  sendMessageCommand ───► window.pyry.sendCommand ─► onCommand(handler) ────► build send_message Envelope
   (message_id gen)        RendererCommand          ipcRenderer.send ──IPC──► ipcMain.on              → Noise transport → daemon
                           (pure, tested)           COMMAND_CHANNEL            strip event, GUARD ✓
                                                                              isRendererCommand(raw)
```

`sendCommand` is the single outbound choke point; `onCommand` is the single inbound seam. **The guard in `onCommand` is the untrusted→trusted checkpoint** — everything downstream of the handler receives a validated `RendererCommand`. No transport is reached in #17; the daemon `Envelope` is built by #11.

## State + concurrency model

- **No store, no async work in #17.** `sendMessageCommand` and `isRendererCommand` are pure/sync; `onCommand` registers a listener and returns. No timers, sockets, or `AbortController` here — those belong to the transport (#4/#7).
- **Registration lifecycle is the one concurrency contract.** `onCommand` returns an unsubscribe (exact-listener `removeListener`). The composition root that wires `onCommand(ipcMain, handler)` (#11/transport) owns registering it **once** for the app lifetime and calling the handle on teardown. Registering twice would double-dispatch each command. Named as the composition root's responsibility (Open question 1); in #17 the seam is unwired, so returning the handle is hygiene + testability.
- **Send is stateless.** `sendCommand` issues an IPC message and returns; no queue, no backpressure in #17 (the transport owns delivery guarantees later).

## Error handling

- **`sendMessageCommand` cannot fail** — a pure wrap of already-typed fields.
- **`isRendererCommand` never throws** — returns a boolean.
- **`onCommand` drops malformed commands** (guard false → no handler call), so a downstream consumer never receives non-conforming input. Recommended fixed-string `console.warn` on drop (no renderer data). It does not throw.
- **Handler robustness is the consumer's job.** The receiver is a thin forwarder — it does not wrap `handler` in try/catch. If #11's handler throws, that propagates out of the `ipcMain` listener (Electron logs it; it does not crash main). Keeping the receiver thin matches `emitDaemonEvent`'s pure-forwarder discipline.
- **No user-facing surface in #17.** Any UI feedback for a failed send (e.g. a retry banner) is #11/#12, driven by the `DaemonEvent` that comes back.

## Testing strategy

`npm test` (vitest, node env) for the pure functions and the receiver; `npm run build` / `npm run typecheck` for the union and the contextBridge/ipc wiring (per the ticket's testing note). Test-first: write these RED before the modules exist. Scenarios (developer writes assertions in the `emitDaemonEvent.test.ts` / `events.test.ts` idiom — bullets, not pre-written bodies):

- **`src/shared/ipc/commands.test.ts`:**
  - **Channel constant** (mirrors `events.test.ts`): `COMMAND_CHANNEL` equals `'pyry:command'`. Pins the string both sides depend on.
  - **`sendMessageCommand`:** given a `SendMessagePayload`, returns `{ type: 'sendMessage', payload: <fields> }` — discriminant is `'sendMessage'`, and the three fields pass through unchanged (field-equal). Import the value, don't hard-code `'sendMessage'` as a bare literal where a rename could silently pass.
  - **`isRendererCommand` — accepts:** a well-formed send-message command, including one produced by `sendMessageCommand`; and one carrying an extra harmless field (structural minimum → still true).
  - **`isRendererCommand` — rejects:** `null`, `undefined`, a non-object, a missing/empty `type`, an unknown `type` (e.g. `'connect'`), a missing `payload`, and a `payload` whose `conversation_id` / `message_id` / `text` is missing or non-string. Each → false.
- **`src/main/receiveCommand.test.ts`** (structural fake `{ on: vi.fn(), removeListener: vi.fn() }`; no Electron):
  - `onCommand(fake, handler)` calls `fake.on` **once** with `COMMAND_CHANNEL` (imported, not a literal) and captures the registered listener.
  - Invoking the captured listener with `(fakeEvent, validCommand)` calls `handler` **once** with the **command only** — assert the arg equals `validCommand` and that the `fakeEvent` object was **not** forwarded (event stripped).
  - Invoking the captured listener with `(fakeEvent, {malformed})` does **not** call `handler` (dropped at the guard).
  - The returned unsubscribe calls `fake.removeListener` with `COMMAND_CHANNEL` and the **exact same listener reference** that was registered.
- **Type-level (`npm run typecheck`, no runtime):**
  - The union member's `payload` is `SendMessagePayload` (compile-checked by reusing `../wire/types`).
  - `sendCommand` appears on `PyryApi` / `window.pyry` typed `(command: RendererCommand) => void` (flows via `typeof api`).
  - An unknown command shape is a compile error (AC4) — inherent to `sendMessageCommand`'s and `onCommand`'s `RendererCommand` typing; note it, do not add a deliberately-failing-compile test.

The contextBridge / `ipcRenderer` / `ipcMain` wiring itself is intentionally **not** unit-tested (no Electron harness) — `npm run build` + `npm run typecheck` cover it, per the ticket.

## Open questions

1. **Single registration + teardown ownership.** The composition root (#11/transport, in `src/main/index.ts`) must call `onCommand(ipcMain, handler)` exactly **once** and invoke the returned unsubscribe on app teardown. #17 provides the handle; wiring is deferred (no live receiver to observe yet — evidence-based, mirrors #18's deferred emitter). Flag when #11 wires the first handler.
2. **Guard grows with the union.** When connect/disconnect commands land, extend **both** `RendererCommand` **and** `isRendererCommand` in lockstep in `commands.ts`. A union member the guard doesn't validate is silently dropped at the boundary — a correctness trap. Consider a type-level exhaustiveness cross-check (a `Record<RendererCommand['type'], true>`) as an early tripwire, mirroring #19's `assertNever` discipline; keep it type-only.
3. **`message_id` generation belongs to #11.** The pure constructor deliberately does not mint the `message_id` (randomness breaks purity). #11's composer generates it (`crypto.randomUUID()` — main-safe, security-appropriate) and assembles the `SendMessagePayload` before calling `sendMessageCommand`. Named for #11, not built here.
4. **Dropped-command observability.** #17 recommends a fixed-string `console.warn` on a dropped malformed command (no renderer data). If a metric on malformed-command rate becomes useful (e.g. to detect a misbehaving renderer build), the seam can count drops later — deferred, no evidence it's needed now.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** The central finding — and where #17 **diverges from #18**. #18 flowed main → renderer, a *trusted* producer, so it added no runtime validation. **#17 flows renderer → main, and the renderer is UNTRUSTED relative to the main process** (per `security-review.md` §1: every IPC message crossing `ipcMain` is untrusted-to-trusted, "even though both sides are our code"). The boundary is **explicit and single**: `onCommand` in `src/main/receiveCommand.ts`, gated by `isRendererCommand`. Downstream consumers (#11/transport) receive only shape-validated `RendererCommand`s. **The guard is what makes the `RendererCommand` type on the handler honest** — without it, the type would claim `RendererCommand` while the runtime value is attacker-controllable `unknown` (the "downstream callers don't know they hold untrusted data" trap §1 warns about). Design decision that resolves the category → **no MUST FIX**. (Do **not** copy #18's "trusted producer, no validator" reasoning — no transitive trust; this spec is reviewed on its own.)
- **[Tokens, secrets, credentials]** No findings. AC5 is enforced **by the type**: `RendererCommand` references only `SendMessagePayload` (`conversation_id`, `message_id`, `text`) — no token/key/byte field. `HelloClientPayload` (`token`), `QrPayload` (`token`, `server_static_pubkey`), and `InnerFrameV2` (base64 frame `data`) are **not** members and must not become members. A compromised renderer can send well-formed *messages as the already-authenticated user* — that is the inherent capability of being the client, bounded by the daemon's session auth (Noise + token), **not** a new hole #17 opens; and it cannot exfiltrate keys/tokens (they never reach the renderer). `SendMessagePayload.text` crossing **to main** is the product (the message to send), not a leak — but must not be logged (§7).
- **[File / storage operations]** N/A — #17 performs no filesystem or storage I/O.
- **[Inter-process / Electron attack surface]** No MUST FIX.
  - The added renderer capability is **narrow**: `sendCommand(RendererCommand)` on one channel. `COMMAND_CHANNEL` is **hardcoded inside `sendCommand`**, so the renderer cannot address arbitrary IPC channels; `ipcRenderer` is **never** exposed (AC2/AC5); the renderer cannot reach Node, the socket, or keys (none are in the renderer).
  - **Every `ipcMain` argument is validated before use** (`isRendererCommand`), satisfying §4's "validate type/shape/allowed values." Malformed input is dropped, not forwarded.
  - The `IpcMainEvent` first arg (`.sender` / `.reply` / `.senderFrame` / `.ports`) is **stripped** in the receiver before the handler runs — no capability leak downstream.
  - `send`/`ipcMain.on` (fire-and-forget), **not** `invoke`/`ipcMain.handle` — there is no synchronous reply channel a handler could leak data back through; responses return as separate `DaemonEvent`s (#18), which carry only wire types.
  - **SHOULD FIX / OUT OF SCOPE — `sandbox: false`.** `src/main/index.ts:17` sets `sandbox: false` (pre-existing scaffold value; #17 does not touch that file). With `contextIsolation: true` + `nodeIntegration: false` the page is walled from Node, and #17's inbound channel is shape-validated, so it is **not exploitable as designed** via this setting — not a MUST FIX for #17. Harden in a dedicated ticket (or fold into the same one #18 flagged); do **not** expand #17 to flip it (respects *don't refactor adjacent code*).
- **[Cryptographic primitives]** N/A — no crypto, RNG, or handshake in #17. `COMMAND_CHANNEL` is a static, non-secret string. (The `message_id` generation deferred to #11 SHOULD use `crypto.randomUUID()`, not `Math.random()` — noted for #11's surface, not #17's.)
- **[Network & I/O]** N/A — no socket, relay, or `ws` in #17; the command reaches the transport only in #11 (#4/#7 own the socket).
- **[Error messages, logs, telemetry]** No findings, one guardrail. #17 adds at most a **fixed-string** `console.warn` on a dropped malformed command — **no renderer data** in the log. The receiver and the preload sender must **not** log the command payload (a `console.log(command)` would leak `SendMessagePayload.text` to main-process stdout or the renderer DevTools console). Called out for the developer and code-review, mirroring #18 §7.
- **[Concurrency]** No MUST FIX. The one contract: `onCommand` returns an unsubscribe that calls `removeListener` with the **exact listener** it registered (no leak / double-fire). Single-registration and teardown are the composition root's (#11's) responsibility, named (Open question 1). No long-lived async task, timer, or socket, and no check-then-act shared-state race, is introduced by #17.
- **[Threat model alignment]**
  - **Renderer compromise reaching the transport/keys** — the threat #17 is built against. A script-injection or supply-chain bug in the renderer gains **only** `sendCommand(shape-validated command)` on one channel: it cannot reach keys/socket/token (not in the renderer), cannot address arbitrary IPC channels (channel hardcoded, `ipcRenderer` not exposed), and malformed commands are dropped at the guard. Worst case: it sends well-formed messages **as the already-authenticated user** — inherent to being the client, bounded by the daemon's session auth. Real, bounded, named.
  - **Shape validation ≠ authorization.** `isRendererCommand` validates structure, not permission. Content authorization (may this user post to this conversation?) is the **daemon's** job over the authenticated Noise session — named so the guard is not mistaken for an authz control.
  - **Hostile daemon / malicious relay** (inbound, malformed/oversized daemon data; drop/delay/reorder) — **out of scope** for #17: this ticket is the *outbound* direction with no socket. Inbound parsing/validation is owned by #5 (codec) / #10 (hello) / #18; relay resilience by #4/#7.
  - **Token theft from disk** — out of scope (#17 touches no disk); owned by #8.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-03
