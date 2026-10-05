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

The closure binds a tracked composer submission to `deps.serverId`, obtains its
optional observer, checks `driver === null`, then wraps building and sending in
`try/catch`. `nextEnvelopeId` starts at **2** (the `hello` consumed id 1):

```ts
function send(payload: SendMessagePayload): void {
  const observe = deps.messageLifecycle?.sending(
    payload.message_id, payload.conversation_id, deps.serverId
  )
  if (driver === null) {
    notifySend(observe, { type: 'dropped', reason: 'send-refused' })
    return
  }
  try {
    const bytes = buildSendMessage({ id: nextEnvelopeId, ts: now(), payload })
    nextEnvelopeId += 1                      // advance only on a successful build
    driver.sendMessage(bytes, observe)
  } catch {
    notifySend(observe, { type: 'dropped', reason: 'send-failed' })
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

A `connected` flag adds no delivery capability. The optional observer classifies
these refusals as `send-refused`; a nonthrowing call remains insufficient evidence
that a frame was written.

### The envelope-id counter

`nextEnvelopeId` is a **module-local, single-writer counter**. `send` contains **no `await`**, so it runs to completion without interleaving — no check-then-act race. It advances **only on a successful build**, so a dropped over-cap send does not consume an id. Gaps are harmless: the daemon uses the envelope `id` for `in_reply_to` correlation, **not sequencing**. (It is a wire-protocol correlation id, **not a Noise nonce** — the Noise session owns its own per-direction nonce counter; no randomness is needed or used here.)

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
      } else {
        connection.send(command.payload)
      }
      return
    }
  }
})
app.on('will-quit', () => unregisterCommands())
```

- **Registered once**, at composition time, without a `did-finish-load` gate. An unavailable route or driver refuses delivery safely and diagnoses a tracked submission.
- **`onCommand` uses `ipcMain.on` (additive)**, so the single-call discipline at this **sole registration site** is what makes "registering twice does not double-dispatch" true.
- **Symmetric teardown** — `will-quit` removes the exact listener, mirroring `unregisterPairing`.
- The command is **already validated** by `isRendererCommand` at the boundary ([#17](../codebase/17.md)). Lifecycle logging separately requires a held, validated composer UUID; command validation alone does not admit an id to diagnostics.

## Data flow

```
renderer composer (#66)
  → window.pyry.sendCommand({ type: 'sendMessage', payload })   // #17 preload bridge
  → ipcRenderer.send(COMMAND_CHANNEL, cmd)
  → ipcMain.on → onCommand listener → isRendererCommand (validate at untrusted boundary)
  → handler: router.route(conversation_id) → connection.send(command.payload)
  → buildSendMessage({ id, ts, payload }) → driver.sendMessage(bytes, observe)
  → session.sendMessage (AEAD seal) → sendFrame → InnerFrameV2 noise_msg → relay → daemon
```

## Message lifecycle diagnostics

The desktop sends immediately at idle and during a running turn; the daemon owns
the turn queue. `createMessageLifecycle` in `src/main/messageLifecycle.ts` records
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
and ordering. Diagnostics add no delivery queue or crypto behavior.

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
| Over-cap plaintext (huge `text`) | `encodeEnvelope` → `WireEncodeError` | Caught in `send`; id **not** consumed; tracked submission gets `send-failed`. |
| Driver / wasm throw during a connected send | `driver.sendMessage` | Caught by the full-body `try/catch`; tracked submission gets `send-failed`. |
| Command arrives disconnected / pre-handshake / post-terminal | `driver === null` guard **or** driver/session refusal | No write or throw; tracked submission gets `send-refused`. |
| Malformed command from the renderer | `isRendererCommand` ([#17](../codebase/17.md)) | Dropped at the boundary before `send`; never reaches this layer. |

The closed lifecycle discard codes are `bridge-failed`, `route-refused`,
`send-refused`, `send-failed`, `write-failed`, `rekey-buffer-full`,
`rekey-abandoned`, `rekey-teardown` and `user-cancel-request`. The driver's caught
frame-encoding or supervisor/socket-write failure uses `write-failed`; a refused
or failed write never emits sent. Caught objects are discarded.

These records diagnose a send without adding a per-message failure event to the
renderer. The existing optimistic echo and delivery UI behavior are unchanged.

## The parity guard (mobile #490 / #31)

Mobile's first real-device run crashed because a relay command started a call with no error handling and the uncaught throw killed the process. The desktop send path **must never throw out of the handler or the module**: a command arriving while disconnected, pre-handshake, or post-terminal is **dropped, never propagated as a crash**. The full-body `try/catch` (not just around the build) plus the `driver === null` guard are the deterministic no-throw guarantee. [#31](https://github.com/pyrycode/pyrycode-desktop/issues/31) is the broader sweep across all relay commands; #65 landed the guard for the one send path.

## Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS** (no findings). Code review: **PASS** (one NIT — the already-agreed exhaustiveness-tripwire deferral).

- **No secret rides this channel, by construction.** `SendMessagePayload` is `{ conversation_id, message_id, text, attachment_ids? }` — message plaintext plus, since [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055), routing ids for uploads already stored on the daemon host; still no token/key/byte field. An `attachment_id` is explicitly not a capability on this wire (not secret, not unguessable — it names a file the daemon already has, not a right to read one), so its addition does not weaken this property. `RendererCommand` references only `SendMessagePayload` ([#17](../codebase/17.md)), so a developer cannot serialize a secret onto this path. The device token continues to live only in the `hello` early-data and the relay headers, both sourced in `bootstrap`, not here.
- **Content-free; classify-don't-forward.** Catches discard the error object because its message could echo plaintext. Lifecycle records contain static events/reasons and validated local ids only; the existing console-silence assertion remains independent of the diagnostic sink. Controlled snapshots and the real serializer pin content exclusion; see [verification coverage](development-verification.md#message-lifecycle-diagnostics).
- **No new IPC / attack surface.** The single `onCommand` registration reuses the existing `COMMAND_CHANNEL` ([#17](command-channel.md)) via `ipcMain.on` (fire-and-forget, no reply channel to leak back through). Every argument is validated before `send` sees it. `contextIsolation`/`sandbox` posture unchanged. The renderer only sends a typed payload — it never touches `driver`, `session`, or bytes.
- **No new crypto.** This layer builds a plaintext envelope and hands it to the existing `driver.sendMessage` → `session.sendMessage`, which performs the vetted `Noise_IK_25519_ChaChaPoly_BLAKE2s` AEAD seal ([#7](noise-session.md)). No `(key, nonce)` pair is managed here.
- **Output size bounded twice on the existing path** — `encodeEnvelope` rejects an over-cap envelope (`MAX_PLAINTEXT_BYTES`), and `encodeInnerFrame` rejects an over-cap outer frame (`MAX_FRAME_BYTES`). A hostile-relay send failure degrades to a dropped message, not a hang or crash.

## Related

- [#65 codebase notes](../codebase/65.md) — implementation summary, patterns, lessons.
- [Composer send](composer-send.md) / [#66](../codebase/66.md) — the renderer half that emits the `sendMessage` command this path receives; together the two halves of sending a message.
- [Daemon connection](daemon-connection.md) / [#62](../codebase/62.md) — hosts the `send` entry point alongside `start`/`stop`; owns the `driver` local, the `now` clock seam, and the classify-don't-forward discipline this inherits.
- [Command channel](command-channel.md) / [#17](../codebase/17.md) — the `onCommand` seam + `isRendererCommand` boundary guard this registers against; #65 closes its deferred single-registration item.
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — `buildClientHello`, the pure builder `buildSendMessage` mirrors; both wrap a payload in an `Envelope` and `encodeEnvelope` to UTF-8 bytes.
- [Noise relay driver](noise-relay-driver.md) / [#50](../codebase/50.md) — `driver.sendMessage(plaintext)`, the send target; its documented pre-handshake/post-terminal inertness is what lets the connection use a single `driver === null` guard.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — `encodeEnvelope` (the `WireEncodeError` throw source) and the `Envelope` / `SendMessagePayload` / `MAX_PLAINTEXT_BYTES` types.
