# 933 — Skip a `real-*` spec when the daemon lacks a required capability

## Files read

- `e2e/fixtures/realDaemon.ts` → the `daemon` fixture, `resolvePyryBin`, `runPyryPair`,
  `decodePairFields`, `waitForDaemonReady` — the skip-gate this ticket extends, the credential-skip
  wording it must match, and the `pairFields` the capability read reuses.
- `e2e/real-claude-question-answer.spec.ts` → its fixture-option block (`QUESTION_MODEL`,
  `skipPermissions`, `interactiveRunner`, `allowRemotePermissions`) — the single consumer that
  declares `question`, and the place the new option is added.
- `src/main/transport/helloExchange.ts` → `buildClientHello`, `parseHelloAck` — the two ends of the
  harness-side read. `parseHelloAck`'s absent-`capabilities` → `[]` rule is why "pre-#2020 daemon"
  and "daemon advertising nothing" are one case.
- `src/main/transport/noiseRelayDriver.ts` → `createNoiseRelayDriver`, `RelaySessionEvent`
  (`handshake-complete` carries `helloAck`), `SessionMaterial` — the probe's whole transport.
  Electron-free: it imports only sibling transport modules.
- `src/main/transport/noiseLib.ts` → `loadNoiseLib` — the shared wasm loader; `CreateKeyPair` on it
  is how the probe mints its own ephemeral static identity without touching `deviceKeypair`
  (which needs `safeStorage`).
- `src/main/transport/codec.ts` → `base64StdDecode` — decodes `server_static_pubkey`.
- `src/main/daemonConnection.ts` → `loadDialConfig`, `decodeServerKey`, `relayClientDialUrl` — the
  production dial the probe mirrors (headers, empty prologue, `/v1/client` path).
- `src/main/transport/fakeRoutingRelay.ts` → `startFakeRoutingRelay`, `onClientMessage` — client
  legs are multiplexed by conn-id (no first-claim-wins), and a client frame sent before the server
  leg is OPEN is **silently dropped**. That drop is the probe's one real hazard.
- `e2e/reporters/zeroExecutedGate.ts` → `ZeroExecutedGate.onTestEnd` — reads `testInfo.skip`
  descriptions verbatim off the annotations, so the reason string is operator-facing output.
- `vitest.config.ts`, `playwright.config.ts`, `playwright.real-claude.config.ts` → the two-way
  `src/` vs `e2e/` separation the unit spec has to fit into.
- `docs/knowledge/features/real-claude-liveness-e2e.md` § "Readiness — Send-enabled, not
  `relay.whenReady()`" → the lesson that decides the probe's retry design: `whenReady()` is
  chicken-and-egg, and a first frame that beats the daemon's `/v1/server` registration is dropped
  by the relay and only heals on a **re-dial**.
- `docs/knowledge/features/real-claude-liveness-e2e.md` § "Edge cases" → `pyry pair` stdout is never
  echoed; stderr surfacing is startup-only. Both rules extend to everything added here.
- Upstream `pyrycode` (checked out at `~/Workspace/Projects/pyrycode`, `main`):
  `internal/relay/v2session_handshake.go` → `supportedV2Capabilities` and `negotiateCapabilities`;
  `internal/devices/device.go` → `Device`, `RedeemBy`. See Context for what these two settle.

## Context

`e2e/fixtures/realDaemon.ts` gates every `real-*` spec on whether a `pyry` binary resolves, and on
nothing that binary can *do*. A daemon that predates a feature therefore produces a test **failure**,
and the dispatcher's real-claude gate routes a failure back to a builder who cannot rebuild a Go
binary. A stale daemon is an environment fault — the same class as a missing credential — so it has
to present as a **skip**, which parks the run in Inbox for the operator instead.

Two upstream facts settle the design, and both were verified in the checked-out daemon tree rather
than assumed:

**The ack carries an intersection, not the daemon's set.** `negotiateCapabilities` returns
*the client's advertised set ∩ `supportedV2Capabilities`*. A probe that advertises nothing learns
nothing. So the probe must advertise **exactly the capabilities the spec declares**: then
`ack.capabilities ⊆ required`, and `missing = required \ ack.capabilities` is exact.

**The pairing token is not consumed by a handshake.** `Devices.Validate` is a pure hash lookup, and
`Device.RedeemBy`'s own comment states that nothing reads it yet and that "a redeemed device keeps
authenticating past it". So the probe can reuse the app's `pairFields` without spending them, and
even the documented future redemption slice keeps re-authentication working. This is the one
cross-repo assumption worth re-checking if the probe ever starts breaking the app's pairing; the
alternative (a second `pyry pair` minting a probe-only device, which the daemon would pick up via
its per-handshake `Devices.Reload`) is deliberately **not** built, per evidence-based fix selection.

No ADR is warranted: this adds no cross-cutting decision, only a harness gate.

## Design source

**Figma:** N/A — no UI surface. This ticket touches only `e2e/` harness code and two test configs.

## Design

Three pieces, in order of trust.

### 1. `e2e/fixtures/daemonCapabilityGate.ts` — the decision, pure

The whole skip-or-not judgement is one total function with no I/O, so it is coverable under
`npm test` (nothing in this repo can assert on its own Playwright skip).

```ts
export type CapabilityReadFailure = 'handshake-failed' | 'malformed-ack' | 'timeout'
export type CapabilityRead =
  | { ok: true; capabilities: readonly string[] }
  | { ok: false; cause: CapabilityReadFailure }
export type CapabilityGateDecision = { skip: false } | { skip: true; reason: string }

export function decideCapabilityGate(
  required: readonly string[],
  read: CapabilityRead
): CapabilityGateDecision
```

Rules, in order:

1. `required` empty → `{ skip: false }` **unconditionally**, even on a failed read. This is AC1's
   invariant expressed in the type: a spec that declares nothing is gated exactly as today.
2. `read.ok === false` → skip, reason names `read.cause` (fail closed, AC3).
3. `missing = required \ read.capabilities` non-empty → skip, reason names each missing capability
   (AC2).
4. otherwise → `{ skip: false }`.

**The reason string is built only from client-owned constants and from `required`** — never from
`read.capabilities`. Daemon-advertised strings are untrusted text and the reason is operator-facing
output that `ZeroExecutedGate` prints verbatim, so nothing the daemon typed is echoed. This is what
makes AC4 structural rather than a discipline.

Both reason shapes name the daemon as the stale thing and carry the rebuild-and-install command,
matching the concreteness of the existing credential skip's `security find-generic-password …` line:
`go build -o ~/.local/bin/pyry ./cmd/pyry` from a current `pyrycode` checkout, or `PYRY_BIN` pointed
at a freshly built binary.

### 2. `readDaemonCapabilities` — the harness-side read (same file)

```ts
export async function readDaemonCapabilities(input: {
  relayUrl: string
  pairFields: Pick<QrPayload, 'server' | 'token' | 'server_static_pubkey'>
  advertise: readonly string[]
  attemptTimeoutMs?: number
  deadlineMs?: number
}): Promise<CapabilityRead>
```

Total — it never throws and never rejects; every failure becomes a `cause`. It mirrors
`daemonConnection`'s `loadDialConfig` field-for-field (same four headers, empty prologue,
`/v1/client` path) with three substitutions: an ephemeral static key minted from `loadNoiseLib`'s
`CreateKeyPair` instead of the persisted device keypair, `advertise` instead of the production
`[CAPABILITY_INTERACTIVE]`, and a probe-shaped device name / client version.

One attempt: construct a `createNoiseRelayDriver`, settle on the first of —
`handshake-complete` → `parseHelloAck` (throw → `malformed-ack`), `error` / `terminal` →
`handshake-failed`, attempt timer → `timeout` — then `stop()` the driver. Settling is one-shot;
`stop()` re-enters synchronously through `terminal` and must be inert by then.

**Retry is load-bearing, not defensive.** The relay drops a client frame that arrives before the
daemon's `/v1/server` leg is OPEN, and nothing re-sends it — `real-claude-liveness-e2e.md` records
that the app only recovers from this by re-dialling. `relay.whenReady()` cannot be awaited first
(chicken-and-egg: it needs a client leg, and the probe is the client leg). So a `timeout` attempt
re-dials until the overall deadline; `handshake-failed` and `malformed-ack` return immediately,
being deterministic.

### 3. `e2e/fixtures/realDaemon.ts` — the wiring

A new additive option fixture `requiredCapabilities: readonly string[]`, default `[]`, in the
`RealDaemonOptions` shape alongside `claudeModel`. In the `daemon` fixture, after
`waitForDaemonReady` and before `use(...)`:

```
if (requiredCapabilities.length > 0) { read → decide → testInfo.skip(true, reason) }
```

The short-circuit is what keeps the nine existing specs byte-identical: they declare nothing, so no
probe is dialled and no code between `waitForDaemonReady` and `use` runs at all.

This is the file's **first skip after resource creation** and that deserves the comment the existing
"skip before creating any resource" note gets: the read needs a running daemon, and the fixture's
`try`/`finally` already reaps the process group and both temp dirs on any exit path, so a late skip
leaks nothing.

`e2e/real-claude-question-answer.spec.ts` declares `test.use({ requiredCapabilities: ['question'] })`
next to its existing overrides (AC5).

### 4. The two configs

The unit spec must run under vitest and must not be collected by Playwright. Today
`vitest.config.ts`'s `include` is `src/` only and Playwright's default `testMatch` would collect a
`*.test.ts` under `testDir: './e2e'`. Both get one line so the separation becomes an explicit
invariant — **`.spec.ts` is Playwright, `.test.ts` is vitest**:

- `vitest.config.ts` → add `'e2e/**/*.test.ts'` to `include` (never `e2e/**/*.spec.ts`).
- `playwright.config.ts` → add `testMatch: /(^|\/)[^/]*\.spec\.ts$/`.
  `playwright.real-claude.config.ts` already matches `.spec.ts` only and needs no change.

## State + concurrency model

No store, no React, no IPC. The probe owns exactly one `NoiseRelayDriver` at a time, and every exit
path calls `stop()` — which drives the supervisor's single `terminal` and closes the session. A
per-attempt `setTimeout` is cleared on every settle. The settle latch is a plain boolean guarding one
`resolve`, so the synchronous `terminal` that `stop()` itself emits cannot double-settle.

Teardown ordering is unchanged: the probe opens and closes its client leg entirely inside the
`daemon` fixture's setup, strictly before the `page` fixture dials the app's own leg. The relay's
`clients` map deletes the entry on close, so no stale conn-id survives into the app's run.

## Error handling

Fail closed, everywhere, into a skip — never a failure, never a hang:

| Failure | Becomes |
|---|---|
| `server_static_pubkey` not decodable / not 32 bytes | `handshake-failed` |
| wasm load / keypair mint rejects | `handshake-failed` |
| driver `error` (any `RelaySessionErrorReason`) or `terminal` | `handshake-failed` |
| `parseHelloAck` throws `WireDecodeError` | `malformed-ack` |
| no ack within the attempt window, retried to the deadline | `timeout` |

Caught error **objects** are dropped, never forwarded into the reason — a codec or wasm message can
echo transcript bytes. Only the static cause crosses, exactly as `noiseRelayDriver` classifies its
own catches. The module emits no logs.

## Testing strategy

`e2e/fixtures/daemonCapabilityGate.test.ts` (vitest, node) covers the pure function only — the probe
is an effectful edge over the real wasm + a real socket, and the repo's precedent
(`noiseKeyPairGenerator.ts`) is to leave that edge to the integration path:

- empty `required` + a failed read → no skip; empty `required` + an ok read → no skip (AC1).
- `required: ['question']` against `['interactive','question']` → no skip (AC5's client half).
- against `['interactive']` and against `[]` → skip; reason names `question`, names the daemon as
  stale, and carries both `go build` and `PYRY_BIN`.
- two missing capabilities → both named.
- each of the three `CapabilityReadFailure` causes → skip, reason names that cause (AC3).
- a read whose `capabilities` contains an attacker-shaped string → that string appears nowhere in
  the reason (AC4, and the direct proof that the reason is built from client-owned constants).

Not covered by vitest, and deliberately: the probe's live behaviour and AC5's "10 executed" half are
operator observations under `npm run e2e:real:gate`, recorded in the PR — the same convention #252
and #479 set for every real-stack claim.

## Open questions

- Whether the probe should mint its own device via a second `pyry pair` rather than reuse
  `pairFields`. Resolved in Context: reuse, because `Validate` is a pure hash lookup today and stays
  re-authenticating under the documented redemption slice. Revisit only if observed to break.
- Attempt window and overall deadline. Starting values: 3s attempt / 15s overall, sized against
  `DAEMON_READY_TIMEOUT_MS` (10s) — the daemon is already control-socket-ready when the probe runs,
  so the only thing being absorbed is relay-leg registration. Record any change here as a revision.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** SHOULD FIX — the design has one new untrusted→trusted edge, the daemon's
  `hello_ack` bytes, and it is already an existing single named function (`parseHelloAck`). But the
  daemon-typed `read.capabilities` strings then flow into `decideCapabilityGate`, whose output is
  printed verbatim by `ZeroExecutedGate`. The set difference MUST be computed as a filter over
  `required` (`required.filter(c => !advertised.includes(c))`), never as a filter or a map over
  `capabilities` — the two are equal in value and opposite in provenance, and only the first
  guarantees every string in the reason is client-owned. Enforced in Phase B by the unit case that
  feeds an attacker-shaped string in `capabilities` and asserts it appears nowhere in the reason.
- **[Tokens, secrets, credentials]** No findings on storage or generation: the probe persists
  nothing, generates no token, and mints its ephemeral Noise static through
  `loadNoiseLib().CreateKeyPair` (`crypto.getRandomValues`-backed), never `Math.random()`. It does
  carry the existing `pairFields.token` in the `X-Pyrycode-Token` header and in the hello
  early-data, exactly as `daemonConnection`'s `loadDialConfig` does. The one way that token could
  escape is an *uncaught* throw whose stack Playwright prints, so `readDaemonCapabilities` is
  specified **total**: its whole body is wrapped, every caught object is dropped, and it resolves a
  `cause` instead of rejecting. That contract is the security control, not an ergonomic choice.
- **[File / storage operations]** Not applicable by design — the probe performs no filesystem
  operation at all. No path is built from any daemon- or wire-supplied value, so there is no
  traversal or TOCTOU surface to reason about. The fixture's existing `mkdtemp` dirs are untouched.
- **[Electron / IPC attack surface]** Not applicable by design — the change adds zero files under
  `src/` and zero IPC channels; `webPreferences`, the `contextBridge` surface and the navigation
  guards are not read or modified. The probe runs in the Playwright worker (plain Node), never in a
  renderer. Importing `src/main/transport/*` from `e2e/` is the direction already established by
  `realDaemon.ts`'s own `fakeRoutingRelay` / `relayPolicy` / `secretBackend` imports — no new
  coupling, and nothing flows the other way.
- **[Cryptographic primitives]** No findings — no primitive is added, chosen, or re-implemented. The
  handshake is `createNoiseRelayDriver` → `createNoiseSession` → noise-c.wasm, consumed unchanged,
  at the pinned `Noise_IK_25519_ChaChaPoly_BLAKE2s` variant. The probe's static key is reused across
  retry attempts within one call, which is not key reuse in the dangerous sense: each attempt is a
  fresh Noise session with fresh ephemerals, which is precisely what a long-term static in IK is
  for. No `(key, nonce)` pair is reachable twice. Worth stating explicitly since it looks like a
  weakening and is not: the probe authenticates on the token alone because the daemon's `Device`
  record carries no static pubkey to pin against — that is the daemon's model, not a hole this
  ticket opens.
- **[Network & I/O]** SHOULD FIX — two bounds must actually be present in Phase B. (a) The inbound
  frame cap: the probe passes no `maxFrameBytes`, inheriting `relayConnection`'s 1 MiB default;
  leaving it unbounded is not an option and the default must not be overridden upward. (b) The
  suite-hang bound (AC3): `createNoiseRelayDriver` builds a `relaySupervisor` that re-dials with
  backoff on its own, so a driver left running after a settle would keep reconnecting for the rest
  of the run. `stop()` therefore belongs in a `finally` on **every** attempt including the
  successful one, the per-attempt timer must be cleared on every settle, and the retry loop must be
  bounded by an absolute deadline rather than an attempt count. The `ws://` loopback scheme is
  correct here and is not a TLS downgrade: the relay is the harness's own in-process
  `startFakeRoutingRelay`, and the app's acceptance of a loopback relay stays behind the
  `app.isPackaged`-gated `PYRY_ALLOW_LOOPBACK_RELAY` flag, which this module does not touch.
- **[Error messages, logs, telemetry]** No findings — the module is log-free by construction (no
  `console.*`), mirroring `fakeRoutingRelay.ts`. Its only output is the skip reason, which is
  operator-facing and therefore covered by the Trust-boundaries finding above. Caught error objects
  are dropped rather than classified-and-forwarded, because a codec or wasm message can echo
  transcript bytes. `playwright.real-claude.config.ts` already disables trace, screenshot and video,
  and this ticket does not change it. `pyry pair` stdout is not read by anything added here.
- **[Concurrency]** No findings, given the contracts above: one driver in flight at a time, a
  one-shot settle latch so the synchronous `terminal` that `stop()` itself emits cannot double-settle,
  and a probe whose whole lifetime is inside the `daemon` fixture's setup — strictly before the
  `page` fixture dials the app's leg, so the app and the probe are never concurrently connected. The
  relay deletes a client entry on close, so no stale conn-id survives into the app's run.
- **[Threat model alignment]** Hostile relay: out of scope by construction (the relay is the
  harness's own in-process fake), though the probe's failure handling is fail-closed against drop /
  reorder anyway — a dropped frame becomes `timeout` becomes a skip. Hostile daemon response:
  addressed — `parseHelloAck` is the defensive parse, and a malformed ack becomes `malformed-ack`
  with none of its strings reaching the reason. Token theft from disk and renderer compromise: not
  in scope and not affected, since nothing at rest and nothing under `src/` changes.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
