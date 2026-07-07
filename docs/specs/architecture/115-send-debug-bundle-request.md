# Spec: Send the debug-bundle request over the encrypted channel (#115)

## Files to read first

- `src/main/transport/sendMessageEnvelope.ts` — the **exact sibling to mirror**: a pure `(input) → Uint8Array` builder that wraps a payload in an `Envelope` and serializes via `encodeEnvelope`. Copy its shape, comment posture, and the "MAIN-PROCESS ONLY" header.
- `src/main/transport/sendMessageEnvelope.test.ts` — the test shape to mirror for the new builder's test: round-trip the built bytes through the real `decodeEnvelope` and assert `type`/`id`/`ts`/`payload`.
- `src/main/daemonConnection.ts:113-140` — `createDaemonConnection` locals: the `nextEnvelopeId` counter (advances only on a successful build) and the `driver: NoiseRelayDriver | null` fence.
- `src/main/daemonConnection.ts:280-295` — the `send(payload)` method: the `driver === null` no-op guard, build → advance id → `driver.sendMessage(bytes)`, wrapped in a never-throw `try/catch`. The new method is a structural twin of this.
- `src/main/daemonConnection.ts:64-82` — the `DaemonConnection` interface (`start`/`stop`/`reconnect`/`send`); the new method is added here.
- `src/main/daemonConnection.test.ts:702-800` — the `describe('… — send (outbound send_message)')` block: fixtures (`build`, `connected`, `FIXED_TS`, `throwOnSend` fake driver, `decodeEnvelope`), and the no-op-before-start / forwards-one-envelope / never-throw tests to mirror.
- `src/main/transport/codec.ts:103-138` — `encodeEnvelope` (caps at `MAX_PLAINTEXT_BYTES`, drops `undefined` keys, never emits `null`) and `decodeEnvelope` (**requires `'payload' in obj`** — throws `WireDecodeError` on an absent payload). This is why "no payload" must be a *present-but-empty* payload on the desktop side.
- `src/shared/wire/types.ts:40-61` — the `EnvelopeType` union (add the new member here) and the `Envelope` interface (`payload: unknown`, **required** — do not touch it).
- `src/main/index.ts:188-194` — the `onCommand` switch (`sendMessage` only, today). **Confirms the renderer→requestDebugBundle wiring is out of scope** for #115 (that is the renderer-command sibling); no change here.

## Context

The **outbound** half of the client debug-bundle download. The daemon serves the bundle on a bare `request_debug_bundle` control frame (assembled by pyrycode #811, streamed by #812, served by #813 — all merged). This slice adds only the ability to *ask*: the background process builds and encrypts a bare `request_debug_bundle` envelope onto the live Noise session. Receiving/reassembling the streamed response, saving to disk, and the renderer command are the sibling tickets (#116/#117/#118) and are **not** in scope here.

The request is a **bare control envelope** — no payload struct, no `conversation_id`, no id that selects a session. The bundle is daemon-global by construction (whole log ring + newest recording across all sessions, no per-session key), so there is no attacker-selectable field. This mirrors the daemon's `TypeInterrupt` (pyrycode #707) — also a bare, payload-less control frame intercepted before `dispatch.Route`.

Not security-sensitive (confirmed: no `security-sensitive` label): outbound-only, no untrusted input parsed, no attacker-selectable field. The inbound-reassembly sibling is the security-sensitive one.

## Design

Three production edits, mirroring the existing `send_message` outbound path field-for-field.

### 1. Shared wire vocabulary — `src/shared/wire/types.ts`

Add `'request_debug_bundle'` as a member of the `EnvelopeType` union (`types.ts:40-48`). One line. This matches the daemon's `TypeRequestDebugBundle = "request_debug_bundle"` (pyrycode `internal/protocol/codes.go`) field-for-field.

- **Do NOT** add a payload interface — it is a bare control frame with no payload struct (unlike `SendMessagePayload`).
- **Do NOT** relax `Envelope.payload` to optional. It stays `payload: unknown` (required). Relaxing it would be a wire-type drift touching every consumer (CLAUDE.md no-drift; `docs/knowledge/decisions/0002`). The "no payload" requirement is satisfied by emitting a *present-but-empty* payload value, not by omitting the field — see § "The empty-payload form" below.

### 2. Builder — `src/main/transport/requestDebugBundleEnvelope.ts` (NEW)

A pure builder, sibling to `buildSendMessage`. Same one-concern-per-file split the module already follows (`helloExchange.ts` for the handshake, `sendMessageEnvelope.ts` for `send_message`, this file for the bare control frame). MAIN-PROCESS ONLY (imports `codec.ts`); carry the same header posture.

Contract (signature + behaviour only — no full body):

```
export interface RequestDebugBundleInput { id: number; ts: string }   // no payload arg — bare frame
export function buildRequestDebugBundle(input: RequestDebugBundleInput): Uint8Array
```

Behaviour: construct `{ id, type: 'request_debug_bundle', ts, payload: {} }` in the same field order as `buildSendMessage`, then return `encodeEnvelope(envelope)`. Thinner than `buildSendMessage` — there is no caller-supplied payload and no `make…Payload` constructor.

- **Do NOT** add a generic `buildControlEnvelope(type, …)` helper. There is exactly one bare control frame in scope; a generic abstraction for one consumer is YAGNI (Simplicity First; mirrors the daemon-side #707 "one-line gate, not an abstraction" decision). If `interrupt` lands later, that ticket decides whether to generalize.
- `encodeEnvelope` *can* throw `WireEncodeError` in principle (over-cap), but a fixed-shape empty-payload envelope is always ~80 bytes — it can never exceed `MAX_PLAINTEXT_BYTES`. Keep the signature honest (it may throw, per `encodeEnvelope`'s contract) but do **not** write an over-cap test for this builder — that branch is unreachable here (see Testing).

### The empty-payload form — decided: `payload: {}`

The daemon's `Envelope.Payload` is a deferred-decode `json.RawMessage` that is **never read** for a bare control type, so the daemon tolerates an absent, `{}`, or `null` payload. The binding constraint is the **desktop's own** `decodeEnvelope`, which requires `'payload' in obj` (throws otherwise), and the AC5 round-trip test exercises exactly that path. So the builder must emit a present payload.

Among present forms, use **`payload: {}`** (an empty object literal):
- Round-trips cleanly through `decodeEnvelope` (key present, value `{}`).
- Consistent with the codebase's hard "never emit `null` on the wire" posture (`codec.ts:107-108`, `types.ts:56-58` — the tightened optionals forbid `null`). `payload: null` would decode fine but violates that house posture, so it is rejected even though the daemon tolerates it.
- Matches how existing payload-less envelopes are written in the tests (`payload: {}` for `ack`/`hello`, `daemonConnection.test.ts:292,359`).

Mobile (`explicitNulls = false`) likely *omits* the payload for its bare frames; the desktop cannot (the field is required and must not be relaxed). This is an accepted, daemon-tolerated divergence — the daemon never reads `Payload` for this type. Document this reasoning in a one-line comment on the `payload: {}` literal so a future reader does not "fix" it to an omission.

### 3. Connection method — `src/main/daemonConnection.ts`

Add `requestDebugBundle(): void` to the `DaemonConnection` interface (beside `send`, `daemonConnection.ts:64-82`) and implement it as a structural twin of `send` (`daemonConnection.ts:280-295`):

1. `if (driver === null) return` — the single "not connected" guard. Covers pre-`start()`, mid-bootstrap, bootstrap-failed. Post-terminal, the driver's own `sendMessage` is inert (`noiseRelayDriver.ts`), same as `send`. This is AC4 (silent no-op, never a throw).
2. `try { const bytes = buildRequestDebugBundle({ id: nextEnvelopeId, ts: now() }); nextEnvelopeId += 1; driver.sendMessage(bytes) }`
3. `catch { /* never throw out of the module (parity #490); drop */ }` — the caught object is dropped, no log, no event, mirroring `send`'s catch. (The build cannot realistically over-cap, but `driver.sendMessage` can throw; keep the `try/catch` for the module's never-throw invariant and exact `send` parity.)

Share the **existing** `nextEnvelopeId` counter — no second counter. Advancing it keeps envelope ids monotonic across interleaved `send`/`requestDebugBundle` calls (the daemon correlates replies by `id`/`in_reply_to`; the reassembly sibling relies on a well-formed request id). Interface method name: `requestDebugBundle` (verb, no args).

- **No `index.ts` change.** The `onCommand` switch stays `sendMessage`-only; the renderer command that would invoke `requestDebugBundle()` is the sibling ticket. Adding an interface method is additive — the sole implementation is `createDaemonConnection`, and no existing consumer must call the new method.

## State + concurrency model

No new state. Reuses the module-local, single-writer `nextEnvelopeId` (no `await` in the method → runs to completion, no check-then-act race, exactly like `send`) and the `driver` fence. No store slice, no async task, no subscription, no teardown surface. The method is fire-and-forget onto the existing driver's `sendMessage`.

## Error handling

| Failure mode | Behaviour | Layer |
|---|---|---|
| Not connected (`driver === null`) | Silent no-op, id not consumed | `requestDebugBundle` guard (AC4) |
| `driver.sendMessage` throws (wasm/driver) | Caught, dropped, never rethrown; no log, no event | `requestDebugBundle` catch (parity #490) |
| Over-cap encode (`WireEncodeError`) | Structurally unreachable (fixed ~80-byte envelope); the catch would still absorb it | `requestDebugBundle` catch |

No new `DaemonEvent`, no banner/dialog: the request is a fire-and-forget outbound. Nothing surfaces to the renderer in this slice (the daemon's streamed response is the reassembly sibling's concern).

## Testing strategy

Vitest, mirroring the existing tests. No new fakes — reuse `daemonConnection.test.ts`'s `build`/`connected`/`throwOnSend`/`decodeEnvelope` fixtures.

**`src/main/transport/requestDebugBundleEnvelope.test.ts` (NEW)** — mirror `sendMessageEnvelope.test.ts`:
- Round-trips to a `request_debug_bundle` envelope carrying the exact `id` and `ts`: build with a fixed `{ id, ts }`, decode with the real `decodeEnvelope`, assert `type === 'request_debug_bundle'`, `id`, `ts`, and that the decoded `payload` equals `{}` (proves the empty payload is present, i.e. `decodeEnvelope` did not throw). This is the "well-formed bare envelope is produced" half of AC5.
- **Do not** add an over-cap `WireEncodeError` test — that branch is unreachable for a fixed-shape empty-payload envelope (would test dead code).

**`src/main/daemonConnection.test.ts`** — add a `describe('… — requestDebugBundle (outbound debug-bundle request)')` block mirroring the `send` block:
- No-op before `start()`: no driver → `expect(() => connection.requestDebugBundle()).not.toThrow()`, nothing forwarded (AC4).
- After `handshake-complete`, forwards exactly one envelope handed to `driver.sendMessage`: `drivers[0].sent` has length 1; decode it and assert `type === 'request_debug_bundle'`, `id === 2`, `ts === FIXED_TS`. This is the "handed to the session's encrypt path" half of AC5.
- Carries no session-selecting field (AC3): the decoded envelope has no `conversation_id`/`message_id`; the decoded `payload` is empty (`{}`).
- Never throws when `driver.sendMessage` throws: build with `{ throwOnSend: true }`, reach connected, `expect(() => connection.requestDebugBundle()).not.toThrow()` (parity #490).
- (Optional, lean) Shares the id counter with `send`: a `send` then a `requestDebugBundle` after handshake produce ids 2 then 3 — proves the single monotonic counter. Include only if cheap; the id-2 assertion above already covers the core AC.

`npm run typecheck` covers the new `EnvelopeType` member and the interface-method addition type-level. `npm run build` is the salvage/QA gate.

## Acceptance criteria mapping

- AC1 (`request_debug_bundle` in `EnvelopeType`, matches daemon) → § Design 1.
- AC2 (build + encrypt a bare envelope onto the live session, mirroring `send_message`) → § Design 2 + 3.
- AC3 (no payload, no session-selecting field) → `payload: {}`, no `conversation_id`; daemonConnection test asserts it.
- AC4 (no live session → silent no-op, never a throw, matching `send`) → § Design 3 guard + catch; before-start test.
- AC5 (unit test: well-formed bare envelope produced and handed to the encrypt path) → the two test files together.

## Open questions

None blocking. The empty-payload form is decided (`payload: {}`, § above). The daemon tolerates any present or absent form for this bare control type, so no daemon coordination is required.
