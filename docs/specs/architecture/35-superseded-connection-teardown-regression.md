# Spec: Pin the "torn-down relay connection never re-enters onEvent" invariant (#35)

Re-scoped mirror of mobile **#496** (close-then-connect race). This ticket adds **test-only,
zero-production-change** regression coverage for a single genuine residue of the original four-race
parity sweep: the connection-layer guarantee that a superseded (torn-down) `relayConnection` can
never fire a late event into the supervisor's shared `onConnEvent`. Same shape as **#33** (mobile
#497 re-scoped to a zero-production-change regression pin).

The other three races were verified already-handled on desktop (the supervisor was built in #22
*after* mobile's review): #499 (idle-Connected-while-unpaired) pinned at
`daemonConnection.test.ts:223`; #498 (backoff pre-collapse) pinned at `relaySupervisor.test.ts:243`;
#493 (reconnect-gating stall) has no subject on desktop (no load-on-reconnect feature — guard on
introduction). Only #496's connection-layer defensive invariant is not directly pinned. This spec
pins it.

## Files to read first

- `src/main/transport/relayConnection.ts:145-205` — **the code under test.**
  `teardownAndEmitClosed` (147-155) and the five socket handlers (`open`/`message`/`pong`/`error`/
  `close`). Read every guard. The two protections this spec pins are on lines **148**
  (`if (closed) return`) and **153** (`ws.removeAllListeners()`). Note that *every* handler that can
  reach `config.onEvent` is **also** independently guarded by the `closed` flag (`open`:158,
  `message`:178, `error`:190, and `close`→teardown:148) — this belt-and-suspenders redundancy drives
  the test design (see § Design → "Why two assertions, not one re-emit").
- `src/main/transport/relayConnection.ts:34-76` — `RelayConnectionConfig`, the `RelayEvent` union,
  and the `RelayConnection` handle. The contract the test drives (`onEvent` sink; `connected` /
  `message` / `closed` events; `close()`).
- `src/main/transport/relayConnection.test.ts:104-148` — `makeSink()` (the event recorder) and the
  `cleanups`/`afterEach` teardown convention. The new file reuses this recorder shape (a trimmed
  synchronous version is fine — see § Testing strategy).
- `src/main/transport/relayConnection.test.ts:309-339` — the two EXISTING terminal-once tests
  (`emits exactly one closed on a remote drop …` and `closes cleanly when close() … before … open`).
  The new tests pin a **different** gap and must not duplicate these — see § Design → "Relationship
  to existing coverage". **Do not modify these.**
- `src/main/pairingConfirmation.test.ts:1-20` — in-repo precedent for `vi.mock(<module>, factory)`.
  The new file mocks `'ws'` the same way. Read for the hoisting/`vi.mocked` idiom.
- `src/main/transport/relaySupervisor.ts:190-213` — `onConnEvent`: **why the connection-layer
  guarantee is load-bearing.** On any `closed` it nulls the live `current` and schedules a re-dial
  with *no per-connection generation fence*. Context for § Security review and § Open questions — not
  code to change.
- `docs/specs/architecture/33-noise-close-during-handshake-regression.md` — the precedent. Mirror its
  structure and its scrupulous "Coverage boundary" honesty (do not overstate what green proves).
- `CLAUDE.md` — test-first; transport-out-of-the-window; `npm test` (vitest) is the test gate,
  `npm run build` the salvage/QA gate.

## Context

**The invariant.** `relayConnection`'s `teardownAndEmitClosed` runs exactly once: it sets
`closed = true`, clears every timer, calls `ws.removeAllListeners()`, and emits the terminal `closed`
exactly once. A torn-down connection therefore can never re-enter `config.onEvent` — no second
`closed`, no stray `message` — no matter what its underlying socket does afterward.

**Why it is load-bearing.** The supervisor's `onConnEvent` (`relaySupervisor.ts:190`) is a *single
shared handler* passed to every connection it dials. On any `closed` it does `current = null` and
schedules a re-dial — with **no per-connection generation fence**. So if a *superseded* connection
(one the supervisor already replaced) could fire a late `closed`, that late event would null the
**new** live `current` and spawn a spurious re-dial — mobile #496's "a superseded connection clobbers
the live one" race. Desktop is safe **only** because the connection layer guarantees a torn-down
connection never fires again. That guarantee is currently enforced by production code but **not
directly pinned by a test**. This ticket pins it, so a future refactor that removes
`removeAllListeners()` or the teardown `closed` guard trips a red test instead of silently reopening
the race.

**Why now.** Last genuine residue of the #35 four-race sweep; the other three are pinned or have no
subject (see intro). Precedent: #33 did exactly this for mobile #497.

**Scope of the pin — connection layer only (a deliberate call).** The ticket asks the architect to
decide whether to add a *supervisor-level* assertion ("a superseded fake connection cannot clobber
`current` / trigger a re-dial"). **It must not be added, because it would fail against current code:**
`onConnEvent` has no generation fence, so a fake connection re-emitting `closed` *would* clobber
`current` and re-dial. That test would only pass after adding a production fence (generation counter)
— which is explicitly out of scope (zero production change) and defends a race the connection layer
already makes impossible. Pinning belongs at the connection layer, where the actual protection lives
(ticket Technical Note 1). The load-bearing relationship is captured in prose (§ Security review) and
in a test comment, not in a second production mechanism.

## Design

**Zero production changes.** The production guards already enforce the invariant. This spec adds
**one new test file**, `src/main/transport/relayConnection.teardown.test.ts`, and touches nothing
else. Expected diff: the new test file only (AC3).

### Why a new file (not an addition to `relayConnection.test.ts`)

The existing suite drives a **real** in-process `ws` server (`startRelay`) and imports the real
`WebSocket`/`WebSocketServer` from `'ws'`. A real socket cannot help here: to prove the *guard* stops
a late event (rather than the socket merely being dead), the test must fire a raw socket event on the
module's internal `ws` **after teardown** and inspect its listener set — both require a controllable
socket object. That means `vi.mock('ws')`, which is module-level and hoisted; adding it to the
existing file would replace the real `WebSocket`/`WebSocketServer` the real-server tests depend on.
So the mocked block lives in its own file. `noiseSession.interop.test.ts` establishes the
dotted-qualifier test-file convention; `pairingConfirmation.test.ts:12` establishes `vi.mock`.

### The socket seam (test-only)

Mock `'ws'` with a `FakeWebSocket extends EventEmitter` whose instances the test captures. Contract
(sketch — the developer writes the body in the file's idiom):

- `class FakeWebSocket extends EventEmitter` with `static OPEN = 1` (the module reads
  `WebSocket.OPEN` at `relayConnection.ts:166,208,217`), an assignable `readyState` field, and
  `vi.fn()` stubs for `send` / `close` / `terminate` / `ping`. `on` / `removeAllListeners` /
  `emit` / `listenerCount` / `listeners` come from `EventEmitter` — those are exactly the methods the
  invariant relies on, so they must be the **real** EventEmitter methods, not stubs.
- The constructor pushes `this` into a hoisted `instances: FakeWebSocket[]`. Use `vi.hoisted(() =>
  ({ instances: [] }))` so the `vi.mock` factory (hoisted above imports) can reference it without a
  "cannot access before initialization" error — this is the one vitest gotcha to get right.
- `vi.mock('ws', () => ({ WebSocket: FakeWebSocket }))`. `RawData` is type-only (erased); the factory
  need not provide it.

The test drives the lifecycle by emitting on the captured instance: `instance.emit('open')` →
`connected`; `instance.emit('close', 1006, Buffer.from('drop'))` → terminal `closed`. Because we emit
`'open'` first (which clears the connect timer) and always reach a `'close'` (which clears the ping
interval via teardown), **no real timers dangle** — no fake timers needed.

### Why two assertions, not one re-emit — the redundancy finding

The invariant is protected by **two mutually-redundant layers** at the `onEvent` boundary:

1. `ws.removeAllListeners()` (line 153) — structurally removes every handler, so a late socket event
   reaches no code.
2. the per-handler `closed` flag (lines 148, 158, 178, 190) — each handler short-circuits when
   `closed` is already true.

A naive "re-fire a raw event and assert nothing happens" test is **green under current code but does
not bite on either single removal**, because whichever layer you remove, the other still stops the
event: remove `removeAllListeners()` and a re-emitted `'close'`/`'message'` still hits its `closed`
guard; remove a `closed` guard and `removeAllListeners()` still means no listener is there to hit. So
each mechanism must be pinned by the assertion that targets it *specifically*:

| Mechanism | Assertion that bites | How |
|---|---|---|
| `ws.removeAllListeners()` (153) | after teardown, `instance` has **zero** listeners for every event (`listenerCount('close')`, `'message'`, `'error'`, `'open'`, `'pong'` all `0`; or `instance.eventNames()` empty) | remove line 153 → counts are non-zero → RED |
| teardown `if (closed) return` (148) | capture the module's `'close'` listener **before** teardown, then re-invoke it directly **after** teardown; assert still exactly one `closed` | remove line 148 → re-invocation re-runs teardown → second `closed` → RED |

The captured-handler re-entry for the `closed`-guard pin is the direct analog of #33 calling an entry
point after `close()`: `teardownAndEmitClosed` is only ever reached via the `'close'` handler, and
`removeAllListeners()` deletes that handler — so the *only* way to re-enter teardown (and thus
exercise its `closed` guard) is to hold the handler reference from before teardown. It is
intentionally white-box; state that in a comment.

The observable "raw event re-fired reaches nobody" assertions (AC1's literal requirement) are ALSO
present — they document the boundary contract and bite when **both** layers are removed — but they
are not what makes a single removal bite. The listenerCount and captured-handler assertions are.

### Relationship to existing coverage (no duplication — ticket Technical Note 3)

- `relayConnection.test.ts:309` pins terminal-once against a follow-up **API** `close()` — routes
  through `close()`'s own guard (`relayConnection.ts:215`), a *different* line than teardown's 148.
- `relaySupervisor.test.ts:261,321` pin "a late event from a dead fake connection is ignored" at the
  **supervisor** layer — the supervisor's `stopped` flag, a different mechanism at a different layer.
- The genuine gap here: a late **raw socket** event after teardown removed the listeners, pinned at
  the **connection** layer. Distinct from all three.

## State + concurrency model

`relayConnection` runs in the Electron main process, single-threaded on the event loop. No production
concurrency primitive is added (none exists to change). The test drives a synchronous
`EventEmitter`-backed fake; every `emit` is synchronous, so there is no interleaving to reproduce and
no fake-timer plumbing required. Do **not** port any mobile #496 synchronization primitive — desktop
prevents the race structurally at teardown; adding runtime machinery would defend a non-race
(pipeline: *Evidence-Based Fix Selection*), exactly as #33 declined mobile #497's mutex.

## Error handling

No new production surface, so no new failure modes. The test asserts only on `RelayEvent` `type`
discriminants and on `EventEmitter` listener counts — never on frame bytes, headers, `code`/`reason`
text, or console output. This preserves the module's log-free / no-leak discipline
(`relayConnection.ts:14-17`): the new file introduces no `console` call and asserts on none.

## Testing strategy

Add one `describe` block — e.g. `relayConnection teardown — superseded connection never re-enters
onEvent (mobile #496 parity)` — to the new file `src/main/transport/relayConnection.teardown.test.ts`,
with **two** focused `it` cases. Reuse a trimmed synchronous event recorder (an `events: RelayEvent[]`
array pushed by `onEvent`; the async `waitFor` from `makeSink` is unnecessary because the fake is
synchronous). Write the test bodies in the file's idiom; the scenarios below are the contract, not
the source.

- **AC1 + removeAllListeners pin — "a late raw socket event after teardown never re-enters onEvent"**
  Construct a connection; grab the captured `instance`. `emit('open')` → assert one `connected`.
  `emit('close', 1006, Buffer.from('drop'))` → assert exactly one `closed`, terminal-once. Then fire
  further **raw** events on the same socket: `emit('close', 4999, Buffer.from('late'))`,
  `emit('error', new Error('late'))`, `emit('message', new Uint8Array([1,2,3]))`. Assert: still
  exactly one `closed`, zero `message`, `connected` count unchanged, and `emit` did not throw.
  **Then the biting assertion:** `instance.listenerCount('close')`, `'message'`, `'error'`, `'open'`,
  `'pong'` are **all 0** (equivalently `instance.eventNames()` is empty). Distinguishing: absent
  `removeAllListeners()` the listener counts are non-zero.

- **teardown `closed`-guard pin — "the terminal closed is idempotent against a re-entered close"**
  Construct a connection; grab `instance`. `emit('open')`. Capture the module's close handler
  **before** teardown: `const [closeHandler] = instance.listeners('close')`. `emit('close', 1006,
  Buffer.from('drop'))` → assert one `closed` (teardown ran; listeners now removed). Re-invoke the
  captured handler directly: `closeHandler(1006, Buffer.from('drop-again'))`. Assert: still exactly
  one `closed`, and it did not throw. Distinguishing: absent the `if (closed) return` at
  `relayConnection.ts:148`, the re-invocation re-runs teardown and emits a second `closed`. Comment
  that this is intentionally white-box — it is the only way to re-enter teardown past
  `removeAllListeners()`, and it pins the belt to `removeAllListeners()`' suspenders.

**Coverage boundary (be precise — do not overstate, per #33).** These are *connection-layer* pins.
They do **not** prove the supervisor is race-free — the supervisor has no generation fence and relies
entirely on this connection-layer guarantee (§ Context). Green means "a torn-down `relayConnection`
does not fire again", not "a superseded connection cannot clobber the live one at the supervisor" —
the latter is *derived* from the former plus the shared-handler wiring, and is asserted in prose, not
code. Also: removing **only** the teardown `closed` guard while keeping `removeAllListeners()` (or
vice-versa) leaves the boundary observably safe because the two are redundant; each is pinned by its
targeted assertion (listenerCount / captured-handler), not by the re-emit. Write the test comments to
say this so a maintainer does not read green as "the guards are individually necessary at the
boundary."

**Gates.** `npm test` (vitest) green; `npm run typecheck` clean (type the `FakeWebSocket` and the
mock factory so the file compiles — `readyState`/`OPEN`/the `vi.fn()` stubs); `npm run build` clean
(salvage gate). If any assertion is red, stop and treat it as a real reopened race — but per the
analysis the current implementation satisfies both guards, so the expected result is green with zero
production change.

## Open questions

None blocking. One resolved judgment call (ticket Technical Note): the supervisor-level assertion is
**deliberately omitted** — it would fail against current code (no generation fence) and demand
out-of-scope production change; the load-bearing connection→supervisor relationship is documented in
prose and a test comment instead (§ Context, § Security review). Whether a future ticket should add a
per-connection generation fence to the supervisor is a separate design question with **no observed
failure** (the connection layer makes it moot today) — do not file speculatively
(*Evidence-Based Fix Selection*).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new finding — the spec adds no production code and no new boundary. It
  *exercises* the relay-socket → `onEvent` boundary with adversarial late input (a hostile / on-path
  relay continuing to send `close`/`error`/`message` frames after the client has torn the connection
  down) and pins that such input is inertly dropped. Strengthens, never weakens, the teardown
  guarantee at `relayConnection.ts:147-155`.
- **[Tokens / secrets]** No finding — no token or key is created, read, stored, or logged. The fake
  socket carries no credential; the test feeds only synthetic close codes, a bare `Error`, and a
  3-byte `Uint8Array`.
- **[File / storage]** No finding — the new file does zero I/O (no `fs`, no disk paths, no
  `safeStorage`). All state is in-memory arrays and an `EventEmitter` fake.
- **[Electron attack surface]** No finding — no IPC, no `BrowserWindow`, no preload, no protocol
  handler, no renderer surface. Pure main-process unit test; the transport stays out of the window
  (CLAUDE.md).
- **[Cryptographic primitives]** No finding — the connection layer is semantics-blind (no Noise, no
  codec); no crypto is touched, added, or hand-rolled. No key/nonce lifecycle is exercised.
- **[Network & I/O]** No finding — `'ws'` is mocked; there is no real socket, no TLS, no timeout, no
  network egress. The connect timer and ping interval are cleared by the driven lifecycle (open then
  close), so no real timer leaks.
- **[Error messages / logs]** No finding — the module is log-free by construction and the test adds
  no `console` call and asserts on none. No assertion inspects frame bytes, headers, or
  `code`/`reason` text, so nothing pressures the module toward leaking identity or payload into a
  diagnostic. The `Error('late')` fed to the `'error'` handler carries no sensitive text.
- **[Concurrency / lifecycle]** This ticket's core category. The invariant under test *is* a
  teardown-safety property of an internet-exposed socket: a superseded connection must never re-enter
  the shared supervisor handler. The spec deliberately adds **no** synchronization primitive and
  justifies it (single-threaded main process; teardown is synchronous and structural —
  *Evidence-Based Fix Selection*). The one risk is *prose overstatement*: a connection-layer green
  must not be read as "the supervisor is proven race-free" (the supervisor has no generation fence
  and depends on this guarantee). Addressed inline by the "Coverage boundary" subsection and a
  required test comment. No MUST FIX.
- **[Threat model]** No finding — aligns with and strengthens the "survive a hostile / on-path relay
  without hanging or acting on post-teardown input, even during teardown" property. The late-event
  test *is* a hostile relay continuing to push frames/closes after the client tears down, and pins
  that they are inertly dropped. Renderer-compromise and token-theft threats are N/A here (no
  renderer, no disk, no credential in scope).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
