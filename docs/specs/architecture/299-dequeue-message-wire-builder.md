# #299 — `dequeue_message` wire type + frame builder

**Size:** S (2 production files, ~90 LOC total). **Label:** `security-sensitive`.
**Blocks:** #300 (the `dequeue_message` command + IPC slice consumes this type + builder).

## Files to read first

- `src/shared/wire/types.ts:40-73` — the `EnvelopeType` union. Add `'dequeue_message'` here.
- `src/shared/wire/types.ts:325-356` — the queue neighbourhood: `QueuedItem` (`queued_msg_id: number`, the inbound decode the outbound field mirrors) and `QueueStatePayload`. The new `DequeueMessagePayload` lives right after these, in the same feature family.
- `src/shared/wire/types.ts:128-136` — `RequestSnapshotPayload`, the single-`conversation_id` sibling payload whose doc-comment style to match.
- `src/main/transport/requestSnapshotEnvelope.ts` (whole file, 44 lines) — **the builder to mirror exactly**: an `Input { id, ts, payload }` interface + a pure `build*(input): Uint8Array` that constructs the Envelope and calls `encodeEnvelope`. The new file is this file with the type renamed.
- `src/main/transport/requestSnapshotEnvelope.test.ts` (whole file) — **the test to mirror**: round-trip via `decodeEnvelope`, assert `type`/`id`/`ts`/`payload`, plus the over-cap `WireEncodeError` case.
- `src/main/transport/codec.ts:39-47,103-138` — `WireEncodeError`, `encodeEnvelope` (throws over `MAX_PLAINTEXT_BYTES`), `decodeEnvelope` (the round-trip decoder; payload stays `unknown`). No changes here — the builder consumes this contract.
- `src/shared/wire/types.test.ts:411-448` — the `queue_state` per-family test block (`describe('queue-state wire vocabulary (#292)')`): compile-time membership assertion + payload shape with `Object.keys` order pin + the `@ts-expect-error` number-not-string pin. The new `dequeue-message` block mirrors this.
- **Memory / conventions (not in code):** the `@shared` alias is NOT available in `src/main` — import shared types by relative path (`../../shared/wire/types`), as `requestSnapshotEnvelope.ts:12` already does. The codec/builder home is `src/main/transport/`, never `src/shared/wire/`.

## Context

The daemon accepts a `dequeue_message` control frame (client → daemon) that removes one queued message from a conversation's backlog before it runs, driving the daemon's `msgqueue.Remove`. Dropping a queued message is **ungated** for any paired client (project security model, daemon SSOT pyrycode #720, `docs/protocol-mobile.md` § Queue) — it carries no nonce and no answer token.

This is the wire+builder base slice, split from #295 along the same #235/#236 seam the memory records. It introduces **only** the wire-level pieces: the payload shape + `EnvelopeType` member under `src/shared/wire/`, and the outbound frame builder under `src/main/transport/`. No `daemonConnection` method, no IPC exposure, no renderer UI — those land in #300, which is blocked on this ticket.

The wire contract: `dequeue_message = { conversation_id, queued_msg_id }`, where `queued_msg_id` is the integer id of the queued entry to remove. It is the **same** per-conversation integer counter already decoded on the inbound side as `QueuedItem.queued_msg_id` (#292), so its outbound type is symmetric — a plain JSON number, never a string.

## Design source

N/A — transport-only slice (wire type + main-process builder). No renderer surface, no visual output; the ticket body carries no `## Figma` section and none is required. The visual-fidelity check is intentionally skipped for code-review.

## Design

Three edits across two production files (plus two test files).

### 1. `src/shared/wire/types.ts` — `EnvelopeType` member

Add `'dequeue_message'` to the `EnvelopeType` union, placed immediately after `'queue_state'` (line 60) so the outbound counterpart sits next to its inbound sibling in the same Queue feature family — the modal frames use this inbound-then-outbound grouping already.

### 2. `src/shared/wire/types.ts` — `DequeueMessagePayload` interface

Add the interface in the queue neighbourhood, immediately after `QueueStatePayload` (line 356). Contract:

```ts
export interface DequeueMessagePayload {
  conversation_id: string
  queued_msg_id: number
}
```

Doc-comment requirements (match the `RequestSnapshotPayload` / `QueuedItem` style):
- Outbound (client → daemon), mirrors the daemon SSOT (pyrycode #720, `docs/protocol-mobile.md` § Queue) field-for-field, wire order `conversation_id, queued_msg_id`, both always present (no `omitempty`).
- **Ungated control frame** — carries NO nonce and NO answer token (contrast `ModalAnswerPayload`, which carries `answer_token`). Any paired client may drop a queued message (project security model #720).
- `queued_msg_id` is **symmetric with the inbound `QueuedItem.queued_msg_id`** — serializes as a plain integer (a JSON number), never a string. It selects the queue entry the daemon's `msgqueue.Remove` deletes; the builder does not police its range (an out-of-range id is a daemon-side no-op), exactly as the inbound decoder "narrows the type but does not police it".

### 3. `src/main/transport/dequeueMessageEnvelope.ts` — the builder (new file)

A byte-for-byte structural twin of `requestSnapshotEnvelope.ts`. Contract:

- Header comment: MAIN-PROCESS ONLY (it imports `./codec`, which uses Node `Buffer`). Never re-export it through any renderer barrel — the raw bytes stay out of the web layer. (This mirrors `requestSnapshotEnvelope.ts:1-10`; the builders are already relative-import-only, never barrelled — confirmed: no barrel re-exports `requestSnapshotEnvelope`/`sendMessageEnvelope`.)
- `import { encodeEnvelope } from './codec'` and `import type { Envelope, DequeueMessagePayload } from '../../shared/wire/types'` (relative path — no `@shared` alias in `src/main`).
- `export interface DequeueMessageInput { id: number; ts: string; payload: DequeueMessagePayload }` — the consumer (#300's `createDaemonConnection.dequeueMessage`) supplies the envelope id counter, the wall clock, and the already-validated payload. Explicit, not read from globals, so the builder is pure and trivially unit-testable — identical to `RequestSnapshotInput`.
- `export function buildDequeueMessage(input: DequeueMessageInput): Uint8Array` — constructs `{ id, type: 'dequeue_message', ts, payload }` and returns `encodeEnvelope(envelope)`. One-line body; see `buildRequestSnapshot` at `requestSnapshotEnvelope.ts:36-44` for the exact shape.
- MAY throw `WireEncodeError` when the serialized envelope exceeds `MAX_PLAINTEXT_BYTES`; the eventual caller (#300's `connection.dequeueMessage`) catches it and drops the send — same contract as `buildRequestSnapshot`.

### Data flow

`DequeueMessagePayload` (validated by #300's IPC edge) → `buildDequeueMessage({ id, ts, payload })` → `encodeEnvelope` → `Uint8Array` plaintext → (downstream, out of this slice) the Noise session (#7) encrypts it, base64-wraps into `InnerFrameV2.data`, and the relay driver sends it. This slice ends at the `Uint8Array`.

## State + concurrency model

None. The builder is a pure synchronous function over caller-supplied input — no store slice, no async task, no shared state, no long-lived subscription. This is the wire-level base; state and the connection method arrive in #300.

## Error handling

- Over-cap: `encodeEnvelope` throws `WireEncodeError` (category-only message, never echoing `conversation_id`/`queued_msg_id`) when the envelope exceeds `MAX_PLAINTEXT_BYTES`. The builder propagates it; the caller (#300) drops the send. No new error type.
- The builder performs **no logging** — consistent with `codec.ts` ("This module performs no logging") and `requestSnapshotEnvelope.ts`. Do not add a log call that echoes the payload; the frame body is client-originated transit content on the encrypted surface.
- No inbound parsing in this slice, so no `WireDecodeError` path and no `daemonEventBridge` arm (this is an outbound frame — there is no `DaemonEvent` member and no `assertNever` to extend).

## Testing strategy

Two test files, plain vitest (`npm test`), no fakes/mocks — the builder is pure and uses the real codec so assertions pin actual wire bytes.

### `src/main/transport/dequeueMessageEnvelope.test.ts` (new) — mirrors `requestSnapshotEnvelope.test.ts`

- **Round-trips to a `dequeue_message` envelope carrying the exact id, ts, and payload.** Build with a fixed ts and a payload `{ conversation_id: 'conv-1', queued_msg_id: 7 }`; `decodeEnvelope` the bytes; assert `type === 'dequeue_message'`, `id`, `ts`, and `payload` deep-equals the input.
- **`queued_msg_id` decodes as a number.** After decoding, assert `typeof (envelope.payload as DequeueMessagePayload).queued_msg_id === 'number'` — the AC's explicit round-trip-as-number check, symmetric with the inbound `QueuedItem` guarantee.
- **Throws `WireEncodeError` when the envelope exceeds the plaintext cap.** Build with an over-cap `conversation_id` (`'x'.repeat(MAX_PLAINTEXT_BYTES + 1)`); expect `toThrow(WireEncodeError)` — same pattern as the sibling.

### `src/shared/wire/types.test.ts` (extend) — new `describe('dequeue-message wire vocabulary (#299)')` block, mirroring the `queue_state` block at 411-448

- **Admits the `dequeue_message` envelope type** — compile-time membership: `const t: EnvelopeType = 'dequeue_message'`.
- **Shapes `DequeueMessagePayload` as `{ conversation_id, queued_msg_id }`** — construct a literal, deep-equal it, and pin the no-drift wire order with `expect(Object.keys(payload)).toEqual(['conversation_id', 'queued_msg_id'])`.
- **Pins `queued_msg_id` as a number** — a `@ts-expect-error` on a `queued_msg_id: '1'` string literal, the compile-time no-drift pin symmetric with `QueuedItem`'s.

Type-level coverage runs under `npm run typecheck` (both sides). `npm run build` is the salvage/QA gate.

## Open questions

None. The wire contract is fully pinned by the daemon SSOT (#720) and symmetric with the already-shipped inbound `QueuedItem` (#292). Payload validation of the renderer-supplied `conversation_id`/`queued_msg_id` is #300's IPC-edge concern, not this slice's (the builder consumes an already-validated payload, per the `RequestSnapshotInput` contract).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No finding in this slice. The builder consumes an *already-validated*, typed `DequeueMessagePayload` the caller supplies (the `RequestSnapshotInput` contract) and emits outbound bytes — there is no untrusted→trusted crossing here. The untrusted boundary is the renderer→main IPC edge that will accept the dequeue request; that edge is **OUT OF SCOPE → #300**, which must validate the renderer-supplied `conversation_id` (string) and `queued_msg_id` (non-negative integer) before constructing the payload.
- **[Tokens, secrets, credentials]** N/A by design. `dequeue_message` is an ungated frame (SSOT #720): it carries NO answer token, NO nonce, NO credential — deliberately unlike `ModalAnswerPayload.answer_token`. The builder touches no secret material.
- **[File / storage operations]** N/A. Pure in-memory serialization; no filesystem, no disk, no path handling.
- **[Inter-process / Electron attack surface]** No finding. The builder is MAIN-process-only (imports `./codec` → Node `Buffer`) and the spec forbids re-exporting it through any renderer barrel — verified that the sibling builders (`requestSnapshotEnvelope`, `sendMessageEnvelope`) are relative-import-only and never barrelled, so `import type` from the renderer cannot reach it. No IPC channel, no `contextBridge` API, and no `BrowserWindow`/`webPreferences` change in this slice (explicit AC: no IPC surface). The process-placement MUST-FIX rule (transport out of the renderer) is satisfied. IPC exposure is deferred to #300.
- **[Cryptographic primitives]** N/A. The builder does no crypto. It emits plaintext bytes the Noise session (#7, a vetted Noise_IK implementation) encrypts downstream; `queued_msg_id` is a daemon-assigned counter, not security-relevant randomness. No `(key, nonce)` handling, no comparison against a secret.
- **[Network & I/O]** No finding. The outbound frame-size cap is enforced: `encodeEnvelope` throws `WireEncodeError` over `MAX_PLAINTEXT_BYTES`, so the desktop never hands the Noise layer an over-cap plaintext the daemon would reject. No new socket, relay URL, TLS config, or inbound frame parsing is introduced.
- **[Error messages, logs, telemetry]** No finding. `WireEncodeError`'s message names the failure category only, never echoing `conversation_id`/`queued_msg_id`. The builder performs no logging (consistent with `codec.ts` and `requestSnapshotEnvelope.ts`); the spec explicitly forbids adding a log call that echoes the client-originated payload.
- **[Concurrency]** N/A. Pure synchronous function — no async, no long-lived task, no shared state, no listener, no cancellation surface.
- **[Threat model alignment]** Malicious/compromised relay: the relay sees only the Noise-encrypted downstream bytes; this builder's plaintext never leaves the main process unencrypted, so an on-path relay learns nothing and can at most drop/delay the frame. Hostile daemon response: N/A — outbound only, no response parsed here. Renderer compromise reaching transport: the builder is unreachable from the renderer (main-only, unbarrelled); a compromised renderer's only path to emit a `dequeue_message` is #300's IPC handler, which must validate the payload. Named residual: because the frame is **ungated** (#720), the sole gate on dropping a queued message is #300's IPC validation plus the operation's inherently low severity — a dequeue removes a queued-but-not-yet-run message the user themselves enqueued on their own conversation, and the daemon's `msgqueue.Remove` is a no-op for an unknown id. This is by design per the project security model; **OUT OF SCOPE → #300** carries the IPC-validation obligation.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-12
