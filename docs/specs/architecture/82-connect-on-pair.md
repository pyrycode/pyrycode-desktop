# Spec #82 — Connect immediately after a fresh pairing (connect-on-pair)

Wire the pairing-confirm success signal to the daemon connection so a fresh pairing dials the
daemon with no manual step. Background-process lifecycle wiring only — no renderer change.

Mirrors mobile #489. Split from #34; sibling #83 (reload-per-dial for *automatic* supervisor
reconnects) is out of scope here and blocked-by this ticket.

## Files to read first

- `src/main/daemonConnection.ts:57-70` — the `DaemonConnection` interface (`start`/`stop`/`send`);
  this ticket adds a fourth method and re-arms the once-only lifecycle. Read the whole file — the
  changes are concentrated here.
- `src/main/daemonConnection.ts:101-260` — `createDaemonConnection`: the `started`/`stopped`/`driver`
  locals (109-117), `onDriverEvent`'s `terminal` suppression via `stopped` (159-164), `bootstrap`'s
  `if (stopped) return` guard before `createDriver` (191-192), and `start()`'s once-only guard
  (242-250). These are the exact seams you extend.
- `src/main/transport/noiseRelayDriver.ts:100-118, 203-242` — the driver's OWN generation-counter
  fencing (`generation` + `teardownConnection`) and its `stop()` → `supervisor.stop()` →
  synchronous `terminal{1000,'stopped'}` path. **This ticket mirrors that exact idiom one layer up.**
  Read it: it is the pattern to copy, and it explains why stopping the old driver on a reconnect
  emits a terminal that must be fenced.
- `src/main/pairingHandler.ts:46-103` — `registerPairingHandler`: the `confirm` seam. The
  `await confirm()` inside the `try` at 91-98 is where a successful persist is observed — the exact
  point the connect trigger fires from.
- `src/main/index.ts:101-164` — the composition root. Note the current registration order: pairing
  handler (114-118) → pairing-status handler (126-127) → window + connection (136-148) →
  `did-finish-load → connection.start()` (147). The wiring change reorders one block; read the
  ordering comments (101-105, 122-127, 144-147) so you preserve their invariants.
- `src/shared/ipc/events.ts:31-37` — the `DaemonEvent` union; `{ type: 'connecting' }` is what a
  (re)dial emits first. No change here — confirms the event already exists.
- `src/main/daemonConnection.test.ts` — the fake-driver / spied-sink harness (`makeDriverFactory`,
  `fakeSink`, `build`, `tick`, `reachConnected`). New reconnect tests reuse it wholesale.
- `src/main/pairingHandler.test.ts:36-38, 128-200` — the `confirmationOf` helper and the
  confirm-success / confirm-throw tests; the new `onPaired` tests slot in beside them.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` — the boundary rule (token
  and `server_static_pubkey` stay in the background process; only typed events cross). AC5 is this.

## Context

The daemon connection's `start()` is once-only: `if (started || stopped) return` (daemonConnection.ts:243).
The composition root fires it once, on `did-finish-load` (index.ts:147). A client that launches
already-paired connects; a client that *pairs during a running session* persists the record but
never connects until the next launch — the operator has to restart.

The paired-server record is persisted through exactly one path: `pairingHandler`'s `await confirm()`
(pairingHandler.ts:92), which calls the `store.save(snapshot)` closure `pairingConfirmation.prepare`
built (pairingConfirmation.ts:127). This ticket wires that confirm-success into a fresh dial.

`bootstrap` already sources the record fresh at dial time — `await pairedServer.load()` runs when the
connect *begins*, not at construction (daemonConnection.ts:175). So a re-arm alone makes the
triggered connect pick up the just-persisted record (AC3). **No record-reload plumbing belongs here**
— reloading on every automatic supervisor reconnect is #83's scope.

## Design

Two seams, one composition-root rewire.

### 1. Re-arm the connection: `DaemonConnection.reconnect()`

Add a fourth method to the interface (daemonConnection.ts:59-70):

```ts
/** Tear down any current connection and dial fresh, re-sourcing the paired-server record at
 *  dial time. The connect-on-pair trigger (#82). No-op once stop()ped. Distinct from the
 *  supervisor's in-session transient auto-reconnect — this replaces the driver entirely. */
reconnect(): void
```

**Generation fence.** Copy the driver's own idiom (noiseRelayDriver.ts:100-118). Add one module-local
counter and route driver events through a per-dial guard so a superseded driver's events — including
the `terminal{1000,'stopped'}` that stopping it synchronously emits — are dropped:

- `let generation = 0` — monotonic connection fence, bumped on every dial.
- Wrap the `onEvent` passed to `createDriver` per-bootstrap: a closure capturing the dial's `gen`
  that early-returns when `gen !== generation`, else forwards to the existing `onDriverEvent`.
  `onDriverEvent` itself is unchanged (it still checks `stopped` for the app-quit terminal).

**Private `dial()`** — the single fresh-connect path both `start()` and `reconnect()` funnel through:

- `const gen = ++generation` — supersede any prior dial.
- `driver?.stop()` then `driver = null` — tear down a live driver (null before the first dial or
  after a not-paired boot). Its stop-terminal carries the *old* gen, so the wrapper drops it — no
  spurious `failed`. This also closes the old relay socket, so only the fresh server is dialed (AC3).
- `nextEnvelopeId = 2` — fresh session, fresh app-envelope numbering (each dial rebuilds `hello` at
  id 1; see daemonConnection.ts:182-188 and the `nextEnvelopeId` comment at 114-117). Correctness-
  neutral (the daemon correlates by id, not sequence) but keeps a re-dialed session self-consistent.
- `emitDaemonEvent(sink, { type: 'connecting' })` — synchronous, before any await (AC2).
- `void bootstrap(gen)` — fire-and-forget; bootstrap catches everything and never rejects.

**`start()` and `reconnect()`** become thin wrappers over `dial()`:

- `start()`: keep `if (started || stopped) return`; set `started = true`; call `dial()`. (The
  `connecting` emit and `void bootstrap()` move into `dial()` — no behavior change on first start:
  `driver` is null so the stop is a no-op, `nextEnvelopeId` is already 2.)
- `reconnect()`: `if (stopped) return`; set `started = true` (idempotent; keeps a later
  `did-finish-load` start a no-op in the unreachable race); call `dial()`.

**`bootstrap(gen: number)`** — thread `gen` through and fence at each suspension point (replaces the
lone `if (stopped) return` at daemonConnection.ts:191-192):

- after `await pairedServer.load()`: `if (gen !== generation) return` — a reconnect superseded this
  in-flight bootstrap; do not emit `not-paired`/`connect-failed` or build a stale driver.
- before `createDriver`: `if (stopped || gen !== generation) return` — covers app-quit (`stopped`,
  which `generation` does NOT subsume — `stop()` does not bump `gen`) AND supersession. Preserves the
  existing "never constructs a driver when stop() races the bootstrap" test.
- `catch`: `if (gen === generation) emitFailed('connect-failed')` — a superseded bootstrap's throw is
  silent (its `failed` would clobber the successor's `connecting`).

**`stop()` is unchanged.** It sets `stopped = true` and calls `driver?.stop()`; the terminal is still
suppressed by `onDriverEvent`'s `if (stopped) return` (gen unchanged on stop, so the wrapper passes it
through to that guard). Both suppression mechanisms coexist: `stopped` for permanent teardown,
`generation` for reconnect supersession.

Update the interface header comment (daemonConnection.ts:58) — it currently reads "the single
explicit connect this ticket wires (auto-reconnect is #34)"; #34 split into this ticket (explicit
re-arm) and #83 (supervisor auto-reconnect record-reload).

### 2. Fire the trigger: `registerPairingHandler` gains `onPaired`

Add an optional callback to the deps (pairingHandler.ts:47-52):

```ts
/** Called once after a confirm persists the record — the connect-on-pair trigger (#82). A trusted
 *  in-process callback that MUST NOT throw (mirrors the onEvent/sink discipline elsewhere in main).
 *  Never called on a failed persist (AC4) or on submit. */
onPaired?: () => void
```

Invoke it on the success path only — inside the existing `try`, after `await confirm()` resolves,
before `return { ok: true }` (pairingHandler.ts:91-98):

- `await confirm()` throwing (a failed persist) lands in the existing `catch` → `persist-failed`
  response, and `onPaired` is never reached. AC4 is structural.
- It carries **no arguments** — a bare signal, exactly like the renderer's `confirm` request. No
  record field crosses to `onPaired`'s caller (AC5 by construction; the record/token/key live in
  `pairingConfirmation`'s frozen snapshot, never in a value this handler passes on).
- Guard the call: `onPaired?.()`. Existing tests that omit `onPaired` keep passing unchanged.

### 3. Wire it: composition root (index.ts)

`registerPairingHandler` currently runs before `connection` exists (index.ts:114 vs 137). To pass
`onPaired: () => connection.reconnect()`, move the `registerPairingHandler(...)` block to **after**
`createDaemonConnection(...)`:

- Keep `registerPairingStatusHandler` where it is (before `createWindow`) — its comment (index.ts:122-124)
  says the renderer queries it before first paint; that invariant is unaffected.
- Move only the `submit`/`confirm` pairing handler down. **Safe:** the whole `whenReady` callback runs
  synchronously to completion in one tick; `createWindow()` merely *starts* the async document load.
  A `submit`/`confirm` invoke is operator-driven (paste + click), which happens many ticks later,
  after first paint — so the handler is registered well before any pairing invoke can arrive.
- Pass `onPaired: () => connection.reconnect()`. `reconnect()` is synchronous, `void`, and does not
  throw (it bumps a counter, calls the guarded `driver?.stop()`, and emits into a sink that "must not
  throw"), so it satisfies the `onPaired` must-not-throw contract and cannot corrupt the confirm
  response.
- Keep the `app.on('will-quit', () => unregisterPairing())` teardown alongside the moved block.

### Data flow (connect-on-pair)

```
renderer confirm invoke ─▶ pairingHandler.listener
                             await confirm()  ─▶ store.save(snapshot)   (record persisted)
                             onPaired()       ─▶ connection.reconnect()
                                                   dial(): ++gen, driver?.stop() (old terminal fenced),
                                                           emit {connecting}, bootstrap(gen)
                                                   bootstrap: load() (fresh record) ─▶ createDriver
                                                   handshake ─▶ {connected} | {failed}
                             return { ok: true }   (independent reply channel — carries no secret)
```

The confirm reply (fingerprint/ok channel) and the daemon `connecting`/`connected` events (daemon-event
channel) are independent — the renderer already renders the latter (#19), so no renderer change (AC2).

## State + concurrency model

- **Single live transport, always.** `dial()` stops the prior driver before constructing the next, so
  a re-pair-while-connected never stacks two sockets. The generation fence guarantees only the
  current-gen bootstrap writes the `driver` ref and only the current-gen driver's events are observed.
- **Races fenced by `generation`** (all resolved by the same counter, mirroring noiseRelayDriver.ts):
  1. Old driver's stop-terminal after a reconnect → wrapper drops it (old gen).
  2. A reconnect superseding an in-flight `bootstrap` mid-`await` → guards at each suspension point
     abort the stale bootstrap before it emits or builds a driver.
  3. Rapid double reconnect → each `++generation` supersedes the previous; last dial wins.
- **`stopped` (unchanged) fences permanent teardown**, which `generation` deliberately does NOT
  subsume (`stop()` does not bump `gen`). Hence the `stopped ||` in the pre-`createDriver` guard.
- **No new async ownership.** No new timers, listeners, or sockets — `reconnect()` reuses the existing
  `bootstrap`/driver lifecycle. Teardown is still `stop()` on `will-quit` (index.ts:148), which stops
  whatever the latest dial constructed. The `onPaired` callback is synchronous — it does not outlive
  the confirm handler.
- **`send()` during the reconnect gap** (old driver stopped, new not yet built): `driver === null`, so
  `send()` is a no-op (daemonConnection.ts:229) — unchanged.

## Error handling

- **Confirm persist fails** → `await confirm()` throws → existing `catch` → `persist-failed` reply,
  `onPaired` not called, no dial (AC4).
- **Triggered dial, no record** (can't happen right after a successful confirm, but defensive) →
  `bootstrap` emits `failed('not-paired')` — same as boot.
- **Triggered dial, load/keychain/key/driver failure** → `failed('connect-failed')`, gen-guarded so a
  superseded dial stays silent. Same classification as boot (AC2's "or a `failed` event on failure").
- **Old driver's terminal on reconnect** → fenced by the generation wrapper; never surfaces as
  `failed('connection-closed')`. Without the fence this would emit a spurious `failed` between the new
  `connecting` and `connected` — the single most important thing the fence buys.
- No new `DaemonEvent` codes, no new reject branches. The failure vocabulary is unchanged.

## Testing strategy

`npm test` (vitest). Reuse the existing fakes; no new fixtures beyond a multi-return `load`.

### `daemonConnection.test.ts` (extend the fake-driver harness)

`makeStores` currently takes a single `load`. For the fresh-record and not-paired→paired tests, allow
`load` to return different values across calls (a queue/counter in the test's `load` closure — no
harness change needed; `overrides.load` is already a free function).

New scenarios (bullet form — write in the project idiom):

- **reconnect() replaces the driver and emits a fresh `connecting`.** start → handshake-complete
  (connected); `drivers[0]` recorded. Call `reconnect()`, `await tick()`. Expect `drivers[0].stopped
  === true`, `drivers.length === 2`, and a second `{ type: 'connecting' }` in the emitted sequence.
- **reconnect() fences the old driver's terminal (no spurious `failed`).** After the reconnect above,
  emit `{ type: 'terminal', code: 1000, reason: 'stopped' }` from `drivers[0]`. Assert no `failed`
  event was appended (the count is unchanged) — the generation wrapper dropped it.
- **reconnect() sources the record fresh (AC3).** `load` returns RECORD_A then RECORD_B. start →
  `drivers[0].config.connection.url === A.relay` (and `X-Pyrycode-Server === A.server`). reconnect →
  `drivers[1].config.connection.url === B.relay`. Proves the fresh pairing's relay/server/token/key
  are the ones dialed.
- **reconnect() from a not-paired boot connects (primary scenario).** `load` returns `null` then
  RECORD. start → `failed('not-paired')`, no driver. reconnect → `drivers.length === 1`; emit
  handshake-complete → `connected`.
- **reconnect() is a no-op after stop() (app quitting).** start → stop → reconnect → `await tick()`.
  No new driver, no new `connecting` beyond what stop already saw.
- **the fresh session restarts envelope numbering at 2.** After a reconnect to a connected driver,
  `send(payload)` produces a `send_message` with `id === 2` on the new driver.
- **secret-free invariant still holds across a reconnect.** Extend the existing "never logs / no event
  carries the token" test to include a reconnect: no `console.*`, and no emitted event serialization
  contains the token, server key, or private key.

Keep the existing suite green — the `stop()`-race, terminal-suppression, and idempotent-`start()`
tests must still pass unchanged (the design preserves each; see § Design).

### `pairingHandler.test.ts` (extend beside the confirm tests)

- **onPaired fires once after a successful confirm.** submit → confirm (confirm resolves) → the
  `onPaired` spy was called exactly once, after the `ok: true` reply.
- **onPaired does NOT fire when the persist fails (AC4).** `confirm` throws → reply is
  `persist-failed` → the `onPaired` spy was not called.
- **onPaired does NOT fire on submit.** submit only → spy not called.
- (Optional) **the handler works without onPaired.** Register without the callback, run a full
  submit→confirm; no throw. (Already implied by every existing test, which omit it.)

### index.ts

No unit test (composition root, no `index.test.ts`). Covered by `npm run build` (typecheck of the
`onPaired` wiring and the `reconnect()` call) and the operator smoke test (pair during a running
session → watch it connect with no restart). The `npm run build` salvage gate must pass.

## Open questions

- **`nextEnvelopeId` reset on dial** — prescribed as `= 2` for a self-consistent fresh session.
  Correctness-neutral (the daemon correlates by `id`, not sequence, per daemonConnection.ts:114-117),
  so a developer who finds it noisier than leaving the counter running may keep it running; note the
  choice either way. Low stakes.
- **Method name `reconnect()`** — chosen to read naturally at the call site (`onPaired: () =>
  connection.reconnect()`). If it reads as colliding with the supervisor's in-session auto-reconnect,
  `restart()` / `redial()` are acceptable; keep the interface doc-comment's distinction either way.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the design adds no new untrusted→trusted boundary. The renderer→main
  `confirm` invoke is still guarded by `isPairingRequest` (pairingHandler.ts:67) and is **fieldless**,
  so no renderer-supplied data reaches the trigger. `onPaired` is a bare signal carrying no arguments;
  the dial re-sources the paired-server record from the trusted secure store (`pairedServer.load()`),
  not from the renderer. A renderer can fire `onPaired` only by driving a real, parse-and-fingerprint-
  validated, operator-confirmed pairing to persistence — it cannot choose an arbitrary dial target.
- [Trust boundaries / no double-dial] No findings — `pendingConfirm`'s consume-before-await
  (pairingHandler.ts:90) caps the trigger at exactly one `onPaired` per real confirm; a replayed
  `confirm` is `no-pending-pairing` and dials nothing.
- [Tokens, secrets] No findings — no new secret handling. The trigger carries no token/key; the dial
  re-runs the unchanged `bootstrap`, which sources the token (into the `hello` + relay header) and the
  server key exactly as boot does. Storage (safeStorage via `pairedServerStore`, ADR 0005) is untouched.
  The reconnect path is added to the existing secret-free / log-free test.
- [File / storage] N/A — no filesystem code added. Persist (`store.save`) and load (`pairedServer.load`)
  are the existing safeStorage-backed paths, unmodified; `nextEnvelopeId = 2` is an in-memory counter.
- [Electron attack surface] No findings — no new IPC channel or `contextBridge` API (`onPaired` is a
  main-side in-process callback). Window `webPreferences` (`sandbox: true`, `contextIsolation: true`,
  index.ts:33-34) untouched. The `registerPairingHandler` reorder stays within the synchronous
  `whenReady` tick, registered before any operator-driven pairing invoke can arrive — no race with an
  unregistered handler. Transport, keys, and socket stay in the main process; the trigger fires main→main.
- [Cryptographic primitives] No findings — no crypto added. `reconnect()` drives a **fresh** Noise_IK
  handshake through a new driver (v2 has no session resume; noiseRelayDriver.ts:6-7), so the superseded
  and new sessions derive independent transport keys from fresh ephemerals — no `(key, nonce)` reuse
  across dials. The device static key is reused as the long-term identity by design (ADR 0002).
- [Network & I/O] No findings — the new driver inherits the same `MAX_FRAME_BYTES` cap
  (daemonConnection.ts:206) and the record's pairing-time-validated relay URL (#52). `reconnect()` is a
  single human-paced dial per pairing, not an automatic retry loop, so no backoff is required here
  (transient-drop backoff is #22's supervisor; record-reload-per-auto-reconnect is #83). `dial()` closes
  the old driver's socket via `driver.stop()` before the new dial — no duplicate or leaked socket.
- [Error messages, logs] No findings — no new logging; the failure path is the unchanged
  classify-don't-forward `emitFailed` (static category codes, caught object dropped). The reconnect adds
  no error string that could echo a secret; the secret-free assertion is extended across a reconnect.
- [Concurrency] No findings — the generation fence (mirroring noiseRelayDriver.ts:100-118) resolves the
  three races (old driver's stop-terminal, a reconnect superseding an in-flight bootstrap, rapid double
  reconnect). `dial()` sets the fence synchronously before any `await`; single live transport is
  guaranteed by tear-down-before-dial. No new timers/listeners/sockets; teardown on `will-quit`
  unchanged.
- [Threat model] OUT OF SCOPE — a **compromised** renderer could loop `submit`→`confirm` to churn
  reconnects (each real persist fires one dial). This causes no secret leak and no privilege escalation
  (a compromised renderer already holds the `sendMessage` command channel and is contained from
  keys/token/socket by process isolation per ADR 0002); the cost is a local socket teardown/redial.
  Reconnect rate-limiting / relay-side abuse handling is not this ticket — it belongs with the
  automatic-reconnect discipline (#83) and the relay's own connection handling (upstream `pyrycode-relay`).
  All inherited protocol threats (hostile relay, token-theft-from-disk, hostile daemon response) are
  unchanged — the reconnect re-runs the same fail-closed handshake and defensive parsing as boot.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
</content>
</invoke>
