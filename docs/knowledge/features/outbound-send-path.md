# Outbound send path

The **main / transport half of the send flow**: a validated `sendMessage` command that reaches the background process becomes an encrypted `send_message` envelope on the live Noise relay session, so a message the user composes actually reaches the pyry daemon. This is the connective tissue between three pieces that already existed but were wired by no one — the [command channel](command-channel.md)'s `onCommand` seam ([#17](../codebase/17.md)), the [daemon connection](daemon-connection.md)'s live authenticated transport ([#62](../codebase/62.md)), and the [Noise relay driver](noise-relay-driver.md)'s `sendMessage(plaintext)` ([#50](../codebase/50.md)).

Introduced in [#65](../codebase/65.md). Entirely `src/main/` — no renderer surface. The renderer half (composer submit + optimistic echo) is [#66](https://github.com/pyrycode/pyrycode-desktop/issues/66), which drives this seam from the other end.

## The three pieces

1. **A pure envelope builder** — `buildSendMessage` in `src/main/transport/sendMessageEnvelope.ts` (new). A sibling to [hello exchange](hello-exchange.md)'s `buildClientHello`, mirroring its shape minus default injection.
2. **A send entry point** — `send(payload)` added to `createDaemonConnection` ([daemon connection](daemon-connection.md)). Builds the envelope and hands the bytes to `driver.sendMessage` — inert (no throw, no crash) when disconnected, pre-handshake, or post-terminal.
3. **The single `onCommand` registration** — at the composition root (`src/main/index.ts`), routing a `sendMessage` command to `connection.send`, unsubscribed on `will-quit`. Closes [#17](../codebase/17.md)'s deferred "single registration + teardown ownership" item.

## 1. The pure envelope builder

```ts
// src/main/transport/sendMessageEnvelope.ts — MAIN-PROCESS ONLY
export interface SendMessageInput {
  id: number                 // the consumer's envelope-id counter (hello consumed id 1)
  ts: string                 // RFC3339 timestamp — supplied by the caller, never read here
  payload: SendMessagePayload // the already-validated command payload
}

export function buildSendMessage(input: SendMessageInput): Uint8Array
// Builds Envelope { id, type: 'send_message', ts, payload } → encodeEnvelope() UTF-8 bytes.
```

**Pure, exactly like `buildClientHello`** — no clock read, no counter, no side effects; the caller supplies `id` + `ts`. **Thinner** than the hello builder: a `SendMessagePayload` has no defaulted fields, so there is no `make…Payload` constructor to route through (contrast `makeHelloClientPayload`; see [hello exchange](hello-exchange.md) / `codec.ts:157`). **MAY throw `WireEncodeError`** when the serialized envelope exceeds `MAX_PLAINTEXT_BYTES` (65519) — the one throw source the send path catches.

**Why a new sibling file, not an addition to `helloExchange.ts`:** `helloExchange.ts` is scoped to the handshake exchange (`hello` / `hello_ack`); `send_message` is **post-handshake application traffic**. Same one-concern-per-file split the `transport/` module already follows.

## 2. The send entry point

```ts
// added to the DaemonConnection interface
/** Encrypt a send_message envelope onto the live session. Idempotent no-op when not
 *  connected (no driver, pre-handshake, or post-terminal). NEVER throws (parity #490). */
send(payload: SendMessagePayload): void
```

The closure is small — one `driver === null` guard, one full-body `try/catch`, and a module-local `nextEnvelopeId` counter starting at **2** (the `hello` consumed id 1 in bootstrap):

```ts
function send(payload: SendMessagePayload): void {
  if (driver === null) return               // before start / mid-bootstrap / bootstrap-failed
  try {
    const bytes = buildSendMessage({ id: nextEnvelopeId, ts: now(), payload })
    nextEnvelopeId += 1                      // advance only on a successful build
    driver.sendMessage(bytes)               // driver is inert pre-handshake / post-terminal
  } catch {
    // Never throw out of the module (parity #490). Caught object DROPPED — its message could
    // echo the plaintext; no log, no event (classify-don't-forward, inherited #62).
  }
}
```

### Why the single `driver === null` guard suffices

The load-bearing correctness argument: **the connection does not track handshake state itself** — the driver already drops pre-handshake/post-terminal sends inertly ([`noiseRelayDriver.ts:229`](noise-relay-driver.md), rooted in `NoiseSession.sendMessage`'s `if (state !== 'transport') return`). Every "not connected" state is covered without a `connected` flag:

| State | `driver` | `driver.sendMessage` behaviour |
|---|---|---|
| before `start()` / mid-bootstrap / bootstrap-failed | `null` | guarded out by `if (driver === null) return` |
| driver constructed, pre-handshake | non-null | inert — `session` null or not in `transport` state |
| connected (transport) | non-null | seals + sends (happy path) |
| after a fatal terminal | non-null | inert — `onTerminal` nulled `session` |
| after `stop()` | non-null | inert — `stop()` drives terminal, nulling `session` |

A `connected` flag would add state for no functional gain — the message is dropped either way; the only difference is whether an id is consumed, which is harmless.

### The envelope-id counter

`nextEnvelopeId` is a **module-local, single-writer counter**. `send` contains **no `await`**, so it runs to completion without interleaving — no check-then-act race. It advances **only on a successful build**, so a dropped over-cap send does not consume an id. Gaps are harmless: the daemon uses the envelope `id` for `in_reply_to` correlation, **not sequencing**. (It is a wire-protocol correlation id, **not a Noise nonce** — the Noise session owns its own per-direction nonce counter; no randomness is needed or used here.)

## 3. The single `onCommand` registration

At the composition root, right after `createDaemonConnection(...)`:

```ts
// src/main/index.ts — the single onCommand registration for the app lifetime
const unregisterCommands = onCommand(ipcMain, (command) => {
  switch (command.type) {
    case 'sendMessage':
      connection.send(command.payload)
      return
  }
})
app.on('will-quit', () => unregisterCommands())
```

- **Registered once**, at composition time — **not** gated on `did-finish-load`. The handler is inert until a driver exists (`send` is a no-op with no driver), so an early command is a safe no-op.
- **`onCommand` uses `ipcMain.on` (additive)**, so the single-call discipline at this **sole registration site** is what makes "registering twice does not double-dispatch" true.
- **Symmetric teardown** — `will-quit` removes the exact listener, mirroring `unregisterPairing`.
- The command is **already validated** by `isRendererCommand` at the boundary ([#17](../codebase/17.md)); the handler receives typed, trusted data. A `switch` on `type` (single member today) keeps it grow-ready; the exhaustiveness tripwire (`Record<RendererCommand['type'], true>`) stays deferred until the union grows a second member.

## Data flow

```
renderer composer (#66)
  → window.pyry.sendCommand({ type: 'sendMessage', payload })   // #17 preload bridge
  → ipcRenderer.send(COMMAND_CHANNEL, cmd)
  → ipcMain.on → onCommand listener → isRendererCommand (validate at untrusted boundary)
  → handler: connection.send(command.payload)                    // ← this feature
  → buildSendMessage({ id, ts, payload }) → driver.sendMessage(bytes)
  → session.sendMessage (AEAD seal) → sendFrame → InnerFrameV2 noise_msg → relay → daemon
```

## Error handling

| Failure | Layer | Result |
|---|---|---|
| Over-cap plaintext (huge `text`) | `encodeEnvelope` → `WireEncodeError` | Caught in `send`; dropped, id **not** consumed. No log, no event. |
| Driver / wasm throw during a connected send | `driver.sendMessage` | Caught by the full-body `try/catch`; process does not crash (parity #490). |
| Command arrives disconnected / pre-handshake / post-terminal | `driver === null` guard **or** driver inertness | Silent no-op; message dropped. No throw. |
| Malformed command from the renderer | `isRendererCommand` ([#17](../codebase/17.md)) | Dropped at the boundary before `send`; never reaches this layer. |

**No send-failure signal to the UI.** The `DaemonEvent` union has no "message send failed" member (`failed` means the *connection* failed, not one message). A dropped send surfaces nothing — matching the AC (drop, don't crash). Send-delivery UX (retry / "not delivered") is out of scope; it likely lands with the reconnect/status choreography ([#34](https://github.com/pyrycode/pyrycode-desktop/issues/34)/[#35](https://github.com/pyrycode/pyrycode-desktop/issues/35)).

## The parity guard (mobile #490 / #31)

Mobile's first real-device run crashed because a relay command started a call with no error handling and the uncaught throw killed the process. The desktop send path **must never throw out of the handler or the module**: a command arriving while disconnected, pre-handshake, or post-terminal is **dropped, never propagated as a crash**. The full-body `try/catch` (not just around the build) plus the `driver === null` guard are the deterministic no-throw guarantee. [#31](https://github.com/pyrycode/pyrycode-desktop/issues/31) is the broader sweep across all relay commands; #65 landed the guard for the one send path.

## Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS** (no findings). Code review: **PASS** (one NIT — the already-agreed exhaustiveness-tripwire deferral).

- **No secret rides this channel, by construction.** `SendMessagePayload` is `{ conversation_id, message_id, text }` — message plaintext only, no token/key/byte field. `RendererCommand` references only `SendMessagePayload` ([#17](../codebase/17.md)), so a developer cannot serialize a secret onto this path. The device token continues to live only in the `hello` early-data and the relay headers, both sourced in `bootstrap`, not here.
- **Log-free; classify-don't-forward.** The sole `catch` **drops** the caught object — a codec error message could echo the message plaintext — and emits nothing. Pinned by a six-method `console`-spy across a happy send + an over-cap send (inherited [#5](wire-codec.md)/[#7](noise-session.md)/[#22](relay-supervisor.md)/[#50](noise-relay-driver.md)/[#62](daemon-connection.md)).
- **No new IPC / attack surface.** The single `onCommand` registration reuses the existing `COMMAND_CHANNEL` ([#17](command-channel.md)) via `ipcMain.on` (fire-and-forget, no reply channel to leak back through). Every argument is validated before `send` sees it. `contextIsolation`/`sandbox` posture unchanged. The renderer only sends a typed payload — it never touches `driver`, `session`, or bytes.
- **No new crypto.** This layer builds a plaintext envelope and hands it to the existing `driver.sendMessage` → `session.sendMessage`, which performs the vetted `Noise_IK_25519_ChaChaPoly_BLAKE2s` AEAD seal ([#7](noise-session.md)). No `(key, nonce)` pair is managed here.
- **Output size bounded twice on the existing path** — `encodeEnvelope` rejects an over-cap envelope (`MAX_PLAINTEXT_BYTES`), and `encodeInnerFrame` rejects an over-cap outer frame (`MAX_FRAME_BYTES`). A hostile-relay send failure degrades to a dropped message, not a hang or crash.

## Related

- [#65 codebase notes](../codebase/65.md) — implementation summary, patterns, lessons.
- [Daemon connection](daemon-connection.md) / [#62](../codebase/62.md) — hosts the `send` entry point alongside `start`/`stop`; owns the `driver` local, the `now` clock seam, and the classify-don't-forward discipline this inherits.
- [Command channel](command-channel.md) / [#17](../codebase/17.md) — the `onCommand` seam + `isRendererCommand` boundary guard this registers against; #65 closes its deferred single-registration item.
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — `buildClientHello`, the pure builder `buildSendMessage` mirrors; both wrap a payload in an `Envelope` and `encodeEnvelope` to UTF-8 bytes.
- [Noise relay driver](noise-relay-driver.md) / [#50](../codebase/50.md) — `driver.sendMessage(plaintext)`, the send target; its documented pre-handshake/post-terminal inertness is what lets the connection use a single `driver === null` guard.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — `encodeEnvelope` (the `WireEncodeError` throw source) and the `Envelope` / `SendMessagePayload` / `MAX_PLAINTEXT_BYTES` types.
