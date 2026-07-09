# Inbound message decode

The **untrusted→trusted boundary for a decrypted daemon message**. The [Noise relay driver](noise-relay-driver.md) hands each decrypted application frame up as opaque bytes (`RelaySessionEvent{ type: 'message'; plaintext }`); this is the layer that turns those bytes into a narrowed, typed `MessagePayload` the renderer can render — or drops them, failing closed, if a hostile or buggy daemon shaped them wrong. It is the inbound counterpart to the [hello exchange](hello-exchange.md) (`parseHelloAck`) and the [outbound send path](outbound-send-path.md) (`buildSendMessage`): same one-concern-per-file split under `src/main/transport/`.

Introduced in [#68](../codebase/68.md). It fills the last no-op arm the [daemon connection](daemon-connection.md) left behind — [#62](../codebase/62.md) wired the handshake-status path but left the inbound-message arm a `// TODO`. This ticket produces the `messageReceived` / `messagesReceived` events that feed the already-complete renderer pipeline: the [daemon-event channel](daemon-event-channel.md) ([#18](../codebase/18.md)) carries them, the [daemon-event bridge](daemon-event-bridge.md) ([#19](../codebase/19.md)) translates them into `SessionAction`s, and the [session store](session-store.md) ([#2](../codebase/2.md)) appends them (deduped by `message_id`, arrival order preserved).

[#180](../codebase/180.md) extended this boundary again, additively, with a `screen_snapshot` →
`snapshot` kind for the [screen snapshot fetch](screen-snapshot-fetch.md) feature — see below.

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
  | { kind: 'bundle-chunk'; seq: number; data: Uint8Array }   // #116, additive
  | { kind: 'bundle-done'; total: number }                    // #116, additive
  | { kind: 'daemon-error' }                                  // #116, additive — content-free
  | { kind: 'snapshot'; snapshot: ScreenSnapshotPayload }      // #180, additive

// Decode + route + narrow one decrypted app-message plaintext:
//  • InboundDaemonMessage  — a `message`/`message_chunk`/bundle/`error`/`screen_snapshot` envelope, fully narrowed
//  • null                  — a well-formed envelope of any OTHER type (ignored)
//  • throws WireDecodeError — oversized / malformed / unparseable / mistyped payload (fail-closed)
export function parseInboundMessage(
  plaintext: Uint8Array,
  diagnosticLog?: DiagnosticLog       // #130 — optional injected content-free logger; absent ⇒ silent
): InboundDaemonMessage | null
```

**Extended by [#116](../codebase/116.md), additively.** The `message` / `message_chunk` recognition and narrowing described below are unchanged byte-for-byte. Three more kinds are now recognized *before* the `default` (unmodeled) branch: `debug_bundle_chunk` → `{ kind: 'bundle-chunk', seq, data }` (base64-decoded via the codec's **strict** `base64StdDecode` right at this boundary, so the [reassembler](debug-bundle-reassembly.md) downstream stays byte-pure), `debug_bundle_done` → `{ kind: 'bundle-done', total }`, and `error` → `{ kind: 'daemon-error' }` (content-free — no `ErrorPayload` field is narrowed). A new `requireNumber` helper sits beside `requireString` for the two numeric fields (`seq`/`total`). Modeling `error` is a deliberate, generally-applicable change: it moves from silently-dropped `inbound-unmodeled` to a modeled, content-free `inbound-decoded(code: 'error')` for **every** `error` frame, bundle-related or not — see the diagnostic-logging table below.

**Extended again by [#180](../codebase/180.md), additively.** `screen_snapshot` → `{ kind: 'snapshot', snapshot: ScreenSnapshotPayload }` via `parseScreenSnapshotPayload`, the [screen snapshot fetch](screen-snapshot-fetch.md) feature's decode half. A new `requireBoolean` helper sits beside `requireString`/`requireNumber` for the reply's `yolo` field — it checks the value's *type*, never its truthiness, so `false` decodes as a real value (permissions enforced) rather than a missing field; the same discipline applies to `model`/`effort`, where `''` means "inherited daemon default," never "absent" (all six fields are always present on the wire, no `omitempty`). Unlike the bundle kinds, the `snapshot` kind carries the **full** decoded payload — including `text`, the rendered screen — through this boundary; the content-minimisation drop of `text`/`ts`/`conversation_id` happens one layer up, at the `daemonConnection.ts` consumer arm (see [daemon connection](daemon-connection.md) and [screen snapshot fetch](screen-snapshot-fetch.md)), not here.

The optional second parameter is the [content-free diagnostic logger](diagnostic-log.md) ([#130](../codebase/130.md)). Absent it, the module is silent and behaves exactly as before; injected, each of the two non-throwing outcomes leaves a content-free record (§ *Diagnostic logging*).

A **single throw type** (`WireDecodeError`) covers every failure, so the consumer's one `catch` handles oversized, malformed, unparseable, and mistyped alike — exactly the shape `parseHelloAck` uses for the `hello_ack` boundary.

## How it works

`parseInboundMessage` layers the semantic narrowing the codec deliberately defers (`Envelope.payload` stays `unknown`) onto `decodeEnvelope`'s structural boundary, plus the oversized guard `decodeEnvelope` omits:

1. **Size guard.** `plaintext.length > MAX_PLAINTEXT_BYTES` (65519) → throw. `decodeEnvelope` does **not** size-check, so this is the only thing that fails an oversized-but-valid-JSON frame closed at this boundary. (Belt-and-suspenders: the upstream Noise transport already bounds the plaintext, but this boundary re-checks what it owns — the unit test drives this function directly, and a future driver change must not silently un-bound it. See § Why the explicit size guard.)
2. **`decodeEnvelope(plaintext)`** — inherits the codec's fail-closed rejection of bad UTF-8, malformed JSON, a non-object top-level, and a missing `id` / `type` / `ts` / `payload`.
3. **Route on `envelope.type`:**
   - `'message'` → `{ kind: 'message', message: parseMessagePayload(payload) }`
   - `'message_chunk'` → `{ kind: 'chunk', messages: parseMessageChunkPayload(payload).messages }`
   - `'debug_bundle_chunk'` / `'debug_bundle_done'` / `'error'` → the three additive kinds ([#116](../codebase/116.md), see above) — narrowed and content-free-logged as `inbound-decoded` before the `default` branch is ever reached.
   - `'screen_snapshot'` → `{ kind: 'snapshot', snapshot }` ([#180](../codebase/180.md)) — narrowed via `parseScreenSnapshotPayload` (fail-closed, all six fields required-present), then content-free-logged as `inbound-decoded(code: 'screen_snapshot')` before the `default` branch.
   - anything else → `return null` — a well-formed `ack` / `hello_ack` / `backfill_since` / etc. is **not an error**, it is simply not modeled here. Since [#130](../codebase/130.md) it is also **logged content-free** (`inbound-unmodeled`, § *Diagnostic logging*) before the `return null`, so an unforeseen envelope kind leaves a footprint instead of vanishing; the return value and the "not surfaced to the UI" behavior are unchanged. (`error` was in this bucket until [#116](../codebase/116.md) promoted it to modeled — see above.)

### Payload narrowing

Two private validators (tested through `parseInboundMessage`, never exported), built on two **local copies** of `isRecord` / `requireString` — the same deliberate duplication [`helloExchange.ts`](hello-exchange.md) uses, for the same reason: the codec's `isRecord` is unexported, and copying it keeps this the edge that validates the opaque payload. No shared validators module; `helloExchange.ts` is not refactored.

- **`parseMessagePayload`** — `isRecord` guard, then `conversation_id` / `message_id` / `text` via `requireString`, then a single `role` enum check (`!== 'user' && !== 'assistant'` → throw). That one check subsumes non-string **and** unknown-string, narrowing to `WireRole` without a cast. Returns only the four known fields; unknown server-added keys are tolerated but dropped (forward-compat, matching `parseHelloAck`).
- **`parseMessageChunkPayload`** — `isRecord` guard, `messages` must be `Array.isArray`, then `raw.map(parseMessagePayload)`: **one bad element throws, failing the whole chunk closed.** An **empty array is valid** — a zero-length batch, harmless downstream (the store handles it as a no-op append).

### Category-only error messages

Every `WireDecodeError` names the failure **category only** (`'missing required field: role'`, `'malformed message payload'`, `'inbound plaintext exceeds max size'`) — it **never interpolates a field value**. `role`, `text`, and `conversation_id` are user conversation content; a `` `bad role: ${role}` `` message would echo that content into an error string a future caller might surface. The consumer drops the caught object today, so this is defense-in-depth — but it becomes load-bearing the moment any caller logs the message. Matches `codec.ts` / `helloExchange.ts`.

### Diagnostic logging (#130)

The module's header once declared *"This module performs no logging."* [#130](../codebase/130.md) deliberately flips that invariant **for this file only**, wiring in the merged [content-free diagnostic logger](diagnostic-log.md) ([#126](../codebase/126.md)) so a wire-integrity fault — a message recurring, changing between send and receive, truncating, or arriving as an unforeseen kind — leaves a footprint. Each of the two **non-throwing** outcomes emits one content-free record; the record carries the envelope type, the plaintext byte length, a one-way hash of the frame, and the logger's own monotonic `seq` — **never the payload value or any decoded field**:

| Outcome | Event | Fields |
|---|---|---|
| modeled `message` | `inbound-decoded` | `code: 'message'`, `bytes: plaintext.length`, `hash` |
| modeled `message_chunk` | `inbound-decoded` | `code: 'message_chunk'`, `bytes`, `count: messages.length`, `hash` |
| modeled `debug_bundle_chunk` / `debug_bundle_done` / `error` ([#116](../codebase/116.md)) | `inbound-decoded` | `code: <the type>`, `bytes`, `hash` — never `seq`/`total`/`data`/the daemon's `ErrorPayload` text |
| modeled `screen_snapshot` ([#180](../codebase/180.md)) | `inbound-decoded` | `code: 'screen_snapshot'`, `bytes`, `hash` — never `text`/`conversation_id`/`model`/`effort`/`yolo` |
| unmodeled (`default`) | `inbound-unmodeled` | `code: envelope.type.slice(0, 64)`, `bytes`, `hash` |

Load-bearing details:

- **Log AFTER the narrower returns.** Each modeled-arm `event()` fires *after* `parseMessagePayload` / `parseMessageChunkPayload` succeeds, so a frame that fails to narrow throws first and produces **no** record. The size guard and `decodeEnvelope` throws also precede the switch. Ordering — not a flag — is what keeps the **throw path unlogged** (the pre-decryption raw-byte case is sibling [#133](https://github.com/pyrycode/pyrycode-desktop/issues/133); a content-free log for the *post-decryption semantic* throw is a deferred open question).
- **`hash` = BLAKE2s-256 of the plaintext FRAME, not `envelope.payload`.** `hashPlaintext` runs `blake2s(plaintext, { dkLen: 32 })` → 64-char hex, over the input bytes. Hashing the whole frame (not just the payload text) is a **security** choice as much as a determinism one: the digest is implicitly salted by the server-assigned `id` / `ts` / `message_id`, so a read-the-log dictionary attack ("did the user type X?") must reconstruct the entire frame, not merely guess the text. `blake2s` comes from `@noble/hashes`, not `node:crypto` — Electron's BoringSSL has no BLAKE2 ([#101](../codebase/101.md)).
- **The one peer-controlled string is capped.** The modeled arms log a **static type literal** into `code`; the unmodeled arm logs the daemon-supplied `envelope.type` — capped `slice(0, MAX_LOGGED_TYPE_CHARS)` (64). Lossless for real wire types (all < 16 chars); a deterministic bound on a hostile daemon that could otherwise stuff up to `MAX_PLAINTEXT_BYTES` of text into `type`. The [#126](../codebase/126.md) serializer JSON-escapes it, so a crafted `type` cannot split one record into two lines.
- **Absent-logger costs nothing.** `diagnosticLog?.event({ … hash: hashPlaintext(plaintext) })` — the `?.` short-circuits the whole call *including* the hash when no logger is injected, so existing callers pay zero and cannot throw (the AC5 backward-compat property, mirroring `relayConnection`).

The allowlist extension is a single additive optional field on `DiagnosticEvent` — `hash?: string`; the length reuses the pre-existing `bytes?`. See [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md) for the allowlist-not-scrubber contract.

### The consumer arm (`daemonConnection.ts`)

The [daemon connection](daemon-connection.md)'s `case 'message'` arm is a thin `InboundDaemonMessage → DaemonEvent` mapper — the module's single IPC choke point. As of [#116](../codebase/116.md) it routes on `inbound.kind` via a `switch`, additively: the `message`/`chunk` arms are unchanged, and the three bundle kinds are routed to the [debug-bundle reassembler](debug-bundle-reassembly.md) instead of the IPC channel (bundle frames emit **no** `DaemonEvent`):

```ts
case 'message': {
  let inbound: InboundDaemonMessage | null
  try {
    inbound = parseInboundMessage(event.plaintext, deps.diagnosticLog)   // #130: thread the logger
  } catch {
    return                                            // fail-closed: drop the frame, no event, no throw
  }
  if (inbound === null) return                        // other envelope type: ignored, no event
  switch (inbound.kind) {
    case 'message':
      emitDaemonEvent(sink, { type: 'messageReceived', message: inbound.message })
      return
    case 'chunk':
      emitDaemonEvent(sink, { type: 'messagesReceived', messages: inbound.messages })
      return
    case 'bundle-chunk':
      reassembler?.chunk(inbound.seq, inbound.data)     // #116: routed to the reassembler, not IPC
      return
    case 'bundle-done':
      reassembler?.done(inbound.total)
      return
    case 'daemon-error':
      reassembler?.fail('daemon-error')
      return
    case 'snapshot':
      // #180: content-minimisation seam — text/ts/conversation_id are decoded but dropped HERE;
      // only the three settings fields cross to the renderer.
      emitDaemonEvent(sink, {
        type: 'snapshotReceived',
        model: inbound.snapshot.model,
        effort: inbound.snapshot.effort,
        yolo: inbound.snapshot.yolo
      })
      return
  }
  return
}
```

The caught `WireDecodeError` is **dropped** (classify-don't-forward): its message could echo message plaintext, so it never reaches a log or an event. A bundle frame with no active (or already-settled) `reassembler` is a no-op via optional chaining — preserving the pre-#116 drop behavior when no bundle request is in flight.

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
- **Content-free-log by construction, secret-safe.** No `console.*` on any path; category-only `WireDecodeError` messages carry no field value; the consumer drops the caught object. Since [#130](../codebase/130.md) the module *does* log — but only a content-free record (type + `seq` + length + one-way hash), never a payload byte or a decoded field: the modeled arms log a static type literal, the unmodeled arm a **capped** peer type, and every record's `hash` is a full-frame BLAKE2s digest implicitly salted by the server-assigned `id`/`ts`/`message_id` (so the log can't confirm a guessed message). Pinned by a six-method `console`-spy (still green — #130 logs via the injected sink, never `console`), an assertion that a thrown message never contains the `role` / `text` / `conversation_id` value, and an AC4 test asserting the serialized log line contains the hash but **neither** planted secret. Message *content* reaching the renderer is the **intended data path**, not a leak — the [#18](../codebase/18.md) `DaemonEvent` union cannot hold a token/key/raw frame by construction.
- **Bounded per-frame work.** The size cap makes work O(size) with size capped; a `message_chunk` array is inherently small (each complete message > 60 bytes, cap 65519) and aborts on the first bad element. A hostile daemon cannot flood an unbounded frame; deep-nesting JSON fails closed via the codec's `RangeError` catch.

## Edge cases and limitations

- **No dedupe, no reorder — arrival order only.** Two `message` frames with the same `message_id` produce two `messageReceived` events. Ordering and dedupe are the renderer store's responsibility ([`appendUnique`, ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)); this module deliberately does neither.
- **`message_chunk` carries complete messages, not partial tokens** — no token coalescing here (see the store's `SessionAction` doc comment). A chunk is a batch of whole `MessagePayload`s.
- **An empty `message_chunk` emits `messagesReceived` with `[]`.** A zero-length batch is a valid, harmless event. If the daemon is later found to never send empty chunks, dropping them is a trivial future tightening — not this boundary's concern.
- **Unmodeled envelope types are ignored but no longer *silent*.** `ack` / `backfill_since` / etc. still return `null` and emit no `DaemonEvent` — decoding/routing them is out of scope. Since [#130](../codebase/130.md) they *are* logged content-free (`inbound-unmodeled` — capped type + size + hash), so an unforeseen kind leaves a diagnosable footprint even though the runtime behavior is unchanged. `error` was in this bucket until [#116](../codebase/116.md) promoted it to a modeled, content-free `daemon-error` kind (see above) — it is no longer in the unmodeled set.
- **The three bundle kinds emit no `DaemonEvent`.** Unlike `message`/`message_chunk`, `bundle-chunk`/`bundle-done`/`daemon-error` never reach the [daemon-event channel](daemon-event-channel.md) — they route to the [debug-bundle reassembler](debug-bundle-reassembly.md)'s injected `BundleConsumer` instead ([#116](../codebase/116.md)). A caller that also waits on daemon events must drive its own wait from the consumer's `complete`/`fail`, not the event sink.
- **The `snapshot` kind emits a *narrower* `DaemonEvent` than it decodes ([#180](../codebase/180.md)).** Unlike the bundle kinds (no event) or `message`/`message_chunk` (event mirrors the decode), `screen_snapshot` decodes all six fields here but the consumer arm emits only three (`model`/`effort`/`yolo`) — `text`/`ts`/`conversation_id` are dropped at `daemonConnection.ts`, not at this boundary. See [screen snapshot fetch](screen-snapshot-fetch.md) for why the drop happens one layer up.

### Why the explicit size guard, given the transport already bounds the plaintext

A Noise transport message is ≤ 65535 bytes, so a single decrypted plaintext is structurally ≤ `MAX_PLAINTEXT_BYTES`. But this module's trust boundary is its **own function argument**, not the socket: the unit test drives `parseInboundMessage` directly (the transport cap is not in the loop), and a future change to the driver's guarantees must not silently un-bound this arm. The guard is one deterministic line, directly satisfies the "oversized" AC, and is testable at this boundary — belt (upstream Noise cap) and suspenders (this check), both deterministic code. It does **not** modify `decodeEnvelope` (shared with the ack path), so there is no drift.

## Related

- [#68 codebase notes](../codebase/68.md) — implementation summary, patterns, lessons (the boundary's introduction).
- [Debug-bundle reassembly (inbound)](debug-bundle-reassembly.md) / [#116 codebase notes](../codebase/116.md) — the additive extension of this boundary: three new recognized kinds, the `error`-modeling change, and the `requireNumber` narrowing helper.
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180 codebase notes](../codebase/180.md) — the second additive extension: the `snapshot` kind, `parseScreenSnapshotPayload`, and the new `requireBoolean` helper; the content-minimisation drop of `text`/`ts`/`conversation_id` happens one layer up in [daemon connection](daemon-connection.md), not here.
- [#130 codebase notes](../codebase/130.md) — the content-free diagnostic logging added at this boundary (`inbound-decoded` / `inbound-unmodeled`); the ticket that flipped this module's "performs no logging" invariant.
- [Content-free diagnostic log](diagnostic-log.md) / [#126](../codebase/126.md) — the logger injected here as the optional 2nd param; `parseInboundMessage` is its third consumer (after the relay leg #127 and daemon leg #128), and the `hash?` field on `DiagnosticEvent` was added additively for this boundary. Allowlist-not-scrubber contract: [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md).
- [Daemon connection](daemon-connection.md) / [#62](../codebase/62.md) — hosts the `case 'message'` arm that calls this and maps its result onto the IPC channel; owns the single choke point and the classify-don't-forward discipline this inherits.
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — `parseHelloAck`, the fail-closed narrowing shape this mirrors (`isRecord` guard → per-field checks → `WireDecodeError`, category-only messages). The local `isRecord` / `requireString` copies follow its precedent.
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the outbound sibling under `transport/`; `sendMessageEnvelope.ts`'s header conventions this file mirrors.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — `decodeEnvelope` (structural boundary, `payload: unknown`, `WireDecodeError` source) + the `MessagePayload` / `MessageChunkPayload` / `MAX_PLAINTEXT_BYTES` types this narrows to.
- [Daemon-event channel](daemon-event-channel.md) / [#18](../codebase/18.md) — the `messageReceived` / `messagesReceived` `DaemonEvent` members this feeds.
- [Daemon-event bridge](daemon-event-bridge.md) / [#19](../codebase/19.md) + [Session store](session-store.md) / [#2](../codebase/2.md) + [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the renderer half that dedupes by `message_id` and preserves arrival order.
- [Noise relay driver](noise-relay-driver.md) / [#50](../codebase/50.md) — surfaces the `message{plaintext}` event this decodes.
- Daemon/mobile peer (QMD `pyrycode-docs`): `internal/protocol` v1 messaging structs (#272 — `MessageChunkPayload.Messages` reuses `MessagePayload`, "same shape as `message.payload`, multiple") + `protocol-mobile.md` § application message types — the Go side that emits the `message` / `message_chunk` envelopes this narrows.
