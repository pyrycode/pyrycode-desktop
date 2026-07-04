# Spec: Hello and hello-ack exchange (#10)

The **application-handshake envelope layer**: two pure functions in one new main-process module
that turn the device identity + stored token into the client `hello` early-data bytes, and turn the
daemon's `hello_ack` early-data bytes back into a validated, typed `HelloAckPayload`. This is the
semantic edge that sits on top of the [#5 wire codec](../../knowledge/features/wire-codec.md) (which
keeps `Envelope.payload` opaque `unknown` by design) and fills in the opaque `hello`/`helloAck`
`Uint8Array`s that the [#7 Noise session](../../knowledge/features/noise-session.md) and
[#50 Noise relay driver](../../knowledge/features/noise-relay-driver.md) carry but explicitly defer
("building them is #10's job").

Wiring these bytes into a live driver, sourcing the key/token, and emitting the completed handshake
to the renderer is the **consumer slice #62** (blocked by this ticket). This ticket is
self-contained and unit-testable with injected inputs; it has **no production caller** on merge.

## Files to read first

- `src/main/transport/codec.ts:112-174` — the three codec functions this module composes:
  `encodeEnvelope` (112), `decodeEnvelope` (127), and `makeHelloClientPayload` (157). **Read the
  `makeHelloClientPayload` doc comment (143-156) closely** — it deliberately makes `capabilities` a
  caller argument defaulting to `[]` and does **not** inject `interactive`; that supersedes this
  ticket's AC #1 wording (see § Reconciliation).
- `src/main/transport/codec.ts:32-47` — `WireDecodeError` (32) and `WireEncodeError` (42). This
  module **reuses `WireDecodeError`** for its own boundary failures; do not add a new error class.
- `src/shared/wire/types.ts:50-85` — `Envelope` (51), `HelloClientPayload` (65), `HelloAckPayload`
  (80); plus `EnvelopeType` (40), `PROTOCOL_VERSION`/`CAPABILITY_INTERACTIVE` (13-14). Import by
  **relative path** (`../../shared/wire/types`) — `src/main` has no `@shared` alias.
- `src/main/transport/codec.test.ts:140-281` — the round-trip + default-injection test idiom to
  mirror. Especially **228-252** (pins `capabilities:[]` and `not.toContain('interactive')`, and
  "advertises only the capabilities the caller passes in"), **163-171** (the `hello_ack` fixture
  shape), and **325-336** (the secret-safety error-message assertion pattern).
- `docs/knowledge/features/wire-codec.md` — opaque-`payload` contract, "consumers validate at their
  own edge," and the category-only / no-logging error discipline this module inherits.
- `docs/knowledge/features/noise-relay-driver.md:39-52` — the injection seam: #62 feeds
  `buildClientHello(...)` output into `NoiseRelayDriverConfig.session.hello`, and feeds the
  `handshake-complete{helloAck}` event's bytes into `parseHelloAck(...)`.
- QMD `pyrycode-docs` (mobile/daemon mirror — read via `mcp__qmd__get`):
  - `protocol-mobile.md` § hello / hello_ack — **both carry `capabilities` as `omitempty`**: absent
    (not `null`) when empty. This is the load-bearing fact behind § Reconciliation and the parse
    contract.
  - `knowledge/features/v2-session-manager.md:27-28` — the daemon marshals
    `HelloAckPayload{ProtocolVersion, ServerID, ConnID}` into `Envelope{ID:1, Type:hello_ack,
    InReplyTo:&hello.ID}` and does **not** set `Capabilities` — so a real ack usually omits it.

## Context

After the Noise channel is up, the daemon speaks an application handshake on top of it: the client
sends a `hello` envelope as Noise **early-data** (inside IK message 1); the daemon validates the
token and replies with a `hello_ack` (recovered from IK message 2). The Noise layer already carries
both as **opaque bytes**. This ticket is the envelope layer on either side of those bytes — nothing
here touches sockets, keys, the handshake, IPC, the preload, or the renderer.

The token, device name, client version, envelope `id`, and `ts` are **inputs** here; sourcing them
(paired-server store `load()`, app identity, an id counter, the wall clock) belongs to the consumer
slice #62. Keeping them as inputs makes both functions deterministic and trivially unit-testable —
no wall-clock read, no storage, no globals.

## Reconciliation: the ticket body is stale on two points (read before designing)

The ticket body was written against an **earlier draft** of the #5 codec. Two of its statements
contradict the merged, tested code and the daemon contract. **Follow this spec, not the stale AC
wording.** Both reconciliations are documented so code-review sees the deviation is intentional.

1. **`interactive` capability (AC #1, Technical Notes).** The body says the payload carries "the
   `interactive` capability" and that `makeHelloClientPayload` injects `capabilities:['interactive']`
   defaults. **It does not.** `codec.ts:157-174` makes `capabilities` a caller argument defaulting to
   `[]`, with an explicit rationale (143-156): the desktop event pipeline models only the coarse
   `message`/`message_chunk` types (confirmed in
   [`session-store.md`](../../knowledge/features/session-store.md) — no `turn_state`/delta/tool
   stream), so advertising `interactive` would make the daemon fan out envelopes this client cannot
   render and the user would see nothing. `codec.test.ts:238-240` actively pins `capabilities:[]`
   and `not.toContain('interactive')`. **Resolution:** `buildClientHello` threads `capabilities` as
   an **optional input**, defaulting to omitted (→ codec's `[]`). It never hardcodes `interactive`.
   The capability policy is deferred to #62 / a future interactive-stream ticket, which passes it in
   explicitly once the structured events are modeled — the same "sourcing is the consumer's job"
   split the ticket already applies to token/device/version.

2. **`last_event_id` → `last_seen_ts` (Technical Notes).** The body references `last_event_id`. That
   field was removed from the wire types; the codec now takes `lastSeenTs?: string` (RFC3339), which
   maps to `HelloClientPayload.last_seen_ts` (daemon `LastSeenTS *time.Time,omitempty`). `buildClientHello`
   threads `lastSeenTs` as an optional pass-through. It is not load-bearing until backfill-on-reconnect
   (#34); absent for the milestone round-trip.

## Design

One new file: `src/main/transport/helloExchange.ts` (main-process only — it imports `codec.ts`,
which uses Node `Buffer`; never re-export it through any renderer barrel). Two pure, synchronous,
side-effect-free functions and one exported input type. No new error class — reuse the codec's
`WireDecodeError`.

### Public surface (contract sketch — not the implementation)

```ts
import { encodeEnvelope, decodeEnvelope, makeHelloClientPayload, WireDecodeError } from './codec'
import type { Envelope, HelloAckPayload } from '../../shared/wire/types'

/** Inputs the consumer (#62) sources; kept explicit so the builder is deterministic + testable. */
export interface ClientHelloInput {
  id: number                       // the hello Envelope's numeric id (consumer's id counter)
  ts: string                       // RFC3339 timestamp (consumer's clock) — never read here
  deviceName: string
  clientVersion: string
  token: string                    // the stored device token (Noise early-data secret)
  capabilities?: readonly string[] // OPTIONAL; omitted → codec default []. Never hardcoded here.
  lastSeenTs?: string              // OPTIONAL backfill anchor; exercised by #34, absent for now
}

/** Build the client `hello` early-data bytes: a `hello` Envelope wrapping a defaults-injected
 *  HelloClientPayload, serialized to UTF-8 via encodeEnvelope. Total on well-typed input. */
export function buildClientHello(input: ClientHelloInput): Uint8Array

/** Parse `hello_ack` early-data bytes into a typed HelloAckPayload. Fail-closed: throws
 *  WireDecodeError (never a partial value) on any structural or semantic mismatch. */
export function parseHelloAck(bytes: Uint8Array): HelloAckPayload
```

### `buildClientHello` — behavior

1. `const payload = makeHelloClientPayload({ deviceName, clientVersion, token, capabilities, lastSeenTs })`
   — the codec injects `role:'client'` and `protocol_versions:['v2']`, defaults `capabilities` to
   `[]` when omitted, and omits `last_seen_ts` when absent. **Never hand-build `HelloClientPayload`**
   (that would drop the injected defaults — the one thing this constructor exists to prevent).
2. `const envelope: Envelope = { id: input.id, type: 'hello', ts: input.ts, payload }` — `type` is
   the literal `'hello'` (an `EnvelopeType`). No optional envelope fields on an outbound hello.
3. `return encodeEnvelope(envelope)` — UTF-8 bytes, the Noise early-data.

`encodeEnvelope` can throw `WireEncodeError` on an over-cap envelope, but a hello is a few hundred
bytes — orders of magnitude under `MAX_PLAINTEXT_BYTES` (65519). This is not a live failure mode; it
is **not defended** (evidence-based — no observed failure), and would propagate if it ever occurred.

### `parseHelloAck` — behavior and the fail-closed ladder

Steps, in order; each rung throws `WireDecodeError` (category-only message) and returns nothing on
failure:

1. `const envelope = decodeEnvelope(bytes)` — the codec's fail-closed structural boundary (invalid
   UTF-8 / malformed JSON / non-object / missing `id`/`type`/`ts`/`payload` → `WireDecodeError`).
   Let it propagate; do not re-wrap.
2. **Envelope type** — `envelope.type !== 'hello_ack'` → throw (`'unexpected envelope type'`). Guards
   against a stray `message`/`error` envelope being mis-parsed as an ack.
3. **Payload shape** — narrow `envelope.payload` to a record (non-null, non-array object). Reuse the
   codec's `isRecord`-style predicate (a small local copy — `isRecord` is not exported; keep it
   inline, do not export a duplicate from codec). A string/number/array/null payload → throw
   (`'malformed hello_ack payload'`).
4. **Required string fields** (the daemon always sends these): `protocol_version`, `server_id`,
   `conn_id`. Each `typeof !== 'string'` → throw (`'missing required field: <name>'`).
5. **`capabilities` — OPTIONAL, default `[]`.** See the critical note below. If the key is present it
   MUST be an array whose every element is a string (else throw `'malformed hello_ack capabilities'`);
   if absent, use `[]`. Copy the array (`[...]`) so the returned value doesn't alias the parsed input.
6. Return `{ protocol_version, server_id, conn_id, capabilities }` — **only** the four known fields.
   Unknown/server-added keys are tolerated (forward-compat, matching the codec) but **not** copied
   into the typed result.

**Critical correctness — `capabilities` is optional, not required.** AC #2 lists `capabilities`
among captured fields and AC #3 says "a missing required field throws." Do **not** conflate the two
into "capabilities is required." The daemon marshals `hello_ack` with `capabilities` as `omitempty`
(`protocol-mobile.md` § hello_ack; `v2-session-manager.md:27-28` sets only `ProtocolVersion`/
`ServerID`/`ConnID`), so a **legitimate** ack usually omits it. Treating it as required would
fail-closed on a real daemon response and silently break the handshake — the exact silent-failure
class this whole layer exists to prevent. Only `protocol_version`, `server_id`, `conn_id` are
required; `capabilities` is optional-with-default-`[]`. The returned `HelloAckPayload` still always
carries `capabilities: string[]` (possibly empty), so the shared type needs **no change** — the type
is the normalized post-parse shape; `omitempty` lives on the wire only.

### Data flow

```
 build (outbound, #62 sources inputs)          parse (inbound, #62 feeds ack bytes)
 ClientHelloInput ─buildClientHello─┐          helloAck bytes ─decodeEnvelope(#5)─► Envelope{payload:unknown}
   │ makeHelloClientPayload(#5)      │                                    │ type==='hello_ack'?
   ▼                                 │                                    ▼ narrow payload (record + fields)
 Envelope{type:'hello'} ─encodeEnvelope(#5)─► UTF-8 bytes    HelloAckPayload{protocol_version,server_id,
   → NoiseRelayDriverConfig.session.hello (#62)                            conn_id, capabilities}
```

## State + concurrency model

None. Both functions are pure, synchronous, reentrant, and hold no state — no store, no async, no
timer, no listener, no shared mutable variable (mirrors the codec's model, `wire-codec.md` § How it
works). There is nothing to cancel or tear down. The store/concurrency surface is entirely the
consumer's (#62 / the driver / the renderer session store).

## Error handling

| Layer / failure | Result | Terminal? |
|---|---|---|
| `decodeEnvelope` structural failure (UTF-8 / JSON / non-object / missing envelope field) | `WireDecodeError` propagated from codec | throws |
| Envelope `type !== 'hello_ack'` | `WireDecodeError('unexpected envelope type')` | throws |
| Payload not a record | `WireDecodeError('malformed hello_ack payload')` | throws |
| Missing/mistyped `protocol_version` / `server_id` / `conn_id` | `WireDecodeError('missing required field: <name>')` | throws |
| `capabilities` present but not a `string[]` | `WireDecodeError('malformed hello_ack capabilities')` | throws |
| `capabilities` absent | default `[]`, **no throw** (omitempty is legal) | ok |
| `buildClientHello` over-cap (not a live mode) | `WireEncodeError` propagated from codec | throws |

- **One error type across the whole decode→narrow chain.** Reusing `WireDecodeError` (imported from
  `./codec`) means the consumer catches a single type for both structural and semantic failures, and
  it is the exact "trust-boundary discipline" AC #3 asks to match. No new error class (simplicity;
  the codec already owns this boundary signal).
- **Secret-safe, log-free (AC #4).** Every thrown message names the failure **category only** — never
  the token, the ack field values, or the raw bytes (the hello carries the device token; error text
  can reach a crash reporter). **Zero `console.*`** anywhere in the module. This matches the codec's
  discipline verbatim (`wire-codec.md` § Security posture) and is pinned by a `console`-spy test.
- **Fail-closed, never partial.** No rung returns a half-built value; a throw aborts before any field
  is surfaced.

## Testing strategy

`src/main/transport/helloExchange.test.ts` (vitest, `npm test`), mirroring `codec.test.ts`'s idiom.
Fixtures build ack bytes by `encodeEnvelope(wrap('hello_ack', payload))` from the codec — round-trip
against the real serializer, not hand-typed JSON, so the test can't drift from the wire form. Write
scenarios as cases (developer writes the assertions in the project idiom):

**`buildClientHello`:**
- Round-trip: build → `decodeEnvelope` → envelope has `{ id, type:'hello', ts }` from the inputs, and
  `payload` deep-equals `makeHelloClientPayload({...})` (defaults `role:'client'`,
  `protocol_versions:['v2']`, `capabilities:[]`) injected.
- Default capabilities: omitting `capabilities` → serialized payload contains `"capabilities":[]` and
  **not** `"interactive"` (the reconciliation guard — mirror `codec.test.ts:238-240`).
- Passed capabilities: `capabilities:['message']` threads through to the payload verbatim.
- `lastSeenTs` present → payload includes `last_seen_ts`; absent → key omitted, no `null` in the JSON.
- Determinism: two calls with identical inputs produce byte-identical output (no wall-clock/id read).

**`parseHelloAck` — happy path:**
- Full ack (`protocol_version`,`server_id`,`conn_id`,`capabilities:['interactive']`) → typed
  `HelloAckPayload` with all four fields equal.
- **Capabilities-absent ack** (daemon `omitempty` case: payload = `{protocol_version,server_id,conn_id}`)
  → returns `capabilities: []`, no throw. *(This is the load-bearing correctness test — a required-field
  treatment would fail here.)*
- Forward-compat: extra unknown keys in payload and envelope are tolerated; result carries only the
  four known fields (unknowns dropped).

**`parseHelloAck` — fail-closed (each throws `WireDecodeError`):**
- Wrong envelope `type` (`'message'`, `'error'`, `'hello'`).
- Non-record payload: string, number, array, `null`.
- Missing or non-string `server_id` / `conn_id` / `protocol_version` (one case each).
- `capabilities` present but wrong type: `"x"` (string), `[1,2]` (non-string elements), `{}` (object).
- Malformed bytes inherited from `decodeEnvelope`: invalid UTF-8, malformed JSON, non-object JSON,
  envelope missing `id`/`ts`/`payload` — assert the `WireDecodeError` still surfaces through this
  function (one or two representative cases; the codec already covers the matrix exhaustively).

**Security / hygiene (AC #4):**
- Secret-safety: a `WireDecodeError` from a bad ack whose payload embeds a `server_id`/`conn_id`
  string does **not** echo that value in `.message` (category-only) — mirror `codec.test.ts:325-336`.
- `console`-spy: spy all six `console` methods; assert **zero** calls across a happy build, a happy
  parse, and every reject branch above.

Type-level: `npm run typecheck` covers both sides; the exported `ClientHelloInput` and the
`HelloAckPayload` return type are checked structurally.

## Open questions

- **`WireDecodeError` reuse vs a dedicated `HelloAckDecodeError`.** Spec recommends **reuse** — a
  single catchable type at the #62 boundary, and it is literally the discipline AC #3 names. A
  dedicated type would only help if #62 needed to distinguish "envelope malformed" from "ack
  semantics wrong," which it does not (both are "daemon sent something we can't trust" → same
  connection-failure handling). If #62 later needs the distinction, adding a subclass is a
  non-breaking change. **Recommendation: reuse; revisit only if #62 surfaces a real need.**
- **`id`/`ts` as explicit inputs vs an injected clock/id-source.** Spec chooses explicit `id`+`ts`
  inputs (simplest deterministic seam; no abstraction for a single call site). If #62 finds it
  cleaner to inject a `{ now(): string; nextId(): number }` provider, that is its call — this module
  stays agnostic by taking the resolved values. **Recommendation: explicit inputs; defer any clock
  abstraction to #62 if it wants one.**

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX — the untrusted→trusted boundary is exactly one function,
  `parseHelloAck` (daemon early-data bytes → typed `HelloAckPayload`). It layers on the codec's
  `decodeEnvelope` structural boundary and adds the semantic narrowing that the codec deliberately
  defers (`Envelope.payload` stays `unknown`; consumers "validate at their own edge" — this is that
  edge). It fails closed via `WireDecodeError`, never returns a partial value, and hands #62 a
  concrete type (not `unknown`) — the type system signals the data is now validated. `buildClientHello`
  is a trusted→wire path (inputs from main-process #62), not an inbound boundary.
- **[Tokens / secrets]** No MUST FIX — the device `token` is an **input** to `buildClientHello`,
  serialized onto the wire as Noise early-data where the protocol requires; it is never generated,
  stored, compared, or logged here. It cannot leak through errors: `buildClientHello` throws only the
  codec's category-only `WireEncodeError` (never echoes values), and `parseHelloAck` never sees the
  token. Token lifecycle (creation/storage/rotation/revocation) is **out of scope** — sourced by
  #62 / stored by #42 (`safeStorage`) / recorded by #44. No `Math.random()`, no secret comparison,
  so no `crypto.timingSafeEqual` is applicable (nothing secret is compared).
- **[File / storage]** N/A — the module performs zero filesystem or storage I/O of any kind. No
  paths, no reads, no writes; no path-traversal / TOCTOU / atomic-write surface exists.
- **[Inter-process / Electron]** No MUST FIX — the module adds no `ipcMain`/`ipcRenderer` channel, no
  `contextBridge` API, no `BrowserWindow`, no custom protocol, no navigation surface. Living under
  `src/main/transport/` and importing `codec.ts` (Node `Buffer`), it is **structurally** excluded
  from the renderer bundle — the renderer physically cannot import `src/main/**`. The spec states it
  must never be re-exported through a renderer barrel (same control the codec relies on). The device
  token therefore stays in main-process memory and never reaches renderer web storage / DevTools.
- **[Cryptographic primitives]** N/A with justification — crypto-free. No RNG, no hashing, no key or
  nonce handling, no MAC/AEAD, no `(key, nonce)` pair (there are none to reuse). JSON serialization
  is not cryptographic. The authenticity of the `hello_ack` bytes is established upstream by #7's
  vetted Noise `ReadMessage` (the daemon proved possession of its static key); this module must not
  be extended to compare secrets or re-implement any handshake step.
- **[Network & I/O]** No MUST FIX — the module is not the socket; it sets no `maxPayload`/timeout and
  opens no connection (the relay connection / supervisor own those). `parseHelloAck`'s input is
  bounded upstream: a v2 Noise transport message ≤ 65535 bytes and the codec's `MAX_PLAINTEXT_BYTES`
  (65519) cap the decrypted envelope before it reaches `decodeEnvelope`, so there is no
  memory-amplification vector. The `capabilities`-array validation loop is bounded by that same
  envelope cap. Deep-nesting `JSON.parse` `RangeError` is caught inside `decodeEnvelope`. TLS / relay
  URL / reconnect discipline are #21/#22's concern, out of scope.
- **[Error messages / logs / telemetry]** No MUST FIX (AC #4, enforced by a MUST in § Error
  handling) — every thrown `WireDecodeError` names the failure **category only** (`'unexpected
  envelope type'`, `'malformed hello_ack payload'`, `'missing required field: server_id'`, `'malformed
  hello_ack capabilities'`); a field **name** is a protocol constant, never a value. No message echoes
  the token, the ack field values, or the raw bytes (which would reach a crash reporter). **Zero
  `console.*`** in the module, pinned by a six-method `console`-spy test across the happy paths and
  every reject branch. No telemetry.
- **[Concurrency]** No findings — two pure, synchronous, reentrant functions. No async, no shared
  mutable state, no timers, no listeners, nothing to cancel or tear down; no check-then-act race is
  possible (no state, no `await`).
- **[Threat-model alignment]** Walked against the desktop threat set:
  - *Malicious / on-path relay:* it is content-blind and cannot forge the `hello_ack` (inside the
    AEAD-authenticated Noise session); corrupting bytes MAC-fails at #7 (`handshake-read-failed`,
    never reaching this module). Any authenticated-but-malformed ack that does reach `parseHelloAck`
    fails closed with no plaintext leak (no logging) and no hang (synchronous, bounded input).
  - *Hostile daemon response:* the fail-closed ladder in `parseHelloAck` is exactly this defense —
    wrong type / non-object / missing-or-mistyped field / bad `capabilities` → `WireDecodeError`,
    never a partial value; oversize is bounded upstream. The `capabilities`-absent→`[]` default is the
    safe least-capability reading, not an escalation sink.
  - *Renderer compromise reaching the transport:* mitigated structurally by main-only placement — a
    renderer script-injection gains no import path to this module, the token, or the ack bytes.
  - *Token theft from disk:* N/A here (no storage) — that bar is raised by #42's `safeStorage`.
  - *Prototype pollution:* `parseHelloAck` reads only specific named protocol fields off the
    `JSON.parse`-produced object and builds a fresh object literal; it does **no** recursive merge and
    never reads/writes `__proto__`/`constructor`. No pollution sink (inherits the codec's posture).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
