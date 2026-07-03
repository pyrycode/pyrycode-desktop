# Spec — Wire codec (encode and decode) (#5)

**Size:** S (confirmed; PO offered S→XS but the strict-base64 boundary + the per-payload
fixture matrix keep it a genuine S). One new production file plus a ~5-line tighten of
`types.ts`. No consumer wiring, no UI.

## Design source

N/A — pure serialization module, no user-visible surface. The ticket body has no `## Figma`
section and the work is not UI-visible, so no visual-fidelity check applies.

## Files to read first

- `src/shared/wire/types.ts:16-98` — the exact shapes the codec (de)serializes: `InnerFrameV2`
  (`v`/`type`/`data`), `Envelope` (opaque `payload: unknown`, optional `in_reply_to`/`event_id`),
  and every payload interface. **Note the `| null` on the three optionals (lines 40, 41, 53) — you
  will tighten these.** The interfaces already use snake_case **wire** field names, so
  `JSON.stringify` emits wire-correct JSON with no name mapping (unlike Kotlin's `@SerialName`).
- `src/shared/wire/types.test.ts:1-16` — the vitest idiom (`describe`/`it`/`expect`) and the
  colocated `*.test.ts` convention your test file follows.
- `src/main/transport/relayConnection.ts:41-42` — `maxFrameBytes` (default 1 MiB). This is the
  **upstream size cap** the codec relies on; the codec is never called on unbounded input.
- `src/main/transport/relayConnection.ts:53-72` — the consumer seam. Inbound frames arrive as
  `RelayEvent { type: 'message'; frame: Uint8Array }` (opaque bytes → `decodeInnerFrame`). Outbound
  uses `send(frame: string | Uint8Array)` where a **string is a WS text frame** — send
  `encodeInnerFrame(...)` (a string), matching mobile's text-frame contract.
- `src/main/transport/relayConnection.test.ts:19-21, 250-253` — the `Uint8Array`/`Buffer`
  byte-handling test idiom to mirror in the codec tests.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md:20-30` — the "do not drift
  the encoded form from mobile without a matching daemon change" constraint that governs this codec.
- `CLAUDE.md` — test-first; keep transport/secret-handling out of the renderer; sealed shapes.

**Mobile source of truth** (sibling repo `pyrycode-mobile`, inlined below so no cross-repo read is
needed): `app/src/main/java/de/pyryco/mobile/data/network/MobileWireCodec.kt` (the `MobileJson`
config + `base64Std*` helpers) and `MobileWireModels.kt` / `MessagePayload.kt` (field names +
defaults). The field/default table in **Design → Wire field contract** reproduces what you need.

## Context

This is the serialization foundation for the connect-send-stream round-trip (Phase 1). The wire
*types* already exist (`src/shared/wire/types.ts`, ticket #21's foundation); this ticket adds the
encode/decode that turns them into — and back from — the daemon's on-the-wire bytes. It blocks #7
(Noise session), which encrypts the encoded Envelope bytes and base64-wraps the resulting Noise
bytes into an `InnerFrameV2.data`.

The daemon does not care which client speaks it, so a byte mismatch (a dropped default, an emitted
`null`, the wrong base64 alphabet, or a silently-truncated decode) breaks the contract silently.
Decode sits on the network trust boundary — it parses bytes a malicious relay peer could shape;
hence the `security-sensitive` label and the security-review pass at the end of this spec.

### The byte flow this codec serves (why these functions, and no more)

Two distinct JSON/base64 boundaries, taken directly from mobile's `NoiseSessionPump` +
`OkHttpRelayTransport`:

1. **`InnerFrameV2` ↔ WS text.** The frame is JSON text on the wire:
   `{"v":2,"type":"noise_init"|"noise_msg"|…,"data":"<base64-std>"}`. Its `data` field carries
   base64-std of the **Noise** bytes (ciphertext / handshake material) — those bytes are #7's, not
   this codec's. This codec only JSON-(de)serializes the frame and provides the base64-std helpers
   #7 will call on `data`.
2. **`Envelope` ↔ plaintext bytes.** The Envelope is JSON serialized to **UTF-8 bytes**; those
   bytes become the Noise plaintext (encrypted by #7) or handshake early-data. `Envelope.payload`
   stays an **opaque carrier** — decoded to a plain JS object typed `unknown`, never narrowed to a
   concrete payload type here. Consumers (#7 and later) validate it at their edge.

The Envelope is **not** itself base64-encoded — base64-std wraps the Noise bytes that ride in
`InnerFrameV2.data`. (The `types.ts:20` comment "base64 of the serialized Envelope" collapses the
`Envelope → JSON → Noise-encrypt → base64` chain; #7 inserts the encrypt step in the middle, so the
codec must **not** fuse Envelope-serialization and base64 into one function.) AC #2's "Envelope
round-trips through its base64-standard-padded serialization" is satisfied at the **test** level by
composing `encodeEnvelope → base64StdEncode → base64StdDecode → decodeEnvelope` — the exact two
primitives the transport composes, standing in for where Noise sits.

## Design

New file: **`src/shared/wire/codec.ts`**. Pure, synchronous, side-effect-free functions plus one
error class. Imported by `src/main` consumers only (#7, the relay wiring). **It must NOT be
re-exported through any barrel the renderer imports** — it uses Node `Buffer` and handles secret
material (tokens) and message plaintext, both of which must stay out of the renderer. `types.ts`
(which the renderer *does* import) stays `Buffer`-free — keep the split.

### Exported surface (contract sketches — not implementations)

```ts
// base64-std alphabet (A–Za–z0–9+/), padded — Go base64.StdEncoding.
export function base64StdEncode(bytes: Uint8Array): string
export function base64StdDecode(data: string): Uint8Array          // STRICT — see below

// InnerFrameV2 ↔ wire. Encode → WS text (string). Decode ← inbound bytes (Uint8Array).
export function encodeInnerFrame(frame: InnerFrameV2): string
export function decodeInnerFrame(bytes: Uint8Array): InnerFrameV2

// Envelope ↔ UTF-8 plaintext bytes (the Noise plaintext / handshake early-data).
export function encodeEnvelope(envelope: Envelope): Uint8Array
export function decodeEnvelope(bytes: Uint8Array): Envelope

// The one default-injecting constructor (see "Default injection").
export function makeHelloClientPayload(input: {
  deviceName: string; clientVersion: string; token: string; lastEventId?: number
}): HelloClientPayload

// Deterministic, catchable decode-failure signal at the trust boundary.
export class WireDecodeError extends Error {}
```

The asymmetry `encodeInnerFrame → string` vs `decodeInnerFrame ← Uint8Array` is **intentional and
correct** — do not "fix" it: we *send* a WS text frame (string), and `ws` *delivers* every inbound
frame as bytes (`RelayEvent.frame: Uint8Array`). Same for `encodeEnvelope → Uint8Array` /
`decodeEnvelope ← Uint8Array` — those bytes are the Noise plaintext #7 encrypts/decrypts.

Use `TextEncoder().encode(...)` / `new TextDecoder('utf-8', { fatal: true }).decode(...)` for the
UTF-8 leg (portable, and `fatal: true` rejects malformed UTF-8 — see Error handling). Use
`Buffer` only for base64 and only in this file.

### Default injection (the TypeScript-specific problem, and the minimal answer)

Mobile's `MobileJson` relies on Kotlin runtime defaults (`encodeDefaults = true`). TS interfaces
carry no runtime defaults, so the "always emit defaults" semantic (AC #3) must be injected. Split
the defaulted fields by how they're enforced:

- **Literal-typed fields enforce themselves.** `InnerFrameV2.v: 2` and `HelloClientPayload.role:
  'client'` are literal types — the type system will not let you construct the object without them,
  so `JSON.stringify` always emits them. **No runtime injector needed** for `v` or `role`.
- **Non-literal defaults need one constructor.** `HelloClientPayload.protocol_versions` and
  `capabilities` are `string[]` (no literal default in the type). `makeHelloClientPayload` is the
  **single** function that injects `protocol_versions: [PROTOCOL_VERSION]` (`["v2"]`) and
  `capabilities: [CAPABILITY_INTERACTIVE]` (`["interactive"]`), and omits `last_event_id` when
  absent. Reuse the `PROTOCOL_VERSION` / `CAPABILITY_INTERACTIVE` constants from `types.ts`.

`HelloClientPayload` is the **only** encode-side payload with non-literal defaults (all others —
`send_message`, `backfill_since` — have none), so this is one constructor, not the "function per
payload type" anti-pattern the ticket warns against. There is **no** per-payload codec wrapper and
**no** generic `decodePayload<T>` — payloads are carried in `Envelope.payload` and narrowed by
consumers at their edge, exactly as mobile does. `Envelope` itself has no defaulted fields, so it
needs no constructor: callers build it directly and omit absent optionals.

### Omit-absent-optionals, without `null` (AC #3)

`JSON.stringify` omits keys whose value is `undefined`, but **serializes `null`**. So the only safe
representation of an absent optional is `undefined`/omitted, never `null`. The current
`in_reply_to?: number | null` (and `event_id`, `last_event_id`) invite a caller to write `null`,
which would serialize as `null` and break the contract.

**Tighten `types.ts`:** drop `| null` from those three fields → `in_reply_to?: number`,
`event_id?: number`, `last_event_id?: number`. This makes "absent" the only representation and lets
`JSON.stringify`'s natural `undefined`-omission satisfy AC #3 with no runtime scrub. This does **not**
drift the wire contract — mobile's `explicitNulls = false` means these are *never emitted as null on
the wire* either; `number | undefined` is the faithful wire representation of mobile's `Long? = null`.
Zero edit fan-out: these fields have no consumers today (verified — only `types.ts` references them).

### Wire field contract (inline from the mobile models — build fixtures from this)

snake_case = wire field name. **emit** = always serialized (default present). **omit** = absent
optional, never `null`. Direction is which side sends it (informs which round-trips exercise
encode vs decode, but the codec is symmetric — all types must round-trip per AC #5).

| Type | Fields (wire name → note) | Dir |
|------|---------------------------|-----|
| `InnerFrameV2` | `v` (=2, **emit**, literal), `type` (str), `data` (base64-std str) | both |
| `Envelope` | `id` (num), `type` (str), `ts` (RFC-3339 str), `payload` (opaque, always present — `{}` for empty ack), `in_reply_to` (num, **omit**), `event_id` (num, **omit**) | both |
| `HelloClientPayload` | `role` (="client", **emit**, literal), `device_name` (str), `client_version` (str), `protocol_versions` (=["v2"], **emit**), `token` (str, **secret**), `capabilities` (=["interactive"], **emit**), `last_event_id` (num, **omit**) | encode |
| `HelloAckPayload` | `protocol_version` (str), `server_id` (str), `conn_id` (str), `capabilities` (str[]) | decode |
| `MessagePayload` | `conversation_id` (str), `message_id` (str), `role` (`'user'\|'assistant'`), `text` (str) | decode |
| `MessageChunkPayload` | `messages` (MessagePayload[]) | decode |
| `SendMessagePayload` | `conversation_id` (str), `message_id` (str), `text` (str) | encode |
| `BackfillSincePayload` | `since_ts` (str), `conversation_id` (str), `max_messages` (num) | encode |
| `ErrorPayload` | `code` (str), `message` (str), `retryable` (bool) — server also emits `retry_after_s`, **not modeled**, tolerated on decode | decode |
| `QrPayload` | `server` (str), `relay` (str), `token` (str, **secret**), `server_static_pubkey` (base64-std str) | round-trip only |

`QrPayload`'s JSON round-trip is in scope (plain-JSON, all strings — no dedicated codec function
needed). Its `server_static_pubkey` → validated-32-raw-bytes decode is a **pairing** concern,
**out of scope** here (deferred to the QR/pairing ticket).

## State + concurrency model

None. The codec is a set of pure, synchronous, total functions over values — no Zustand slice, no
async task, no stream, no timer, no listener, no shared mutable state. It is reentrant and
thread/dispatcher-safe by construction (mirrors mobile's "immutable and thread-safe" `MobileJson`).
This is why there is no store contract or teardown behavior to specify.

## Error handling

The **decode** functions are the untrusted→trusted boundary. They must **fail closed**: throw
`WireDecodeError`, never return a partial or silently-truncated value (AC #4).

- **Strict base64 (the load-bearing correctness + security point).** Node's `Buffer.from(s,
  'base64')` is **lenient** — it silently strips non-alphabet characters and truncates (e.g.
  `Buffer.from('YQ==garbage', 'base64')` decodes only `YQ==`, no error). That directly violates
  AC #4. Go's `base64.StdEncoding` and mobile's `Base64.getDecoder()` are strict. `base64StdDecode`
  MUST replicate strict behavior: **validate before delegating** — reject input that is not
  canonical standard-alphabet base64 (any char outside `A–Za–z0–9+/=`, length not a multiple of 4,
  padding not a well-formed trailing `={0,2}`, or url-safe `-`/`_`) by throwing `WireDecodeError`;
  only then `Buffer.from(validated, 'base64')`. The invariant asserted by tests: strict-reject, no
  truncation.
- **Malformed JSON.** Catch **all** throws from `JSON.parse` — `SyntaxError` *and* `RangeError`
  (deep nesting / stack) — and rethrow as `WireDecodeError`.
- **Malformed UTF-8.** Decode bytes with `new TextDecoder('utf-8', { fatal: true })` so invalid
  byte sequences throw (not silently replaced with U+FFFD); wrap as `WireDecodeError`.
- **Missing / wrong-typed required fields.** After parse, structurally validate required primitives:
  `decodeInnerFrame` requires `type: string` and `data: string` (tolerate any numeric `v` — do
  **not** hard-reject a future version); `decodeEnvelope` requires `id: number`, `type: string`,
  `ts: string`, and `payload` present. Missing/wrong-typed → `WireDecodeError`. Extra unknown keys
  are **tolerated** (forward-compat, AC #4) and `payload` stays opaque (`unknown`), never narrowed.
- **Error-message hygiene (secret-safety — MUST).** `WireDecodeError` messages name the failure
  **category only** (`"malformed base64"`, `"invalid UTF-8"`, `"malformed JSON"`, `"missing
  required field: type"`) and **never** echo the raw input bytes/string or decoded field values —
  frames and envelopes carry the device `token` and message plaintext. The codec itself performs
  **no logging** (`console.*`) whatsoever. (Mirrors mobile's `decodeServerStaticPubkey`, which names
  the category and never echoes the key.)

The **encode** functions cannot fail on well-typed input (the tightened types forbid `null`
optionals; literal types force defaults). They do not throw.

## Testing strategy

`src/shared/wire/codec.test.ts`, vitest, following `types.test.ts`'s idiom and the
`Uint8Array`/`Buffer` handling in `relayConnection.test.ts`. Build per-payload JSON **fixtures**
from the **Wire field contract** table (AC #5). Write these as bullet-scenario tests (inputs +
expected behavior), not as pre-written bodies:

- **Frame round-trip:** `encodeInnerFrame(frame)` → a string containing `"v":2`, `"type"`, `"data"`;
  feed its UTF-8 bytes to `decodeInnerFrame` → deep-equals the original.
- **Envelope + every payload round-trip:** for each payload type in the table, build an `Envelope`
  carrying it, `encodeEnvelope → decodeEnvelope`, assert the decoded envelope deep-equals the
  original and `payload` is the same plain object (opaque, not narrowed).
- **Defaults emitted (AC #3):** `makeHelloClientPayload({ deviceName, clientVersion, token })` inside
  an envelope → encoded JSON contains `"role":"client"`, `"protocol_versions":["v2"]`,
  `"capabilities":["interactive"]`; frame JSON contains `"v":2`.
- **Optionals omitted, never null (AC #3):** an Envelope without `in_reply_to`/`event_id` → encoded
  JSON string contains neither key and no `null`; a hello without `lastEventId` → no `last_event_id`.
- **Forward-compat decode (AC #4):** `decodeEnvelope` on JSON with unknown keys (`payload_encrypted`,
  and an `ErrorPayload` with `retry_after_s`) → does not throw; known fields intact.
- **Strict base64 (AC #4):** `base64StdDecode` throws `WireDecodeError` on non-alphabet chars,
  wrong length, malformed padding, and url-safe `-`/`_`; include `"YQ==garbage"` to prove Node's
  lenient truncation is defeated (throws, does not decode `"YQ=="`).
- **base64 alphabet:** `base64StdEncode` of bytes that produce `+`/`/` (e.g. `0xFB 0xFF`) uses
  `+`/`/` and `=` padding (not `-`/`_`), length a multiple of 4; round-trips through
  `base64StdDecode`.
- **Malformed JSON / UTF-8 / missing fields:** `decodeEnvelope`/`decodeInnerFrame` throw
  `WireDecodeError` on truncated-garbage bytes, invalid UTF-8 bytes, and objects missing a required
  field (`{"v":2}` with no `type`/`data`; an envelope missing `id`/`ts`).
- **QrPayload:** survives a plain JSON round-trip (all string fields equal); note in a comment that
  the `server_static_pubkey` 32-byte decode is deferred to the pairing ticket.
- **Round-trip stability:** decode-then-re-encode a canonical fixture yields byte-equal output
  (proves no null-injection / default-drop drift).

Type coverage: `npm run typecheck` (both configs) must pass; the tightened `types.ts` optionals
must not break the node or web build (no consumers today).

## Open questions

- **Prototype-pollution hardening (SHOULD FIX, developer's call).** `JSON.parse` creates an *own*
  `__proto__` key; it does **not** pollute `Object.prototype`, and the codec performs no
  recursive merge, so there is no pollution sink here. A `JSON.parse` reviver that drops
  `__proto__`/`constructor`/`prototype` keys is a cheap optional hardening the developer *may* add
  if it doesn't break the round-trip stability test — but it is not required (no wire field is named
  those). The primary control is the documented contract: consumers must not naïve-deep-merge the
  opaque `payload`. Do not build a defense beyond this absent an observed failure.
- **Frame-size cap** is owned upstream by `relayConnection`'s `maxFrameBytes` (1 MiB default); the
  codec assumes bounded input and adds no cap of its own. Confirm no consumer calls the codec on
  pre-cap bytes.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX — the untrusted→trusted boundary is exactly the two `decode*`
  functions (relay bytes → parsed frame/envelope), one function per shape, explicit. `payload` stays
  typed `unknown` — the type system signals to downstream callers that it is **not** yet
  narrowed/validated. `WireDecodeError` is the single boundary failure signal. Consumers narrow
  `payload` at their own edge (documented in Design).
- **[Tokens / secrets]** Addressed in-spec (Error handling → "Error-message hygiene", MUST):
  `WireDecodeError` messages carry the failure **category only**, never the raw bytes/string or
  decoded values, because frames/envelopes carry the device `token` (HelloClient, Qr) and message
  plaintext; the codec does **no** logging. The codec neither generates, stores, nor compares
  secrets — it only serializes them onto the wire where the protocol requires. (Consumers must not
  `console.log` a hello payload; noted for #7.)
- **[File / storage]** N/A — the codec performs no filesystem or storage I/O of any kind.
- **[Inter-process / Electron]** No MUST FIX — the codec adds no IPC channel, no `contextBridge`
  API, no `BrowserWindow`. MUST (Design): `codec.ts` stays a main-only file, **not** re-exported
  through any renderer-imported barrel, keeping wire-decode, secret handling, and `Buffer` out of
  the renderer bundle. `types.ts` (renderer-imported) stays `Buffer`-free. This upholds
  "transport/parsing lives in main, never the renderer."
- **[Cryptographic primitives]** N/A with justification — the codec is crypto-free. No RNG, no
  hashing, no key handling, no MAC/token comparison. base64 and JSON are not cryptographic. The
  Noise handshake and AEAD are #7's, from a vetted Noise library — the codec must not be extended to
  compare secrets (no `timingSafeEqual` needed because it compares nothing secret).
- **[Network & I/O]** No MUST FIX — the codec is not the socket. Memory-amplification is bounded by
  `relayConnection`'s `maxFrameBytes` (1 MiB) upstream, so decode sees bounded input; the codec
  relies on that cap explicitly (Open questions). Deep-nesting `JSON.parse` `RangeError` is caught
  and converted to `WireDecodeError`. TLS/relay-URL validation is pairing/#21's concern, out of
  scope.
- **[Error messages / logs / telemetry]** No MUST FIX — covered by the secret-safety MUST above:
  category-only error messages, zero logging in the codec, no telemetry.
- **[Concurrency]** No findings — pure synchronous functions, no async, no shared mutable state, no
  timers/listeners; reentrant by construction.
- **[Threat-model alignment]** Malicious/on-path relay: malformed/truncated/oversized frames →
  deterministic `WireDecodeError`, never a partial value (AC #4), no plaintext leak (no logging),
  bounded by the upstream frame cap. Hostile daemon response inside the session: malformed
  Envelope/payload → required-field validation throws; `payload` stays opaque for consumer
  validation. Renderer compromise reaching the transport: mitigated by the main-only isolation MUST.
  Prototype pollution (ticket-flagged): `JSON.parse` is pollution-safe on its own and the codec has
  no merge sink — SHOULD FIX reviver noted, not gated (Open questions). Token theft from disk: N/A
  (no storage).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-03
