# Spec #83 — Reload the paired-server record on every dial (reload-per-dial)

Close the gap #82 left open: the **automatic supervisor reconnect** must re-source the paired-server
record from storage, so the freshest record is what gets dialed — for both the connection headers
(url + `token`/server) AND the Noise session material (`server_static_pubkey` + `hello`). Background-
process transport change only; the renderer observes the resulting typed daemon events unchanged.

Mirrors mobile #489 (reload-per-dial) and the daemon's reload-at-handshake + fail-closed discipline
(pyrycode #782). Split from #34; layers onto sibling #82 (PR #85, connect-on-pair), which made the
*explicit* dial re-source the record but deliberately left the automatic reconnect untouched.

## Files to read first

- `src/main/transport/relaySupervisor.ts:56-66, 168-197` — `RelaySupervisorConfig.connection` (the
  captured connection snapshot, one of the two residuals), `onConnEvent`'s transient-`closed` →
  `backoffTimer = setTimer(dial, …)` re-dial, and `dial()` itself (currently synchronous, reuses
  `config.connection`). **This is where the connection-header reload lands.**
- `src/main/transport/noiseRelayDriver.ts:61-80, 100-178` — `NoiseRelayDriverConfig.session` (the
  captured session-material snapshot, the other residual), the generation-counter fencing
  (100-118), and `onConnected` (124-178) which rebuilds a fresh session from `config.session` on
  every supervisor `connected`. **This is where the session-material reload lands.**
- `src/main/daemonConnection.ts:191-255, 275-293` — `bootstrap`'s inline record-load → connection +
  session assembly (191-246; extract this into the provider) and `dial()`. #82's generation fence
  and not-paired/connect-failed classification live here and are **preserved almost verbatim**.
- `src/main/transport/relayConnection.ts:34-49` — `RelayConnectionConfig` shape, so you know exactly
  what `Omit<RelayConnectionConfig, 'onEvent'>` (the connection portion the provider returns) carries.
- `src/main/pairedServerStore.ts:33-56, 120-138` — `PairedServerStore.load()` contract: **no cache,
  reads through on each call** (a re-pair is observed immediately — this is what makes reload-per-dial
  work), `null` = never-paired (the only null path), `MalformedPairedServerRecordError` thrown on a
  present-but-corrupt blob (never coerced to null).
- `docs/specs/architecture/82-connect-on-pair.md` — the sibling that built `dial()`/`reconnect()`/
  `bootstrap` and the generation fence. Read §Design + §State/concurrency; this ticket extends, not
  rewrites, that machinery.
- `src/main/transport/relaySupervisor.test.ts:127-156` — the `setup()` harness + `fakeConnectionFactory`
  (captures the config each connection is built with) + `fakeScheduler`; new reload tests reuse it.
- `src/main/transport/noiseRelayDriver.test.ts:169-195` — `SESSION_MATERIAL`, the `setup()` harness,
  and `fakeSupervisorFactory` (captures config, exposes `emit`); the reload tests drive the captured
  `resolveConnection` then `emit({type:'connected'})`.
- `src/main/daemonConnection.test.ts:34-130` — `RECORD`, `makeDriverFactory` (captures
  `config`), `makeStores`/`build`, and the **multi-return `load`** pattern (`overrides.load` is a free
  closure) the new provider tests reuse.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` — the boundary rule: `token`
  and `server_static_pubkey` never leave the background process. AC5 is this. AC4 is the log-free rule.

## Context

The relay connection heals itself across transient drops (`relaySupervisor.ts`): a retryable `closed`
re-dials with capped jittered backoff. Two transport layers capture their inputs **once, at
construction**, and reuse them on every automatic reconnect:

1. **The supervisor** captures `config.connection` (relay url + the `X-Pyrycode-Server` /
   `X-Pyrycode-Token` headers). Its transient-drop re-dial (`dial()` at :193) rebuilds the connection
   from that snapshot.
2. **The driver** captures `config.session` (`staticPrivateKey`, `remoteStaticPublicKey`, `hello`).
   Its `onConnected` (:124) rebuilds a fresh Noise session from that snapshot on every `connected`.

Neither path returns through `daemonConnection.dial()` → neither re-reads the record. #82 made the
*explicit* dial (`start()`/`reconnect()` → `dial()` → `bootstrap`) re-source the record via
`pairedServer.load()`, but the automatic reconnect re-uses the *same* driver and supervisor, so both
snapshots survive. If the record changes mid-session (a re-pair to a new relay/server/key, or the
record being cleared), the automatic reconnect keeps dialing the stale in-memory view.

This ticket threads a **per-dial config provider** through the reconnect path so both residual
snapshots are re-sourced from storage on every automatic reconnect.

## Design

One idea: replace the two construction-time **snapshots** with an injected **provider function**
`loadDialConfig` that loads the record and derives both halves fresh. It's constructed in
`daemonConnection` (which owns the `pairedServer` store) and threaded down; the transport layers stay
store-agnostic and IPC-free — they receive a plain async function, never the store.

The provider is used only for **automatic re-dials**. The **first** dial keeps using the config
`daemonConnection` already loaded in `bootstrap` (no reason to reload the record microseconds after
loading it, and this keeps #82's first-dial not-paired/connect-failed messaging exactly where it is).
This makes every change **additive** — the existing `connection`/`session` fields stay required, the
provider is optional — so every existing test compiles and passes unchanged.

### New types (in `noiseRelayDriver.ts`)

Extract the driver's inline session shape into a named type and add the provider's return shape:

```ts
export interface SessionMaterial {           // was the inline type of NoiseRelayDriverConfig.session
  staticPrivateKey: Uint8Array
  remoteStaticPublicKey: Uint8Array
  prologue: Uint8Array
  hello: Uint8Array
  loadTimeoutMs?: number
}
export interface DialConfig {
  connection: Omit<RelayConnectionConfig, 'onEvent'>
  session: SessionMaterial
}
/** Load the current paired-server record → derive one dial's config. `null` = no record (fail closed). */
export type DialConfigProvider = () => Promise<DialConfig | null>
```

`NoiseRelayDriverConfig.session` becomes `SessionMaterial` (rename only); a new optional
`loadDialConfig?: DialConfigProvider` is added.

### 1. `daemonConnection.ts` — construct and inject the provider

Extract the record-load + derive that `bootstrap` does inline (`daemonConnection.ts:191-246`) into a
provider, then hand it to the driver. `bootstrap`'s fences and failure classification stay verbatim.

- **`loadDialConfig(): Promise<DialConfig | null>`** — `await pairedServer.load()`; `null` → return
  `null` (not-paired); else `await deviceKeypair.ensure()`, `decodeServerKey(...)`, `buildClientHello({
  id: 1, ts: now(), deviceName, clientVersion, token })`, and assemble `{ connection: { url, headers,
  maxFrameBytes }, session }` — the *same* object `bootstrap` builds today (see :217-237). A thrown
  `decodeServerKey`/`ensure`/`MalformedPairedServerRecordError` propagates (caught upstream).
- **`bootstrap(gen)`** collapses its inline load+derive into one `const dc = await loadDialConfig()`
  and adds the provider to the driver config; every fence is unchanged:
  - `if (gen !== generation) return` (after the await — a reconnect superseded this bootstrap)
  - `if (dc === null) { emitFailed('not-paired'); return }`
  - `if (stopped || gen !== generation) return` (before `createDriver`)
  - `createDriver({ connection: dc.connection, session: dc.session, loadDialConfig, onEvent: fenced })`
  - `catch { if (gen === generation) emitFailed('connect-failed') }`

  Behaviour note: #82 checked `gen` after `load()` *and* after building `hello`; collapsing into one
  post-`loadDialConfig` check is correctness-equivalent — a superseded bootstrap does a little extra
  cheap, side-effect-free derivation then bails at the same fence before `createDriver`. No event and
  no driver are produced for a superseded gen. Keep the not-paired-before-gen-check ORDER (gen check
  first, then `dc === null`) so a superseded bootstrap never emits `not-paired`.

Nothing else in `daemonConnection` changes: `dial()`, the generation wrapper, `onDriverEvent`,
`stop()`, `send()`, and `DaemonConnectionDeps` are untouched. Import `DialConfig` from
`./transport/noiseRelayDriver`.

### 2. `noiseRelayDriver.ts` — reload session material on automatic reconnect

The driver already owns `onConnected` (fresh session per `connected`). It gains: build a
`resolveConnection` for the supervisor from `loadDialConfig` (this is the single per-dial `load()`),
stash that dial's session for `onConnected` to consume, and pick fresh material on reconnects.

- Two module-locals: `let firstConnect = true` and `let pendingSession: SessionMaterial | null = null`.
- **`resolveConnection`** (only when `config.loadDialConfig` is set; else `undefined`) — an async
  `() => Promise<Omit<RelayConnectionConfig,'onEvent'> | null>` the supervisor calls before each
  re-dial: `const dc = await config.loadDialConfig!(); pendingSession = dc?.session ?? null; return
  dc?.connection ?? null`. **One `load()` feeds both halves** — the supervisor gets `connection`,
  `onConnected` gets `pendingSession` — so there is no re-pair-mid-dial split between the headers and
  the key (both come from the same record snapshot). Pass `resolveConnection` into `createSupervisor`
  (alongside the existing `connection`).
- **`resolveConnection` MUST catch a thrown `loadDialConfig` and return `null`** (drop the caught
  object — classify-don't-forward: a `decodeServerKey`/keychain/`MalformedPairedServerRecordError`
  message could echo the key/token). A malformed or undecryptable on-disk record on an automatic
  reconnect therefore fails closed identically to the no-record case, instead of escaping as an
  unhandled rejection at the supervisor's `await` (that would violate AC3's "never a crash or a throw
  out of the transport" and break the fail-closed discipline this ticket mirrors from pyrycode #782).
  This catch is load-bearing, not optional — the whole "reload-at-dial + fail-closed" guarantee rests
  on it. Also null `pendingSession` on this path so a stale prior session is never reused.
- **`onConnected`** selects the material for this connection:
  `const material = config.loadDialConfig && !firstConnect ? pendingSession : config.session; firstConnect = false`.
  When `loadDialConfig` is absent (existing callers/tests) or this is the first connect, it uses
  `config.session` exactly as today. Guard `material === null` (defensive type-narrowing — the
  supervisor fail-closes on a null `resolveConnection` *before* `connected`, so this is
  structurally unreachable on the reload path; emit `{ type: 'error', reason: 'session-load-failed' }`
  rather than dereference null). Otherwise run the existing `createSession(...)` with `material`.

The generation fence (`gen`), the pending-frame buffer, `teardownConnection`, `sendMessage`, `stop`,
`onTerminal`, and `onMessage` are unchanged. `pendingSession` is written by `resolveConnection`
(during a re-dial) and read by `onConnected` (after that dial connects); supervisor dials never
overlap, so the value read is always the one this dial resolved.

### 3. `relaySupervisor.ts` — reload connection config on automatic re-dial

Add an optional provider and make `dial()` async, using it only for re-dials.

- `RelaySupervisorConfig` gains `resolveConnection?: () => Promise<Omit<RelayConnectionConfig,'onEvent'> | null>`.
  `connection` stays required (first dial + the no-provider fallback).
- A synthetic close code for the fail-closed terminal:
  `export const NO_PAIRED_RECORD_CLOSE_CODE = 4000` — a client-side sentinel, **never sent over the
  wire**, carried on the terminal so the consumer surfaces a non-connected event (AC3).
- `let firstDial = true`.
- **`dial()` becomes `async`** (its two call sites — the immediate construction-time call and
  `setTimer(dial, …)` — both tolerate a floating promise):
  - `backoffTimer = null; if (stopped) return`
  - First dial or no provider → `conn = config.connection; firstDial = false` (synchronous, no
    `await` reached — preserves the "dials immediately on creation" invariant and every existing
    re-dial test).
  - Else → `const resolved = await config.resolveConnection()`, then **fence**: `if (stopped) return`
    (a `stop()` raced the reload; during a backoff gap `stop()` is the only event source, and it has
    already run `emitTerminal`). If `resolved === null` → `emitTerminal(NO_PAIRED_RECORD_CLOSE_CODE,
    'no-paired-record'); return` (AC3: end supervision, never spin dialing a phantom). Else `conn = resolved`.
  - `current = createConnection({ ...conn, onEvent: onConnEvent })`.

`emitTerminal`, `onConnEvent`, backoff/stability timers, `stop()`, `send()`, and the wire cadence are
unchanged. **Not touched:** reconnect cadence, fatal-close-code handling, the handshake (per ticket).

### Data flow (automatic reconnect after this change)

```
transient closed ─▶ supervisor.onConnEvent: backoffTimer = setTimer(dial, jitter)
  timer fires ─▶ dial(): await resolveConnection()          ← driver's wrapper
                   driver.resolveConnection: await loadDialConfig()   ← daemonConnection's provider
                     pairedServer.load()  (FRESH record)  ─▶ deriveDialConfig
                     stash pendingSession; return connection
                 createConnection({ ...fresh connection }) ─▶ 'connected'
  connected ─▶ driver.onConnected: material = pendingSession (fresh session material)
                 createNoiseSession(material) ─▶ fresh Noise_IK handshake ─▶ handshake-complete
```

`daemonConnection.dial()`/`reconnect()` (the #82 explicit path) is unchanged; a re-pair still tears
down the whole driver via `reconnect()` (connect-on-pair). This ticket only changes what the
supervisor's *own* automatic re-dial reads.

## State + concurrency model

- **One `load()` per dial.** The driver's `resolveConnection` is the single load site for an automatic
  re-dial; it feeds the supervisor's connection and stashes the session for `onConnected`. No
  independent second load, so no re-pair-mid-dial split between headers and key.
- **The async re-dial is fenced against stop/supersede.** `dial()` re-checks `stopped` after the
  `await`. During a backoff gap there is no live connection, so `stop()` is the only thing that can
  race the reload; its `emitTerminal` sets `stopped` and clears timers, and the post-await check
  aborts the dial. The driver's generation counter continues to fence a late/stale session install
  and any superseded driver's events (unchanged from #82/#50).
- **Single live transport, always.** Unchanged: the supervisor holds at most one `current` connection;
  `daemonConnection.dial()` stops the prior driver before constructing the next.
- **No new async ownership.** No new timers, listeners, sockets, or `AbortController`s — the reload
  reuses the existing backoff timer's callback and the existing session lifecycle. Teardown is still
  `stop()` on `will-quit`. `loadDialConfig` is a plain async function, not a subscription.
- **`firstConnect`/`firstDial` are single-writer** module locals flipped once; no cross-await
  check-then-act on shared state.

## Error handling

- **Reconnect finds no record** (`load()` → `null`, e.g. the record was cleared mid-session without a
  clean `stop()`): `resolveConnection` returns `null` → supervisor `emitTerminal(NO_PAIRED_RECORD_
  CLOSE_CODE)` → driver `onTerminal` → `daemonConnection` `emitFailed('connection-closed')`. A
  non-connected `failed` event, no crash, no throw (AC3). Supervision ends; a subsequent re-pair
  rebuilds via #82's `reconnect()`.
- **Reconnect hits a malformed record / bad key / keychain failure**: `loadDialConfig` (via
  `deviceKeypair.ensure`, `decodeServerKey`, or `MalformedPairedServerRecordError`) throws.
  `resolveConnection` **catches it and returns `null`** (see §Design part 2 — mandatory), so the
  supervisor fail-closes via `emitTerminal(NO_PAIRED_RECORD_CLOSE_CODE)` exactly as for the no-record
  case. The throw never reaches the supervisor's `await` as a rejection. Fail-closed, non-connected,
  no crash, no unhandled rejection (AC3). The caught object is dropped, never logged (AC4).
- **First dial, not-paired / connect-failed**: unchanged — `bootstrap` emits `failed('not-paired')`
  or `failed('connect-failed')` with #82's messaging.
- **No new `DaemonEvent` codes.** The reconnect fail-closed reuses the existing `connection-closed`
  failed event. No new reject branches in the state machine beyond the one null-config check per
  layer.

## Testing strategy

`npm test` (vitest), `npm run typecheck`. Every change is additive (optional provider fields), so the
**entire existing suite across all three files must stay green unchanged** — assert this explicitly.
New scenarios as bullets (write in the project idiom; reuse each file's `setup`/`build` harness):

### `relaySupervisor.test.ts`

- **Auto re-dial reloads the connection via `resolveConnection`.** `setup` with `connection: A` and a
  `resolveConnection` returning `B`. First dial builds a connection with A's url/headers (assert on the
  captured config). Emit a transient `closed`; fire the backoff timer; `await` a microtask (dial now
  awaits). Assert the second connection was built with B's url/headers — the fresh record, not A.
- **Fails closed when `resolveConnection` returns `null` on re-dial.** `resolveConnection` → `null`.
  Reach a connected state, drop, fire backoff, await. Assert exactly one `terminal` with
  `code === NO_PAIRED_RECORD_CLOSE_CODE`, no new connection created, and no pending timers remain.
- **`stop()` during an in-flight reload does not dial.** `resolveConnection` returns a test-controlled
  deferred promise. Drop → fire backoff → dial awaits. Call `stop()`; then resolve the deferred. Assert
  no new connection is created and the only terminal is `{1000,'stopped'}`.
- **First dial ignores the provider.** With a `resolveConnection` set, assert the *immediate*
  construction-time dial used `config.connection` (built synchronously, one connection present before
  any timer/await) — the provider is only for re-dials.
- **Existing suite unchanged** (no `resolveConnection` → synchronous `config.connection` on every
  dial, including re-dials): the backoff-sequence, stability-reset, fatal-close, and stop tests pass
  verbatim.

### `noiseRelayDriver.test.ts`

- **Reloads session material on reconnect when `loadDialConfig` is set.** `setup` passing
  `loadDialConfig` returning a `DialConfig` whose `session` is a distinct `SESSION_B`. First
  `emit({type:'connected'})` → session built from `config.session` (`SESSION_MATERIAL`). To simulate a
  re-dial: invoke the captured `supervisor().config.resolveConnection?.()` (as the real supervisor
  would before re-dialing), `await`, then `emit({type:'connected'})` again. Assert the second session
  was built with `SESSION_B`'s `remoteStaticPublicKey`/`hello`, not the first material.
- **First connect uses `config.session` even with `loadDialConfig` present** (`firstConnect` gate).
- **A thrown `loadDialConfig` fails closed, not crashes.** `loadDialConfig` rejects (simulate a
  `MalformedPairedServerRecordError` / bad-key throw). Invoke the captured `resolveConnection()` and
  assert it **resolves to `null`** (never rejects) and left `pendingSession` null — the mandatory
  catch. (The supervisor's null → terminal mapping is covered in `relaySupervisor.test.ts`; together
  they prove malformed-record-on-reconnect ends supervision with no unhandled rejection — AC3.)
- **No `loadDialConfig` → every connect uses `config.session`** (existing multi-`connected` /
  re-handshake tests pass verbatim; assert explicitly).
- **Defensive:** a `connected` with `pendingSession` null (never populated) emits an `error`, not a
  crash. (Low priority; structurally unreachable — note it or skip.)

### `daemonConnection.test.ts`

- **`loadDialConfig` is threaded into the driver.** After `build()` + start, `drivers[0].config.loadDialConfig`
  is a function.
- **The threaded provider re-sources the record.** Multi-return `load`: `RECORD_A` then `RECORD_B`
  (distinct relay/server/key). `bootstrap` consumes A (first dial). Invoke
  `drivers[0].config.loadDialConfig()` and assert the returned `DialConfig.connection.url === B.relay`,
  the `X-Pyrycode-Server` header is B's, and `session.remoteStaticPublicKey` decodes B's
  `server_static_pubkey` (use the REAL codec, as this suite already does).
- **The provider returns `null` when a later load is unpaired.** `load` → `RECORD` then `null`;
  `bootstrap` consumes `RECORD`; `drivers[0].config.loadDialConfig()` resolves `null`.
- **Secret-free across a reload (AC4).** Extend the existing "never logs / no event carries the token"
  test: invoke `loadDialConfig()` (which handles the token + server key) and assert no `console.*` and
  that no emitted `DaemonEvent` serialization contains the token, `server_static_pubkey`, or private
  key. (The reload emits nothing itself; this pins that no secret escapes the background process — AC5.)

## Open questions

- **Fail-closed message fidelity.** The reconnect-with-no-record path surfaces as
  `failed('connection-closed', 'The connection to pyrybox was closed (code 4000).')` — technically a
  non-connected event (AC3 satisfied) but the message says "closed", not "not paired". The common
  not-paired case (never paired at launch) still gets the correct "No paired pyrybox" message via
  `bootstrap`. A dedicated not-paired message on the *reconnect* path (route the synthetic code to a
  `not-paired` classification in the driver's `onTerminal`) is a possible refinement — deferred as
  evidence-based: the reconnect-finds-no-record case is rare (requires clearing the record mid-session
  without stopping the connection). Developer may keep the generic message.
- **`NO_PAIRED_RECORD_CLOSE_CODE` value.** `4000` (WebSocket private-use range, never sent on the
  wire). If it reads as confusable with a real relay code, any clearly-synthetic constant is fine;
  keep it named and documented.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the only boundary is the existing disk→memory read
  `pairedServer.load()` (safeStorage-decrypted blob → structurally validated by `decodeRecord`, then
  `decodeServerKey`'s 32-byte check). This ticket re-crosses that *same* boundary once per automatic
  reconnect instead of once at construction; the validators are re-run each dial. No new boundary, and
  reload-and-revalidate-per-dial is a strengthening (the client analog of the daemon's reload-at-
  handshake, pyrycode #782). No renderer boundary is crossed — `loadDialConfig` is a main→main
  in-process function; the record never reaches IPC/preload/renderer (AC5).
- [Tokens, secrets] SHOULD FIX (addressed in-spec) — a malformed/undecryptable record or keychain
  failure on reconnect makes `loadDialConfig` *throw*; if uncaught it escapes as an unhandled rejection
  at the supervisor's `await`, violating AC3's "never a throw out of the transport" and echoing a
  key/token in the reject. The spec now **mandates** `resolveConnection` catch it and return `null`
  (drop the caught object), with a test (`noiseRelayDriver.test.ts` thrown-reload → resolves null). No
  new secret storage/serialization: the reload re-derives the `token` (relay header + `hello`) and
  `server_static_pubkey` exactly as `bootstrap`; `pendingSession` is a main-process-only local,
  never logged or crossed to the renderer.
- [File / storage] N/A — no filesystem code added. The reload calls the existing read-through
  `pairedServer.load()` (safeStorage, ADR 0005); no untrusted input reaches a path (fixed store name
  `PAIRED_SERVER_NAME`), no new check-then-open. A tampered ciphertext fails to decrypt → `load()`
  propagates → caught → fail closed, never a malicious dial.
- [Electron attack surface] No findings — no new IPC channel, no `contextBridge`/`webPreferences`
  change. The provider is main-side; the renderer cannot invoke it or influence which record loads
  (the record is written only by the operator-confirmed pairing path, #82). The automatic reconnect is
  relay-driven, not renderer-driven, so it adds no renderer-triggerable churn surface. Transport/keys/
  socket stay in main (ADR 0002).
- [Cryptographic primitives] No findings — no crypto added. Every reconnect already drives a **fresh**
  Noise_IK handshake (v2 has no session resume; `noiseRelayDriver.ts:6-7`); the reload only changes
  which static key / `hello` feed that fresh session. Each `onConnected` builds a new session with new
  ephemerals and reset nonce counters, so no `(key, nonce)` pair is reused across dials. The device
  static key is reused as long-term identity by design (ADR 0002). The 32-byte `decodeServerKey` check
  runs on every reload.
- [Network & I/O] No findings — the derived connection carries `maxFrameBytes: MAX_FRAME_BYTES` (the
  inbound-frame cap) on every reload, same as `bootstrap`; the developer MUST include it (a test pins
  the reloaded config's headers/url — extend it to assert the cap). The relay URL is the pairing-time-
  validated (#52) record value, re-read not re-validated — consistent with `bootstrap` and gated by
  safeStorage integrity. Reconnect cadence, capped jittered backoff, and fatal-close handling are
  explicitly **unchanged**, so the added per-dial keychain read is bounded by backoff (≤ one per capped
  interval) — no tight loop, no DoS amplifier. The reload's `await`s are the same fast fail-closed
  keychain reads `bootstrap` already performs unbounded; no new unbounded-wait class is introduced.
- [Error messages, logs] No findings — no new logging; the reload is log-free by construction, caught
  errors dropped (classify-don't-forward). The reconnect fail-closed surfaces a static
  `failed('connection-closed', '…(code 4000)')`; no token/key/transcript in any message. The AC4
  secret-free test is extended to exercise a reload.
- [Concurrency] No findings — the ticket's named race (in-flight reload vs stop/supersede) is fenced by
  the supervisor's single post-`await` `stopped` re-check: during a backoff gap `current === null`, so
  `stop()` is the ONLY event that can race the reload, and its `emitTerminal` sets `stopped` before the
  check aborts the dial. The driver's generation counter continues to fence a stale session install.
  `pendingSession`/`firstDial`/`firstConnect` are single-writer, sequential per dial. No new timers,
  listeners, sockets, or `AbortController`s; single-live-transport unchanged.
- [Threat model] Aligned / inherited — a hostile on-path relay drop-flooding forces backoff-bounded
  reconnect-reloads (no plaintext leak, no hang); token-theft-from-disk is bounded by safeStorage (a
  forged record needs the OS keychain — that is the trust boundary, inherited from ADR 0005/#82, not
  weakened here). Hostile-daemon-response parsing and renderer-compromise isolation are untouched by
  this ticket. Reconnect rate-limiting / relay-side abuse handling remains out of scope (#35 and the
  relay per #82's carry-forward).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
