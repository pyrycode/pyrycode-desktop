# #68 — Decode inbound daemon-message frames and emit them onto the daemon-event channel

**Size:** S (PO-sized S; confirmed). **Labels:** `security-sensitive`.
**One line:** fill the no-op `case 'message'` arm of `onDriverEvent` in `daemonConnection.ts` — decode the decrypted app-envelope, route `message` / `message_chunk` by wire type, and emit the matching `DaemonEvent`, failing closed exactly like the `parseHelloAck` boundary.

## Files to read first

- `src/main/daemonConnection.ts:122-154` — the `onDriverEvent` choke point (**the seam**). The `case 'message'` arm at `:138-141` is the no-op TODO this ticket fills. Copy the `handshake-complete` arm's shape (`:125-137`): parse in a `try`, `catch` → fail-closed, emit after. Do not touch any other arm.
- `src/main/transport/helloExchange.ts:63-113` — `parseHelloAck` + its **local** `isRecord` (`:66-68`) and `requireString` (`:71-77`). This is the exact fail-closed narrowing shape to mirror: `isRecord` guard → per-field `requireString` → `WireDecodeError` on any miss → return only the known fields (drop unknown keys). Note the deliberate local copy of `isRecord` (codec's is not exported) — the new file copies the same two helpers locally, does **not** refactor a shared validators module.
- `src/main/transport/sendMessageEnvelope.ts` — the **outbound** sibling. The new inbound file mirrors its file-header conventions verbatim: main-process-only banner, `import { … } from './codec'`, `import type … from '../../shared/wire/types'` (relative — no `@shared` alias in `src/main`).
- `src/main/transport/codec.ts:120-138` — `decodeEnvelope` contract: it validates `id`/`type`/`ts`/`payload` structurally and leaves `payload` **opaque `unknown`**; throws `WireDecodeError`. **It performs no size check** — the oversized guard is this ticket's job. Also `:32-37` (`WireDecodeError`), `:176-202` (`isRecord` / `parseJsonObject` reference — the decode already rejects bad UTF-8, malformed JSON, and non-object top-level).
- `src/shared/wire/types.ts:40-96` — `Envelope` / `EnvelopeType`, `WireRole` (`'user' | 'assistant'`), `MessagePayload`, `MessageChunkPayload`. And `:30` — `MAX_PLAINTEXT_BYTES` (65519), the inbound size cap.
- `src/shared/ipc/events.ts:31-37` — the `DaemonEvent` union. Emit targets: `{ type: 'messageReceived'; message: MessagePayload }` and `{ type: 'messagesReceived'; messages: readonly MessagePayload[] }`. Do not add or drift members.
- `src/main/emitDaemonEvent.ts` — `emitDaemonEvent(sink, event)`; already imported by `daemonConnection.ts`.
- `src/main/daemonConnection.test.ts:26-143` — fixtures, the fake-driver factory (`makeDriverFactory` / `drivers[0].emit(event)` drives a `RelaySessionEvent` back in), the spied `sink`, and `emitted(sink)`. `:313-322` — the current "no-op message" test, **replaced** by this ticket. `:356-382` — the six-method console-spy + no-secret-in-payload sweep to **extend** with a message path.
- `docs/knowledge/codebase/62.md` — the consumer's established patterns this arm inherits: one choke point maps a sealed driver-event union to a sealed IPC-event union; **classify-don't-forward** (drop the caught object, surface only static data); **log-free** (six-method console-spy).
- `docs/knowledge/decisions/0004-renderer-session-store-reducer-wire-types.md` — the renderer store dedupes by `message_id` and preserves arrival order (`appendUnique`). **This module does neither** — it emits in arrival order and does not dedupe or reorder (AC).

## Context

The Noise relay driver (#50) surfaces each decrypted application frame as `RelaySessionEvent` `{ type: 'message'; plaintext: Uint8Array }` (`noiseRelayDriver.ts:57`). The connect consumer (#62) wired the handshake-status path but left the inbound-message arm a no-op TODO. This ticket fills it: decode the plaintext application envelope, route by wire `type`, and emit the matching `DaemonEvent` — the background-process, wire-facing half that feeds the already-complete renderer pipeline (#18 channel → #19 bridge → #2 store).

This is **untrusted daemon input on an internet-exposed surface** (decrypted bytes from a relay peer). It must fail closed exactly like the `parseHelloAck` boundary already in this module. `decodeEnvelope` intentionally leaves `payload` opaque (`unknown`), so this consumer owns the per-field validation — the same ownership `parseHelloAck` has for `hello_ack`.

## Design

### Where the new code lives

Two edits, both in `src/main`:

1. **New file `src/main/transport/inboundMessage.ts`** — the inbound app-message decode boundary. Sibling to `sendMessageEnvelope.ts` (outbound build) and analogous to `helloExchange.ts` (handshake `hello`/`hello_ack`). It owns the **entire** untrusted-bytes → typed transition: size guard, `decodeEnvelope`, route by envelope `type`, per-field payload narrowing. This mirrors `parseHelloAck`'s "bytes in, throw on any mismatch, return a typed value" shape — the developer tests it against real encoded envelope bytes exactly as `daemonConnection.test.ts` tests the ack path.

2. **Modified `src/main/daemonConnection.ts`** — the `case 'message'` arm becomes a thin `InboundDaemonMessage → DaemonEvent` mapper. It stays the module's single choke point ("`RelaySessionEvent → DaemonEvent`. Nothing else emits"): the transport helper does the wire boundary; the consumer does the IPC mapping. This keeps `transport/` **IPC-free** (it never imports `DaemonEvent`) — the placement rule #62 established.

### Public contract — `inboundMessage.ts`

```ts
// Discriminated result: which modeled app-message the envelope carried. NOT a wire type and NOT
// a DaemonEvent (transport stays IPC-free) — an internal transport result the consumer maps.
export type InboundDaemonMessage =
  | { kind: 'message'; message: MessagePayload }
  | { kind: 'chunk'; messages: MessagePayload[] }

// Decode + route + narrow one decrypted app-message plaintext.
//  • returns InboundDaemonMessage        — a `message` or `message_chunk` envelope, fully narrowed
//  • returns null                        — a well-formed envelope of any OTHER type (ignored, AC5)
//  • throws WireDecodeError              — oversized, malformed, unparseable, or a missing/mistyped
//                                          payload field (fail-closed, AC4). Single throw type, so
//                                          the consumer's one catch covers every failure — like parseHelloAck.
export function parseInboundMessage(plaintext: Uint8Array): InboundDaemonMessage | null
```

Behavior (implement as the body; each numbered step is one small guard, mirroring `parseHelloAck`):

1. **Size guard (oversized, AC4):** if `plaintext.length > MAX_PLAINTEXT_BYTES` → throw `WireDecodeError`. `decodeEnvelope` does not size-check, so this is the only thing that makes an oversized-but-valid-JSON frame fail closed at this boundary. This boundary re-checks rather than trusting the caller (see § Error handling for why the upstream transport bound is not relied on).
2. `const envelope = decodeEnvelope(plaintext)` — throws `WireDecodeError` on bad UTF-8 / malformed JSON / non-object / missing `id`/`type`/`ts`/`payload` (inherited).
3. Route on `envelope.type`:
   - `'message'` → `{ kind: 'message', message: parseMessagePayload(envelope.payload) }`
   - `'message_chunk'` → `{ kind: 'chunk', messages: parseMessageChunkPayload(envelope.payload) }`
   - anything else → `return null` (ignored — a well-formed `ack`/`error`/etc. is not an error, AC5).

Private helpers in the same file (do **not** export; test through `parseInboundMessage`):

- `isRecord(value): value is Record<string, unknown>` and `requireString(payload, field): string` — **local copies** of the two helpers in `helloExchange.ts:66-77`, for the same documented reason (codec's `isRecord` is unexported; the copy keeps this the edge that validates the opaque payload). Do not introduce a shared validators module or refactor `helloExchange.ts`.
- `parseMessagePayload(payload: unknown): MessagePayload`:
  - `isRecord(payload)` guard, else throw `WireDecodeError`.
  - `conversation_id`, `message_id`, `text` via `requireString` (each a string, else throw).
  - `role`: read `payload.role`; throw `WireDecodeError` unless it is exactly `'user'` or `'assistant'` (this single check covers non-string and unknown-string alike — narrows to `WireRole`). A bare cast is not sufficient (AC).
  - return `{ conversation_id, message_id, role, text }` — only the four known fields; unknown extra keys tolerated but dropped (forward-compat, like `parseHelloAck`).
  - **Error messages are category-only static strings** (`'missing required field: role'`, `'malformed message payload'`), never interpolating the offending value — matching `codec.ts` / `helloExchange.ts`. Do **not** write `` throw new WireDecodeError(`bad role: ${role}`) ``: a `WireDecodeError` message can be surfaced by a future caller, and the `role`/`text`/`conversation_id` values are user conversation content. (The consumer drops the caught object today, so this is defense-in-depth, but it is load-bearing the moment any caller logs the message.)
- `parseMessageChunkPayload(payload: unknown): MessageChunkPayload`:
  - `isRecord(payload)` guard, else throw.
  - `const raw = payload.messages`; throw `WireDecodeError` unless `Array.isArray(raw)`.
  - `messages = raw.map(parseMessagePayload)` — every element validated as a `MessagePayload`; one bad element throws, failing the whole chunk closed (AC). An **empty array is valid** (array, zero elements) → `{ messages: [] }`; the store handles a zero-length batch harmlessly.
  - return `{ messages }`.

### Consumer contract — `daemonConnection.ts` `case 'message'` arm

Replace the no-op (`:138-141`) with the map. Contract sketch (mirrors the `handshake-complete` arm's try/emit shape):

```ts
case 'message': {
  let inbound: InboundDaemonMessage | null
  try {
    inbound = parseInboundMessage(event.plaintext)
  } catch {
    // Fail-closed (AC4): oversized / malformed / unparseable / mistyped payload. Drop the frame —
    // no event, no throw. The caught WireDecodeError is DROPPED (classify-don't-forward: a decode
    // error message could echo message plaintext; it never reaches a log or an event).
    return
  }
  if (inbound === null) return                      // AC5: other envelope types ignored, no event
  if (inbound.kind === 'message') {
    emitDaemonEvent(sink, { type: 'messageReceived', message: inbound.message })
  } else {
    emitDaemonEvent(sink, { type: 'messagesReceived', messages: inbound.messages })
  }
  return
}
```

New imports in `daemonConnection.ts`: `parseInboundMessage`, `type InboundDaemonMessage` from `'./transport/inboundMessage'`. No other line changes; no existing symbol's signature or behavior changes; no consumer cascade.

### Data flow

```
relay socket → supervisor → noiseRelayDriver (Noise decrypt)
  → RelaySessionEvent{ type:'message', plaintext }
    → daemonConnection.onDriverEvent  case 'message'
      → parseInboundMessage(plaintext)      [transport: size + decodeEnvelope + route + narrow]
        ├─ throw  → catch → drop (no event)                         (AC4)
        ├─ null   → ignore (no event)                               (AC5)
        ├─ {kind:'message'} → emitDaemonEvent messageReceived       (AC2)
        └─ {kind:'chunk'}   → emitDaemonEvent messagesReceived      (AC3)
          → DAEMON_EVENT_CHANNEL → #19 bridge → #2 store (appendUnique, dedupe+order)
```

## State + concurrency model

No new state, no new async, no new store. The arm is a **synchronous** map inside the existing `onDriverEvent` callback (which the driver invokes synchronously on decrypt). No `await`, no timer, no listener, no `AbortController` — nothing to cancel or tear down beyond what #62 already owns. `nextEnvelopeId` and the `started`/`stopped`/`driver` locals are untouched; this arm reads none of them and mutates none. Ordering and dedupe are the renderer store's responsibility (`appendUnique`, ADR 0004); this module emits in **arrival order** and does not dedupe or reorder — two `message` frames with the same `message_id` produce two `messageReceived` events.

## Error handling

| Layer | Result type | Failure behavior |
|---|---|---|
| `parseInboundMessage` (transport) | `InboundDaemonMessage \| null` | Throws a single type — `WireDecodeError` — on oversized / malformed / unparseable / mistyped. `null` for a well-formed but unmodeled envelope type (not a failure). |
| `case 'message'` arm (consumer) | `void` | `try/catch` → a throw is **dropped silently** (no event, no log, caught object not forwarded); `null` → ignored; a result → exactly one `DaemonEvent`. **Never throws out of the module.** |
| UI | — | A dropped inbound frame surfaces **nothing** (no `failed`, no banner). A single malformed *message* frame is not connection-fatal — the session continues. This is deliberately different from a malformed `hello_ack`, which *is* fatal and surfaces `failed('malformed-hello-ack')`, because the handshake cannot complete without it. |

**Why the explicit size guard, given the transport already bounds the plaintext.** A Noise transport message is ≤65535 bytes, so a single decrypted plaintext is structurally ≤65519 (`MAX_PLAINTEXT_BYTES`). But this module's trust boundary is its own function argument, not the socket: the unit test drives `parseInboundMessage`/`onDriverEvent` directly, so the transport cap is not in the loop, and a future change to the driver's guarantees must not silently un-bound this arm. The guard is one deterministic line, directly satisfies AC4's "oversized," and is testable at this boundary. This is defense-in-depth at the boundary we own (belt = upstream Noise cap, suspenders = this check; both deterministic code). It does **not** modify `decodeEnvelope` (shared with the ack path) — no drift.

**Secret-safety.** `WireDecodeError` messages name the failure category only (never a field value or raw bytes — enforced by `codec.ts`), and the consumer drops the caught object regardless. No `console.*` anywhere on any path. The message `text`, `conversation_id`, and `message_id` never reach a log or a surfaced error string.

## Testing strategy

`npm test` (vitest), `npm run typecheck`, `npm run build` are the gates. All new tests are plain function tests against fakes/real-codec — no Electron harness.

### `src/main/transport/inboundMessage.test.ts` (new)

Build inputs with the **real** codec (`encodeEnvelope({ id, type, ts, payload })`) so assertions pin actual wire bytes, mirroring `daemonConnection.test.ts`'s `validHelloAck()`.

- **Happy — message:** a `message` envelope with valid `{conversation_id, message_id, role, text}` → `{ kind:'message', message: {…} }`; extra unknown payload keys dropped; both `role:'user'` and `role:'assistant'` accepted.
- **Happy — chunk:** a `message_chunk` with two valid messages → `{ kind:'chunk', messages:[…] }` preserving order; an **empty** `messages:[]` → `{ kind:'chunk', messages:[] }` (valid, not an error).
- **Ignored (AC5):** envelope types `ack`, `error`, `hello_ack`, and an arbitrary string → `null`, no throw.
- **Fail-closed (AC4) — each throws `WireDecodeError`:**
  - decode-level (inherited): invalid UTF-8; malformed JSON; non-object top-level; envelope missing `type`/`payload`.
  - `message` payload not an object; missing/non-string `conversation_id` / `message_id` / `text`; `role` missing, non-string, or a string other than `user`/`assistant` (e.g. `'system'`).
  - `message_chunk` payload not an object; `messages` missing / not an array (object, string, number); a `messages` array containing one bad element (non-object, or missing field, or bad role) → the whole chunk throws.
  - **oversized:** a plaintext `> MAX_PLAINTEXT_BYTES` whose JSON *would* be a valid `message` envelope → throws (proves the size guard, not just JSON validity, is what rejects it).
- **Secret-safety / log-free:** six-method `console` spy asserts no call on any happy or failing path; a thrown `WireDecodeError`'s `.message` never contains the payload `text`, `conversation_id`, or the offending `role` value (pins the category-only-message rule above — the `role` case is where a naive implementation would interpolate the bad value).

### `src/main/transport/inboundMessage.ts` header

Copy the main-process-only banner shape from `sendMessageEnvelope.ts`: main-process only (imports `codec.ts` / Node `Buffer` transitively, handles message plaintext), never re-export through a renderer barrel, fail-closed at the untrusted→trusted boundary, no logging.

### `src/main/daemonConnection.test.ts` (extend)

**Replace** the no-op test at `:313-322` and add cases driving `drivers[0].emit({ type: 'message', plaintext })` after a completed handshake:

- valid `message` plaintext → emits exactly one `{ type:'messageReceived', message }` with matching fields.
- valid `message_chunk` plaintext (2 messages) → emits exactly one `{ type:'messagesReceived', messages }`, both in order.
- ignored envelope type (`ack`) → emits nothing.
- malformed plaintext (bad JSON) → emits nothing **and `emit(...)` does not throw**.
- `message` envelope missing `text`, and one with an unknown `role` → each emits nothing, no throw.
- oversized plaintext → emits nothing, no throw.
- arrival-order / no-dedupe: two `message` frames with the same `message_id` → two `messageReceived` events.
- **Extend the console-spy + no-secret sweep** (`:356-382`): drive a `message` frame carrying a secret `text` through both the happy path and a malformed path; assert no `console.*` and that `JSON.stringify(emitted(...))` for the malformed frame does not contain the secret text.

## Open questions

- **None blocking.** The `role` enum check subsumes non-string and unknown-string in one guard; if the developer prefers `requireString(payload,'role')` then a membership check for symmetry with the other fields, either is acceptable as long as an unknown `role` throws.
- Emitting `messagesReceived` for an empty `message_chunk` is intended (a zero-length batch is a valid, harmless event). If the daemon is later found to never send empty chunks, dropping them is a trivial future tightening, not this ticket's concern.

## Scope check

Production `.ts` files (excluding tests/md/spec): `src/main/transport/inboundMessage.ts` (new) + `src/main/daemonConnection.ts` (mod) = **2** (< 5). New exported symbols: `parseInboundMessage` (fn) + `InboundDaemonMessage` (type) = **2** (< 5); `MessagePayload`/`MessageChunkPayload`/`DaemonEvent` already exist and are unchanged. No consumer cascade (all additive; existing signatures untouched). No new dependency. No wire-type or event-type drift. Estimated total written: ~50 LOC (`inboundMessage.ts`) + ~12 LOC (arm) + ~120 LOC tests ≈ **~180 LOC**. Solidly S.

## Security review

**Verdict:** PASS

This is the "hostile daemon response" trust boundary (§9). Every category was walked adversarially against the spec above.

**Findings:**

- **[Trust boundaries]** No MUST FIX — the untrusted→trusted transition is a **single explicit boundary**: `parseInboundMessage` in `src/main/transport/inboundMessage.ts`, returning a narrowed `InboundDaemonMessage` or throwing one error type. `payload:unknown` never escapes it; downstream (`daemonConnection` arm, `DaemonEvent`, store) holds only concrete wire types. Envelope metadata (`id`/`ts`/`in_reply_to`/`event_id`) is never forwarded into any `DaemonEvent` — only `type` (for routing) and the narrowed `payload` cross.
- **[Tokens / secrets]** N/A — this arm handles post-decrypt message content, not tokens or keys. No token generation, storage, or comparison introduced.
- **[File / storage]** N/A — purely in-memory decode; no filesystem, no path handling, no disk write.
- **[Electron attack surface]** No MUST FIX — decode stays in the **main process** (`transport/`); no new IPC channel, no new `contextBridge` API, no `webPreferences` change. The event travels the existing `DAEMON_EVENT_CHANNEL` carrying only `MessagePayload` (AC6 — the #18 union cannot hold a token/key/raw frame by construction). Message *content* reaching the renderer is the intended data path, not a leak; keys/sockets stay in main.
- **[Cryptographic primitives]** N/A — no crypto in this arm; the Noise decrypt already happened upstream (#7/#50). No key/nonce handling, no hand-rolled anything.
- **[Network & I/O]** No MUST FIX — the inbound plaintext has an explicit `MAX_PLAINTEXT_BYTES` cap at this boundary (§ Error handling), so a hostile daemon cannot flood an unbounded frame. Per-frame work is O(size) with size capped; a `message_chunk` array is inherently small (each complete message > 60 bytes, cap 65519) and aborts on the first bad element. Deep-nesting JSON attacks fail closed via `parseJsonObject`'s `RangeError` catch (`codec.ts:194-199`). Outer-frame `maxPayload`, TLS, relay-URL validation are owned upstream (#21/#22/#50/#52), unchanged.
- **[Error messages / logs / telemetry]** No MUST FIX (one tightening applied inline) — log-free on every path (six-method console-spy, extended). New narrowers must use **category-only** `WireDecodeError` messages, never interpolating a field value; the spec now calls this out explicitly for the `role` case and the secret-safety test asserts the thrown message carries no `role`/`text`/`conversation_id` value. The consumer drops the caught object regardless (classify-don't-forward).
- **[Concurrency]** No MUST FIX — the arm is a **synchronous, stateless** map inside the existing `onDriverEvent`. No new async, timer, listener, or `AbortController`; no `await`, so no check-then-act race; no shared-state mutation. Post-`stop()` no `message` events arrive (driver generation guard + teardown, #50/#62). Inherits #62's window-lifecycle handling unchanged.
- **[Threat model alignment]** No MUST FIX — **hostile/buggy daemon:** every field parsed defensively, fail-closed on malformed/oversized/mistyped/unknown-role/non-array — the core purpose of the ticket. **Malicious on-path relay (content-blind):** flood/reorder/replay survive without hanging or leaking (stateless, synchronous, sends nothing); ordering & dedupe are correctly delegated to the store (ADR 0004), not attempted here. **Renderer compromise:** cannot reach keys/socket — decode stays in main. **Out of scope, named:** dedupe/order/`conversation_id` scoping → store #2/ADR 0004; reconnect/backfill → #34; outer-frame size / TLS / relay-URL → #21/#22/#50/#52.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
