# Hello exchange

The **application-handshake envelope layer**: two pure functions in `src/main/transport/helloExchange.ts` that turn the device identity + stored token into the client `hello` early-data bytes, and turn the daemon's `hello_ack` early-data bytes back into a validated, typed `HelloAckPayload`. It is the **semantic edge** that sits on top of the [wire codec](wire-codec.md) (which keeps `Envelope.payload` opaque `unknown` by design) and fills in the opaque `hello`/`helloAck` `Uint8Array`s that the [Noise session](noise-session.md) and [Noise relay driver](noise-relay-driver.md) carry but explicitly defer — *"building them is #10's job."*

Introduced in [#10](../codebase/10.md). Lives entirely in the Electron **background process**; the `hello` it builds carries the device token as Noise early-data, and it must never be re-exported through a renderer barrel.

## What it does

After the Noise channel is up, the daemon speaks an application handshake on top of it: the client sends a `hello` envelope as Noise **early-data** (inside IK message 1); the daemon validates the token and replies with a `hello_ack` (recovered from IK message 2). The Noise layer already carries both as **opaque bytes**. This module is the envelope layer on either side of those bytes — nothing here touches sockets, keys, the handshake, IPC, the preload, or the renderer. It mirrors mobile's hello handling in `NoiseSessionPump` / the mobile wire models.

- `buildClientHello(input)` → `Uint8Array` — the outbound (trusted → wire) path: a `hello` `Envelope` wrapping a defaults-injected `HelloClientPayload`, serialized to UTF-8 via `encodeEnvelope`. Total on well-typed input.
- `parseHelloAck(bytes)` → `HelloAckPayload` — the inbound (untrusted → trusted) path: the daemon's `hello_ack` early-data bytes narrowed to a validated, typed payload. **Fails closed** — throws `WireDecodeError`, never returns a partial value.

## How it works

One file, two pure/synchronous/side-effect-free functions, one exported input type, **no new error class** — it reuses the codec's `WireDecodeError` so the consumer catches a single type for both structural and semantic failures. No store, no async, no timer, no shared mutable state; reentrant by construction (mirrors the codec's model).

### Public surface

```ts
export interface ClientHelloInput {
  id: number                       // the hello Envelope's numeric id (consumer's id counter)
  ts: string                       // RFC3339 timestamp (consumer's clock) — never read here
  deviceName: string
  clientVersion: string
  token: string                    // the stored device token (Noise early-data secret)
  capabilities?: readonly string[] // OPTIONAL; omitted → codec default []. Never hardcoded here.
  lastSeenTs?: string              // OPTIONAL backfill anchor; exercised by #34, absent for now
}

export function buildClientHello(input: ClientHelloInput): Uint8Array
export function parseHelloAck(bytes: Uint8Array): HelloAckPayload
```

### `buildClientHello`

1. `makeHelloClientPayload({ deviceName, clientVersion, token, capabilities, lastSeenTs })` — the codec injects `role:'client'` and `protocol_versions:['v2']`, defaults `capabilities` to `[]` when omitted, and omits `last_seen_ts` when absent. **Never hand-build `HelloClientPayload`** — that would drop the injected defaults, the one thing that constructor exists to prevent.
2. Wrap it: `{ id, type: 'hello', ts, payload }` — `type` is the literal `'hello'`; no optional envelope fields on an outbound hello.
3. `encodeEnvelope(...)` → UTF-8 bytes, the Noise early-data.

`id` and `ts` are taken as **inputs** rather than read from a wall clock / counter, which keeps the builder deterministic and byte-reproducible: identical inputs produce byte-identical output. Sourcing them (plus the token, device name, client version) is the consumer's job (#62 / app identity / the paired-server store `load()`).

### `parseHelloAck` — the fail-closed ladder

Each rung throws a category-only `WireDecodeError` and returns nothing on failure:

1. `decodeEnvelope(bytes)` — the codec's fail-closed structural boundary (invalid UTF-8 / malformed JSON / non-object / missing `id`/`type`/`ts`/`payload`). Propagated, never re-wrapped.
2. **Envelope type** — `type !== 'hello_ack'` → `'unexpected envelope type'`. Guards a stray `message`/`error`/`hello` envelope from being mis-parsed as an ack.
3. **Payload shape** — narrow to a record (non-null, non-array object). A string/number/array/null payload → `'malformed hello_ack payload'`. (Uses a small local `isRecord`; the codec's is not exported.)
4. **Required string fields** — `protocol_version`, `server_id`, `conn_id`; each `typeof !== 'string'` → `'missing required field: <name>'`.
5. **`capabilities` — OPTIONAL, default `[]`.** If present it MUST be an array of strings (else `'malformed hello_ack capabilities'`); if absent, use `[]`. The array is copied (`[...]`) so the result doesn't alias the parsed input.
6. **`workspace_root` — OPTIONAL, no default.** Omission stays absent. A present value
   must be a string (including empty or relative strings); non-strings fail through the
   required-string validator with static field-name copy. Absolute-base admission belongs
   to [Add workspace](add-workspace-dialog.md#connection-and-folder-admission), not decoding.
7. Return **only** the validated known fields. Unknown / server-added keys are tolerated (forward-compat, matching the codec) but not copied through.

**`capabilities` is optional, not required — this is the load-bearing correctness point.** The daemon marshals `hello_ack` with `capabilities` as `omitempty` (absent, not `null`, when empty), so a *legitimate* ack usually omits it. Treating it as required would fail-closed on a real daemon response and silently break the handshake — the exact silent-failure class this whole layer exists to prevent. The returned `HelloAckPayload` still always carries `capabilities: string[]` (possibly empty), so the shared wire type needs **no change**: the type is the normalized post-parse shape; `omitempty` lives on the wire only.

### Data flow

```
 build (outbound, #62 sources inputs)              parse (inbound, #62 feeds ack bytes)
 ClientHelloInput ─buildClientHello─┐              helloAck bytes ─decodeEnvelope─► Envelope{payload:unknown}
   │ makeHelloClientPayload          │                                    │ type==='hello_ack'?
   ▼                                 │                                    ▼ narrow payload (record + fields)
 Envelope{type:'hello'} ─encodeEnvelope─► UTF-8 bytes    HelloAckPayload{protocol_version, server_id,
   → NoiseRelayDriverConfig.session.hello (#62)                          conn_id, capabilities, workspace_root?}
```

## Configuration and usage

- **Main-process only, imported by relative path.** `src/main/**` has no `@shared` alias — the module imports the wire types via `../../shared/wire/types` and the codec via `./codec`. It (transitively, through the codec) uses Node `Buffer`, so the renderer bundle physically cannot import it.
- **No production caller on merge.** This ticket is the self-contained envelope module; wiring it into a live driver is the [#62](https://github.com/pyrycode/pyrycode-desktop/issues/62) consumer slice (blocked by #10). The injection seam: #62 feeds `buildClientHello(...)` output into `NoiseRelayDriverConfig.session.hello`, and feeds the driver's `handshake-complete{helloAck}` bytes into `parseHelloAck(...)`.
- **`makeHelloClientPayload` is mandatory** for the hello payload — do not hand-build `HelloClientPayload` (you would drop the injected `role`/`protocol_versions` defaults and the `capabilities`/`last_seen_ts` omitempty handling).

## Edge cases and limitations

- **`capabilities` is never hardcoded to `interactive`.** The desktop event pipeline models only the coarse `message`/`message_chunk` types (no `turn_state`/delta/tool stream — see [session store](session-store.md)), so advertising `interactive` would make the daemon fan out envelopes this client cannot render and the user would see nothing. The capability policy is deferred to a caller that has modeled the structured stream and passes them in explicitly — the same "sourcing is the consumer's job" split applied to token/device/version.
- **`lastSeenTs` is a pass-through, not load-bearing yet.** It maps to `HelloClientPayload.last_seen_ts` (daemon `LastSeenTS *time.Time,omitempty`) and is absent for the milestone round-trip; it only matters at backfill-on-reconnect ([#34](https://github.com/pyrycode/pyrycode-desktop/issues/34)).
- **Over-cap encode is not defended.** `encodeEnvelope` can throw `WireEncodeError` on an over-cap envelope, but a hello is a few hundred bytes — orders of magnitude under `MAX_PLAINTEXT_BYTES` (65519). This is not a live failure mode (evidence-based — no observed failure); it would simply propagate if it ever occurred.
- **Input to `parseHelloAck` is bounded upstream.** A v2 Noise transport message is ≤ 65535 bytes and the codec's `MAX_PLAINTEXT_BYTES` caps the decrypted envelope before it reaches `decodeEnvelope`, so there is no memory-amplification vector and the `capabilities`-array validation loop is bounded by that same cap.

## Security posture

The architect's self-review verdict is **PASS** (`docs/specs/architecture/10-hello-and-hello-ack-exchange.md § Security review`).

- **One untrusted → trusted boundary: `parseHelloAck`.** It layers the semantic narrowing the codec defers onto `decodeEnvelope`'s structural boundary, fails closed via `WireDecodeError`, never returns a partial value, and hands the consumer a concrete `HelloAckPayload` (not `unknown`) — the type system signals the data is now validated. `buildClientHello` is a trusted → wire path (inputs from the main-process consumer), not an inbound boundary.
- **Secret-safe, log-free.** Every thrown message names the failure **category only** (`'unexpected envelope type'`, `'malformed hello_ack payload'`, `'missing required field: server_id'`, `'malformed hello_ack capabilities'`) — a field *name* is a protocol constant, never a value. No message echoes the token, the ack field values, or the raw bytes (error text can reach a crash reporter, and the hello carries the device token). **Zero `console.*`** in the module, pinned by a six-method `console`-spy test across the happy paths and every reject branch.
- **Token is an input, never handled as a secret here.** The device `token` is serialized onto the wire as Noise early-data where the protocol requires; it is never generated, stored, compared, or logged. Its lifecycle (storage/rotation) is out of scope — [#42](secure-store.md) stores it, [#44](paired-server-store.md) records it, #62 sources it.
- **Crypto-free.** No RNG, no hashing, no key/nonce handling — JSON serialization is not cryptographic. The authenticity of the `hello_ack` bytes is established upstream by the [Noise session](noise-session.md)'s AEAD-authenticated `ReadMessage` (the daemon proved possession of its static key); this module must not be extended to compare secrets or re-implement any handshake step.
- **No prototype-pollution sink.** `parseHelloAck` reads only specific named protocol fields off the `JSON.parse`-produced object and builds a fresh object literal — no recursive merge, no `__proto__`/`constructor` access (inherits the codec's posture).

## Related

- [Wire codec](wire-codec.md) (#5) — the serialization layer this module composes: `makeHelloClientPayload`, `encodeEnvelope`, `decodeEnvelope`, and the `WireDecodeError` reused here. It keeps `Envelope.payload` opaque `unknown`; this module is the edge that validates it.
- [Noise session](noise-session.md) (#7) — carries `hello` (early-data for IK msg 1) and `helloAck` (recovered from msg 2) as opaque bytes; the envelope semantics are this module's job.
- [Noise relay driver](noise-relay-driver.md) (#50) — the composition adapter whose `session.hello` this feeds and whose `handshake-complete{helloAck}` this parses, once #62 wires them.
- [#10 codebase notes](../codebase/10.md) · Spec: `docs/specs/architecture/10-hello-and-hello-ack-exchange.md`
- Mobile/daemon mirror (via QMD `pyrycode-docs`): `protocol-mobile.md` § hello / hello_ack (both carry `capabilities` as `omitempty`); `knowledge/features/v2-session-manager.md` (the daemon marshals `HelloAckPayload{ProtocolVersion, ServerID, ConnID}` and does not set `Capabilities`).
