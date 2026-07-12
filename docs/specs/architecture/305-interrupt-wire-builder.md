# #305 — `interrupt` wire type + frame builder

**Size:** XS (2 production files, ~55 production LOC + ~20 test LOC). **Label:** `security-sensitive`.
**Split from:** #146 (interrupt-running-turn), slice 1 of 3.
**Blocks:** #306 (the `interrupt` command + IPC slice consumes this type + builder); then #307 (the composer stop-state render) lands on top.

## Files to read first

- `src/main/transport/requestDebugBundleEnvelope.ts` (whole file, 50 lines) — **the builder to mirror exactly.** A BARE control frame: an `Input { id, ts }` interface (no payload arg) + a pure `build*(input): Uint8Array` that constructs `{ id, type, ts, payload: {} }` and calls `encodeEnvelope`. The new file is this file with `request_debug_bundle` → `interrupt`. **NOT `dequeueMessageEnvelope.ts`** — despite the ticket body saying "mirroring `buildDequeueMessage`", `dequeue_message` carries a real payload; `interrupt` does not. The correct structural twins are the *bare* builders below.
- `src/main/transport/requestDebugBundleEnvelope.test.ts` (whole file, 23 lines) — **the test to mirror**: one round-trip via `decodeEnvelope`, asserting `type`/`id`/`ts` and `payload` deep-equals `{}`. No over-cap case (a fixed-shape empty-payload envelope can never exceed `MAX_PLAINTEXT_BYTES`, so the bare-frame twins deliberately omit it — see Testing strategy).
- `src/main/transport/listConversationsEnvelope.ts` (whole file, 48 lines) — the second bare-frame twin, byte-identical shape to `requestDebugBundleEnvelope.ts`. Confirms the pattern is the module's established convention, not a one-off.
- `src/shared/wire/types.ts:40-73` — the `EnvelopeType` union. Add `'interrupt'` here (see Design §1).
- `src/shared/wire/types.ts:474-481` — `ListConversationsPayload = Record<string, never>` and its doc-comment: *"the bare builder emits `payload: {}` directly and does not import this type; it exists to name the wire contract, exactly as `request_debug_bundle` has no payload struct."* This is the precedent for **NOT** adding an `InterruptPayload` type — and `interrupt` goes further than `list_conversations` (AC5 forbids even the documentary type). The `request_debug_bundle` member, which has no payload type at all, is the exact precedent to follow.
- `src/main/transport/codec.ts:112-138` — `encodeEnvelope` (throws `WireEncodeError` over `MAX_PLAINTEXT_BYTES`) and `decodeEnvelope`. **Line 133 (`if (!('payload' in obj)) throw ...`) is load-bearing**: it is *why* the builder emits `payload: {}` present-and-empty rather than omitting it — an absent payload fails the round-trip. No changes to this file; the builder consumes its contract.
- `docs/specs/architecture/299-dequeue-message-wire-builder.md` — the twin wire+builder spec (also `security-sensitive`) for overall structure and the security-review shape. Note the one structural difference: #299 introduces a payload type + guard-family test; **#305 introduces neither** (bare frame).
- **Memory / conventions (not in code):** the `@shared` alias is NOT available in `src/main` — import shared types by relative path (`../../shared/wire/types`), as `requestDebugBundleEnvelope.ts:12` already does. The codec/builder home is `src/main/transport/`, never `src/shared/wire/`.

## Context

`interrupt` is the desktop equivalent of pressing **Esc** at the local terminal: the daemon maps a bare `interrupt` v2 control frame to a single Esc keystroke into the supervised `claude`, stopping the current turn. It is an inbound phone→binary **control** frame — intercepted at the daemon's `dispatchAppFrame` *before* `dispatch.Route`, like `request_debug_bundle` / `dequeue_message` (daemon SSOT pyrycode #707, `docs/protocol-mobile.md` § interrupt).

Daemon SSOT facts that shape this slice:
- **Bare by construction.** No `conversation_id`, no `modal_id` nonce, no `answer_token`, no idempotency key. A replayed `interrupt` simply sends another Esc, and an Esc with no running turn is a no-op in `claude` — so no nonce or dedup is needed (#707).
- **Fire-and-forget — NO reply.** The daemon does not `ack` an `interrupt`. The turn-stopped signal reaches the desktop through the *existing* interactive stream (`turn_state{idle}` / `turn_end`), not as a response correlated to this frame. Nothing in this slice or its consumers awaits a reply.
- **Server-side gated on `interactive`.** The daemon routes `interrupt` → exactly one Esc only for a connection that negotiated the `interactive` capability; a non-interactive connection gets zero Esc (#707, `TestV2Session_Interrupt_RoutesEscByCapability`). The desktop already advertises `interactive` (#179), so this frame will be honoured. The gate is entirely daemon-side; the builder does nothing about it.

This is the **wire+builder base slice** (Strangler-Fig: introduce the primitive alongside the existing API). It ships **only** the `EnvelopeType` member under `src/shared/wire/` and the outbound frame builder under `src/main/transport/`. No `daemonConnection` method, no IPC exposure, no renderer UI, and **no consumer** — those land in #306 (command + IPC) and #307 (render), which are blocked on this ticket.

## Design source

N/A — transport-only slice (wire type + main-process builder). No renderer surface, no visual output; the ticket body carries no `## Figma` section and none is required. The composer stop-state visual lands in #307. The visual-fidelity check is intentionally skipped for code-review.

## Design

Two edits across two production files (plus one new test file). No payload type, no payload guard, no `types.test.ts` change (bare-frame precedent — see §3).

### 1. `src/shared/wire/types.ts` — `EnvelopeType` member

Add `'interrupt'` to the `EnvelopeType` union. Suggested placement: immediately after `'dequeue_message'` (line 61), grouping it with the other outbound interactive control verbs — but placement is **documentary only** (union order carries no wire meaning).

AC1 requires the member be *documented* as a v2-only, payload-free phone→binary control frame. Since there is no `InterruptPayload` interface to host that documentation (AC5), the doc lives as a short comment adjacent to the union member — e.g.:

```ts
  | 'dequeue_message'
  // v2-only bare phone→binary control frame — maps to a single claude Esc (stops the current
  // turn). Carries NO conversation_id / nonce / answer_token / payload; daemon-gated on the
  // `interactive` capability; fire-and-forget (no reply). SSOT pyrycode #707.
  | 'interrupt'
```

The exact wording is the developer's; the load-bearing facts to capture: bare / payload-free, maps to Esc, no correlation fields, `interactive`-gated, no reply.

**Note on membership enforcement:** `Envelope.type` is `EnvelopeType | string` (types.ts:78), so the builder's `type: 'interrupt'` literal would compile even without the union member. The member is added for contract/documentation and to let consumers (#306) write `const t: EnvelopeType = 'interrupt'`. This is exactly why the bare-frame twins carry no compile-time membership test — see §3.

### 2. `src/main/transport/interruptEnvelope.ts` — the builder (new file)

A structural twin of `requestDebugBundleEnvelope.ts` / `listConversationsEnvelope.ts`. Contract:

- **Header comment:** MAIN-PROCESS ONLY (it imports `./codec`, which uses Node `Buffer`). Never re-export it through any renderer barrel — the raw bytes stay out of the web layer. (Mirrors `requestDebugBundleEnvelope.ts:1-10`; verified the sibling builders are relative-import-only and never barrelled.)
- **Imports:** `import { encodeEnvelope } from './codec'` and `import type { Envelope } from '../../shared/wire/types'` (relative path — no `@shared` alias in `src/main`; no payload type imported).
- `export interface InterruptInput { id: number; ts: string }` — the consumer (#306's `createDaemonConnection.interrupt`) supplies the envelope id counter and the wall clock. **No payload field** — this is a bare control frame, exactly like `RequestDebugBundleInput`. Explicit inputs (not read from globals) keep the builder pure and trivially unit-testable.
- `export function buildInterrupt(input: InterruptInput): Uint8Array` — constructs `{ id: input.id, type: 'interrupt', ts: input.ts, payload: {} }` and returns `encodeEnvelope(envelope)`. One-line body; see `buildRequestDebugBundle` at `requestDebugBundleEnvelope.ts:42-50` for the exact shape.
- **`payload: {}` present-and-empty — NOT absent, NOT `null`.** Doc-comment must record why (mirror `requestDebugBundleEnvelope.ts:26-40`): the daemon never reads a payload for this bare control type (intercepted before dispatch), so it tolerates absent/`{}`/`null`; the *binding* constraint is the desktop's own `decodeEnvelope`, which throws on an absent `payload` (codec.ts:133), and `Envelope.payload` is required (relaxing it to optional would be a wire-type drift touching every consumer — CLAUDE.md no-drift). `{}` (not `null`) upholds the module's never-emit-null posture (codec.ts:107-108). Do not "fix" this to an omission.
- **May throw `WireEncodeError`** in principle (encodeEnvelope's contract), but a fixed-shape ~60-byte empty-payload envelope can never exceed `MAX_PLAINTEXT_BYTES`; the eventual caller (#306) catches anyway.

### 3. No `src/shared/wire/types.test.ts` change

The bare control frames `request_debug_bundle` and `list_conversations` have **no** per-family `describe(...)` block in `types.test.ts` (verified) — their `EnvelopeType` membership is exercised only via the builder round-trip test (which asserts `envelope.type === '<name>'`). `interrupt` follows that precedent exactly: the round-trip test in `interruptEnvelope.test.ts` (§Testing) covers the membership at runtime, and AC5 forbids a payload type or guard, so there is nothing else to type-test. Adding a `dequeue_message`-style vocabulary block here would manufacture a test the bare-frame twins deliberately don't carry — do not add one.

### Data flow

`InterruptInput` (`id` from the consumer's envelope-id counter, `ts` from the consumer's clock) → `buildInterrupt({ id, ts })` → `encodeEnvelope` → `Uint8Array` plaintext. Downstream (out of this slice, in #306): the Noise session (#7) encrypts it, base64-wraps it into `InnerFrameV2.data`, and the relay driver (#50) sends it — fire-and-forget. The turn-stopped acknowledgement arrives out-of-band on the existing interactive stream (`turn_state{idle}` / `turn_end`), never as a reply to this frame. **This slice ends at the `Uint8Array`.**

## State + concurrency model

None. `buildInterrupt` is a pure synchronous function over caller-supplied input — no store slice, no async task, no shared state, no subscription, no cancellation surface. State and the connection method arrive in #306; the composer stop-state store slice arrives in #307.

## Error handling

- **Over-cap:** `encodeEnvelope` throws `WireEncodeError` (category-only message, never echoing `id`/`ts`) if the envelope exceeds `MAX_PLAINTEXT_BYTES`. The builder propagates it; the caller (#306) drops the send. No new error type. (In practice unreachable for a fixed-shape empty-payload frame, but the contract is preserved for symmetry with the twins.)
- **No logging** — consistent with `codec.ts` ("This module performs no logging") and the sibling builders. Do not add a log call; there is no client content in this frame to leak, but the no-logging posture is the module convention.
- **No inbound parsing** in this slice → no `WireDecodeError` path, and no `daemonEventBridge` arm to extend (this is an outbound frame — there is no `DaemonEvent` member and no `assertNever` to touch). The absence of a reply (see Context) means there is likewise no correlation/pending-request bookkeeping.

## Testing strategy

One new test file, plain vitest (`npm test`), no fakes/mocks — the builder is pure and uses the real codec so the assertion pins actual wire bytes.

### `src/main/transport/interruptEnvelope.test.ts` (new) — mirrors `requestDebugBundleEnvelope.test.ts`

- **Round-trips to a bare `interrupt` envelope carrying the exact id and ts (AC3 + AC4).** Build with a fixed `ts` and an `id`; `decodeEnvelope` the bytes; assert `type === 'interrupt'`, `id`, `ts`, and `payload` deep-equals `{}`. The `payload.toEqual({})` assertion is the load-bearing one: it proves `decodeEnvelope` did **not** throw on an absent payload — i.e. the frame carries a present-but-empty payload, per AC3 — and it doubles as the runtime membership check for the new `EnvelopeType` member.

**No over-cap `WireEncodeError` test.** The bare-frame twins (`requestDebugBundleEnvelope.test.ts`, `listConversationsEnvelope.test.ts`) omit it deliberately: with no payload to inflate, a fixed-shape ~60-byte envelope can never exceed `MAX_PLAINTEXT_BYTES`, so the case is unreachable and the test would be vacuous. Follow the twins — do not add it. (Contrast `dequeueMessageEnvelope.test.ts`, which *does* test over-cap because it can inflate `conversation_id`.)

Type-level coverage runs under `npm run typecheck` (both sides). `npm run build` is the salvage/QA gate.

## Open questions

None. The wire contract is fully pinned by the daemon SSOT (#707) and by the two already-shipped bare-frame builders it mirrors. The `interactive`-capability gate is daemon-side and already satisfied by the desktop's #179 advertisement; the command/IPC surface and any validation of a caller-triggered interrupt are #306's concern (this slice's builder consumes only a numeric `id` + string `ts`, both non-untrusted internal values).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No finding. This slice has no untrusted→trusted crossing: `buildInterrupt({ id, ts })` consumes an internal envelope-id counter and a clock string that #306's connection method supplies — no relay socket, no renderer IPC, no daemon response, no disk read reaches this code. **Frame-shape audit (ticket-required):** the emitted frame is `{ id, type: 'interrupt', ts, payload: {} }` — correctly **bare** (no `conversation_id`, no `modal_id` nonce, no `answer_token`, no idempotency key), matching daemon SSOT #707 field-for-field. The bare/replayable shape is safe by construction: a replayed `interrupt` is a benign extra Esc, and an Esc with no running turn is a no-op in `claude` (#707), so the deliberate absence of a nonce/dedup is not a vulnerability. Validating that a *triggered* interrupt is legitimate is the renderer→main IPC edge's job — **OUT OF SCOPE → #306**.
- **[Tokens, secrets, credentials]** N/A by design. `interrupt` is a bare frame (#707): it carries NO answer token, NO nonce, NO credential — deliberately unlike `ModalAnswerPayload.answer_token`. `id` (a plain counter) and `ts` (a timestamp) are non-secret. The builder touches no secret material; there is nothing to generate, store, rotate, or revoke.
- **[File / storage operations]** N/A. Pure in-memory serialization; no filesystem, no disk, no path handling, no TOCTOU, no atomic-write concern.
- **[Inter-process / Electron attack surface]** No finding. The builder is MAIN-process-only (imports `./codec` → Node `Buffer`) and the spec forbids re-exporting it through any renderer barrel — verified the sibling bare builders (`requestDebugBundleEnvelope`, `listConversationsEnvelope`) are relative-import-only and never barrelled, so a renderer `import` cannot reach it. No `contextBridge` API, no `ipcMain` channel, and no `BrowserWindow`/`webPreferences` change in this slice (explicit: no IPC surface). The process-placement MUST-FIX rule (transport out of the renderer) is satisfied. Positive structural note for the downstream gate: because `interrupt` is **nullary** (the renderer supplies no payload), #306's future IPC handler accepts zero renderer-controlled bytes into the frame — its only job is to confirm a live/interactive connection, not to sanitize input. IPC exposure and that check are **OUT OF SCOPE → #306**.
- **[Cryptographic primitives]** N/A. The builder does no crypto. It emits plaintext bytes the Noise session (#7, a vetted Noise_IK implementation) encrypts downstream. There is no RNG — a bare frame has no nonce or token to mint (contrast `answer_token`, minted #236), and #707 confirms no dedup key is needed. No `(key, nonce)` handling, no comparison against a secret, no hand-rolled primitive.
- **[Network & I/O]** No finding. The outbound frame-size cap is enforced: `encodeEnvelope` throws `WireEncodeError` over `MAX_PLAINTEXT_BYTES` (in practice unreachable for a fixed-shape ~60-byte empty-payload envelope, but the contract holds). No new socket, relay URL, TLS config, `maxPayload`, timeout, reconnect logic, or inbound frame parsing is introduced — all transport plumbing is inherited unchanged from existing code.
- **[Error messages, logs, telemetry]** No finding. `WireEncodeError`'s message names the failure category only, never echoing `id`/`ts`. The builder performs no logging (consistent with `codec.ts` and the sibling builders), and the frame carries no client content or secret to leak in any case.
- **[Concurrency]** N/A. Pure synchronous function — no async, no long-lived task, no shared state, no listener, no timer, no cancellation surface. The downstream send is fire-and-forget (no reply per #707), which means #306 accumulates no pending-request/correlation state — a simplification, not a hazard.
- **[Threat model alignment]** Malicious/compromised relay: content-blind and on-path; it sees only the Noise-encrypted downstream bytes (this builder's plaintext never leaves the main process unencrypted), so it can at most drop/delay/reorder the frame → a *denial of interrupt* (the user's Esc doesn't land, the turn keeps running), never a plaintext leak or a hang; a relay replay is a benign extra Esc (#707). Token theft from disk: N/A (no token, no disk). Hostile daemon response: N/A — `interrupt` is fire-and-forget, no response is parsed here; the turn-stopped signal rides the already-shipped, already-defensive `turn_state`/`turn_end` decoders. Renderer compromise reaching the transport: the builder is unreachable from the renderer (main-only, unbarrelled); a compromised renderer's only path to emit an `interrupt` is #306's future IPC handler, and because the command is nullary the severity ceiling is "stop the user's own running turn on their own conversation" — a self-inflicted, low-severity nuisance the user can already trigger by clicking the stop button, with no escalation and no data exfiltration. **Named residual:** the frame is bare/client-ungated by design, so the only gates are daemon-side `interactive` gating (already satisfied via #179) and #306's IPC handler — both **OUT OF SCOPE → #306** for this wire+builder slice.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-12
