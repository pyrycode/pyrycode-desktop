# #524 — fakeDaemon: route the rekey window by inner frame type, not by session state

**Size:** S (PO's `size:s` confirmed — the production change is one line, but the deliverable is a
gated interleave harness plus a `driveClient` fidelity fix that is load-bearing for AC1.)
**Files:** `src/main/transport/fakeDaemon.ts` (1 production file), `src/main/transport/fakeDaemon.test.ts`.

## Design source

N/A — test-only transport infrastructure (`src/main/transport/fakeDaemon.ts` never enters the
production graph). No UI surface, so no Figma anchor applies.

## Files to read first

- `src/main/transport/fakeDaemon.ts:390-414` — `onMessage`, the routing site. The whole production
  change is one added conjunct on the `awaiting-rekey-init` branch at `:411`.
- `src/main/transport/fakeDaemon.ts:369-388` — `handleTransport`. Confirm for yourself that it never
  assigns `state` and seals via the `send` captured from `sendCipher` at entry (`:371`). Both facts
  are why the routing change needs no state handling and no re-seal logic.
- `src/main/transport/fakeDaemon.ts:265-282` — `initiateRekey`. Note it sets `state` **synchronously**
  before `sendNoise`, and that its `rekey_request` consumes send-cipher nonce 0. Both matter for the
  test's ordering argument.
- `src/main/transport/fakeDaemon.ts:207-216` — `settle`'s first-wins latch. The reason the new tests
  must **not** do a baseline round-trip first.
- `src/main/transport/fakeDaemon.ts:14-34` and `:390-396` — the two comment blocks that carry the
  routing rationale and its security argument. Both must move with the behaviour.
- `src/main/transport/fakeDaemon.test.ts:148-230` — `driveClient`. **This is where the non-obvious
  work is.** Line 219 tags only the *first* outbound frame `noise_init`; every later frame, including
  the client's in-session rekey msg1, is tagged `noise_msg`. See § "The `driveClient` fidelity fix".
- `src/main/transport/fakeDaemon.test.ts:346-420` — the two existing rekey tests. Their bodies must
  not change; they are AC1's regression surface.
- `src/main/transport/fakeDaemon.test.ts:103-128` — `makeWaiter`, the bounded-wait idiom every test
  in this file uses. Reuse it; do not add timers.
- `src/main/transport/fakeDaemon.test.ts:541-563` — the raw-`connect()` byte-level test. Read it for
  the shape, then note that AC4 **cannot** use it (see § Testing strategy, AC4).
- `src/main/transport/noiseRelayDriver.ts:188-211` — the production `firstFrame` / `rekeyInitPending`
  double latch. This is the exact behaviour `driveClient` must mirror.
- `src/main/transport/noiseSession.ts:196-232` — `beginRekey`: the session emits `rekey-requested`
  and then **synchronously** hands msg1 to `sendFrame` inside the same `onFrame` turn. That is what
  makes a latch armed in `onEvent` land on exactly the right frame.
- `src/main/transport/noiseSession.ts:256-268` — the `awaiting-rekey-reply` arm. It consumes the next
  inbound frame as its handshake reply. This is #507's bug and the reason the interleaved reply must
  never be delivered to the client in this ticket.
- `src/main/daemonConnection.roundtrip.test.ts:320-357` — the third `initiateRekey` call site. It
  drives the real `noiseRelayDriver`, so it already tags `noise_init` correctly and needs no change.

## Context

`onMessage` currently routes on session **state** alone while in `awaiting-rekey-init`
(`fakeDaemon.ts:411`): every inbound frame goes to `handleRekeyInit` → `fresh.ReadMessage` → throw →
`settle({ ok: false, reason: 'handshake-read-failed' })` → leg closed. The real daemon dispatches on
the inner frame **type** (`pyrycode` `internal/relay/v2session.go:664-669`) and keeps serving
transport frames under the old `CipherState`s throughout its awaiting-reply window (spec #450).

The consequence is a testing gap: the realistic interleaved-frame rekey collision cannot be
reproduced against the fake at all, so #507 (the client-side desync fix) has no harness to test
against. This ticket closes that gap and nothing else.

## Design

### 1. The production change — one conjunct

`onMessage` (`fakeDaemon.ts:397-414`). The dispatch chain becomes:

```ts
if (state === 'awaiting-msg1') handleMsg1(raw)
else if (state === 'awaiting-rekey-init' && innerType === 'noise_init') handleRekeyInit(raw)
else if (innerType === 'noise_init') handleReconnect(raw)
else handleTransport(raw)
```

Only `&& innerType === 'noise_init'` is added. Walk the four reachable cases:

| state | innerType | routes to | why |
|---|---|---|---|
| `awaiting-rekey-init` | `noise_init` | `handleRekeyInit` | unchanged — AC1 |
| `awaiting-rekey-init` | anything else | `handleTransport` | falls through arm 3 (its guard is false) — AC2 |
| `transport` | `noise_init` | `handleReconnect` | unchanged (#416) |
| `transport` | anything else | `handleTransport` | unchanged |

Three constraints on the implementation, all of which the existing code already satisfies:

- **Do not touch the `awaiting-msg1` arm.** The initial-handshake window is out of scope; no AC
  covers it and other harnesses (`fakeRelayForwarder.test.ts`) reach it.
- **Do not add a `state` re-assignment.** `handleTransport` never assigns `state`, so
  `awaiting-rekey-init` survives a served frame for free. Adding one would break AC3.
- **Do not touch `handleTransport`.** It already captures `send = sendCipher` at entry (`:371`) and
  seals every reply with it, which *is* the pre-swap old-cipher behaviour spec #450 requires.

### 2. The `driveClient` fidelity fix — required, not optional

`driveClient`'s `sendFrame` (`fakeDaemon.test.ts:216-222`) tags a frame `noise_init` only when
`firstOut` is true. The client's in-session rekey msg1 is therefore tagged **`noise_msg`** today.
That is invisible under state-based routing and **fatal under type-based routing**: after the change,
the rekey msg1 would fall to `handleTransport`, fail AEAD, settle `transport-decrypt-failed`, and
never complete the swap — breaking both existing rekey tests (`:346`, `:397`).

Mirror the production driver's second latch (`noiseRelayDriver.ts:196-211`):

- Add a one-shot `rekeyInitPending` boolean alongside `firstOut`.
- Arm it in `driveClient`'s `onEvent` when the event is `rekey-requested`, before pushing to `events`.
  The session hands msg1 to `sendFrame` synchronously within the same `onFrame` turn
  (`noiseSession.ts:225-229`), so the latch lands on exactly that one frame.
- In `sendFrame`, tag `noise_init` when `firstOut || rekeyInitPending`, then clear both.

The existing test **bodies** stay byte-for-byte unchanged; only the shared harness gains the latch.
This is what makes the ticket's claim true — the two rekey tests then pass because the client tagged
its msg1 the way the real driver does, not because the fake ignored the tag.

`daemonConnection.roundtrip.test.ts:343` drives the real `noiseRelayDriver` and already tags
correctly; it needs no change.

### 3. The interleave harness — an inbound gate on `driveClient`

The ordering problem: `initiateRekey()` streams `rekey_request`, the client recognises it and sends
its rekey msg1 **synchronously** in the same turn. Racing an app frame against that is
timing-dependent. Solution (the ticket's own suggestion): **withhold the `rekey_request` from the
initiator**. The client stays in `transport`, so `sendMessage` is not dropped by the session's state
guard (`noiseSession.ts:311`), while the daemon is already in `awaiting-rekey-init` —
`initiateRekey` assigns `state` synchronously before it sends (`fakeDaemon.ts:280-281`), so there is
no window in which the app frame can arrive too early. The ordering is exact, with no second Noise
initiator and no timers.

Extend `driveClient` with, roughly:

- `holdInbound(): void` — arm the gate.
- `held: Uint8Array[]` — raw InnerFrameV2 frames captured while armed, in arrival order.
- `release(i: number): void` — feed `held[i]` through the existing decode + `initiator.onFrame` path.
- `sendRaw(raw: Uint8Array): void` — frame `raw` as a `noise_msg` InnerFrameV2 and push it through
  `activeRelay.send`. Needed only by AC4.

The gate lives at the one existing site: the `e.type === 'message'` arm of the relay `onEvent`
(`:193-199`). When armed, push `e.frame` to `held` and `waiter.notify()` instead of calling
`initiator.onFrame`. Default is disarmed, so every existing test is unaffected.

Hold the **raw frame bytes**, not the decoded Noise payload — the tests need to inspect the
InnerFrameV2 `type` and the sealed length.

### 4. What cannot be asserted here, and why

The interleaved reply's **plaintext is not verifiable through the client**, and the spec deliberately
does not ask for it. Noise recv nonces are per-direction counters: `rekey_request` burns the daemon's
K0 send nonce 0 and the interleaved reply is nonce 1, so the client can only decrypt the reply after
consuming the `rekey_request` — at which point it is in `awaiting-rekey-reply` and eats the next
inbound frame as its handshake reply (`noiseSession.ts:256-268`). That is exactly #507's bug, and
per the ticket's scope boundary it must not be wired in here.

So the interleaved reply is captured and **never released to the client**. It is asserted
structurally (§ Testing strategy, AC2), and the daemon's `{ ok: true }` settle carries the real
weight: that value is reachable from exactly one line — `handleTransport:387` — and only after
`recvCipher.DecryptWithAd` succeeded and the replies were sealed and streamed.

## State + concurrency model

No production state machine changes. `DaemonState` keeps its four members; `awaiting-rekey-init`
gains one more legal inbound (a non-`noise_init` frame) that leaves the state untouched.

Test-side concurrency stays inside this file's existing idiom: `makeWaiter()` bounded waits, the
`cleanups` array for teardown. No new timers, no `AbortController`, no polling loops.

## Error handling

| Inbound in `awaiting-rekey-init` | Outcome | Leg |
|---|---|---|
| valid `noise_init` | fresh responder handshake, atomic swap, msg2 + resume under new send cipher | open |
| malformed `noise_init` | `handshake-read-failed`, both old ciphers intact | closed (`handleRekeyInit`'s catch) |
| non-`noise_init`, decrypts | served; reply under the current send cipher; state held | open |
| non-`noise_init`, does not decrypt | `transport-decrypt-failed`, **no reply** | **open** — `handleTransport`'s catch `return`s |

The fail-closed posture is preserved and narrowed, not widened: the AEAD remains the sole authority
on whether a transport frame is genuine. What changes is only *which* rejection path an
undecryptable frame takes.

## Testing strategy

Two new tests in `src/main/transport/fakeDaemon.test.ts`, in the existing `describe`. Both use the
gate. Neither does a baseline round-trip before `initiateRekey()` — that is the ticket's main trap:
`settle` is first-wins (`:212-216`) and `handleTransport` settles `{ ok: true }` on its first reply
(`:387`), so a baseline round-trip makes every later reason unobservable. `initiateRekey` only
requires `transport` (`:271-272`), and the module note at `:269-270` explicitly blesses rekeying
before the single reply.

### Test A — the interleave (AC2, AC3, AC5)

Stand up with a `buildReply` returning a distinctive canned envelope. Then:

- Drive the client to `handshake-complete`. No round-trip.
- Arm the gate; `daemon.initiateRekey()`; wait for `held.length >= 1` (the withheld `rekey_request`).
  The client is still in `transport`; the daemon is already in `awaiting-rekey-init`.
- `initiator.sendMessage(probe)` — the interleaved old-cipher app frame.
- Wait for `held.length >= 2`, then assert:
  - **`await daemon.whenSettled()` equals `{ ok: true }`.** This is the must-fail-first assertion:
    today the frame reaches `handleRekeyInit`, `ReadMessage` throws, and the run settles
    `{ ok: false, reason: 'handshake-read-failed' }`. Reachable only from `handleTransport:387`.
  - `decodeInnerFrame(held[1])` has `type === 'noise_msg'`, and its base64-decoded payload length is
    `canned.length + 16` — the ChaChaPoly tag over the canned reply. This distinguishes a served
    reply from a handshake msg2 or an empty frame. (Choose a canned envelope long enough that the
    length is unambiguous.)
- Release `held[0]` (the `rekey_request`) and assert the swap still completes:
  - exactly one `rekey-requested` event;
  - a `message` event byte-equal to `DEFAULT_REKEY_RESUME_MESSAGE`, i.e. the post-swap resume frame
    decrypted under the client's **new** recv cipher;
  - no client `error` event.

  This is AC3's assertion *and* the oracle for "the daemon stayed in `awaiting-rekey-init`": had a
  buggy fix reset the state to `transport`, the client's `noise_init` would route to
  `handleReconnect`, whose `decodeEnvelope` over the rekey's **empty** early-data throws
  (`fakeDaemon.ts:336-337`) → `handshake-read-failed` + close → no resume frame, no swap. The
  assertion cannot pass without the state being held.

- Never release `held[1]`; add a one-line comment saying why (§ 4 above, #507).

### Test B — the undecryptable frame (AC4)

- Same setup and gate; drive to `handshake-complete`, no round-trip.
- Arm the gate, `initiateRekey()`, wait for `held.length >= 1`.
- `sendRaw(new Uint8Array(48).fill(0x33))` — garbage tagged `noise_msg`.
- Assert `await daemon.whenSettled()` equals `{ ok: false, reason: 'transport-decrypt-failed' }`.
  Must-fail-first: today the reason is `handshake-read-failed`.
- Assert no reply: after a short bounded wait, `held.length` is still 1. The positive control for
  this negative assertion is Test A, which uses the identical gate and does capture a reply frame —
  say so in a comment so the assertion does not read as vacuous.
- Do **not** assert a close. Per the ticket, `handleTransport`'s catch returns rather than closing.

AC4 cannot use the raw `connect()` harness at `:60`/`:553`: that leg never completes a handshake, so
`initiateRekey` no-ops on its `state !== 'transport'` guard. Hence `sendRaw` on the real driven leg.

### AC1 — regression

Verified by the two existing rekey tests (`:346`, `:397`) and `daemonConnection.roundtrip.test.ts:343`
staying green with unchanged bodies, plus `npm run typecheck` and `npm run build`.

### Log-free discipline

Both new tests exercise the changed routing arm. Wrap at least Test A in the file's
`CONSOLE_METHODS` spy idiom (`:425`, `:519`, `:542`) and assert no console output — the new arm is a
new path through the untrusted→trusted boundary and must stay log-free like every other.

## Comment updates (part of the deliverable)

- `fakeDaemon.ts:14-34` — the rekey-INITIATOR paragraph and the ROUTING-ONLY paragraph. State that
  in `awaiting-rekey-init` the inner `type` selects the path: `noise_init` → fresh responder
  handshake + atomic swap; anything else → `handleTransport` under the **old** ciphers, faithful to
  `v2session.go:664-669` and spec #450's "transport frames continue flowing under the OLD
  `CipherState`s". Keep the existing fail-closed argument and extend it: an undecryptable frame in
  that window now fails via `transport-decrypt-failed` instead of `handshake-read-failed`; the AEAD
  is still the sole authority, so a hostile inner type cannot bypass the handshake or force a
  downgrade.
- `fakeDaemon.ts:390-396` — the `onMessage` comment, same argument in short form.
- `fakeDaemon.ts:149-151` — one clause on `initiateRekey`'s JSDoc noting the window keeps serving
  transport frames under the current ciphers.

Do not restate the argument in a fourth place.

## Open questions

- **`pushFrame` in the rekey window** (`fakeDaemon.ts:419-422` no-ops unless `state === 'transport'`).
  Deliberately out of scope here — a served reply produces the same interleaved old-cipher frame on
  the wire. #507's architect should confirm that route suffices before assuming the fake can stage a
  daemon→client interleave directly. Flagged upstream by PO already; not fixed here.
- **The gate's shape is the developer's call** within the contract in § 3. If a single
  `holdInbound()` / `release(i)` pair reads worse than a `gate: { arm, held, release }` object, take
  the clearer one — the tests are the contract, not the field names.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The untrusted→trusted boundary is unchanged and still a single
  function: `onMessage` (`fakeDaemon.ts:397-414`), which decodes the InnerFrameV2 and fails closed to
  `frame-decode-failed` before any routing decision is made. The change moves one *routing* decision
  from `state` to `innerType`; it moves no *interpretation* decision. Every downstream handler still
  derives trust solely from the Noise state machine and the AEAD — `handleRekeyInit` from
  `ReadMessage`, `handleTransport` from `DecryptWithAd`. A hostile `innerType` selects a path but
  cannot make either handler accept bytes it would otherwise reject.
- **[Cryptographic primitives]** No findings, and one property worth naming: the change cannot cause
  **key or nonce reuse**. `handleTransport` seals with the `send` captured at entry (`:371`) and the
  swap happens only inside `handleRekeyInit` (`:298-309`), so a frame served during the window
  consumes the *next* old-key nonce and can never re-issue a nonce under either cipher. No primitive
  is added, none is re-implemented; `NOISE_PROTOCOL` and the noise-c.wasm Split mapping are untouched.
- **[Fail-closed posture]** No findings. The change relaxes *which* rejection path an undecryptable
  frame takes (`transport-decrypt-failed` rather than `handshake-read-failed`), not *whether* it is
  rejected. The one behavioural relaxation is that the leg now survives that rejection — matching the
  real daemon, and matching the pre-existing `transport`-state behaviour of the same handler. AC4
  pins it.
- **[Downgrade / handshake bypass]** No findings. The widened arm routes *away* from the handshake,
  never toward it: a frame can now reach `handleTransport` where it previously reached
  `handleRekeyInit`. There is no new way to reach a handshake path, so a hostile peer cannot use the
  inner type to force a fresh handshake, re-run a completed one, or replace the responder static
  (`staticPriv` is captured once at `:175` and reused by every handshake path).
- **[Error messages, logs, telemetry]** No findings. `FakeDaemonErrorReason` gains no member; the two
  reachable reasons are existing static strings. Every catch still drops the caught object. The
  module stays log-free, and Test A asserts it under the file's `CONSOLE_METHODS` spies.
- **[Tokens, secrets, credentials]** No findings. No token, key, or credential is read, stored, or
  logged. The test harness continues to use `buildTestHello`'s synthetic dummy token
  (`fakeDaemon.test.ts:131-139`) and freshly generated in-process keypairs; no `PYRY_LIVE_*` value is
  reachable from either new test.
- **[Electron attack surface / process placement]** No findings, and the ticket's central safety
  property is unchanged: `fakeDaemon.ts` is TEST-ONLY and must never enter the production graph
  (`:44-46`). Its importers stay `*.test.ts` plus the `e2e/` fixtures; this change adds no importer
  and no export, so the module boundary is not widened. Nothing crosses `contextBridge`; no window,
  no IPC channel, no renderer surface is touched.
- **[Network & I/O]** No findings. The `maxPayload: MAX_FRAME_BYTES` cap on the daemon leg (`:442`)
  and the loopback `ws://` dialer are untouched. `sendRaw` sends a 48-byte fixed frame on the
  already-open test leg; it opens no socket and takes no URL.
- **[Concurrency]** No findings. No async task, timer, or listener is added on the production side.
  The test gate is a synchronous array append inside an existing handler, drained through the file's
  `makeWaiter` bounded waits and torn down by the existing `cleanups` array — no unbounded queue and
  no work outliving the test.
- **[Threat model alignment — hostile relay]** No findings. A relay that reorders or injects frames
  into the rekey window now gets its injected frame AEAD-checked (`transport-decrypt-failed`, leg
  survives) instead of handshake-checked (`handshake-read-failed`, leg closed). Strictly closer to
  the real daemon, and the injected frame still cannot be served: only a frame sealed under the live
  send cipher opens.
- **[Threat model alignment — client-side desync]** OUT OF SCOPE, by the ticket's explicit boundary.
  A client in `awaiting-rekey-reply` consumes the next inbound frame as its handshake reply
  (`noiseSession.ts:256-268`), so an interleaved old-cipher frame desyncs it. That is **#507**, which
  this ticket unblocks. The spec's §4 requires the interleaved reply be captured and never delivered
  precisely so this ticket neither depends on nor pre-empts that fix. Not a regression: the desync
  exists against the real daemon today; #524 only makes it reproducible.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
