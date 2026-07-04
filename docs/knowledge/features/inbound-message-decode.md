# Inbound message decode

The **untrusted→trusted boundary for a decrypted daemon message**. The [Noise relay driver](noise-relay-driver.md) hands each decrypted application frame up as opaque bytes (`RelaySessionEvent{ type: 'message'; plaintext }`); this is the layer that turns those bytes into a narrowed, typed `MessagePayload` the renderer can render — or drops them, failing closed, if a hostile or buggy daemon shaped them wrong. It is the inbound counterpart to the [hello exchange](hello-exchange.md) (`parseHelloAck`) and the [outbound send path](outbound-send-path.md) (`buildSendMessage`): same one-concern-per-file split under `src/main/transport/`.

Introduced in [#68](../codebase/68.md). It fills the last no-op arm the [daemon connection](daemon-connection.md) left behind — [#62](../codebase/62.md) wired the handshake-status path but left the inbound-message arm a `// TODO`. This ticket produces the `messageReceived` / `messagesReceived` events that feed the already-complete renderer pipeline: the [daemon-event channel](daemon-event-channel.md) ([#18](../codebase/18.md)) carries them, the [daemon-event bridge](daemon-event-bridge.md) ([#19](../codebase/19.md)) translates them into `SessionAction`s, and the [session store](session-store.md) ([#2](../codebase/2.md)) appends them (deduped by `message_id`, arrival order preserved).

## Where it lives

`src/main/transport/inboundMessage.ts` — sibling to `helloExchange.ts` (handshake `hello` / `hello_ack`) and `sendMessageEnvelope.ts` (outbound builder). **Main-process only:** it imports the [wire codec](wire-codec.md) (`codec.ts`, transitively Node `Buffer`) and the payload it narrows carries message plaintext. It is never re-exported through a renderer barrel — the plaintext and raw bytes must stay out of the web layer.

Crucially, it is **IPC-free**: it never imports `DaemonEvent` or `emitDaemonEvent`. The `transport/` directory holds the wire boundary; the [daemon connection](daemon-connection.md) — one level up at top-level `src/main/` — owns the IPC mapping. This preserves the placement rule [#62](../codebase/62.md) established (a module that imports both a `transport/` primitive **and** the IPC layer must sit above `transport/`).

## Public contract

```ts
// Which modeled app-message the envelope carried. NOT a wire type and NOT a DaemonEvent —
// an internal transport result the daemon-connection consumer maps onto the IPC channel.
export type InboundDaemonMessage =
  | { kind: 'message'; message: MessagePayload }
  | { kind: 'chunk'; messages: MessagePayload[] }

// Decode + route + narrow one decrypted app-message plaintext:
//  • InboundDaemonMessage  — a `message` or `message_chunk` envelope, fully narrowed
//  • null                  — a well-formed envelope of any OTHER type (ignored)
//  • throws WireDecodeError — oversized / malformed / unparseable / mistyped payload (fail-closed)
export function parseInboundMessage(plaintext: Uint8Array): InboundDaemonMessage | null
```

A **single throw type** (`WireDecodeError`) covers every failure, so the consumer's one `catch` handles oversized, malformed, unparseable, and mistyped alike — exactly the shape `parseHelloAck` uses for the `hello_ack` boundary.

## How it works

`parseInboundMessage` layers the semantic narrowing the codec deliberately defers (`Envelope.payload` stays `unknown`) onto `decodeEnvelope`'s structural boundary, plus the oversized guard `decodeEnvelope` omits:

1. **Size guard.** `plaintext.length > MAX_PLAINTEXT_BYTES` (65519) → throw. `decodeEnvelope` does **not** size-check, so this is the only thing that fails an oversized-but-valid-JSON frame closed at this boundary. (Belt-and-suspenders: the upstream Noise transport already bounds the plaintext, but this boundary re-checks what it owns — the unit test drives this function directly, and a future driver change must not silently un-bound it. See § Why the explicit size guard.)
2. **`decodeEnvelope(plaintext)`** — inherits the codec's fail-closed rejection of bad UTF-8, malformed JSON, a non-object top-level, and a missing `id` / `type` / `ts` / `payload`.
3. **Route on `envelope.type`:**
   - `'message'` → `{ kind: 'message', message: parseMessagePayload(payload) }`
   - `'message_chunk'` → `{ kind: 'chunk', messages: parseMessageChunkPayload(payload).messages }`
   - anything else → `return null` — a well-formed `ack` / `error` / `hello_ack` / etc. is **not an error**, it is simply not modeled here.

### Payload narrowing

Two private validators (tested through `parseInboundMessage`, never exported), built on two **local copies** of `isRecord` / `requireString` — the same deliberate duplication [`helloExchange.ts`](hello-exchange.md) uses, for the same reason: the codec's `isRecord` is unexported, and copying it keeps this the edge that validates the opaque payload. No shared validators module; `helloExchange.ts` is not refactored.

- **`parseMessagePayload`** — `isRecord` guard, then `conversation_id` / `message_id` / `text` via `requireString`, then a single `role` enum check (`!== 'user' && !== 'assistant'` → throw). That one check subsumes non-string **and** unknown-string, narrowing to `WireRole` without a cast. Returns only the four known fields; unknown server-added keys are tolerated but dropped (forward-compat, matching `parseHelloAck`).
- **`parseMessageChunkPayload`** — `isRecord` guard, `messages` must be `Array.isArray`, then `raw.map(parseMessagePayload)`: **one bad element throws, failing the whole chunk closed.** An **empty array is valid** — a zero-length batch, harmless downstream (the store handles it as a no-op append).

### Category-only error messages

Every `WireDecodeError` names the failure **category only** (`'missing required field: role'`, `'malformed message payload'`, `'inbound plaintext exceeds max size'`) — it **never interpolates a field value**. `role`, `text`, and `conversation_id` are user conversation content; a `` `bad role: ${role}` `` message would echo that content into an error string a future caller might surface. The consumer drops the caught object today, so this is defense-in-depth — but it becomes load-bearing the moment any caller logs the message. Matches `codec.ts` / `helloExchange.ts`.

### The consumer arm (`daemonConnection.ts`)

The [daemon connection](daemon-connection.md)'s `case 'message'` arm is now a thin `InboundDaemonMessage → DaemonEvent` mapper — the module's single IPC choke point:

```ts
case 'message': {
  let inbound: InboundDaemonMessage | null
  try {
    inbound = parseInboundMessage(event.plaintext)
  } catch {
    return                                            // fail-closed: drop the frame, no event, no throw
  }
  if (inbound === null) return                        // other envelope type: ignored, no event
  if (inbound.kind === 'message') {
    emitDaemonEvent(sink, { type: 'messageReceived', message: inbound.message })
  } else {
    emitDaemonEvent(sink, { type: 'messagesReceived', messages: inbound.messages })
  }
  return
}
```

The caught `WireDecodeError` is **dropped** (classify-don't-forward): its message could echo message plaintext, so it never reaches a log or an event.

## Data flow

```
relay socket → supervisor → noiseRelayDriver (Noise decrypt)
  → RelaySessionEvent{ type:'message', plaintext }
    → daemonConnection.onDriverEvent  case 'message'
      → parseInboundMessage(plaintext)     [transport: size guard + decodeEnvelope + route + narrow]
        ├─ throw  → catch → drop (no event)
        ├─ null   → ignore (no event)
        ├─ {kind:'message'} → emitDaemonEvent messageReceived
        └─ {kind:'chunk'}   → emitDaemonEvent messagesReceived
          → DAEMON_EVENT_CHANNEL → #19 bridge → #2 store (appendUnique: dedupe + order)
```

## Error handling

| Layer | Result | Failure behavior |
|---|---|---|
| `parseInboundMessage` (transport) | `InboundDaemonMessage \| null` | Throws a single type — `WireDecodeError` — on oversized / malformed / unparseable / mistyped. `null` for a well-formed but unmodeled envelope type (**not** a failure). |
| `case 'message'` arm (consumer) | `void` | `try/catch` → a throw is **dropped silently** (no event, no log, caught object not forwarded); `null` → ignored; a result → exactly one `DaemonEvent`. **Never throws out of the module.** |
| UI | — | A dropped inbound frame surfaces **nothing** (no `failed`, no banner). A single malformed *message* frame is not connection-fatal — the session continues. Deliberately different from a malformed `hello_ack`, which **is** fatal (`failed('malformed-hello-ack')`) because the handshake cannot complete without it. |

## Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS**. This is the "hostile daemon response" trust boundary — decrypted bytes from a relay peer on an internet-exposed surface.

- **A single explicit boundary.** `payload: unknown` never escapes `parseInboundMessage`; downstream (the consumer arm, `DaemonEvent`, the store) holds only concrete wire types. Envelope metadata (`id` / `ts` / `in_reply_to` / `event_id`) is never forwarded — only `type` (for routing) and the narrowed payload cross.
- **Fail-closed on every hostile shape.** Malformed / oversized / unparseable / mistyped / unknown-`role` / non-array `messages` / one-bad-element chunk each drops the frame — no partial value ever surfaces.
- **Log-free, secret-safe.** No `console.*` on any path; category-only `WireDecodeError` messages carry no field value; the consumer drops the caught object. Pinned by a six-method `console`-spy and an assertion that a thrown message never contains the `role` / `text` / `conversation_id` value (the `role` case is where a naive impl would interpolate). Message *content* reaching the renderer is the **intended data path**, not a leak — the [#18](../codebase/18.md) `DaemonEvent` union cannot hold a token/key/raw frame by construction.
- **Bounded per-frame work.** The size cap makes work O(size) with size capped; a `message_chunk` array is inherently small (each complete message > 60 bytes, cap 65519) and aborts on the first bad element. A hostile daemon cannot flood an unbounded frame; deep-nesting JSON fails closed via the codec's `RangeError` catch.

## Edge cases and limitations

- **No dedupe, no reorder — arrival order only.** Two `message` frames with the same `message_id` produce two `messageReceived` events. Ordering and dedupe are the renderer store's responsibility ([`appendUnique`, ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)); this module deliberately does neither.
- **`message_chunk` carries complete messages, not partial tokens** — no token coalescing here (see the store's `SessionAction` doc comment). A chunk is a batch of whole `MessagePayload`s.
- **An empty `message_chunk` emits `messagesReceived` with `[]`.** A zero-length batch is a valid, harmless event. If the daemon is later found to never send empty chunks, dropping them is a trivial future tightening — not this boundary's concern.
- **Unmodeled envelope types are silently ignored.** `ack` / `error` / `backfill_since` / etc. return `null` and emit nothing — decoding/routing them is out of scope for this ticket.

### Why the explicit size guard, given the transport already bounds the plaintext

A Noise transport message is ≤ 65535 bytes, so a single decrypted plaintext is structurally ≤ `MAX_PLAINTEXT_BYTES`. But this module's trust boundary is its **own function argument**, not the socket: the unit test drives `parseInboundMessage` directly (the transport cap is not in the loop), and a future change to the driver's guarantees must not silently un-bound this arm. The guard is one deterministic line, directly satisfies the "oversized" AC, and is testable at this boundary — belt (upstream Noise cap) and suspenders (this check), both deterministic code. It does **not** modify `decodeEnvelope` (shared with the ack path), so there is no drift.

## Related

- [#68 codebase notes](../codebase/68.md) — implementation summary, patterns, lessons.
- [Daemon connection](daemon-connection.md) / [#62](../codebase/62.md) — hosts the `case 'message'` arm that calls this and maps its result onto the IPC channel; owns the single choke point and the classify-don't-forward discipline this inherits.
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — `parseHelloAck`, the fail-closed narrowing shape this mirrors (`isRecord` guard → per-field checks → `WireDecodeError`, category-only messages). The local `isRecord` / `requireString` copies follow its precedent.
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the outbound sibling under `transport/`; `sendMessageEnvelope.ts`'s header conventions this file mirrors.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — `decodeEnvelope` (structural boundary, `payload: unknown`, `WireDecodeError` source) + the `MessagePayload` / `MessageChunkPayload` / `MAX_PLAINTEXT_BYTES` types this narrows to.
- [Daemon-event channel](daemon-event-channel.md) / [#18](../codebase/18.md) — the `messageReceived` / `messagesReceived` `DaemonEvent` members this feeds.
- [Daemon-event bridge](daemon-event-bridge.md) / [#19](../codebase/19.md) + [Session store](session-store.md) / [#2](../codebase/2.md) + [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the renderer half that dedupes by `message_id` and preserves arrival order.
- [Noise relay driver](noise-relay-driver.md) / [#50](../codebase/50.md) — surfaces the `message{plaintext}` event this decodes.
- Daemon/mobile peer (QMD `pyrycode-docs`): `internal/protocol` v1 messaging structs (#272 — `MessageChunkPayload.Messages` reuses `MessagePayload`, "same shape as `message.payload`, multiple") + `protocol-mobile.md` § application message types — the Go side that emits the `message` / `message_chunk` envelopes this narrows.
