# Spec: Pin the close-during-handshake safety invariant with regression tests (#33)

Mirror of mobile #497, but only the **invariant**, not the fix. Mobile added a synchronization
primitive to defend a Kotlin coroutine/thread race. Desktop's session is single-threaded with
synchronous wasm crypto, so that race cannot occur here — porting the mutex would defend a non-race
(pipeline: *Evidence-Based Fix Selection*). What carries over is the safety property, and it is
worth locking down with **test-only, zero-production-change** regression coverage because this is
security-sensitive wasm code: freed `noise-c.wasm` pointers must never be re-entered.

## Files to read first

- `src/main/transport/noiseSession.ts:99-183` — the code under test: `freeAll`, `start`, `onFrame`,
  `sendMessage`, `close`. Read every guard. The four tests exercise exactly these short-circuits:
  `state === 'closed'` (top of `onFrame`, top of `close`), `state !== 'idle' || hs === null`
  (`start`), `state !== 'transport' || sendCipher === null` (`sendMessage`), and `freeAll`'s
  per-object guarded `obj?.free()` + null-out.
- `src/main/transport/noiseSession.test.ts:126-150` — the `collector<E>()` helper and the
  `handles` / `afterEach` teardown convention. Both new-test scenarios reuse these verbatim.
- `src/main/transport/noiseSession.test.ts:131-133` — `initErrors(events)`; used to assert a
  specific error reason is **absent** after close (the distinguishing signal — see Design).
- `src/main/transport/noiseSession.test.ts:225-259` — the `pair()` helper (auto-wired
  initiator↔responder). AC3 reuses it as-is: `initiator.start()` drives the whole handshake to
  completion synchronously, then the test closes and probes.
- `src/main/transport/noiseSession.test.ts:296-315` — the `loneInitiator(sendFrame)` helper. AC1
  and AC2 reuse it with a **capturing** `sendFrame` (push into an array) so the test can assert
  "no frame emitted".
- `src/main/transport/noiseSession.test.ts:371-382` — the EXISTING
  `close() is idempotent and leaves start()/onFrame/sendMessage inert` test. The new block
  deliberately overlaps this (see Design → "Relationship to the existing test"). **Do not modify,
  move, or delete it** (don't-touch-adjacent).
- `CLAUDE.md` — test-first; sealed event shapes; transport-out-of-the-window; `npm test` (vitest)
  is the test gate, `npm run build` the salvage/QA gate.

## Context

The problem this pins: `createNoiseSession` holds three wasm objects (`hs`, `sendCipher`,
`recvCipher`). `close()` synchronously sets `state='closed'` and calls `freeAll()`, which frees each
(guarded, idempotent) and **nulls the reference**. Every entry point (`start` / `onFrame` /
`sendMessage`) already no-ops once `state==='closed'` (or its handle is `null`). Because there is
**no `await` inside any entry point**, `close()` cannot interrupt a `WriteMessage` / `ReadMessage` /
`Split` / `Encrypt` / `Decrypt` mid-flight in one event-loop turn.

Today the structure is safe. The hazard is a *future* refactor that slips an `await` into an entry
point: the entry point would then be interruptible by a concurrent `close()` that frees the wasm
state, and the resumed continuation would call into a freed pointer — a use-after-free. This ticket
pins the mechanism that keeps that safe today: the post-`close()` short-circuit guards in each entry
point. See "Coverage boundary" below for exactly what the tests do and do not catch — the honest
claim is narrower than "catches any await-slip", and the spec must not overstate it.

Why now: the close-during-handshake half of the original #33 (mobile #497 parity). The
rekey-recovery half is carved out to #76 (its base mechanism — an in-session rekey responder — is
entirely unbuilt on desktop, so it cannot be hardened here).

## Design

**Zero production changes.** The production guards already enforce the invariant. This spec adds one
new `describe` block to `src/main/transport/noiseSession.test.ts` and touches nothing else. If any
new test is red, that exposes a real use-after-free to fix — but the expected outcome is **no
production diff** (AC5).

### The distinguishing signal (why arbitrary frames suffice)

Each test must prove the difference between "close short-circuited the entry point" and "close was a
no-op". The sharp signal is **the specific effect the pre-close path would have produced, and the
post-close path must not**:

| Scenario | If close were a no-op, the entry point would… | Post-close it must instead… |
|---|---|---|
| `start()` before send (idle) | write msg 1 → emit a frame to `sendFrame` | emit no frame, no event |
| `onFrame()` in `awaiting-handshake-reply` | `hs.ReadMessage(frame)` → on bad MAC, `fail('handshake-read-failed')` | emit no event (no `handshake-read-failed`) |
| `onFrame()` in `transport` | `recvCipher.DecryptWithAd(frame)` → on garbage, `fail('transport-decrypt-failed')` | emit no event (no `transport-decrypt-failed`) |
| `sendMessage()` in `transport` | seal plaintext → emit a frame to `sendFrame` | emit no frame |

So an **arbitrary (garbage) frame is enough**: the pre-close path on that same garbage produces a
*specific, observable* error event (or a frame); the post-close path must produce neither. The
assertion pair is therefore `{ no new event / no new frame } ∧ { does not throw }`.

**Why a valid frame is NOT needed (and would add no coverage).** `freeAll()` sets `hs = null`,
`sendCipher = null`, `recvCipher = null`. So *any* post-close entry into the crypto path — valid
input or garbage — would manifest identically: a null-deref `TypeError` (e.g. `hs.ReadMessage` on
`null`), caught by `expect(...).not.toThrow()`. Feeding a well-formed message 2 would not
distinguish a "silent success on freed state" from the null-deref case, because the reference is
nulled, not dangling. The scarier "reused freed pointer returns valid data" form cannot occur here
for the same reason. Garbage input + `not.toThrow` is the complete tripwire; a valid-frame variant
is strictly more setup for zero additional regression power. Keep it simple (pipeline: *Simplicity
First*).

### Relationship to the existing test

`noiseSession.test.ts:371-382` already asserts double-close idempotency and inert
`start`/`onFrame`/`sendMessage` after a `start()`-then-`close()`. The new block **intentionally
overlaps** it: it is the *named* regression fixture for the mobile #497 invariant, complete across
all four close scenarios with the sharper "specific error absent / no frame emitted" assertions.
A future reader searching for "close during handshake" should find one dedicated, self-describing
block rather than an incidental assertion buried in a general lifecycle test. The overlap is
deliberate, not redundant cleanup — leave the existing test untouched.

### Coverage boundary (be precise — do not overstate)

These tests use the **close-then-call** ordering: `close()` runs to completion, then a *fresh* entry
point is invoked. They **cannot** reproduce a true mid-flight interleaving (`onFrame` starts →
yields at an `await` → `close()` runs → `onFrame` resumes into freed state), because the current
synchronous code has no yield point to interleave at — you cannot write a test that forces an
interleaving the code's synchronicity forbids.

What the tests therefore pin is the **post-close short-circuit guards themselves** — the
`state === 'closed'` / `handle === null` checks that keep every entry point from re-entering freed
wasm. Their regression value: a future refactor that removes or weakens one of those guards (the
common way an async rewrite reintroduces the hazard — the guard is dropped, or the async path
reaches the crypto call before short-circuiting) trips a red test, because a post-close
`onFrame`/`sendMessage` would then reach `null.ReadMessage` / `null.DecryptWithAd` / `null.Encrypt`
and throw, failing the `not.toThrow()` assertions. This is a genuine tripwire on the guards; it is
**not** a proof that a hypothetical async entry point is race-free. Write the test comments to say
this — a maintainer must not read green here as "concurrent close is proven safe."

## State + concurrency model

The whole rationale for "test-only, no synchronization primitive" lives here — the developer must
**not** port mobile #497's mutex/lock.

- `noiseSession.ts` runs in the Electron main process, single-threaded on the event loop.
- All crypto is **synchronous wasm** (`noise-c.wasm`): `WriteMessage`, `ReadMessage`, `Split`,
  `EncryptWithAd`, `DecryptWithAd` all return within one event-loop turn.
- No entry point contains an `await`. `close()` therefore cannot interleave with an in-flight
  entry point in one turn — the interleaving mobile's threaded model allowed is structurally
  impossible here.
- The **only** async surface is the wasm load inside `createNoiseSession` (`await loadNoiseLib()`),
  before any handle exists; a supersede-during-load is already fenced by the driver's generation
  counter (#50). No new async surface is introduced.

Adding a lock here would defend a race the model makes impossible — forbidden make-work under
*Evidence-Based Fix Selection*. The invariant is defended by tests, not by runtime code.

## Error handling

Not applicable to new production surface (there is none). The tests rely on the existing
classify-don't-forward discipline in `noiseSession.ts`: entry points emit only static
`NoiseSessionErrorReason` values, never bytes. The new tests assert on those static reasons
(`initErrors`), and assert **absence** of the reason the pre-close path would have raised. No test
asserts on any message text or byte content, so the log-free / no-leak discipline is preserved (the
existing `security — log-free by construction` test at line 385 continues to cover console output;
the new block adds no console assertions because the close/guard paths emit nothing).

## Testing strategy

Add one `describe` block — `close-during-handshake safety invariant (mobile #497 parity)` — to
`src/main/transport/noiseSession.test.ts`, with four `it` cases. Reuse `loneInitiator`, `pair`,
`collector`, `initErrors`, and the `handles`/`afterEach` teardown already in the file. Write the
test code in the file's existing idiom; the scenarios below are the contract, not the source.

- **AC1 — close before start (idle → closed):** build a `loneInitiator` with a **capturing**
  `sendFrame` (push frames into a `sent: Uint8Array[]`) and a `collector`. Call `close()` first,
  then `start()`. Expect: `start()` does not throw; `sent.length === 0` (no msg 1 emitted);
  `events.length === 0` (no event). Distinguishing: absent the close, `start()` would have pushed
  exactly one frame.

- **AC2 — close while awaiting the handshake reply (after `start()`, before message 2):** build a
  `loneInitiator` with a capturing `sendFrame` and a `collector`. Call `start()` → assert one frame
  captured (msg 1), record `eventsAfterStart = events.length` (0). Call `close()`. Feed one
  arbitrary frame: `onFrame(new Uint8Array(64).fill(0x5a))`. Expect: does not throw; no new frame
  captured; `events.length === eventsAfterStart`; `initErrors(events)` does **not** contain
  `handshake-read-failed`. Distinguishing: absent the close, that garbage frame in
  `awaiting-handshake-reply` would fail the handshake read and emit `handshake-read-failed`.

- **AC3 — close after `handshake-complete` (transport → closed):** use `pair()`; call
  `initiator.start()` to drive the handshake to completion synchronously. Assert `init.events`
  contains `handshake-complete`. Record `initCount = init.events.length` and the responder's
  received-`message` count. Call `initiator.close()`. Then:
  - `initiator.onFrame(new Uint8Array(48).fill(0x17))` — does not throw; `init.events.length ===
    initCount`; `initErrors(init.events)` does **not** contain `transport-decrypt-failed`.
    (Absent the close, that garbage would fail transport decrypt and emit
    `transport-decrypt-failed`.)
  - `initiator.sendMessage(new Uint8Array([1, 2, 3]))` — does not throw; the responder receives no
    new `message` event (its received-`message` count is unchanged). (Absent the close,
    `sendMessage` would seal a frame and the responder would decrypt it.)

- **AC4 — idempotent double-close (no throw, no double-free):** build any session (a `loneInitiator`
  is enough), optionally `start()`, then call `close()` twice. Expect: neither call throws. The
  observable proxy for "no double-free" is no throw — the second `close()` returns at the
  `state === 'closed'` guard before reaching `freeAll()`, and `freeAll()` itself guards each
  `obj?.free()` in try/catch, so a double-free is structurally impossible. (This overlaps line
  371-382 by design; keep both.)

Gates: `npm test` (vitest) must be green; `npm run typecheck` clean; `npm run build` clean (salvage
gate). Expected diff: **the test file only**. If any assertion is red, stop and treat it as a real
use-after-free — but per the analysis above, the current implementation satisfies every guard, so
the expected result is green with zero production change.

## Open questions

None. The invariant, the seams, and the four scenarios are fully determined by the current
implementation. The one judgment call — "arbitrary frames vs. valid frames" — is resolved in
Design (arbitrary suffices and is strictly simpler because `freeAll` nulls the references).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new finding — the spec adds no production code and no new boundary. It
  *exercises* the relay-frame → `onFrame` boundary (untrusted inbound frame, here a garbage
  `Uint8Array`) and hardens its teardown guarantee: after `close()`, an untrusted inbound frame is
  dropped without touching freed crypto state. Strengthens, never weakens, the boundary at
  `src/main/transport/noiseSession.ts:135-169`.
- **[Tokens / secrets]** No finding — no token is created, stored, or logged. The only
  token-shaped value is the pre-existing `HELLO.token = 'dummy-device-token-not-a-real-credential'`
  fixture (`noiseSession.test.ts:37`); the new tests feed garbage frames and empty plaintexts and
  touch no credential.
- **[File / storage]** No finding — the new block does zero I/O (no `fs`, no disk paths). All
  fakes are in-memory arrays.
- **[Electron attack surface]** No finding — no IPC, no `BrowserWindow`, no protocol handler, no
  renderer surface. Pure main-process unit tests.
- **[Cryptographic primitives]** No finding — the `Noise_IK_25519_ChaChaPoly_BLAKE2s` suite from
  vetted `noise-c.wasm` is unchanged; no hand-rolled crypto is introduced. No key/nonce reuse is
  created: post-close `sendMessage` returns at its guard *before* any `EncryptWithAd`, so no nonce
  is consumed on freed/reused state; the single handshake in AC3 runs exactly once via `pair()`.
  Rekey / nonce-reset is explicitly a different ticket (#76) and is not touched here.
- **[Network & I/O]** No finding — no sockets, no `ws`, no timeouts; the tests are fully in-memory.
- **[Error messages / logs]** No finding — tests assert only on static `NoiseSessionErrorReason`
  values (via `initErrors`) and on the *absence* of the specific reason the pre-close path would
  raise. No test asserts on plaintext, key, or frame bytes, so the log-free / no-leak discipline is
  preserved; the existing `log-free by construction` test (`noiseSession.test.ts:385`) still covers
  console output, and the new block adds no console assertions.
- **[Concurrency]** SHOULD (addressed inline, not gating) — this ticket's core is the
  teardown/shutdown-safety property from this category ("what happens on close mid-Noise-send"). The
  spec deliberately does **not** add a synchronization primitive and justifies it (single-threaded,
  synchronous wasm, no `await` in any entry point — *Evidence-Based Fix Selection*). The one risk
  is *prose overstatement*: a close-then-call test cannot reproduce a true mid-flight
  close/resume interleaving, so green must not be read as "concurrent close proven safe." Addressed
  inline by the "Coverage boundary" subsection and a required test-comment note. No MUST FIX.
- **[Concurrency — sink reentrancy]** OUT OF SCOPE — a separate, untested invariant is that a
  synchronously-reentrant `sendFrame` / `onEvent` sink (one that calls back into the session in the
  same turn) sees a consistent state. The production code already sets `state` *before* invoking a
  sink (`noiseSession.ts:131-132`, `166-168`), so this holds today, but it is a distinct property
  from close-during-handshake, has no observed failure, and pinning it would expand this ticket
  past its XS scope. Deferred; no owner ticket filed (no observed need — *Evidence-Based Fix
  Selection*).
- **[Threat model]** No finding — aligns with and strengthens the "survive a hostile / on-path
  relay without leaking plaintext or hanging, even during teardown" property: the garbage-frame
  tests are literally a hostile relay/daemon continuing to send after the client tears down, and
  pin that such frames are inertly dropped. Renderer-compromise and token-theft threats are N/A
  (no renderer, no disk here); broader socket-lifecycle shutdown belongs to the driver/supervisor
  (#50), not this pure crypto unit.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
