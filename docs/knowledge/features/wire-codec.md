# Wire codec

The **serialization layer** of the transport: pure functions that turn the shared wire types into — and back from — the daemon's on-the-wire bytes, **byte-identical to what pyrycode-mobile sends**. Encode is total; the two `decode*` functions are the network trust boundary and **fail closed**. Lives entirely in the Electron **background process** (`src/main/transport/codec.ts`), never the renderer.

Introduced in [#5](../codebase/5.md). It sits *on top of* the [relay connection](relay-connection.md) (#21, the opaque byte pipe) and *under* the Noise session (#7, which encrypts the bytes this codec produces). The wire *types* it (de)serializes already existed ([#21 foundation](../codebase/21.md), `src/shared/wire/types.ts`); this ticket adds only the encode/decode. The daemon does not care which client speaks it, so a byte mismatch — a dropped default, an emitted `null`, the wrong base64 alphabet, or a silently-truncated decode — breaks the contract **silently** ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md).

## What it does

Turns typed wire values into their exact JSON/base64 byte form and parses them back. It is a **thin serializer** ported field-for-field from the mobile Kotlin codec (`MobileWireCodec.kt`: the `MobileJson` config + `base64Std*` helpers; `MobileWireModels.kt` / `MessagePayload.kt`: field names + defaults) — deliberately **no per-payload wrapper functions**. `Envelope.payload` stays an **opaque carrier** (`unknown`): decoded but never narrowed to a concrete payload type here; consumers (#7 and later) validate it at their own edge, exactly as mobile does.

## How it works

One file, one error class, eight functions: `src/main/transport/codec.ts`. Pure, synchronous, side-effect-free — no store, no async, no timer, no shared mutable state; reentrant by construction (mirrors mobile's immutable, thread-safe `MobileJson`).

### Public surface

```ts
// base64-std alphabet (A–Za–z0–9+/), padded — Go base64.StdEncoding.
export function base64StdEncode(bytes: Uint8Array): string
export function base64StdDecode(data: string): Uint8Array          // STRICT — see Edge cases

// InnerFrameV2 ↔ WS text. Encode → text frame (string). Decode ← inbound bytes (Uint8Array).
export function encodeInnerFrame(frame: InnerFrameV2): string
export function decodeInnerFrame(bytes: Uint8Array): InnerFrameV2

// Envelope ↔ UTF-8 plaintext bytes (the Noise plaintext / handshake early-data).
export function encodeEnvelope(envelope: Envelope): Uint8Array
export function decodeEnvelope(bytes: Uint8Array): Envelope

// The one default-injecting constructor (see Defaults).
export function makeHelloClientPayload(input: {
  deviceName: string; clientVersion: string; token: string
  capabilities?: readonly string[]; lastSeenTs?: string; lastEventId?: number
}): HelloClientPayload

// Deterministic, catchable decode-failure signal at the trust boundary.
export class WireDecodeError extends Error {}
```

The **asymmetry** `encodeInnerFrame → string` vs `decodeInnerFrame ← Uint8Array` is intentional and correct: we *send* a WS text frame (a string), and `ws` *delivers* every inbound frame as bytes (`RelayEvent.frame: Uint8Array`). Same for `encodeEnvelope → Uint8Array` / `decodeEnvelope ← Uint8Array` — those bytes are the Noise plaintext #7 encrypts/decrypts.

### The two byte boundaries this codec serves

Taken directly from mobile's `NoiseSessionPump` + `OkHttpRelayTransport`:

1. **`InnerFrameV2` ↔ WS text.** The frame is JSON text on the wire: `{"v":2,"type":"noise_init"|"noise_msg"|…,"data":"<base64-std>"}`. Its `data` field carries base64-std of the **Noise** bytes (ciphertext / handshake material) — those bytes are #7's, not this codec's. This codec only JSON-(de)serializes the frame and provides the base64-std helpers #7 will call on `data`.
2. **`Envelope` ↔ plaintext bytes.** The Envelope is JSON serialized to **UTF-8 bytes**; those bytes become the Noise plaintext (encrypted by #7) or handshake early-data. The Envelope is **not** itself base64-encoded — base64-std wraps the Noise bytes that ride in `InnerFrameV2.data`. #7 inserts the encrypt step between `encodeEnvelope` and `base64StdEncode`, so the codec must **not** fuse Envelope-serialization and base64 into one function. (The `types.ts:20` comment "base64 of the serialized Envelope" collapses that whole `Envelope → JSON → Noise-encrypt → base64` chain.)

### Defaults (the TypeScript-specific problem)

Mobile relies on Kotlin runtime defaults (`encodeDefaults = true`). TS interfaces carry no runtime defaults, so "always emit defaults" (AC #3) is split by how each field is enforced:

- **Literal-typed fields enforce themselves.** `InnerFrameV2.v: 2` and `HelloClientPayload.role: 'client'` are literal types — you cannot construct the object without them, so `JSON.stringify` always emits them. **No runtime injector.**
- **Non-literal defaults need one constructor.** `makeHelloClientPayload` injects `protocol_versions: ['v2']` (reusing `PROTOCOL_VERSION` from `types.ts`). `capabilities` is a caller argument defaulting to `[]`; production `loadDialConfig` in `daemonConnection` supplies `[CAPABILITY_INTERACTIVE, CAPABILITY_MULTI_AGENT]` (`['interactive', 'multi_agent']`) through [hello exchange](hello-exchange.md). `interactive` enables the structured stream; `multi_agent` unlocks Codex conversations, frames and model rows on supporting v0.27.0+ daemons. The advertised set belongs at the caller: the [capability probe](real-claude-liveness-e2e.md#capability-gated-skip--the-one-check-that-runs-after-the-daemon-exists) supplies exactly its spec's required set. Optional `lastEventId` and legacy `lastSeenTs` become `last_event_id` and `last_seen_ts` only when provided, never `null`. `HelloClientPayload` is the only encode-side payload with non-literal defaults, so it has one constructor. `Envelope` has no defaulted fields; callers build it directly.
- **`client_version` gets an app-name prefix, added once, here.** `input.clientVersion` is the bare app version (`app.getVersion()`, e.g. `"0.1.0"`); the constructor writes `client_version` as `` `${CLIENT_APP_NAME}/${input.clientVersion}` `` (`CLIENT_APP_NAME = 'pyrycode-desktop'`), the `<app>/<MAJOR>.<MINOR>.<PATCH>` format the daemon parses (pyrycode `docs/protocol-mobile.md` § `hello`, "`client_version` format"; \#1612). The prefix is added inside this constructor rather than by the caller because the same bare `clientVersion` also feeds the relay `User-Agent` header and the session-start log banner, and prefixing it upstream would double-prefix both (see [daemon connection lifecycle](daemon-connection-lifecycle.md) `clientVersion` field). Once a daemon release enforces a minimum `client_version` it cannot parse, an unprefixed hello is rejected — desktop shipped this format ahead of that gate.

### Omit-absent-optionals, without `null` (AC #3)

`JSON.stringify` drops `undefined` keys but **serializes `null`**. Represent absent
optionals as `undefined`/omitted: `Envelope.in_reply_to`, `Envelope.event_id` and
`HelloClientPayload.last_event_id` are optional numbers; the legacy `last_seen_ts`
is an optional string. The constructor adds the hello fields only when supplied,
matching mobile's `explicitNulls = false` without a runtime scrub.

`last_event_id` requests bounded current-conversation replay after a daemon-wide
event position. `last_seen_ts` has no daemon consumer; connection-produced hellos
never send it. The codec passes the numeric position through without validating
its range. [Daemon connection](daemon-connection-lifecycle.md#replay-cursor-lifetime)
owns positive-safe-integer validation and the in-memory cursor; `decodeEnvelope`
keeps payloads opaque and only retains numeric `event_id` values. Observe an
admitted envelope before narrowing its payload, so unknown types and malformed
payloads can still advance replay. Failed size or envelope guards cannot advance
or reset it. An expired or unknown position yields `resync`; the connection clears
that host's cursor without automatically loading history.

### Data flow

```
 encode (outbound)                                   decode (inbound)
 Envelope ──encodeEnvelope──► UTF-8 bytes            relay bytes ──decodeInnerFrame──► InnerFrameV2
                │  (#7 Noise-encrypts)                              │  .data
                ▼                                                   ▼ base64StdDecode
 InnerFrameV2.data ◄──base64StdEncode── Noise bytes     Noise bytes (#7 decrypts) ──► plaintext bytes
                │                                                   │
 encodeInnerFrame──► WS text (string) ──► relay          plaintext ──decodeEnvelope──► Envelope{payload: unknown}
```

`payload` stays opaque at both ends; nothing here reaches IPC, the preload, or the renderer.

## Configuration and usage

- **Main-process only, imported by relative path.** `src/main/**` cannot use the `@shared/*` alias — the codec imports the shared types via `../../shared/wire/types`. It uses Node `Buffer` (for base64) and `TextEncoder`/`TextDecoder` (for the UTF-8 leg).
- **Consumers.** #7 (the Noise session) calls `encodeEnvelope`/`decodeEnvelope` around its encrypt/decrypt and `base64StdEncode`/`base64StdDecode` on `InnerFrameV2.data`; the relay wiring sends `encodeInnerFrame(...)` (a string → WS text frame, matching mobile's text-frame contract) and feeds inbound `RelayEvent.frame` bytes to `decodeInnerFrame`.
- **`makeHelloClientPayload`** is the one constructor a caller building the client hello must use — do not hand-build `HelloClientPayload` (you would drop the injected defaults).
- **Input is assumed bounded.** The codec adds no size cap of its own; [`relayConnection`'s `maxFrameBytes`](relay-connection.md) (1 MiB) bounds inbound bytes upstream, so decode never sees unbounded input.

## Edge cases and limitations

- **Envelope vocabulary needs a direct type assertion.** `Envelope.type` accepts
  `EnvelopeType | string`, so constructing an envelope cannot prove that its name
  belongs to the declared vocabulary. `conversation_deleted` was already parsed
  and consumed while its union member was missing (#1247). In
  `src/shared/wire/types.test.ts`, assign the literal directly to `EnvelopeType`
  without a cast, following the `turn_state` and `conversation_deleted` tests.
  Vitest alone can pass with the member absent; `npm run typecheck` checks this
  file through `tsconfig.node.json`, and `npm run build` runs that check too.
  See [test-tier evidence](development-verification.md#what-each-test-tier-proves).
- **Strict base64, by canonical-form check.** Node's `Buffer.from(s, 'base64')` is **lenient on four axes** — it strips non-alphabet chars, accepts url-safe `-`/`_`, tolerates wrong length, and accepts non-canonical final quanta (`'YQ==garbage'` → only `'YQ=='`, no error; `'YR=='` → the same byte as `'YQ=='`). Any of those would let a malformed frame decode to a silently-truncated or off-contract value (violating AC #4). `base64StdDecode` replicates Go's strict `base64.StdEncoding` with **one comparison**: lenient-decode, then require `base64StdEncode(decoded) === data`. Node's encoder emits only canonical output, so every garbage-bearing, url-safe, wrong-length, or non-canonical-quantum input fails the equality and throws — **no truncation**. Decode accepts a value **iff** it is the canonical encoding of its own bytes. The empty string re-encodes to itself and stays valid.
- **Decode fails closed.** `decodeInnerFrame` / `decodeEnvelope` throw `WireDecodeError` on: malformed base64 (above), malformed UTF-8 (`TextDecoder('utf-8', { fatal: true })` rejects invalid byte sequences rather than substituting U+FFFD), malformed JSON (every `JSON.parse` throw — `SyntaxError` *and* deep-nesting `RangeError` — is caught), a non-object top level, and a missing/mistyped required primitive. They never return a partial value.
- **Forward-compatible decode.** Unknown / server-added keys are **tolerated** (e.g. an `ErrorPayload` with `retry_after_s`, or a `payload_encrypted` field) — decode does not throw and `payload` stays opaque. `decodeInnerFrame` tolerates **any** numeric `v` (it does not hard-reject a future version) but normalizes the returned `v` to the literal `2` — the inbound version is intentionally discarded, not preserved.
- **Encode cannot fail** on well-typed input: the tightened types forbid `null` optionals and literal types force the defaults, so the encode functions do not throw.
- **`QrPayload`** round-trips as plain JSON (all string fields) — no dedicated codec function. Its `server_static_pubkey` → validated-32-raw-bytes decode is a **pairing** concern, deferred to the QR/pairing ticket.
- **Prototype pollution is not a live sink here.** `JSON.parse` creates an *own* `__proto__` key and does not pollute `Object.prototype`; the codec does no recursive merge. No wire field is named `__proto__`/`constructor`/`prototype`, so no reviver was added (evidence-based). The documented obligation on consumers: do **not** naïve-deep-merge the opaque `payload`.

## Security posture

The ticket carries the `security-sensitive` label; the architect's review verdict is **PASS** (`docs/specs/architecture/5-wire-codec.md § Security review`).

- **Structural renderer isolation.** The codec handles secret material — device `token` in hello/QR payloads, and message plaintext — plus Node `Buffer`. Living under `src/main/transport/`, the renderer bundle **physically cannot import it** (`src/main/**` is outside the renderer's reachable graph). This is the *deterministic* control that replaced the rev-1 placement under `src/shared/wire/`, where isolation rested only on the *convention* "don't add a barrel" (see [#5 notes](../codebase/5.md)). `types.ts` (which the renderer *does* import) stays in `src/shared/wire/` and `Buffer`-free — keep the types-vs-codec split.
- **Secret-safe error messages.** `WireDecodeError` messages name the **failure category only** (`"malformed base64"`, `"invalid UTF-8"`, `"malformed JSON"`, `"missing required field: type"`) and **never** echo the raw bytes/string or decoded field values — frames and envelopes carry the device `token` and message plaintext. The codec performs **no logging** (`console.*`) whatsoever. (Mirrors mobile's `decodeServerStaticPubkey`, which names the category and never echoes the key.) Restated obligation for #7: do not `console.log` a hello payload.
- **Crypto-free.** No RNG, no hashing, no key handling, no MAC/token comparison — base64 and JSON are not cryptographic. The Noise handshake and AEAD are #7's; the codec must not be extended to compare secrets.

## Related

- **`UnrecognizedMessagePayload`'s doc comment** (`src/shared/wire/types.ts`, above the interface) — the dated census of what the daemon actually forwards for the two lines this codec's `unrecognized_message` frame is *not* emitted for. `system` and `rate_limit_event` both stay unreachable from that frame, but by different routes: `system` holds it because it is the sole member of the daemon's `ignoredLineTypes` map (unreachable **by list membership**), `rate_limit_event` because it has an arm of its own that never falls through to the unrecognized case (unreachable **by matching**, the daemon's stronger guarantee) — the two phrases are not interchangeable, and a comment that applies one to both inverts the distinction. Measured 2026-09-07 against pyrycode `internal/streamsup/parser.go`; re-measure rather than citing that date once the daemon moves again (#1248).
- [Relay connection](relay-connection.md) (#21) — the opaque byte pipe this codec sits on top of; its 1 MiB `maxFrameBytes` bounds the input decode sees.
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md) — "do not drift the encoded form from mobile without a matching daemon change", and the types→`shared` / codec→`transport` split this ticket enforces.
- [ADR 0001 — Stack: transport in the background process](../decisions/0001-stack-electron-react-typescript.md) — the background-process transport home.
- [#5 codebase notes](../codebase/5.md) · Spec: `docs/specs/architecture/5-wire-codec.md`
- Go/mobile mirror (via QMD `pyrycode-docs`): `knowledge/features/v2-session-manager.md` (`internal/relay` Noise_IK + JSON-decode boundary) and `docs/protocol-mobile.md` (§ Wire shapes / Transport) — the source-of-truth this codec ports.
