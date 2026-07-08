# Debug-bundle reassembly (inbound)

The **receive half of the client debug-bundle download**: the background process recognizes the daemon's streamed reply to [`request_debug_bundle`](debug-bundle-request.md) — ordered `debug_bundle_chunk`* frames followed by one `debug_bundle_done` marker, or a single `error` in lieu of the stream — and reassembles the chunks into the complete opaque `.tar.gz` archive, or fails cleanly. This is the `security-sensitive` sibling of [#115](../codebase/115.md) (outbound) and [#117](../codebase/117.md) (persistence): it is the layer that parses bytes sent by the relay peer.

Introduced in [#116](../codebase/116.md). Entirely `src/main/`/`src/main/transport/` — the reassembled bytes never reach the renderer. **Additive throughout:** the existing `message` / `message_chunk` inbound path ([inbound message decode](inbound-message-decode.md)) is unchanged. The renderer command that triggers a request is the typed `requestDebugBundle` [command channel](command-channel.md) member ([#168](../codebase/168.md), landed); the orchestrator that consumes this ticket's `BundleConsumer` result is the [debug-bundle orchestrator](debug-bundle-orchestrator.md) ([#169](../codebase/169.md), landed — #118 split into #168+#169); saving the reassembled bytes to disk is [save-debug-bundle](save-debug-bundle.md) ([#117](../codebase/117.md), landed, independent).

## The daemon contract

Per `pyrycode/pyrycode docs/protocol-mobile.md § Debug bundle (v2)` (daemon `internal/relay/v2bundlestream.go`):

- **`debug_bundle_chunk`** `{ seq: number, data: base64-std string }` — `seq` 0-based, contiguous, ascending. The receiver requires the next chunk's `seq` to equal the count of chunks already seen — a reorder, gap, or duplicate is rejected.
- **`debug_bundle_done`** `{ total: number }` — the exact count of chunk frames sent. A `total` that does not equal the count received is a truncation error, never accepted as complete.
- **`error`** (existing `ErrorPayload`) — a single `error` envelope replaces the whole stream when the daemon cannot assemble the bundle. Its text is never surfaced or logged.
- A one-chunk stream and an **empty bundle** (zero chunks + `done{total:0}`) are both valid.
- **No `in_reply_to` correlation.** The daemon does not correlate these frames to the request by id — it correlates by *type*. The desktop has at most one bundle request in flight (daemon-global bundle, one UI action), so a single per-connection reassembler slot keyed by nothing but liveness is the correct client-side model.

## Three layers

### 1. Wire vocabulary — `src/shared/wire/types.ts`

`'debug_bundle_chunk'` / `'debug_bundle_done'` added to `EnvelopeType` (`'error'` already present), plus two payload interfaces beside `MessagePayload`:

```ts
export interface DebugBundleChunkPayload {
  seq: number
  data: string   // standard base64 on the wire — Go's []byte auto-encodes via encoding/json
}
export interface DebugBundleDonePayload {
  total: number
}
```

Field-for-field with the daemon's `DebugBundleChunkPayload{Seq int; Data []byte}` / `DebugBundleDonePayload{Total int}` ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md)).

### 2. Recognition — `src/main/transport/inboundMessage.ts`

`InboundDaemonMessage` gains three kinds, recognized in `parseInboundMessage`'s `switch` **before** the `default` (unmodeled) branch:

| Envelope type | Returns | Narrowing |
|---|---|---|
| `debug_bundle_chunk` | `{ kind: 'bundle-chunk'; seq: number; data: Uint8Array }` | `seq` via a new `requireNumber` (sibling of `requireString`); `data` via the codec's **strict** `base64StdDecode` — throws `WireDecodeError` on non-canonical/truncated base64. The base64 decode happens *at this boundary* so the reassembler stays byte-pure. |
| `debug_bundle_done` | `{ kind: 'bundle-done'; total: number }` | `total` via `requireNumber`. |
| `error` | `{ kind: 'daemon-error' }` | **Content-free** — no `ErrorPayload` field is narrowed; the reassembler only needs "a terminal error arrived." |

The `error` case is a deliberate, generally-applicable change: it moves from `inbound-unmodeled` (dropped silently via `default`) to a modeled `inbound-decoded(code: 'error')` — now content-free-logged for *every* `error` frame, bundle-related or not, since it is now recognized as a real kind rather than falling through unclassified. The throw path stays unlogged (narrowing happens before the log call), so a malformed chunk leaves no record and never advances the reassembler.

### 3. Reassembler — `src/main/transport/bundleReassembler.ts` (new, main-only, IPC-free, log-free)

A pure, injected-consumer accumulator — no codec, no Noise, no IPC, and it **never logs** (it holds content-bearing bytes).

```ts
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

State: an ordered `Uint8Array[]` of accepted chunks (its `.length` *is* the chunks-seen count) plus a `settled` boolean.

- `chunk(seq, data)` — no-op if settled; `seq !== chunks.length` → settle + `fail('seq-mismatch')` (this single check rejects a reorder, gap, *and* duplicate alike); else append + `progress?.(chunks.length)`.
- `done(total)` — no-op if settled; `total !== chunks.length` → settle + `fail('total-mismatch')`; else settle + `complete(Buffer.concat(chunks))`. Zero chunks + `total: 0` completes with a zero-length `Uint8Array` — never rejected.
- `fail(reason)` — no-op if settled; else settle + `fail(reason)`.
- **Terminal-once by construction:** `settled` makes any stray post-terminal frame (a chunk after `done`, a `done` after a `fail`) silently inert — the consumer is called exactly once, total.

### 4. Wiring — `src/main/daemonConnection.ts`

A single module-local slot, `let reassembler: BundleReassembler | null = null` — the desktop's entire bundle-reassembly state, replaced on each request (no `in_reply_to` map, matching the daemon's type-only correlation).

`requestDebugBundle` signature changed to take a consumer:

```ts
function requestDebugBundle(consumer: BundleConsumer): void {
  if (driver === null) {
    consumer.fail('not-connected')   // was a silent no-op; the consumer now ALWAYS gets a terminal
    return
  }
  reassembler = createBundleReassembler(consumer)   // arm BEFORE sending — reply can't race an unarmed slot
  try {
    const bytes = buildRequestDebugBundle({ id: nextEnvelopeId, ts: now() })
    nextEnvelopeId += 1
    driver.sendMessage(bytes)
  } catch {
    // never throw (parity #490); a throw here after arming leaves the reassembler pending — the
    // connection-teardown net below still resolves it.
  }
}
```

`onDriverEvent`'s `message` case now routes on `inbound.kind`:

- `'message'` / `'chunk'` → `messageReceived` / `messagesReceived` (unchanged)
- `'bundle-chunk'` → `reassembler?.chunk(inbound.seq, inbound.data)`
- `'bundle-done'` → `reassembler?.done(inbound.total)`
- `'daemon-error'` → `reassembler?.fail('daemon-error')`

A bundle frame with no active (or an already-settled) reassembler is a no-op — preserving the pre-#116 drop behavior when no request is in flight, and keeping an unrelated `error` harmless.

**Connection-teardown net:** the `terminal` and connection-level `error` cases in `onDriverEvent` unconditionally call `reassembler?.fail('connection-lost')` before their existing handling, so a socket drop mid-stream always resolves the consumer — no hang, no lingering accumulated bytes. Safe unconditionally because `fail` on a settled/absent reassembler is a no-op; this is deterministic code, not a stochastic guard (Belt-and-Suspenders Means Different Fabric).

## Data flow

```
requestDebugBundle(consumer) ──arm──▶ reassembler = createBundleReassembler(consumer)
        │ send request_debug_bundle frame (#115)
        ▼
daemon streams (decrypted by driver → onDriverEvent 'message'):
   chunk{seq:0} chunk{seq:1} … done{total:N}   ──▶ parseInboundMessage ──▶ kind ──▶ reassembler
        │                                                                              │
        └── OR single error  ─────────────────────────────────────────────▶ reassembler.fail
                                                                                       ▼
                                         consumer.complete(bytes)  XOR  consumer.fail(reason)
```

## Error handling

| Failure | Layer | Result |
|---|---|---|
| Malformed chunk (bad base64 `data`, non-number `seq`/`total`, oversized, malformed envelope) | `parseInboundMessage` | Throws `WireDecodeError`; `onDriverEvent`'s existing catch drops the frame. The reassembler is **not** advanced — a corrupt frame neither corrupts nor completes the archive. |
| Reorder / gap / duplicate `seq` | reassembler | `consumer.fail('seq-mismatch')`, settled |
| `done.total` ≠ chunks received | reassembler | `consumer.fail('total-mismatch')`, settled |
| Single daemon `error` reply | recognition → routing → reassembler | `consumer.fail('daemon-error')`, settled — never the daemon's error text |
| Connection drops mid-stream | `onDriverEvent` terminal/error | `consumer.fail('connection-lost')`, settled |
| Requested while disconnected | `requestDebugBundle` | `consumer.fail('not-connected')` |

All five reasons are static enum strings — no wire value, byte, or daemon message is ever interpolated into a reason, a log, or an `Error`.

## Security properties

`security-sensitive` (the reassembler ingests bytes from the untrusted relay peer and adds frame dispatch on the internet-exposed inbound path); architect review verdict **PASS**.

- Every bundle field crosses the same fail-closed boundary as `message`: `seq`/`total` narrowed to `number`, `data` decoded by **strict** `base64StdDecode`, the whole frame bounded by `MAX_PLAINTEXT_BYTES` in `parseInboundMessage`. A mismatch throws and is dropped before the reassembler ever sees it.
- No path/injection reach: the reassembled bytes are opaque and only concatenated — nothing here writes a file, builds a path, or inspects the tarball. [`saveDebugBundle`](save-debug-bundle.md) derives its filename from module constants only, never from `bytes`.
- Content hygiene: the reassembler never logs; recognition logs are content-free (`event`/`code`/`bytes`/`hash`, never `data`/`seq`/`total`/the daemon's error text).
- Fail-closed / no partial archive: a corrupt or out-of-order stream can never yield a partial or mixed archive — a malformed frame throws before advancing state, a `seq`/`total` violation settles to `fail`, and `settled` makes the terminal exactly-once.
- Resource/DoS: memory is bounded per-frame by `MAX_PLAINTEXT_BYTES`; in aggregate this matches the daemon's own accepted stance for an authenticated, paired peer (no new cap introduced — see § Open questions below). The connection-teardown net prevents an interrupted stream from leaking a pending accumulator.
- Renderer isolation upheld: everything lives in `src/main`/`src/main/transport`; `BundleConsumer` is a main-side interface, the [orchestrator](debug-bundle-orchestrator.md) (#169, using #168's [`debugBundleProgress`/`debugBundleSaved`/`debugBundleFailed`](daemon-event-channel.md) events) forwards only content-free progress/result over IPC.

## Testing

- **`bundleReassembler.test.ts`** — pure unit tests against a spy `BundleConsumer`: multi-chunk happy path (ordered concatenation + ascending `progress`), one-chunk stream, empty bundle (zero-length complete), seq gap/reorder/duplicate → `seq-mismatch`, `total` mismatch → `total-mismatch`, mid-stream `fail('daemon-error')`/`fail('connection-lost')`, and terminal-once (any post-settle call is silently absorbed).
- **`inboundMessage.test.ts`** — recognition + narrowing of the three new kinds, fail-closed on bad base64/non-number fields, additive proof that `message`/`message_chunk` are unchanged, and a content-free-log assertion that `data`/`seq`/`total` never appear in a diagnostic record.
- **`daemonConnection.test.ts`** — routing through the injected `createDriver` fake + a spy consumer: outbound frame + arming, chunk/done → `complete` with the served concatenation, `error` → `daemon-error` (and a no-op when no request is in flight), `not-connected`, and a mid-stream `terminal`/`error` driver event → `connection-lost`.
- **`daemonConnection.roundtrip.test.ts`** (AC5, end-to-end through the **real** handshake) — `startFakeDaemon({ buildReplyFrames })` streams a multi-chunk bundle; `requestDebugBundle(consumer)` is driven to `consumer.complete(bytes)` equal to the served bytes, session still open; a `[error]`-only reply drives `consumer.fail('daemon-error')`.
- **`fakeDaemon.ts`** gained a `buildReplyFrames?: (inboundPlaintext) => Uint8Array[]` streaming-serve extension (test infra only, never bundled) — seals and streams an ordered list of plaintext envelopes instead of the single `buildReply`; the `initiateRekey` streaming path was the precedent.

## Edge cases and open questions

- **`error` correlation is "any inbound `error` while a bundle is in flight," not `in_reply_to`-matched.** Correct for the single-in-flight, daemon-global bundle today. If the desktop ever multiplexes concurrent id-correlated request/reply streams, this needs revisiting with an `in_reply_to`→slot map — not an observed failure mode today, deferred (Evidence-Based Fix Selection).
- **No explicit reassembly memory cap.** Matches the daemon's own accepted stance for a paired, Noise-authenticated peer. `done.total` × chunk-size-cap would give an upper bound to reject early if a hardened cap is ever wanted — flagged for a future hardening ticket, not this slice.
- **Bundle frames emit no `DaemonEvent`.** A completion/failure surfaces only through the injected `BundleConsumer`'s callbacks, never through the [daemon-event channel](daemon-event-channel.md) — a consumer of this feature that also waits on daemon events must drive its own wait/notify from `complete`/`fail`, not from the event sink.

## Related

- [#116 codebase notes](../codebase/116.md) — implementation summary, patterns, and lessons learned.
- [Debug-bundle request (outbound)](debug-bundle-request.md) / [#115](../codebase/115.md) — the sibling that sends the bare `request_debug_bundle` frame this feature's stream responds to.
- [Save debug bundle (persistence)](save-debug-bundle.md) / [#117](../codebase/117.md) — the independent persistence leaf that consumes `consumer.complete(bytes)` verbatim, wired by the [orchestrator](debug-bundle-orchestrator.md) (#169).
- [Command channel](command-channel.md) / [Daemon-event channel](daemon-event-channel.md) / [#168](../codebase/168.md) — the typed IPC contract (`requestDebugBundle` command + `debugBundleProgress`/`debugBundleSaved`/`debugBundleFailed` events + `DebugBundleFailure`) that the [orchestrator](debug-bundle-orchestrator.md) (#169) uses to expose this ticket's `BundleConsumer` result to the renderer, mapping this ticket's `BundleFailReason` onto #168's coarser `DebugBundleFailure`.
- [Inbound message decode](inbound-message-decode.md) / [#68](../codebase/68.md) — the `message`/`message_chunk` boundary this recognition is additive to; shares `parseInboundMessage`, `isRecord`, and the content-free logging pattern.
- [Content-free diagnostic log](diagnostic-log.md) / [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md) — the logger the recognition layer's `inbound-decoded` calls write through; no allowlist growth needed (reuses `event`/`code`/`bytes`/`hash`).
- [Daemon connection](daemon-connection.md) / [#62](../codebase/62.md) — hosts the reassembler slot and `requestDebugBundle(consumer)`.
- [Noise session](noise-session.md) — the additive "recognize-or-drop" precedent (#108) this recognition-before-`default` pattern follows.
- Daemon contract (QMD `pyrycode-docs`): `internal/protocol/messaging.go` (`DebugBundleChunkPayload`/`DebugBundleDonePayload`), `internal/relay/v2bundlestream.go` (the reassembly reference this mirrors), `docs/protocol-mobile.md` § Debug bundle (v2); pyrycode #812/#813 (stream/serve, merged).
- Parent: [#71](https://github.com/pyrycode/pyrycode-desktop/issues/71) split into #115/#116/#117/#118, and #118 further split into [#168](../codebase/168.md)+[#169](../codebase/169.md) — [[ticket-71-debug-bundle-split]], [[ticket-118-command-surface-refined]].
