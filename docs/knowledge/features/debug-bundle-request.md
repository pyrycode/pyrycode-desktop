# Debug-bundle request (outbound)

The **outbound "ask" half of the client debug-bundle download**: the background process encrypts a bare `request_debug_bundle` control envelope onto the live Noise session, so the pyry daemon begins streaming the current session's debug bundle back. This is the client sibling of the daemon's assemble/stream/serve path (pyrycode #811/#812/#813, all merged).

Introduced in [#115](../codebase/115.md). Entirely `src/main/` — the request is built and encrypted in the background process; keys and bytes never reach the renderer. **Outbound only:** receiving/reassembling the streamed `.tar.gz` response (#116), saving it to disk (#117), and the renderer command that would trigger the request (#118) are the sibling slices of the [#71](https://github.com/pyrycode/pyrycode-desktop/issues/71) split and are **not** part of this feature yet — this doc grows as they land.

## A bare control frame — no payload, no selector

`request_debug_bundle` is a **bare control envelope**: no payload struct, no `conversation_id`, no id that selects a session. The bundle is **daemon-global by construction** (the whole log ring + the newest recording across *all* sessions, no per-session key), so there is **no attacker-selectable field**. That is why this outbound slice is **not `security-sensitive`** (no untrusted input parsed, nothing an attacker can steer) while the inbound-reassembly sibling (#116) — which parses daemon-sent bytes — is.

It mirrors the daemon's `TypeInterrupt` (pyrycode #707): a bare, payload-less control frame intercepted **before** `dispatch.Route`. The wire type matches the daemon's `TypeRequestDebugBundle = "request_debug_bundle"` field-for-field (CLAUDE.md no-drift, [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md)).

## The two pieces

1. **A pure envelope builder** — `buildRequestDebugBundle` in `src/main/transport/requestDebugBundleEnvelope.ts` (new). A **thinner** sibling of [`buildSendMessage`](outbound-send-path.md): same pure `(id, ts) → Uint8Array` shape, same field order, same `encodeEnvelope` serialization, same MAIN-PROCESS-ONLY posture — minus the payload argument and the `make…Payload` constructor (there is nothing caller-supplied to wrap).

```ts
// src/main/transport/requestDebugBundleEnvelope.ts — MAIN-PROCESS ONLY
export interface RequestDebugBundleInput {
  id: number   // the consumer's envelope-id counter
  ts: string   // RFC3339 timestamp — supplied by the caller, never read here
}

export function buildRequestDebugBundle(input: RequestDebugBundleInput): Uint8Array
// Builds Envelope { id, type: 'request_debug_bundle', ts, payload: {} } → encodeEnvelope() UTF-8 bytes.
```

2. **A connection method** — `requestDebugBundle(): void` added to [`createDaemonConnection`](daemon-connection.md), a **structural twin of `send`**: one `driver === null` no-op guard, one full-body `try/catch`, sharing the module-local `nextEnvelopeId` counter.

```ts
function requestDebugBundle(): void {
  if (driver === null) return              // not connected → silent no-op (never a throw)
  try {
    const bytes = buildRequestDebugBundle({ id: nextEnvelopeId, ts: now() })
    nextEnvelopeId += 1                     // shares the one counter with send; advance on success
    driver.sendMessage(bytes)              // driver is inert pre-handshake / post-terminal
  } catch {
    // Never throw out of the module (parity #490). Caught object DROPPED — no log, no event.
  }
}
```

**No `index.ts` change.** The `onCommand` switch stays `sendMessage`-only; the renderer command that would call `requestDebugBundle()` is the sibling ticket (#118). Adding the interface method is purely additive — its sole implementation is `createDaemonConnection`, and no existing consumer must call it.

## The empty-payload form — `payload: {}`, not an omission

The one non-obvious call, pinned by an inline comment so it is not "fixed" later. "No payload" on the desktop side is a **present-but-empty** `payload: {}`, **not** an omitted field:

- The daemon never reads `Payload` for this bare control type (intercepted before dispatch, like `interrupt`), so it tolerates an absent, `{}`, or `null` payload — the daemon is **not** the binding constraint.
- The **binding constraint is the desktop's own** [`decodeEnvelope`](wire-codec.md), which requires `'payload' in obj` and throws `WireDecodeError` otherwise (`codec.ts:133`). The unit test round-trips the built bytes through the real `decodeEnvelope`, so the builder must emit a present payload.
- `payload: {}` over `payload: null`, because the codec's house posture is **never emit `null` on the wire** (`codec.ts:107`; the tightened optionals forbid it). `null` would decode but violate that posture.
- **Accepted, daemon-tolerated divergence from mobile:** mobile (`explicitNulls = false`) likely *omits* the field; the desktop cannot, because `Envelope.payload` is **required** and must not be relaxed to optional (a relax would be a wire-type drift touching every consumer). The daemon reads neither form, so the divergence is invisible.

Generalizes to any future "no payload" outbound frame (e.g. `interrupt`) — captured as project memory.

## The shared envelope-id counter

`requestDebugBundle` advances the **same** module-local, single-writer `nextEnvelopeId` that `send` uses — **no second counter**. So envelope ids stay unique and monotonic across interleaved `send`/`requestDebugBundle` calls (a `send` then a request yield ids 2 then 3). The daemon correlates replies by envelope `id`/`in_reply_to`, and the reassembly sibling (#116) relies on a well-formed request id to match the streamed response. Advancing only on a successful build, with no `await` in the method, keeps it race-free — identical discipline to the [outbound send path](outbound-send-path.md).

## Data flow

```
(future) renderer command (#118)
  → connection.requestDebugBundle()                          // ← this feature
  → buildRequestDebugBundle({ id, ts }) → driver.sendMessage(bytes)
  → session.sendMessage (AEAD seal) → sendFrame → InnerFrameV2 noise_msg → relay → daemon
  → daemon intercepts request_debug_bundle before dispatch.Route → begins streaming the bundle back
    (the streamed response is the inbound-reassembly sibling #116's concern)
```

## Error handling

| Failure | Layer | Result |
|---|---|---|
| Not connected (`driver === null`) | `requestDebugBundle` guard | Silent no-op; id **not** consumed. No throw. |
| `driver.sendMessage` throws (wasm/driver) | `try/catch` | Caught, dropped, never rethrown; no log, no event (parity #490). |
| Over-cap encode (`WireEncodeError`) | `try/catch` | Structurally unreachable — a fixed-shape ~80-byte envelope can never exceed `MAX_PLAINTEXT_BYTES`; the catch would absorb it regardless. |

No new `DaemonEvent`, no banner/dialog — the request is fire-and-forget. The daemon's streamed response surfaces (later) through the reassembly sibling, not here.

## Related

- [#115 codebase notes](../codebase/115.md) — implementation summary, patterns, lessons, and the sibling roadmap (#116/#117/#118).
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the `send_message` path this mirrors field-for-field: the pure builder shape, the single-`driver === null`-guard case analysis, the shared id-counter model, and the never-throw posture are all reused.
- [Daemon connection](daemon-connection.md) / [#62](../codebase/62.md) — hosts the `requestDebugBundle()` method alongside `send`; owns the `nextEnvelopeId` counter and the `driver` fence.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — `encodeEnvelope` (the serializer), `decodeEnvelope`'s `'payload' in obj` requirement (`codec.ts:133`, the constraint forcing a present payload), the `Envelope` type, and the "never emit null" posture.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the wire types match mobile/daemon field-for-field; `EnvelopeType` extended, `Envelope.payload` not relaxed.
- Daemon twins (QMD `pyrycode-docs`): pyrycode #811/#812/#813 (assemble/stream/serve), `TypeRequestDebugBundle` in `internal/protocol/codes.go`, `docs/protocol-mobile.md` § Debug bundle (v2). Precedent: pyrycode #707 `TypeInterrupt`.
