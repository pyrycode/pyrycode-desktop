# Spec #416 — Fake-daemon reconnect e2e for the modal reconcile (+ reconnect-capable harness)

**Ticket:** [#416](https://github.com/pyrycode/pyrycode-desktop/issues/416) · **Size:** S (no split) · **Security-sensitive:** yes · Split B of #196 (A = #415, PR #417, merged).

## Design source

N/A — pure test infrastructure, no visible surface (per ticket body). The visual-fidelity check is intentionally skipped; there is no renderer UI in this ticket.

## Context

#415 (merged) taught the renderer to **reconcile the outstanding modal slice on every supervisor (re)handshake**: `modalBridge.ts` flips the `connected` DaemonEvent to a payload-free `{ type: 'reconnected' }`, and `modalPrompts.ts` reduces it by clearing `outstanding` while preserving `resolved` + `rejections`. The daemon's connect-time re-sends then repopulate `outstanding` (a still-held modal re-appears via `shown`; absence = resolved-while-away). That reconcile is unit/integration-tested at the bridge/reducer level, but **nothing proves it against a genuine reconnect**: a mid-session relay drop, a real supervisor re-dial, a fresh Noise responder handshake, and the daemon re-pushing (or not) the outstanding `modal_shown`.

The in-process fake harness (#88/#90/#91) has **zero reconnect capability today**:

- `fakeRelayForwarder.ts` fills `clientLeg` once and terminates any client re-dial (`if (clientLeg !== null) socket.terminate()`, line 131). It never nulls a leg on `close`, so a supervisor re-dial is refused.
- `fakeDaemon.ts` is a single responder handshake: `awaiting-msg1` → `transport`. On a reconnect the client sends a fresh `noise_init` (v2 has no session resume) that `onMessage` routes into `handleTransport`, where it MAC-fails. The only fresh-handshake path is the in-session rekey (`handleRekeyInit`, entered via `initiateRekey`). There is no server-push of a `modal_shown`.
- `daemonConnection.roundtrip.test.ts` quiesces the supervisor at teardown (`connection.stop()` runs first in the LIFO cleanup) — no test exercises a real re-dial through the fake daemon.

So proving the reconcile end-to-end means **building the reconnect path first**, then the e2e on top. The reconnect capability is deliberately **modal-agnostic** (AC5) so the #197 queue-reconnect e2e can reuse the same drop/re-dial harness unchanged.

**Load-bearing faithfulness fact (verified on `main`):** on a supervisor reconnect the driver (`noiseRelayDriver.onConnected`, line 168) builds a **fresh** `createNoiseSession` carrying `material.hello` — a full IK handshake expecting a `hello_ack` — and its first outbound frame is tagged `noise_init` "so the daemon routes them to a handshake path, not transport-decrypt" (`noiseRelayDriver.ts:189/203`). The reconnect handshake is therefore **not** an empty-early-data rekey; it is the initial handshake shape (`handleMsg1`: recover hello, decode, write hello_ack) combined with the rekey path's **atomic cipher swap** (`handleRekeyInit`: install both new ciphers, then free both old ones). The daemon detects the reconnect from the `noise_init` inner-frame type — which is exactly the routing signal the driver documents. Branching on it is faithful, not a shortcut.

## Files to read first

- `src/main/transport/fakeRelayForwarder.ts:122-156` — the `wss.on('connection')` handler; leg-fill logic at 130-142, `settleReady` at 155. **AC1 edit site**: add a `close` handler that nulls the matching leg slot (identity-guarded), plus a `dropClientLeg()` control on the handle. The module header (1-16) states the content-blindness invariant — do **not** import codec/Noise here; the re-splice must stay opaque-byte plumbing.
- `src/main/transport/fakeDaemon.ts` — the whole file (~388 lines). Precedents to mirror:
  - `handleMsg1` (215-237) — recover hello early-data, `decodeEnvelope`, `WriteMessage(hello_ack)`, `Split`. The reconnect handshake reuses this shape.
  - `handleRekeyInit` (263-293) — fresh responder handshake reusing the same static + **atomic cipher swap** (install both, free both old). The reconnect handshake reuses this swap discipline.
  - `initiateRekey` (245-256) — seal a control envelope under the current send cipher and stream it. The precedent for `pushFrame` (AC3).
  - `onMessage` (319-332) — the state router. **AC2 edit site**: peek `inner.type` to route a `transport`-state `noise_init` into the new reconnect handler.
  - `sendNoise` (210-213), `freeAll` (194-205), `settle` (186-190), `FakeDaemon`/`FakeDaemonOptions` (86-134), `DaemonState` (136). Module header (1-37) — faithfulness + log-free + closed-reason discipline.
- `src/main/transport/fakeDaemon.test.ts` — the self-test. `standUp` (222-233) and `driveClient` (148-220) are the primitive-level scaffold; the rekey self-test (335-384) is the closest template for the **reconnect self-test** (AC4). Note the `connect()` transient re-dial helper (60-78) and log-free `vi.spyOn(console)` assertions.
- `src/main/daemonConnection.roundtrip.test.ts:160-220` — `standUpRoundTrip` (the harness scaffold to reuse) + its `sink`, `cleanups` LIFO (107-124), and `makeWaiter` (80-105). **e2e edit site**: extend `standUpRoundTrip` (return `forwarder`; add an `onDaemonEvent` hook; thread `reconnectResendFrames`) and add a `describe` block with the two reconnect variants.
- `src/renderer/src/store/modalBridge.ts:41-125` — `translateModalEvent` (`connected` → `{ type: 'reconnected' }` at 61-65; `modalShown` → `{ type: 'shown', … }` at 43-52) and `subscribeModal` (117-125). The #415 code the e2e wires into the sink path.
- `src/renderer/src/store/modalPrompts.ts:70-182` — `ModalState`, `reduceModal` (`shown` idempotency 127-146, `reconnected` clear 169-176), `initialModalState`, `selectOutstanding`. The reducer the e2e folds events through and asserts against.
- `src/main/daemonConnection.ts:447-461` (the `connected` emit at handshake-complete) and `755-773` (the `modalShown` emit from the inbound loop). The chain the e2e proves: `connected` → `reconnected` (bridge) → `outstanding: []` → re-sent `modalShown` → `shown` → repopulate. `answerModal` exists at 319/1316 (see Open Questions on "answerable").
- `src/shared/wire/types.ts:33-38` (`InnerFrameV2` — `type: string`, the reconnect discriminant) and `449-456` (`ModalShownPayload` — wire shape `modal_id, class, title, prompt, options, default_option_id` for the crafted e2e frame).
- `src/main/transport/inboundMessage.ts:700-720` — `parseModalShown`; confirms the decode the e2e's crafted `modal_shown` envelope must satisfy (well-formed options, `class ∈ WireModalClass`).

## Design

Three parts, in dependency order. The forwarder re-splice and the daemon reconnect are the two ends of **one** splice — neither is independently observable — hence a single compile-atomic ticket. All three additions are modal-agnostic (AC5); the modal specifics live only in the e2e test.

### 1. Reconnect-capable forwarder (`fakeRelayForwarder.ts`) — AC1

The forwarder gains two capabilities, both content-blind (no codec/Noise import):

- **Null the leg on close.** In the `connection` handler, register `socket.on('close', …)` that nulls `clientLeg`/`serverLeg` **only if the closing socket is still the current occupant** (`clientLeg === socket`). The identity guard prevents a late close of the old socket from nulling a freshly re-spliced new leg. A subsequent `/v1/client` dial then re-fills the slot and splices to the still-connected server leg. The `settleReady()` call on a re-splice is a no-op (already settled). The server leg is untouched by a client-leg close (AC1).
- **`dropClientLeg(): void` on the `FakeRelayForwarder` handle.** Terminates the current `clientLeg` (`terminate()` → abnormal 1006 close, which the supervisor treats as retryable → auto-reconnect; see `noiseRelayDriver.ts:64`, `#149`). No-op when `clientLeg` is null. This is the test's mid-session drop trigger. Modal-agnostic.

**Interface delta:**
```
interface FakeRelayForwarder {
  // …existing url / whenReady / close…
  dropClientLeg(): void   // terminate the current client leg; a re-dial re-splices (AC1)
}
```

Behavior contract (assert in the forwarder test if a targeted case is added, else covered by the e2e): after `dropClientLeg()`, a fresh `/v1/client` dial registers as the new `clientLeg` and forwards to the same `serverLeg`; the server leg never closes.

### 2. Reconnect-aware fake daemon (`fakeDaemon.ts`) — AC2, AC3

**State.** `DaemonState` is unchanged (`awaiting-msg1 | transport | awaiting-rekey-init | closed`). The reconnect handshake starts and ends in `transport`; it needs no new state (it is entered by an inner-frame-type peek, not a state transition).

**`onMessage` routing change (AC2).** `onMessage` already decodes the inner frame; capture the whole `InnerFrameV2` (not just `.data`) so its `.type` is visible, then route:

| state | inner `.type` | handler |
|-------|---------------|---------|
| `awaiting-msg1` | any | `handleMsg1` (unchanged) |
| `awaiting-rekey-init` | any | `handleRekeyInit` (unchanged) |
| `transport` | `noise_init` | **`handleReconnect` (new)** |
| `transport` | otherwise | `handleTransport` (unchanged) |

The `base64StdDecode`/`decodeInnerFrame` fail-closed path (frame-decode-failed) is unchanged.

**`handleReconnect(raw)` (new).** A fresh Noise responder handshake reusing the same static — `handleMsg1`'s hello path with `handleRekeyInit`'s atomic swap. One-line-summary of the body (do **not** pre-write it; compose from the two cited precedents):

- Guard: no-op unless both ciphers are non-null (mirrors `handleRekeyInit`'s guard).
- `const fresh = lib.HandshakeState(NOISE_PROTOCOL, RESPONDER); fresh.Initialize(null, staticPriv, null, null)`.
- `const hello = fresh.ReadMessage(raw, true) ?? EMPTY_AD; decodeEnvelope(hello)` — recover + validate the client hello early-data exactly as `handleMsg1` does (faithfulness: a malformed hello fail-closes).
- `const msg2 = fresh.WriteMessage(encodeEnvelope({ …hello_ack… }))` — reuse the same `helloAck` payload the daemon was constructed with (so the reconnect's `connected` ack matches the initial one; the e2e can assert ack equality across both handshakes).
- `const pair = fresh.Split()` → **atomic swap**: `const prevSend = sendCipher, prevRecv = recvCipher; sendCipher = pair[0]; recvCipher = pair[1];` then free `prevSend`/`prevRecv` in a guarded loop. Nothing fallible between install and free (the `handleRekeyInit` invariant, load-bearing).
- `state = 'transport'` (already there; explicit for clarity), `sendNoise(msg2)`.
- **Then** stream `reconnectResendFrames` (see below) sealed under the **new** send cipher, in order.
- `catch`: `settle({ ok: false, reason: 'handshake-read-failed' })` + `void close()` — the library auto-freed `fresh`, no cipher was reassigned (both still hold the old keys). Mirrors `handleMsg1`/`handleRekeyInit`.

Note the split role-mapping stays `sendCipher = split[0], recvCipher = split[1]` — noise-c returns `[send, recv]` for both roles (module header, lines 22-28). The self-test (AC4) is the deterministic oracle if this is ever crossed.

**`reconnectResendFrames?: Uint8Array[]` (new `FakeDaemonOptions` field).** The ordered list of **plaintext** envelopes the daemon seals (under the new send cipher) and streams immediately after the reconnect handshake's `hello_ack`. Default `[]`. Modal-agnostic: the modal e2e passes `[modalShownEnvelope]` (variant 1) or `[]` (variant 2); a queue e2e would pass a `queue_state` envelope. This mirrors `rekeyResumeMessage: Uint8Array` (a static override) exactly, generalized to N frames. Streaming after `hello_ack` guarantees the client processes `connected` (→ `reconnected` → clear) **before** the re-sent `modalShown` (→ `shown` → repopulate) — the load-bearing ordering (WS preserves order; the single daemon-event channel delivers in order).

**`pushFrame(plaintext: Uint8Array): void` (new `FakeDaemon` handle method) — AC3.** Seal `plaintext` under the **current** send cipher and stream it as a `noise_msg` (`sendNoise(sendCipher.EncryptWithAd(EMPTY_AD, plaintext))`). No-op unless `state === 'transport'` and `sendCipher !== null`. This is the server-initiated push the e2e uses to raise the initial modal mid-session — the `initiateRekey` seal-and-stream pattern minus the state transition. Modal-agnostic (any envelope). AC3's "push a `modal_shown`" is satisfied by `pushFrame(modalShownEnvelope)`.

**Interface delta:**
```
interface FakeDaemonOptions {
  // …existing…
  reconnectResendFrames?: Uint8Array[]  // sealed + streamed (new send cipher) after a reconnect handshake; default []
}
interface FakeDaemon {
  // …existing staticPublicKey / whenSettled / initiateRekey / close…
  pushFrame(plaintext: Uint8Array): void  // seal under the current send cipher + stream (AC3); no-op unless in transport
}
```

**Module-header update (security-review-relevant).** The current header states "the inner `type` is NOT branched on." That is now narrowed: the inner `type` **is** consulted for **routing only** (`noise_init` in `transport` state → a fresh responder handshake), which is faithful to the driver's documented contract (`noiseRelayDriver.ts:189`). Transport-frame *interpretation* still relies solely on the Noise state machine + AEAD — a hostile `type` cannot misroute a transport frame, and a hostile `noise_init` triggers only a fresh-handshake attempt that **fails closed** (`handshake-read-failed`), never a downgrade or a transport bypass. Revise the header to say exactly this (see Security review below).

### 3. Reconnect e2e (`daemonConnection.roundtrip.test.ts`) — AC4, AC5

**Reuse `standUpRoundTrip`** with three minimal, backward-compatible extensions (existing callers unaffected):

1. Return the `forwarder` handle in `RoundTripContext` (so the test can call `dropClientLeg()`).
2. Add an optional `onDaemonEvent?: (e: DaemonEvent) => void` param, invoked inside the `sink.webContents.send` alongside the existing `events.push` + `waiter.notify`. This is the seam that feeds the renderer modal bridge live, in arrival order.
3. Thread `reconnectResendFrames` through `daemonOpts` (already spread into `startFakeDaemon`).

**Wire the #415 renderer code into the sink path** (the reconcile lives in the renderer reducer, so the DaemonEvent sink alone is insufficient — Technical Notes). The test builds a tiny synchronous emitter and runs the **real** `subscribeModal` (from `modalBridge.ts`) into the **real** `reduceModal` (from `modalPrompts.ts`):

- A `Set<listener>` + `onDaemonEvent = (l) => { add; return () => delete }` shaped to `subscribeModal`'s contract.
- `let modalState = initialModalState; subscribeModal(onDaemonEvent, (me) => { modalState = reduceModal(modalState, me) })`.
- Pass `(e) => listeners.forEach((l) => l(e))` as `standUpRoundTrip`'s `onDaemonEvent` hook, so every DaemonEvent flows `sink → subscribeModal → translateModalEvent → reduceModal`.
- Assert against `selectOutstanding(modalState)`.

(Using `subscribeModal` most literally places "the real modalBridge + modalPrompts in the sink consumer path." Directly calling `translateModalEvent` + `reduceModal` in the hook is an acceptable simpler equivalent — both exercise the #415 choke points.)

**Crafted modal frame.** A well-formed `modal_shown` envelope built with the production `encodeEnvelope`, payload per `ModalShownPayload` (`modal_id`, `class: 'permission' | 'trust'`, `title`, `prompt`, `options: [{id,label}]`, `default_option_id ∈ options[].id`), and the file's `FIXED_TS`. The same `modal_id` is reused for the initial push and the reconnect re-send (variant 1) so the reducer's `shown` idempotency is under test.

**Data flow (variant 1 — still-held modal re-pushed):**

1. `standUpRoundTrip(reconnectResendFrames: [modalFrame])` → wait `connected`. (First `connected` → `reconnected` fires on empty `outstanding` — AC4 no-op.) Assert `outstanding == []`.
2. `daemon.pushFrame(modalFrame)` → wait `modalShown` → assert `outstanding == [expectedPrompt]` (present once, options + defaultOptionId intact).
3. `forwarder.dropClientLeg()` → the supervisor auto-reconnects, re-dials `/v1/client`, forwarder re-splices, client sends fresh `noise_init` → daemon `handleReconnect` → `hello_ack` (msg2) → **then** the re-sent `modalFrame`.
4. Wait for the **second** `connected` **and** the re-delivered `modalShown`. Assert `outstanding == [expectedPrompt]` — **exactly one** prompt, same `modalId` (proves clear-then-repopulate, no duplicate). Assert the reconnect ack equals the initial ack.

**Data flow (variant 2 — resolved-while-away, not re-pushed):**

1–3 as above but `standUpRoundTrip(reconnectResendFrames: [])`. After the drop + re-handshake, the daemon streams `hello_ack` and **nothing else**.
4. Wait for the second `connected`. Assert `outstanding == []` (the `reconnected` clear stands; the modal is gone). No `modalShown` arrives after the reconnect.

**Ordering assertion (both variants).** In `events`, the reconnect's `connected` precedes any post-reconnect `modalShown`. This pins the reset-before-repopulate order the reconcile depends on.

**AC5 (modal-agnostic).** The forwarder (`dropClientLeg` + leg-null-on-close) and the daemon (`handleReconnect` + `reconnectResendFrames` + `pushFrame`) contain **zero** modal references. Only the e2e crafts modal frames and wires the modal bridge. A `#197` queue-reconnect e2e reuses `standUpRoundTrip` + `dropClientLeg` + `reconnectResendFrames` unchanged, swapping the crafted frame and the asserted store.

## State + concurrency model

- **Forwarder legs** are single-writer per socket-event turn (`connection`/`message`/`close` handlers run to completion). The `close`-nulls-leg + identity-guard makes re-splice race-free: a stale old-socket close cannot clobber a new leg. No shared mutable state crosses a re-splice beyond the two leg slots.
- **Daemon ciphers** follow the existing atomic-swap invariant: `handleReconnect` installs both new ciphers before freeing either old one, with nothing fallible between (the `handleRekeyInit` discipline). `state` is set before `sendNoise` (re-entrancy discipline, mirroring the session). No `await` between a cipher read and its write.
- **Ordering** is the load-bearing property: over one WS, `hello_ack` then `reconnectResendFrames` are sent in sequence; the client processes them in order; the sink delivers `connected` before `modalShown`; the modal bridge dispatches `reconnected` (clear) before `shown` (repopulate). No timing hack, no sleep — the bounded `makeWaiter` gates each step on the observed event.
- **Teardown** is the existing LIFO `cleanups`: `connection.stop()` (quiesce supervisor) → `daemon.close()` (free wasm, terminate leg) → `forwarder.close()`. The mid-test `dropClientLeg()` is orthogonal to teardown; the supervisor's auto-reconnect happens during the test body, then `connection.stop()` quiesces it at the end. No reconnect churn at teardown.

## Error handling

- **Reconnect handshake failure** (malformed/wrong-suite reconnect msg1): `handleReconnect`'s `catch` classifies `handshake-read-failed`, settles `{ ok: false, … }`, and closes — the ciphers are untouched (both still old), the caught object is dropped (no transcript bytes echoed). Same closed-reason discipline as `handleMsg1`/`handleRekeyInit`; **no new `FakeDaemonErrorReason`**.
- **Frame decode** at the leg boundary is unchanged (`frame-decode-failed`).
- **Hostile `noise_init` in `transport`**: routes to `handleReconnect`, which fail-closes on garbage `ReadMessage`. No misroute, no downgrade. (Security review below.)
- **Forwarder** stays log-free and content-blind; `dropClientLeg` on a null leg is a silent no-op.
- **e2e** asserts on event types/counts and `outstanding` (`ModalPrompt` structural equality) — never serialized payloads / secrets, matching the file's existing discipline. Every double is registered in `cleanups` the moment it is created, so a mid-test throw still tears everything down.

## Testing strategy

`npm test` (vitest), unconditional under the in-process fake target (no Go, no network). `npm run typecheck` covers the interface deltas.

**`fakeDaemon.test.ts` — reconnect self-test (AC4).** A primitive-level case mirroring the rekey self-test (335-384), driving the real client initiator (`driveClient`) through the forwarder against the reconnect-capable daemon:

- Complete the initial handshake + one K0 round-trip (baseline).
- `daemon.pushFrame(cannedEnvelope)` → the client receives it as a `message` (proves the server-initiated push path).
- `forwarder.dropClientLeg()` → the primitive driver here does **not** auto-reconnect (it's not the supervisor), so the self-test drives the re-dial explicitly: build a **fresh** `createNoiseSession` on a re-dialled `/v1/client` leg (reusing the same device static + hello), `start()` it → a fresh `noise_init`. Assert the daemon completes the reconnect handshake (`handshake-complete` with the same `hello_ack`) and a post-reconnect round-trip succeeds under the new keys.
- With `reconnectResendFrames: [cannedEnvelope]`, assert the client receives it after the reconnect `hello_ack` (the re-send path).
- Log-free assertion (`vi.spyOn(console)` over `CONSOLE_METHODS`) across the reconnect path — the fake must not leak transcript bytes.
- Keep the existing self-test cases green (the reconnect handshake must be faithful — a lax fake that diverges from the real daemon must fail these).

*(If driving a fresh session in the primitive self-test proves heavier than the value it adds, the minimum AC4 self-test bar is: a `transport`-state `noise_init` drives a genuine responder re-handshake whose ciphers round-trip — assert via the crossed-Split oracle staying green. Prefer the fuller drop→re-dial shape if it fits the turn budget.)*

**`daemonConnection.roundtrip.test.ts` — reconnect e2e (AC4, AC5).** The two variants above, asserting at `ModalState.outstanding` through the real `subscribeModal` + `reduceModal`. Scenarios:

- Variant 1: initial push shows the modal once; after drop + re-handshake + re-send, it surfaces exactly once with the same `modalId` and intact options; reconnect ack equals initial ack; `connected` precedes the re-delivered `modalShown`.
- Variant 2: after drop + re-handshake with no re-send, `outstanding` is empty (resolved-while-away); no `modalShown` follows the reconnect `connected`.
- No `failed` DaemonEvent across either sequence.

All scenarios are bullet-described here; the developer writes the assertions in the file's existing idiom (`findEvent`, `types()` failure messages, `makeWaiter`, `cleanups`).

## Security review

**Verdict:** PASS

Adversarial self-audit per `architect/security-review.md`. The ticket is TEST-ONLY infrastructure under `src/main/transport/` — `fakeDaemon.ts` / `fakeRelayForwarder.ts` are `.ts` doubles whose sole importers are `*.test.ts`, held out of the production graph by their "MUST NEVER be imported into the production graph" module headers and the forwarder's content-blindness import-list invariant. Nothing here enters `src/main/index.ts`, `src/preload`, or `src/renderer`. The categories with real surface are Cryptographic primitives, Trust boundaries, Concurrency, and Threat-model alignment; the rest are not applicable by design.

**Findings:**

- **[Trust boundaries]** No MUST/SHOULD findings — the one untrusted→trusted boundary is the daemon's `onMessage` (single choke point). This ticket adds exactly one routing branch (`transport` + inner `noise_init` → `handleReconnect`) and one server-initiated seal (`pushFrame`). `handleReconnect` treats `raw` as untrusted and validates it via the real `ReadMessage` (MAC-checked); the forwarder boundary stays opaque bytes (no parse). Downstream holds only post-handshake ciphers.
- **[Cryptographic primitives — key/nonce reuse, the load-bearing check]** No findings. The reconnect derives **entirely fresh** session ciphers from a fresh `Split()` (fresh ephemerals → fresh DH), then atomically installs them and frees the old ones. The nonce counters reset to zero **under a new key** — this is Noise rehandshake, not the catastrophic reset-nonce-without-rekey case (the design never does the latter). The responder **static** is reused across the reconnect, which is correct IK behaviour (the static is the long-term pinned identity; ephemerals are per-handshake). Split role-mapping stays `[send, recv]` (no swap); the crossed-Split self-test oracle (AC4) pins it. `NOISE_PROTOCOL` + production `codec` + real Noise flow — no hand-rolled crypto.
- **[Cryptographic primitives — faithfulness]** No findings — `handleReconnect` is `handleMsg1`'s hello-recovery/validation + `handleRekeyInit`'s atomic swap, both cited precedents. A lax fake that skipped hello validation or crossed the Split mapping fails the AC4 self-test round-trip / crossed-Split oracle. The `catch` classifies `handshake-read-failed` with both old ciphers still installed (no torn state).
- **[Threat model — hostile `noise_init` in `transport`]** No MUST finding (fail-closed). A hostile `noise_init` frame routes to `handleReconnect`, which fail-closes on garbage `ReadMessage` (`handshake-read-failed` → settle + close). It cannot misroute a transport frame, bypass AEAD, or downgrade the session — completing a fresh IK handshake requires a genuine exchange against the responder's own static, and a forged msg1 fails the MAC. No new exposure beyond the initial connect: any peer knowing the pinned responder static could already open an IK handshake (the reconnect is the same shape). Test-only infra regardless.
- **[Error messages / logs]** No findings — `handleReconnect`'s `catch` drops the caught object (a library string can echo transcript bytes) and settles a static closed reason; daemon + forwarder stay log-free; the AC4 self-test asserts zero `console.*` across the reconnect path; the e2e asserts on event types/counts + `ModalPrompt` structure, never serialized payloads. Crafted frames carry synthetic display text + a synthetic nonce (no real credential).
- **[Concurrency]** No findings — the leg re-splice is identity-guarded (`clientLeg === socket`), so a late old-socket close cannot clobber a freshly re-spliced leg; at most one client leg exists at a time (the guard + the existing "terminate if slot filled"). The cipher swap installs both new before freeing both old, nothing fallible between (mirrors `handleRekeyInit`). `state` is set before `sendNoise` (re-entrancy). Teardown LIFO quiesces the supervisor via `connection.stop()`; the mid-test drop's reconnect is orthogonal.
- **[Network & I/O]** No findings — the daemon dials with the existing `{ maxPayload: MAX_FRAME_BYTES }` cap (unchanged); `dropClientLeg` + re-splice reuse existing sockets (no unbounded allocation); `reconnectResendFrames` is a fixed, bounded, test-supplied list; loopback `ws` test infra adds no relay-URL / TLS surface. Bounded `makeWaiter` gates every step (no hang).
- **[Module-header faithfulness]** **SHOULD FIX (does not gate).** The current `fakeDaemon.ts` header asserts "the inner `type` is NOT branched on." This ticket narrows that to "consulted for routing only." The developer MUST update the header to state the narrowed invariant (routing on `noise_init`; transport *interpretation* still relies solely on the Noise state machine + AEAD; a hostile `noise_init` fail-closes). A stale header would leave a misleading security claim in place. Called out as a Design requirement above; code-review must confirm the header was updated.
- **[Tokens/secrets]** Not applicable — no real credential handled; synthetic-only, matching the existing `DUMMY_TOKEN` discipline.
- **[File / storage]** Not applicable — no filesystem or disk path touched; in-memory sockets + wasm cipher state only.
- **[Inter-process / Electron attack surface]** Not applicable — no `BrowserWindow`, IPC channel, `contextBridge` API, or custom-protocol handler added; the e2e's `sink` is a fake `webContents.send` stub, and the "renderer" side is the real `modalBridge` / `modalPrompts` pure functions run in-process with no privilege.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-14

## Open questions

- **"Answerable" (AC4).** Interpreted as: the re-surfaced prompt is a well-formed `ModalPrompt` present in `outstanding` exactly once with its `options` + `defaultOptionId` intact (the precondition the render/answer slice needs). The primary assertion is the outstanding-state check, **not** a full answer round-trip — driving `connection.answerModal` would require the fake daemon to handle an inbound `modal_answer` and reply `modal_dismissed`, which adds modal-specific daemon surface and would violate AC5's modal-agnostic mandate. The answer command path is already covered by #236/#237. If reviewers want a concrete answer round-trip, it belongs in a separate ticket with a modal-aware daemon variant, not here. **Recommendation: keep the outstanding-state assertion.**
- **Self-test fresh-session drive (AC4).** The primitive `fakeDaemon.test.ts` reconnect case must re-dial and drive a fresh `noise_init` itself (no supervisor). If threading a second `createNoiseSession` through `driveClient` is awkward, the fallback minimum (a `transport`-state `noise_init` round-tripping under fresh ciphers) still satisfies AC4's "the fake-daemon self-test gains a reconnect case." The developer picks based on the turn budget; the fuller shape is preferred.
- **Forwarder targeted test.** AC1's re-splice is covered implicitly by the e2e. A small dedicated forwarder test (drop → re-dial → forward) would localise a regression but is optional — flagged, not required.
