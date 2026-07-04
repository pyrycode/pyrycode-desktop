# Spec — #65: Outbound send path — encrypt a send-message command onto the relay

**Size:** S · **Labels:** `security-sensitive` · **Scope:** one new transport-layer builder + two edits (`daemonConnection.ts`, `index.ts`) — additive, zero consumer cascade · no new dependency.

Wires the last missing seam of the send flow: a validated `sendMessage` command that reaches `onCommand` in the background process becomes an encrypted `send_message` envelope on the live relay session. This is the **main / transport half**; the renderer half (composer submit + optimistic echo) is #66, which drives this seam from the other end. No UI surface — entirely `src/main/`.

Three pieces, matching the three ACs:

1. A **pure envelope builder** (`SendMessagePayload → send_message envelope bytes`), mirroring `buildClientHello`.
2. A **send entry point** on `createDaemonConnection` that builds the envelope and hands the bytes to `driver.sendMessage` — inert (no throw, no crash) when disconnected, pre-handshake, or post-terminal.
3. The **single `onCommand` registration** at the composition root that routes a `sendMessage` command to that entry point, unsubscribed on teardown.

## Files to read first

- `src/main/daemonConnection.ts:56-62` — `DaemonConnection` interface (`start`/`stop`); add `send` here.
- `src/main/daemonConnection.ts:93-212` — the factory. Add the id counter local + the `send` closure; extend the returned object. Note the `driver` local (`:103`) is set only in `bootstrap` and never nulled.
- `src/main/daemonConnection.ts:143-192` — `bootstrap`. The `hello` is built with **`id: 1`** (`:153`); app envelopes continue from `2`. Extract: where the `driver` local becomes non-null.
- `src/main/transport/helloExchange.ts:43-61` — `buildClientHello`: the shape to mirror (build an `Envelope`, `encodeEnvelope` to UTF-8 bytes). The send builder is **thinner** — no `make…Payload` default injection.
- `src/main/transport/codec.ts:103-118` — `encodeEnvelope` contract: throws `WireEncodeError` when the serialized envelope exceeds `MAX_PLAINTEXT_BYTES`. This is the one throw source the send path must catch.
- `src/main/transport/noiseRelayDriver.ts:82-88` and `:229-233` — `NoiseRelayDriver.sendMessage(plaintext)`: the send target. Its contract is **inert before handshake-complete / after terminal** (`session?.sendMessage`). The connection depends on this.
- `src/main/transport/noiseRelayDriver.test.ts:304-306, 345, 358` — existing tests proving `driver.sendMessage` is inert after terminal and never throws. The connection relies on these; **do not re-test driver inertness at the connection layer.**
- `src/main/transport/noiseSession.ts:64-65, 171-174` — `NoiseSession.sendMessage`: `if (state !== 'transport') return` — the base of the inertness guarantee.
- `src/main/receiveCommand.ts:17-42` — `onCommand(source, handler): () => void` + structural `CommandSource`. The seam index.ts calls once; returns the unsubscribe.
- `src/shared/ipc/commands.ts:34-60` — `RendererCommand` (single member `{ type: 'sendMessage'; payload: SendMessagePayload }`) + `isRendererCommand`. The handler receives an already-validated command.
- `src/main/index.ts:104-137` — composition root. Register `onCommand` and add a `will-quit` unsubscribe here, mirroring `unregisterPairing` (`:112-116`).
- `src/shared/wire/types.ts:98-102, 51-61, 30` — `SendMessagePayload`, `Envelope`, `MAX_PLAINTEXT_BYTES` (65519).
- `src/main/daemonConnection.test.ts:51-133` — the fake-driver factory + deps builder to extend (the fake's `sendMessage` currently no-ops; add a `sent` recorder and an optional throw mode).
- `src/main/transport/codec.test.ts:193-195` — an existing `send_message` round-trip through the codec; the builder test can be even thinner.
- `docs/knowledge/codebase/17.md` (§ Deferred) — the "single registration + teardown ownership (#11)" item this ticket closes, and the optional exhaustiveness-tripwire note.
- `docs/knowledge/codebase/62.md` (§ Patterns) — the `daemonConnection` disciplines this inherits: classify-don't-forward, log-free, the `stopped` flag.

## Context

The typed command channel (#17) delivers a validated `RendererCommand` to `onCommand` in the background process, but nothing is registered to receive it. The live authenticated transport (#62, `createDaemonConnection` with `start`/`stop`) and the Noise relay driver (#50, `driver.sendMessage(plaintext)`) both exist. The missing layer is the connective tissue between them: build the envelope, drive `sendMessage`, and register the handler once at the composition root. #17's codebase note explicitly defers this exact wiring ("single registration + teardown ownership").

**Parity note (mobile #490 / #31).** Mobile's first real-device run crashed because a relay command started a call with no error handling and the uncaught throw killed the process. The send path here **must never throw out of the handler or the module** — a command arriving while disconnected, pre-handshake, or post-terminal is dropped, never propagated as a crash.

## Design

### 1. Pure envelope builder — `src/main/transport/sendMessageEnvelope.ts` (new)

Mirrors `helloExchange.ts`'s builder, minus default injection (a `SendMessagePayload` has no defaulted fields — see `codec.ts:157` note on why `hello` needs a constructor and app payloads do not).

```ts
// Contract only — body is ~3 lines.
export function buildSendMessage(input: {
  id: number
  ts: string
  payload: SendMessagePayload
}): Uint8Array
// Builds Envelope { id, type: 'send_message', ts, payload } and returns encodeEnvelope(envelope).
// Pure: no clock, no counter, no side effects (the caller supplies id + ts, exactly as
// buildClientHello). MAY throw WireEncodeError when the envelope exceeds MAX_PLAINTEXT_BYTES;
// the sole caller (connection.send) catches it.
```

Invariant asserted by its unit test: `decodeEnvelope(buildSendMessage({id, ts, payload}))` yields `type: 'send_message'` and a payload deep-equal to the input (mirrors `codec.test.ts:193`).

Placement: a new sibling to `helloExchange.ts`, not an addition to it — `helloExchange.ts` is scoped to the handshake exchange (`hello`/`hello_ack`); `send_message` is post-handshake app traffic. Same one-concern-per-file pattern the module already follows.

### 2. Send entry point — `src/main/daemonConnection.ts` (modify)

Add to the `DaemonConnection` interface:

```ts
/** Encrypt a send_message envelope onto the live session. Idempotent no-op when not
 *  connected (no driver, pre-handshake, or post-terminal). NEVER throws (parity #490). */
send(payload: SendMessagePayload): void
```

Add to the factory closure: one counter local and one closure, then extend the returned object to `{ start, stop, send }`.

```ts
// Hello consumed envelope id 1 in bootstrap (:153); app envelopes continue from 2.
let nextEnvelopeId = 2

function send(payload: SendMessagePayload): void {
  if (driver === null) return               // before start / mid-bootstrap / bootstrap-failed
  try {
    const bytes = buildSendMessage({ id: nextEnvelopeId, ts: now(), payload })
    nextEnvelopeId += 1                      // advance only on a successful build
    driver.sendMessage(bytes)               // driver is inert pre-handshake / post-terminal
  } catch {
    // Never throw out of the module (parity #490). Covers an over-cap plaintext
    // (WireEncodeError) and any driver/wasm throw. Caught object DROPPED — its message could
    // echo the plaintext; no log, no event (classify-don't-forward, inherited #62).
  }
}
```

The `driver === null` guard plus the driver's documented inertness cover all "not connected" cases — see the case analysis below. The full-body `try/catch` (not just around the build) is the deterministic no-throw guarantee the parity note requires.

### 3. Composition-root registration — `src/main/index.ts` (modify)

Right after `createDaemonConnection(...)` (`:126-132`), register the handler once and add a symmetric teardown, mirroring `unregisterPairing`:

```ts
// The single onCommand registration for the app lifetime (#17 deferred this wiring).
// The command is already validated by isRendererCommand at the boundary; route its payload
// to the send entry point. A switch on `type` (single member today) keeps it grow-ready.
const unregisterCommands = onCommand(ipcMain, (command) => {
  switch (command.type) {
    case 'sendMessage':
      connection.send(command.payload)
      return
  }
})
app.on('will-quit', () => unregisterCommands())
```

Registration happens at composition time (not gated on `did-finish-load`): the handler is inert until a driver exists, so an early command is a safe no-op. Exactly one `onCommand` call + one `will-quit` unsubscribe is what makes "registering twice does not double-dispatch" true — `onCommand` uses `ipcMain.on` (additive), so the single-call discipline at the sole registration site is the guarantee.

### Data flow

```
renderer composer (#66)
  → window.pyry.sendCommand({ type: 'sendMessage', payload })   // #17 preload bridge
  → ipcRenderer.send(COMMAND_CHANNEL, cmd)
  → ipcMain.on  →  onCommand listener  →  isRendererCommand (validate at untrusted boundary)
  → handler: connection.send(command.payload)                    // ← this ticket
  → buildSendMessage({ id, ts, payload })  →  driver.sendMessage(bytes)
  → session.sendMessage (AEAD seal)  →  sendFrame  →  InnerFrameV2 noise_msg  →  relay  →  daemon
```

## State + concurrency model

- **No store, no new async task, no new listener** beyond the single `onCommand` registration (unsubscribed on `will-quit`). The renderer `sessionStore` (#2) remains the single source of session state; this module only sends.
- **Envelope-id counter** (`nextEnvelopeId`) is a module-local, single-writer counter. `send` contains **no `await`**, so it runs to completion without interleaving — no check-then-act race on the counter. It advances only on a successful build, so a dropped over-cap send does not consume an id. Gaps are harmless: the daemon uses envelope `id` for `in_reply_to` correlation, not sequencing.
- **Why the single `driver === null` guard suffices** (the load-bearing correctness argument): every "not connected" state is covered without the connection tracking handshake state itself.

  | State | `driver` | `driver.sendMessage` behaviour |
  |---|---|---|
  | before `start()` / mid-bootstrap / bootstrap-failed | `null` | guarded out by `if (driver === null) return` |
  | driver constructed, pre-handshake | non-null | inert — `session` null or not in `transport` state |
  | connected (transport) | non-null | seals + sends (happy path) |
  | after fatal terminal | non-null | inert — `onTerminal` nulled `session` |
  | after `stop()` | non-null | inert — `stop()` drives terminal, nulling `session` |

  The connection deliberately does **not** track a `connected` flag to gate `send`: the driver already drops pre-handshake/post-terminal sends inertly, so a flag would add state for no functional gain (the message is dropped either way; the only difference is whether an id is consumed, which is harmless).

## Error handling

| Failure | Layer | Result |
|---|---|---|
| Over-cap plaintext (renderer sends huge `text`) | `encodeEnvelope` → `WireEncodeError` | Caught in `send`; dropped, not forwarded, id **not** consumed. No log, no event. |
| Driver / wasm throw during a connected send | `driver.sendMessage` | Caught by the full-body `try/catch`; process does not crash (parity #490). |
| Command arrives disconnected / pre-handshake / post-terminal | `driver === null` guard **or** driver inertness | Silent no-op; message dropped. No throw. |
| Malformed command from the renderer | `isRendererCommand` (#17, pre-existing) | Dropped at the boundary before `send`; never reaches this layer. |

- **No send-failure signal to the UI.** The `DaemonEvent` union has no "message send failed" member, and `failed` means the *connection* failed, not one message. A dropped send surfaces nothing — matching the AC (drop, don't crash). Send-delivery UX (retry / "not delivered") is out of scope (see Open questions).
- **Secret discipline (AC4).** The caught object is always dropped — never logged, never interpolated, never forwarded. `SendMessagePayload.text` is message plaintext; a codec error message can echo it. Inherited from #5/#7/#22/#50/#62.

## Testing strategy

`npm test` (vitest), fakes over mocks, mirroring the established layer tests.

**`src/main/transport/sendMessageEnvelope.test.ts` (new)** — pure function:
- `buildSendMessage({ id, ts, payload })` → `decodeEnvelope` round-trips to `type: 'send_message'`, the exact `payload`, and the given `id`/`ts`.
- An over-cap `text` makes it throw `WireEncodeError` (so the caller's catch is justified).

**`src/main/daemonConnection.test.ts` (extend)** — extend the fake driver (`:60-83`) with a `sent: Uint8Array[]` recorder and an optional `throwOnSend` mode; keep the real codec so assertions pin actual bytes:
- `send` before `start()` (no driver) → nothing recorded, no throw.
- `send` after `handshake-complete` → exactly one forward; decode the recorded bytes and assert `type: 'send_message'`, the payload, `id === 2`, and the fixed `ts`.
- a second `send` → `id === 3` (monotonic).
- an over-cap payload → `send` does not throw and forwards nothing; the next successful `send` still uses `id === 2` (id not consumed by the failed build).
- fake driver whose `sendMessage` throws → `connection.send` does not throw.
- console-spy sweep across a happy send + an over-cap send → no `log/info/warn/error/debug/trace`, and no recorded/serialized value contains the message text.
- **Not re-tested here:** inertness after terminal/stop — that is the driver's contract, already covered by `noiseRelayDriver.test.ts:304-358`. Add a one-line comment pointing there.

**`src/main/index.ts`** — no unit test (no Electron harness, per #17/#62). Covered by `npm run typecheck` + `npm run build`. The single-registration / `will-quit`-symmetry property is verified by inspection against the `unregisterPairing` precedent.

**Gate:** `npm run build`, `npm run typecheck`, `npm test` all pass (AC5).

## Open questions

1. **Send-failure UX** — surfacing "message not delivered" (retry indicator, dropped-send toast) to the renderer. No `DaemonEvent` models it today; out of scope here. Likely lands with the reconnect/status choreography (#34/#35) or a dedicated ticket. Flag for the developer: do **not** invent an event for it in this ticket.
2. **Exhaustiveness tripwire** (`Record<RendererCommand['type'], true>`) — deferred per #17 until the command union grows a second member (connect/disconnect). `sendMessage` stays the only member, so the plain `switch` is sufficient now.
3. **Builder file name** — resolved to `sendMessageEnvelope.ts` (sibling to `helloExchange.ts`) for an unambiguous reading list; the developer may rename if a stronger local convention emerges, but keep it under `src/main/transport/`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new finding. The one untrusted→trusted boundary on this path is the renderer→main IPC message, already gated by `isRendererCommand` at `onCommand` (#17). `connection.send` receives an already-validated `SendMessagePayload` — it holds trusted, typed data. This ticket adds no new boundary; it consumes the existing one. The daemon-response boundary (inbound `message`) is untouched (#12).
- **[Tokens, secrets, credentials]** No finding. This path carries no token/key — `SendMessagePayload` is `{ conversation_id, message_id, text }` (message plaintext only). AC5 is enforced by construction upstream: `RendererCommand` references only `SendMessagePayload`, so no secret can ride this channel (`commands.ts` header). The device token continues to live only in the `hello` early-data and the relay headers, both sourced in `bootstrap`, not here.
- **[File / storage operations]** N/A — no filesystem access on this path.
- **[Inter-process / Electron attack surface]** No finding. No new `ipcMain` channel or `contextBridge` API — the single `onCommand` registration reuses the existing `COMMAND_CHANNEL` (#17) via `ipcMain.on` (fire-and-forget, no reply channel to leak back through). Every argument is validated before `send` sees it. The window's `contextIsolation`/`sandbox` posture (`index.ts:31-32`) is unchanged. Transport/keys/socket stay in the main process; the renderer only sends a typed payload — it never touches `driver`, `session`, or bytes.
- **[Cryptographic primitives]** No finding. This layer builds a plaintext envelope and hands it to the existing `driver.sendMessage` → `session.sendMessage`, which performs the vetted `Noise_IK_25519_ChaChaPoly_BLAKE2s` AEAD seal (#7). No crypto is added, and no `(key, nonce)` pair is managed here — the Noise session owns its per-direction nonce counter. The envelope-id counter is a wire-protocol correlation id, not a nonce, and needs no randomness (`Math.random` is not used and not needed).
- **[Network & I/O]** No finding. Outbound frame size is bounded twice on the existing path: `encodeEnvelope` rejects an over-cap envelope (`MAX_PLAINTEXT_BYTES`, 65519) — the throw this ticket catches — and `encodeInnerFrame` rejects an over-cap outer frame (`MAX_FRAME_BYTES`). The relay URL / TLS / reconnect discipline are owned by #22/#50/#62 and untouched. A hostile-relay send failure degrades to a dropped message, not a hang or crash.
- **[Error messages, logs, telemetry]** No finding. The path is log-free by construction: the sole `catch` drops the caught object (its message could echo message plaintext) and emits nothing. The console-spy test pins this. No secret, key, frame, or plaintext reaches any sink.
- **[Concurrency]** No finding. `send` launches no long-lived async work and adds no timer or listener beyond the single `onCommand` registration, which is unsubscribed on `will-quit` (symmetric with `unregisterPairing`). `send` contains no `await`, so the id counter has no check-then-act race. Duplicate-connection concerns are the driver/supervisor's (#22/#50), unchanged.
- **[Threat model alignment]** Addressed. **Malicious relay:** content-blind and on-path; a dropped/flooded send degrades to a lost message, never a leak (plaintext is AEAD-sealed before it leaves the process) or a crash (full-body `try/catch`). **Renderer compromise reaching the transport:** a compromised renderer can already call `sendCommand`; the strongest it achieves here is sending a well-formed `send_message` inside the *already-authenticated* session — it cannot reach keys, the token, or the raw socket (all main-process), and it cannot forge a different envelope type (the handler only routes `sendMessage`). **Hostile daemon response:** not on this outbound path (#12 owns inbound). **Uncaught-throw process-kill (mobile #490):** directly mitigated by the full-body `try/catch` + `driver === null` guard — the MUST-address desktop-parity threat for this ticket.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
