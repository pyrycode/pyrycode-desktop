# Spec #116 — Reassemble the streamed debug-bundle chunks into the archive

**Ticket:** [#116](https://github.com/pyrycode/pyrycode-desktop/issues/116) · size **S** · `security-sensitive`
**Blockers:** #115 (CLOSED — request send) and #117 (CLOSED — save) already merged. This is the missing middle: recognise the daemon's streamed reply and reassemble it.
**Consumer:** #118 (OPEN — renderer command with progress/result) wires a `BundleConsumer` into `requestDebugBundle(consumer)`.

## Design source

N/A — background-process transport work (frame recognition + reassembly). No renderer/UI surface, so no Figma anchor is required. The UI (the Download button) is #72, behind #118.

## Context

The receive half of the client debug-bundle feature. #115 already sends the bare `request_debug_bundle` control frame. The daemon (`pyrycode/pyrycode`#812/#813, merged) answers on the requesting connection by **streaming** the archive as ordered `debug_bundle_chunk`\* frames followed by one `debug_bundle_done` marker, or — if it cannot assemble the bundle — a **single `error`** envelope in lieu of the stream. The archive routinely exceeds one AEAD frame (a real `.cast` recording alone is > 65535 bytes), which is the whole reason it is chunked.

Today every decrypted app frame reaches `daemonConnection.onDriverEvent`'s `message` case and is handed to `parseInboundMessage` (`src/main/transport/inboundMessage.ts`). That decoder models only `message` / `message_chunk`; anything else falls through its `default` branch, which content-free-logs it as `inbound-unmodeled` (#130) and returns `null` (dropped). Bundle frames and the `error` reply die there.

**This slice is additive.** The `message` / `message_chunk` path is unchanged. The three new types (`debug_bundle_chunk`, `debug_bundle_done`, `error`) are recognised *before* the `default` branch, narrowed at the same untrusted→trusted boundary, and routed to a stateful **reassembler** that delivers the finished archive — or a clean failure — to an injected **consumer**. The archive is an **opaque `.tar.gz` blob**: the manifest and recording-absent flag live *inside* the tarball, so this slice concatenates bytes and never unpacks or inspects them.

## Files to read first

- `src/main/transport/inboundMessage.ts:52-171` — the `InboundDaemonMessage` union, the `parseMessagePayload` / `requireString` / `isRecord` narrowing helpers, and the `switch (envelope.type)` with its content-free `diagnosticLog?.event(...)` calls and `default` branch. **This is the seam** — extend the union and add cases before `default`, reusing `requireString`/`isRecord` and the `hashPlaintext` log pattern.
- `src/main/daemonConnection.ts:176-227` — `onDriverEvent`: the `message` case (`parseInboundMessage` at :200, the fail-closed catch, the `null`→ignore, the `messageReceived`/`messagesReceived` emits) and the `terminal`/`error` cases. Routing + the reassembler slot land here.
- `src/main/daemonConnection.ts:76-101,346-362` — the `DaemonConnection` interface and the current `requestDebugBundle(): void` no-op (structural twin of `send`). The signature gains a `consumer` param; the slot is armed here before the frame is sent.
- `src/shared/wire/types.ts:40-62,88-118` — `EnvelopeType`, `Envelope` (note `payload: unknown`, optional `in_reply_to?`), the existing payload interfaces (`MessagePayload`, `ErrorPayload`). Add the two bundle payloads beside them, field-for-field with the daemon (`docs/knowledge/decisions/0002`).
- `src/main/transport/codec.ts:51-70,127-134` — `base64StdEncode` / **strict** `base64StdDecode` (throws `WireDecodeError` on non-canonical base64 — this is the fail-closed decode for chunk `data`), `WireDecodeError`, and `decodeEnvelope` (requires a present `payload`).
- `src/main/transport/fakeDaemon.ts:87-105,199-206,288-301` — `FakeDaemonOptions` (`buildReply`), `sendNoise` (frame+seal one Noise output), `handleTransport` (seals exactly one reply then `settle`), and `initiateRekey:238-249` (the "stream a sealed control frame" precedent). The streaming-serve extension goes here.
- `src/main/daemonConnection.test.ts:55-102,153-182` — the injected `createDriver` fake with `emit(RelaySessionEvent)` + captured `sent[]`, `fakeSink`/`emitted`, the `DiagnosticLog` spy, and `makeEnvelope`/`makeChunkEnvelope`. The routing + outbound tests reuse this harness verbatim.
- `src/main/daemonConnection.roundtrip.test.ts:1-95` — the real-handshake harness (`startFakeRelayForwarder` + `startFakeDaemon` + real driver, `makeWaiter`, fixed clock). The AC5 end-to-end test extends it.
- `docs/knowledge/decisions/0002` (wire-types-match-mobile) and `pyrycode/pyrycode docs/protocol-mobile.md § Debug bundle (v2)` — the authoritative contract (summarised below).

## Daemon contract (authoritative — from `protocol-mobile.md § Debug bundle (v2)`)

- **`debug_bundle_chunk`** `{ seq: int, data: base64-std string }` — `seq` 0-based, contiguous, ascending; the receiver **requires the next chunk's `seq` to equal the count of chunks already seen** (reorder / gap / duplicate detected). `data` decodes and is appended in `seq` order. Each chunk's raw size ≈48000 B so the sealed frame stays under the 65535-byte cap.
- **`debug_bundle_done`** `{ total: int }` — `total` = the exact number of chunk frames. A `done` whose `total` ≠ chunks-received is a **count-mismatch / truncation** error, never accepted as complete.
- **`error`** (existing `ErrorPayload`) — a single `error` envelope replaces the whole stream when the daemon cannot assemble the bundle (static message, code `server.binary_offline`, `retryable: true`). **We never surface or log the daemon's error text.**
- **Edge cases:** a one-chunk stream is valid (`chunk{seq:0}` + `done{total:1}`); an **empty bundle** is valid (zero chunks + `done{total:0}`). Interleaved non-bundle frames (e.g. a `message`) are filtered by type — on the client they simply route to their own path, invisible to the reassembler.
- **Correlation:** the daemon does **not** correlate these frames to the request by `id`/`in_reply_to` (the protocol says clients MUST NOT dedup by `id`; daemon-originated frames correlate by **type**). The desktop has at most **one** bundle request in flight (daemon-global bundle, one UI action), so a **single per-connection reassembler slot keyed by nothing but liveness** is the correct model — no `in_reply_to` matching. See Open questions.

## Design

Three layers, each single-concern, matching the module's existing split:

### 1. Wire vocabulary — `src/shared/wire/types.ts`

- Add `'debug_bundle_chunk'` and `'debug_bundle_done'` to the `EnvelopeType` union (`'error'` already present).
- Add two payload interfaces beside `MessagePayload`:
  - `DebugBundleChunkPayload { seq: number; data: string }` — `data` is standard base64 on the wire (mirrors Go `DebugBundleChunkPayload{Seq int; Data []byte}`; `[]byte` auto-encodes std base64 via `encoding/json`).
  - `DebugBundleDonePayload { total: number }` — mirrors Go `DebugBundleDonePayload{Total int}`.

### 2. Frame recognition + narrowing — `src/main/transport/inboundMessage.ts`

Extend the `InboundDaemonMessage` union with three kinds and add three `switch` cases **before** `default`:

| Envelope type | Returns | Narrowing (fail-closed → `WireDecodeError`) |
|---|---|---|
| `debug_bundle_chunk` | `{ kind: 'bundle-chunk'; seq: number; data: Uint8Array }` | `seq` is a number; `data` is a string; `base64StdDecode(data)` (strict — throws on bad base64). Decode happens **here**, at the boundary, so the reassembler stays byte-pure. |
| `debug_bundle_done` | `{ kind: 'bundle-done'; total: number }` | `total` is a number. |
| `error` | `{ kind: 'daemon-error' }` | **Content-free** — no `ErrorPayload` field is narrowed or surfaced; the reassembler only needs "a terminal error arrived." |

- Add two small narrowing helpers (`parseDebugBundleChunkPayload`, `parseDebugBundleDonePayload`) following `parseMessagePayload`'s shape; a `requireNumber` sibling to `requireString` (non-number → category-only `WireDecodeError`). Reuse `isRecord`.
- **Content-free logging** (matching the existing `inbound-decoded` calls): each recognised kind logs `{ event: 'inbound-decoded', code: <type>, bytes: plaintext.length, hash: hashPlaintext(plaintext) }`. Never log `data` bytes, `seq`, `total`, or any `ErrorPayload` field. The `error` case moves from `inbound-unmodeled` to `inbound-decoded` (code `'error'`) now that it is modeled — a content-free, more-accurate log change that applies to *all* `error` frames, bundle-related or not. Call this out in review; it is intentional.
- The **throw path stays unlogged** and the fail-closed contract is unchanged: a malformed chunk (bad base64, missing `seq`) throws `WireDecodeError`, which `onDriverEvent`'s existing catch drops.

### 3. Reassembler — `src/main/transport/bundleReassembler.ts` (NEW, main-only, IPC-free)

A pure, injected-consumer accumulator. It lives in `transport/` (no IPC, no Electron), so it is unit-testable in plain Node and does not invert the layer boundary `daemonConnection` maintains.

Contract sketch (signatures only — no bodies):

```ts
// closed set: seq-mismatch=reorder/gap/dup · total-mismatch=truncation ·
//   daemon-error=single error reply · connection-lost · not-connected
export type BundleFailReason =
  | 'seq-mismatch' | 'total-mismatch' | 'daemon-error' | 'connection-lost' | 'not-connected'
export interface BundleConsumer {
  complete(bytes: Uint8Array): void        // exactly one terminal:
  fail(reason: BundleFailReason): void      //   complete XOR fail, once
  progress?(chunksReceived: number): void   // optional, per accepted chunk
}
export interface BundleReassembler {
  chunk(seq: number, data: Uint8Array): void
  done(total: number): void
  fail(reason: BundleFailReason): void
}
export function createBundleReassembler(consumer: BundleConsumer): BundleReassembler
```

Behaviour (asserted by the unit test, § Testing):
- **State:** an ordered `Uint8Array[]` of accepted chunks (its length *is* the chunks-seen count) and a `settled` boolean.
- `chunk(seq, data)`: no-op if `settled`; else if `seq !== chunks.length` → `settle` + `consumer.fail('seq-mismatch')`; else append, then `consumer.progress?.(chunks.length)`.
- `done(total)`: no-op if `settled`; else if `total !== chunks.length` → `settle` + `consumer.fail('total-mismatch')`; else `settle` + `consumer.complete(<concat of chunks in order>)` (`Buffer.concat`, main-only). Empty bundle (`chunks.length === 0`, `total === 0`) completes with a zero-length `Uint8Array` — never rejected.
- `fail(reason)`: no-op if `settled`; else `settle` + `consumer.fail(reason)`.
- **Terminal-once:** the `settled` flag guarantees a stray post-terminal frame is silently ignored — the consumer receives exactly one of `complete` / `fail`, never a partial. **Never logs** (byte-bearing).

### 4. Wiring — `src/main/daemonConnection.ts`

- Add a module-local slot: `let reassembler: BundleReassembler | null = null`.
- **`requestDebugBundle` signature change** (the only signature change; ~1 real call site — its test — since #118 is unbuilt):
  - `requestDebugBundle(consumer: BundleConsumer): void`.
  - If `driver === null` (not connected): `consumer.fail('not-connected')` and return — the consumer *always* gets a terminal, so #118's command never hangs. (This replaces the old silent no-op; the wire behaviour is still "send nothing," but the caller is now notified.)
  - Otherwise: `reassembler = createBundleReassembler(consumer)` **before** building/sending the request frame (arm before the reply can arrive), then the existing build + `driver.sendMessage` (unchanged, incl. the `nextEnvelopeId` share and the never-throw catch — a build/​send throw after arming leaves the reassembler pending; the connection-teardown net below still resolves it).
- **`onDriverEvent` `message` case** — after `parseInboundMessage`, route on `inbound.kind`:
  - `'message'` → `messageReceived` (unchanged) · `'chunk'` → `messagesReceived` (unchanged)
  - `'bundle-chunk'` → `reassembler?.chunk(inbound.seq, inbound.data)`
  - `'bundle-done'` → `reassembler?.done(inbound.total)`
  - `'daemon-error'` → `reassembler?.fail('daemon-error')`
  - A bundle frame with no active reassembler (`null`, or settled → inert) is a no-op — preserving today's drop behaviour when no request is in flight, and keeping an unrelated `error` harmless when no bundle is streaming.
- **Connection-teardown net** — in the `terminal` and `error` (connection-level) cases, add `reassembler?.fail('connection-lost')` so an in-flight stream interrupted by a socket drop resolves the consumer (no hang, no lingering accumulated bytes). Safe unconditionally: `fail` on a settled reassembler is a no-op. This is deterministic code, not a stochastic guard.

### Data flow

```
requestDebugBundle(consumer) ──arm──▶ reassembler = createBundleReassembler(consumer)
        │ send request_debug_bundle frame (existing)
        ▼
daemon streams (over AEAD, decrypted by driver → onDriverEvent 'message'):
   chunk{seq:0} chunk{seq:1} … done{total:N}     ──▶ parseInboundMessage ──▶ kinds ──▶ reassembler
        │                                                                                 │
        └── OR single error  ──────────────────────────────────────────────────▶ reassembler.fail
                                                                                          ▼
                                            consumer.complete(bytes)  XOR  consumer.fail(reason)
```

### 5. Test infra — `src/main/transport/fakeDaemon.ts` (streaming-serve extension)

Not production code (imported only by `*.test.ts`, never bundled), but required by AC5. Additive, no fan-out to existing `buildReply` callers:

- Add optional `FakeDaemonOptions.buildReplyFrames?: (inboundPlaintext: Uint8Array) => Uint8Array[]` — returns an ordered list of **plaintext envelopes** to seal and stream, one sealed `noise_msg` per element (loop `sendNoise(sendCipher.EncryptWithAd(EMPTY_AD, frame))`).
- `handleTransport`: if `buildReplyFrames` is set, stream each of its frames in order; else the existing single `buildReply`. Keep the `settle({ ok: true })` after streaming. The test builds `[chunk0, chunk1, …, done]`, a reordered/truncated variant, or `[error]` via `encodeEnvelope`.

## State + concurrency model

- **Single source of reassembly state:** the one module-local `reassembler` slot in `daemonConnection`, replaced on each `requestDebugBundle`. No parallel state, no map keyed by request id (one in-flight request by construction). `onDriverEvent` runs on the single main-process event loop; frames arrive strictly ordered on the socket, so `chunk`/`done` see a consistent `chunks.length` with no locking.
- **Lifecycle / teardown:** the consumer receives exactly one terminal — `complete`, or `fail` for one of the five reasons. A stream interrupted by teardown resolves via the connection-teardown net; a stray late frame is absorbed by `settled`. Accumulated chunk bytes are released when the slot is replaced or `daemonConnection` is dropped. No `AbortController` needed — there is no long-lived async task, only synchronous event handling.
- **Backpressure/memory:** the reassembler holds the whole archive (× ~4/3 during accumulation, base64-decoded per chunk as it arrives). This mirrors the daemon side's accepted "not a remote DoS vector" finding (#812/#813): the peer is already Noise-authenticated (paired), and `MAX_PLAINTEXT_BYTES` caps each frame. No new cap is introduced here; see Open questions.

## Error handling

| Failure | Layer | Result |
|---|---|---|
| Malformed chunk (bad base64 `data`, non-number `seq`/`total`, malformed envelope, oversized) | `parseInboundMessage` | throws `WireDecodeError` → `onDriverEvent` existing catch drops the frame. The reassembler is **not** advanced (the throw happens before routing), so a corrupt frame neither corrupts nor completes the archive. |
| Reorder / gap / duplicate `seq` | reassembler | `consumer.fail('seq-mismatch')`, settled |
| `done.total` ≠ chunks received | reassembler | `consumer.fail('total-mismatch')`, settled |
| Single daemon `error` reply | recognition → routing → reassembler | `consumer.fail('daemon-error')`, settled — never the daemon's error text |
| Connection drops mid-stream | `onDriverEvent` terminal/error | `consumer.fail('connection-lost')`, settled |
| Requested while disconnected | `requestDebugBundle` | `consumer.fail('not-connected')` |

All reasons are **static enum strings** — no wire value, byte, or daemon message is ever interpolated into a reason, a log, or an Error. The reassembler and recognition layer never `console.*`; recognition emits only content-free `inbound-decoded` records.

## Testing strategy

Vitest (`npm test`), plus `npm run typecheck` for the type-level guarantees. Fakes over mocks, matching the module.

- **`bundleReassembler.test.ts` (NEW)** — pure, no crypto, a shared `makeConsumer()` spy. Scenarios (bullet, not full bodies):
  - Multi-chunk happy path → `complete` with bytes equal to the ordered concatenation of the fed chunks; `progress` called once per chunk with ascending counts.
  - One-chunk stream (`chunk{0}` + `done{1}`) → complete.
  - Empty bundle (no chunks + `done{0}`) → complete with a zero-length `Uint8Array`.
  - `seq` gap (`0` then `2`), reorder (`1` then `0`), duplicate (`0` then `0`) → each `fail('seq-mismatch')`, no `complete`.
  - `total` mismatch (2 chunks, `done{total:3}`) → `fail('total-mismatch')`.
  - `fail('daemon-error')` / `fail('connection-lost')` mid-stream → single `fail`, no `complete`.
  - Terminal-once: any frame after settle (chunk, done, or fail) is ignored — consumer called exactly once total.
- **`inboundMessage.test.ts` (extend)** — recognition + narrowing:
  - `debug_bundle_chunk` → `{ kind:'bundle-chunk', seq, data }` with `data` equal to the base64-decoded bytes; `debug_bundle_done` → `{ kind:'bundle-done', total }`; `error` → `{ kind:'daemon-error' }`.
  - Fail-closed: bad-base64 `data`, missing/non-number `seq`/`total` → `WireDecodeError` (throws, returns nothing).
  - Additive: a `message` / `message_chunk` still returns its existing kind unchanged.
  - Content-free log: each recognised kind emits `inbound-decoded` with code = type, `bytes`, `hash`; assert `data`/`seq`/`total` never appear in a record.
- **`daemonConnection.test.ts` (extend)** — routing via the injected `createDriver` fake + a spy `BundleConsumer`:
  - `requestDebugBundle(consumer)` while connected pushes exactly one `request_debug_bundle` envelope onto `sent[]` (existing outbound assertion, now with a consumer).
  - Emit `bundle-chunk`×N then `bundle-done` plaintexts → `consumer.complete(bytes)` equals the served concatenation; `message`/`message_chunk` interleaved still emit `messageReceived`/`messagesReceived` (additive, unaffected).
  - Emit an `error` plaintext with an active reassembler → `consumer.fail('daemon-error')`; with **no** active request → no consumer call, no crash (drop preserved).
  - `requestDebugBundle(consumer)` while disconnected (no driver) → `consumer.fail('not-connected')`, nothing sent.
  - A `terminal`/`error` driver event mid-stream → `consumer.fail('connection-lost')`.
  - Update the five existing `requestDebugBundle()` call sites to pass a fake consumer.
- **`daemonConnection.roundtrip.test.ts` (extend)** — AC5 end-to-end through the **real** handshake:
  - `startFakeDaemon({ buildReplyFrames })` serves a multi-chunk bundle (N chunks + done) in response to the `request_debug_bundle`; drive `requestDebugBundle(consumer)`; wait; assert `consumer.complete(bytes)` **equals the served bytes**, session still open.
  - Error-reply variant: `buildReplyFrames` serves `[error]` → `consumer.fail('daemon-error')`.
- **`types.test.ts` / `fakeDaemon.test.ts` (extend)** — the two new `EnvelopeType` members are present; `buildReplyFrames` streams N sealed frames (assert the client receives N `message` driver events for N served frames).

## Scope note (why one S)

Four production `.ts` files (types, inboundMessage, bundleReassembler [new], daemonConnection) + one **test-infra** file (`fakeDaemon.ts`, imported only by `*.test.ts`, never in the production bundle — excluded from the production-file count). All architect red lines pass: 1 new file (< 3), ~5 new exported symbols (≤ 5), 1 real call-site for the signature change (< 10), 5 AC, 5 reject branches (< 10), ~530 total LOC (< 600), no branch overlap. The design is genuinely additive recognition of two inbound-only types the daemon already emits — the #108/#111/#112 "recognise-or-drop" precedent, not a staged wire migration.

## Open questions

- **`error` correlation.** We fail the in-flight reassembler on *any* inbound `error` while active, not on an `in_reply_to`-matched one. Correct for the single-in-flight, daemon-global bundle today; if the desktop ever multiplexes concurrent id-correlated request/reply streams, revisit with an `in_reply_to`→slot map. Not an observed failure mode — deferred per Evidence-Based Fix Selection.
- **Reassembly memory cap.** No explicit ceiling on total accumulated bytes (matches the daemon's own accepted stance for a paired, Noise-authenticated peer). If a hardened cap is ever wanted, `done.total` × chunk-cap gives an upper bound to reject early — flag for a future hardening ticket, not this slice.
- **Consumer wiring in #118.** #118 constructs the per-download `BundleConsumer` (mapping `complete`→`saveDebugBundle`, `fail`→error IPC, `progress`→progress IPC) and calls `requestDebugBundle(consumer)`. This spec fixes that contract; #118 owns the IPC surface.

## Security review

`security-sensitive` — the reassembler ingests bytes from the untrusted relay peer and adds frame dispatch on the internet-exposed inbound path. Adversarial pass over the change surface below (the `security-review.md` process file is not present in this worktree; the pass follows the process described in the architect agent instructions). Verdict: **PASS**.

- **Trust boundary — untrusted peer bytes.** The relay peer is authenticated by the Noise IK handshake (pairing), but its *payloads* are untrusted. Every field crosses the same fail-closed boundary as `message`: `seq`/`total` narrowed to `number` (`requireNumber`), `data` decoded by **strict** `base64StdDecode` (rejects non-canonical/truncated base64), the whole frame bounded by `MAX_PLAINTEXT_BYTES` in `parseInboundMessage`. No field is trusted structurally; a mismatch throws `WireDecodeError` and is dropped. Enforced at `inboundMessage.ts` (the boundary) — no bundle byte is interpreted before it narrows.
- **No path/injection reach.** The reassembled bytes are opaque and are *only* concatenated; nothing in this slice writes a file, builds a path, unpacks the tarball, or reads the manifest. #117's `saveDebugBundle` (already merged) derives its filename from **module constants only** (`STEM`/`EXT`, never from `bytes` or any daemon field), so no untrusted byte reaches a path segment — traversal is structurally impossible and out of this slice's reach regardless.
- **Content hygiene — no leakage into logs/errors.** The reassembler never logs and holds bytes only in memory. Recognition logs are **content-free** (`event`, `code`=type, `bytes`=length, one-way BLAKE2s `hash` of the frame) — never `data`, `seq`, `total`, or the daemon's `ErrorPayload.message`. All five `BundleFailReason`s are static enum strings; no wire value is interpolated into a reason, log, or `Error`. The `daemon-error` path deliberately discards the daemon's error text (per `protocol-mobile.md` content hygiene). This preserves the module's existing "classify-don't-forward" posture (#62/#128/#130).
- **Fail-closed / no partial archive.** A corrupt or out-of-order stream can never yield a partial or mixed archive: a malformed frame throws before the reassembler advances; a `seq`/`total` violation settles the reassembler to `fail` and completes nothing; the `settled` flag makes the terminal exactly-once. The two integrity nets from the daemon side hold end-to-end — AEAD (per-frame content integrity) + `seq`/`total` (structural gap/reorder/truncation).
- **Resource / DoS.** Accumulated memory is bounded per-frame by `MAX_PLAINTEXT_BYTES` and in aggregate matches the daemon's accepted stance for an authenticated paired peer; the connection-teardown net prevents an interrupted stream from leaking a pending accumulator. No unbounded loop, no new socket, no new external input. No amplification: one request → a bounded stream the peer already gates.
- **Renderer isolation.** Everything lands in `src/main` / `src/main/transport` (main process). No key, socket, token, or raw byte crosses to the renderer — `BundleConsumer` is a main-side interface; #118 forwards only content-free progress/result over IPC (its own review). CLAUDE.md "keep the transport out of the window" upheld.

No FAIL categories. Proceed to commit.
