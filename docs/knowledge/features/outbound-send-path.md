# Outbound send path

The **main / transport half of the send flow** builds and encrypts a `send_message`
envelope from a validated command, then attempts a write through the live Noise
relay session. Dispatch alone does not establish delivery: each layer can refuse
or fail a send. The [command channel](command-channel.md),
[daemon connection](daemon-connection.md) and [Noise relay driver](noise-relay-driver.md)
carry the bytes; message lifecycle diagnostics record how far a local submission got.

Introduced in [#65](../codebase/65.md). Transport stays in `src/main/`.
The renderer half is [Composer send](composer-send.md); its restricted
[diagnostic requests](diagnostics-channel.md#restricted-message-lifecycle-requests)
record acceptance and cancellation requests in the main-owned lifecycle trail added by
[#1721](https://github.com/pyrycode/pyrycode-desktop/issues/1721).

## The three pieces

1. **A pure envelope builder** — `buildSendMessage` in `src/main/transport/sendMessageEnvelope.ts` (new). A sibling to [hello exchange](hello-exchange.md)'s `buildClientHello`, mirroring its shape minus default injection.
2. **A send entry point** — `send(payload)` added to `createDaemonConnection` ([daemon connection](daemon-connection.md)). Validates and admits copied payloads to a bounded main-memory FIFO, draining through `driver.sendMessage` only after authenticated handshake. Delivery outcomes update the existing echo.
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

`send(payload: SendMessagePayload): void` validates and encodes before admitting a
copied payload to the host connection's FIFO. Initial-connect and reconnect gaps
retain accepted messages with `waiting` status. The cap is 128 messages and 1 MiB
of encoded envelope bytes per host, in addition to `MAX_PLAINTEXT_BYTES` admission;
incoming overflow fails visibly without evicting older messages.

A validated `hello_ack` drains in submission order. Synchronous `send-refused`
keeps the head for the next handshake; other failures remove it and report
`not-sent`. The draining guard reserves the head's capacity through handoff and
appends reentrant submissions behind the remainder. Accepted rekey-buffered sends
belong solely to `noiseSession`, and written messages are never automatically
retried. `written` establishes a socket write, not daemon acknowledgement.
The [connection lifecycle](daemon-connection-lifecycle.md#disconnected-composer-message-delivery)
owns pairing comparison, terminal-failure recovery through unchanged-pairing
Reconnect, permanent release and shutdown. Holds do not survive restart.

Delivery uses its own observer even when diagnostics has no eligible record.
A null driver is now a reason to retain an accepted message, rather than silently
drop it; the driver/session observer still determines whether a send was refused,
failed, buffered for rekey or written. There is no generic control-request retry.

### The envelope-id counter

`nextEnvelopeId` starts at 2 after hello's id 1, is shared with other outbound
methods and resets on explicit dial. Admission encodes using the current ID
without consuming it; drain rebuilds the envelope with the current clock and
`nextEnvelopeId++`. An attempted drain can consume an ID even when refused or
encoding fails. Envelope IDs correlate replies and are not sequence guarantees
or Noise nonces; only the Noise session owns its per-direction nonce counters.

## 3. The single `onCommand` registration

At the composition root, the conversation router selects the originating host's
connection. The same lifecycle tracker is shared by all host connections:

```ts
// src/main/index.ts — the single onCommand registration for the app lifetime
const unregisterCommands = onCommand(ipcMain, (command) => {
  switch (command.type) {
    case 'sendMessage': {
      const connection = router.route(command.payload.conversation_id)
      if (connection === null) {
        messageLifecycle.drop(command.payload.message_id, command.payload.conversation_id, 'route-refused')
        emitDaemonEvent(bindServerOrigin(live.sink, command.serverId ?? null), {
          type: 'messageDelivery', conversationId: command.payload.conversation_id,
          messageId: command.payload.message_id, status: 'not-sent'
        })
      } else {
        connection.send(command.payload)
      }
      return
    }
  }
})
app.on('will-quit', () => unregisterCommands())
```

- **Registered once**, at composition time, without a `did-finish-load` gate. An unavailable route reports Not sent and diagnoses a tracked submission; an unauthenticated connection retains admitted payloads.
- **`onCommand` uses `ipcMain.on` (additive)**, so the single-call discipline at this **sole registration site** is what makes "registering twice does not double-dispatch" true.
- **Symmetric teardown** — `will-quit` removes the exact listener, mirroring `unregisterPairing`.
- The command is **already validated** by `isRendererCommand` at the boundary ([#17](../codebase/17.md)). Lifecycle logging separately requires a held, validated composer UUID; command validation alone does not admit an id to diagnostics.

## Data flow

```
renderer composer (#66)
  → window.pyry.sendCommand({ type: 'sendMessage', payload })   // #17 preload bridge
  → preload isRendererCommand → ipcRenderer.send(COMMAND_CHANNEL, cmd)
  → ipcMain.on → onCommand listener → isRendererCommand (validate at untrusted boundary)
  → handler: router.route(conversation_id) → connection.send(command.payload)
  → validate/encode → copied payload FIFO → authenticated drain
  → buildSendMessage({ id, ts, payload }) → driver.sendMessage(bytes, observe)
  → session.sendMessage (AEAD seal) → sendFrame → InnerFrameV2 noise_msg → relay → daemon
```

## Message lifecycle diagnostics

With authenticated transport the desktop sends at idle and during a running turn;
the daemon owns the turn queue. Local reconnect holding is separate from that queue.
`createMessageLifecycle` in `src/main/messageLifecycle.ts` records
four events through the existing [diagnostic log](diagnostic-log.md), one JSON line
per observed transition. All records use the held local UUID as `messageId`:

| Event | Evidence |
|---|---|
| `message-queued` | The composer accepted a submission, before command dispatch. Blank input, no active conversation and the existing availability gate produce no lifecycle. |
| `message-sent` | The message's encrypted frame passed the socket OPEN guard and `ws.send` returned successfully. `connectionId` is the main-generated UUID also on that socket's `relay-open` and `relay-closed` records. Each new socket, across hosts and reconnects, gets a fresh UUID. |
| `message-acknowledged` | A decoded `queue_state` lists the held local id for its bound originating host and conversation. This establishes daemon possession, not a Claude answer. |
| `message-dropped` | A known local refusal/discard, or a separately classified user cancellation request. The `code` is one of the fixed reasons below. |

Repeated snapshots acknowledge once. Missing/empty ids, other clients' ids,
another conversation or host, and queue disappearance provide no acknowledgment.
Wire ids are comparison-only; the record uses the tracker’s held local id.
Closing a socket after sent without acknowledgment leaves delivery unknown. There
is no invented drop, timeout or resend.

An optional `SendOutcome` observer travels through connection → driver → session
→ supervisor → relay connection. Existing unrelated senders may omit it.
The session retains each observer beside its owned plaintext in the existing rekey
buffer: waiting emits no sent event; flushing observes each item's own write after
the cipher swap. Overflow diagnoses only the incoming send. Failed rekey or an
interrupted flush diagnoses abandoned entries; closing diagnoses retained entries
as teardown. Splice-before-flush and generation fencing preserve existing ownership
and ordering. Diagnostics do not own delivery or crypto behavior. The connection
retains the optional
observer across its local hold without reporting a transient refusal as a final drop.

Cancellation emits `message-dropped` with `code: 'user-cancel-request'` once for a
tracked id, including after acknowledgment. It reports the local request even if
the dequeue bridge fails; it does not establish daemon removal. It has a separate
deduplication flag: treating it as a terminal discard would hide a subsequent
write or acknowledgment from a message still in the rekey buffer. The existing
dequeue action and buffer behavior remain the owners of delivery behavior.

The synchronous tracker holds at most 1024 submissions and silently retires the
oldest when admitting another. Retirement emits no drop and suppresses later
observations for that retired entry. Queued, sent, acknowledged, actual discard
and cancellation records are deduplicated. Logger and observer faults are swallowed
so diagnosis cannot throw into sending. Host and conversation strings are held for
matching only; message content, attachments, keys, tokens, payloads and caught error
strings never enter these records.

## Error handling

| Failure | Layer | Result |
|---|---|---|
| Invalid/over-cap message | Validation or `encodeEnvelope` admission | No FIFO entry; `not-sent`, with content-free failure observation. |
| Incoming count/byte overflow or stopped connection | FIFO admission | Reject newest entry as `not-sent`; preserve older holds. |
| No authenticated driver / synchronous send refusal | Connection hold / driver observer | Retain payload as `waiting` for a successful same-pairing handshake. |
| Terminal connection failure | Connection lifecycle | Retain payload, mark `not-sent`; unchanged-pairing explicit Reconnect retries. |
| Driver/encoding/write/rekey failure after handoff | Drain / send observer | `not-sent`; no automatic retry of that entry. |
| Unroutable conversation | Trusted main router | Stamped `not-sent`; optional command host ID is attribution only. |
| Malformed command | Preload and main `isRendererCommand` | Preload throws fixed `Invalid command`; main independently drops malformed IPC before dispatch. Composer bridge failure preserves draft/attachments and a failed echo. |

The closed lifecycle discard codes are `bridge-failed`, `route-refused`,
`send-refused`, `send-failed`, `write-failed`, `rekey-buffer-full`,
`rekey-abandoned`, `rekey-teardown` and `user-cancel-request`. The driver's caught
frame-encoding or supervisor/socket-write failure uses `write-failed`; a refused
or failed write never emits sent. Caught objects are discarded.

Diagnostics and the typed `messageDelivery` event are independent. The latter carries
only correlation IDs and a closed status to the [existing echo sidecar](composer-send-internals.md#2-local-delivery-status-and-receipt-settlement);
no payload, key, raw bytes or caught error reaches it.

## The parity guard (mobile #490 / #31)

Transport send failures must not escape the handler or crash the process. Admission
and drain catch validation/encoding/driver exceptions and expose fixed delivery
categories. Disconnected accepted messages wait locally; permanent failures remain
visible on the echo. Preload's deliberate fixed-copy synchronous validation exception
is handled by the composer, preserving its draft and attachment take.

## Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS** (no findings). Code review: **PASS** (one NIT — the already-agreed exhaustiveness-tripwire deferral).

- **No secret rides this channel, by construction.** `SendMessagePayload` is `{ conversation_id, message_id, text, attachment_ids? }` — message plaintext plus, since [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055), routing ids for uploads already stored on the daemon host; still no token/key/byte field. An `attachment_id` is explicitly not a capability on this wire (not secret, not unguessable — it names a file the daemon already has, not a right to read one), so its addition does not weaken this property. `RendererCommand` references only `SendMessagePayload` ([#17](../codebase/17.md)), so a developer cannot serialize a secret onto this path. The device token continues to live only in the `hello` early-data and the relay headers, both sourced in `bootstrap`, not here.
- **Content-free; classify-don't-forward.** Catches discard the error object because its message could echo plaintext. Lifecycle records contain static events/reasons and validated local ids only; the existing console-silence assertion remains independent of the diagnostic sink. Controlled snapshots and the real serializer pin content exclusion; see [verification coverage](development-verification-test-tiers.md#message-lifecycle-diagnostics).
- **No new IPC / attack surface.** The single `onCommand` registration reuses the existing `COMMAND_CHANNEL` ([#17](command-channel.md)) via `ipcMain.on` (fire-and-forget, no reply channel to leak back through). Every argument is validated before `send` sees it. `contextIsolation`/`sandbox` posture unchanged. The renderer only sends a typed payload — it never touches `driver`, `session`, or bytes.
- **No new crypto.** This layer builds a plaintext envelope and hands it to the existing `driver.sendMessage` → `session.sendMessage`, which performs the vetted `Noise_IK_25519_ChaChaPoly_BLAKE2s` AEAD seal ([#7](noise-session.md)). No `(key, nonce)` pair is managed here.
- **Output size bounded twice on the existing path** — `encodeEnvelope` rejects an over-cap envelope (`MAX_PLAINTEXT_BYTES`), and `encodeInnerFrame` rejects an over-cap outer frame (`MAX_FRAME_BYTES`). A hostile-relay send failure degrades to a dropped message, not a hang or crash.

## Related

- [#65 codebase notes](../codebase/65.md) — implementation summary, patterns, lessons.
- [Composer send](composer-send.md) / [#66](../codebase/66.md) — the renderer half that emits the `sendMessage` command this path receives; together the two halves of sending a message.
- [Daemon connection](daemon-connection.md) / [#62](../codebase/62.md) — hosts the `send` entry point alongside `start`/`stop`; owns the `driver` local, the `now` clock seam, and the classify-don't-forward discipline this inherits.
- [Command channel](command-channel.md) / [#17](../codebase/17.md) — the `onCommand` seam + `isRendererCommand` boundary guard this registers against; #65 closes its deferred single-registration item.
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — `buildClientHello`, the pure builder `buildSendMessage` mirrors; both wrap a payload in an `Envelope` and `encodeEnvelope` to UTF-8 bytes.
- [Noise relay driver](noise-relay-driver.md) / [#50](../codebase/50.md) — `driver.sendMessage(plaintext)`, the send target; its refusal/write observations determine when the connection retains or releases a payload.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — `encodeEnvelope` (the `WireEncodeError` throw source) and the `Envelope` / `SendMessagePayload` / `MAX_PLAINTEXT_BYTES` types.
