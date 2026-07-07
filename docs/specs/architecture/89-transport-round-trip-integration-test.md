# Spec #89 — Automated transport round-trip test

**Ticket:** [#89](https://github.com/pyrycode/pyrycode-desktop/issues/89) · Split from #39
**Size:** S (PO) — confirmed S. One new test file, **zero production code**.
**Labels:** `security-sensitive` (security review appended below — mandatory for this ticket).

## Context

Today the only end-to-end check of the assembled background relay client is the manual capstone
(#13, closed). Every layer has unit tests, but mobile's connection-layer bugs surfaced only under a
**real round-trip through the assembled client** — never under per-layer unit tests. This ticket adds
the first automated end-to-end coverage: it drives the assembled `createDaemonConnection`
(bootstrap → real driver → real Noise session → real relay socket) through a genuine
`Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake, send, and streamed reply against the in-process
fake target that landed in its blockers — `startFakeRelayForwarder` (#90) + `startFakeDaemon` (#91) —
and asserts the reply reaches the renderer bridge with the session still open.

The value over the existing `noiseSession.interop.test.ts` is the **layer under test**: that test
wires the primitives directly (`createNoiseSession` + `createRelayConnection` + `codec`); this one
drives the whole assembled stack at its real entry point (`createDaemonConnection.start()`), leaving
the `createDriver` seam at its default so the real `createNoiseRelayDriver` → real Noise handshake
runs. Only the outer seams `daemonConnection.test.ts` already fakes are injected: the two stores
(`deviceKeypair.ensure()` / `pairedServer.load()`) and a captured `sink`.

An opt-in **live variant** mirrors the operator-gated path already established in
`noiseSession.interop.test.ts`: the same round-trip runs against the live relay + pyrybox daemon only
when a real paired credential is supplied via the environment, and skips cleanly otherwise.

## Files to read first

- `src/main/daemonConnection.ts:42-116` — `DaemonConnectionDeps` (the DI seams) + `createDaemonConnection`.
  Extract: `createDriver` **defaults to the real** `createNoiseRelayDriver` (leave it unset here); the
  record's `relay` becomes the dial URL verbatim and `server_static_pubkey` is decoded to the 32-byte
  responder static (`decodeServerKey`, `:105-111`).
- `src/main/daemonConnection.test.ts:27-152` — the seam-faking pattern to reuse: `fakeSink()` /
  `emitted()` (`:96-102`), `makeStores()` (`:105-115`), the `build()` deps shape (`:117-140`). Here you
  reuse the sink + store fakes but **omit `createDriver`** (real driver) and drive over the real socket
  instead of `drivers[0].emit(...)`.
- `src/main/transport/fakeRelayForwarder.ts:20-38` — `FakeRelayForwarder` handle (`url`, `whenReady`,
  `close`). Extract: leg paths are `${url}/v1/client` (real client) and `${url}/v1/server` (fake
  daemon); `whenReady()` resolves once both legs splice.
- `src/main/transport/fakeDaemon.ts:54-90, 101-124` — `startFakeDaemon(options)`; `FakeDaemonOptions`
  (`url`, `buildReply`, `helloAck`); `FakeDaemon` (`staticPublicKey`, `whenSettled`, `close`). Extract:
  the daemon dials `${url}/v1/server`; `staticPublicKey` is what the record's `server_static_pubkey`
  must encode; **the default `buildReply` echoes verbatim and must be overridden** (see Design §3).
- `src/main/transport/noiseSession.interop.test.ts:176-202, 365-474` — the reusable `makeWaiter`
  (resolve-on-timeout, `:176-202`), and the operator-gated live convention: `readLiveEnv()` env-var
  names + `describe.skipIf(!live)` (`:376-474`). Extract: **reuse the same env-var names and skip
  pattern — do not invent a new one**; note the live path generates a **fresh in-process device
  keypair** and never logs the credential.
- `src/main/transport/inboundMessage.ts:92-110` — `parseInboundMessage`: a `message` envelope →
  `{kind:'message'}`, a `message_chunk` → `{kind:'chunk'}`, any other well-formed type → `null`
  (ignored). This is why `buildReply` must return a `message`/`message_chunk` envelope.
- `src/main/transport/sendMessageEnvelope.ts:36-44` — `connection.send()` puts a **`send_message`**
  envelope on the wire; that is the `inboundPlaintext` the daemon's `buildReply` receives (and the
  default echo re-sends it, which the client correctly ignores).
- `src/shared/ipc/events.ts:32-38` — the `DaemonEvent` union: assert on `type` ∈ {`connecting`,
  `connected`, `failed`, `messageReceived`, `messagesReceived`}.
- `src/main/transport/codec.ts` — `encodeEnvelope`, `base64StdEncode` (build the reply envelope; encode
  the daemon static into the record). `src/shared/wire/types.ts` — `MessagePayload`, `PairedServerRecord`
  shape (`server`, `relay`, `token`, `server_static_pubkey`).
- `src/main/transport/noiseLib.ts` — `loadNoiseLib()`; use `lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)`
  to mint the device static keypair the `ensure()` seam returns (mirrors the interop test — noise-c CSPRNG,
  never `Math.random()`).

## Design

New file: **`src/main/daemonConnection.roundtrip.test.ts`** (sibling to `daemonConnection.ts`; a
`.test.ts` so vitest runs it and it can import the test-only harness without entering the production
graph). Two `describe` blocks.

### 1. Shared helpers (reuse existing patterns, do not re-invent)

- **Recording sink** — replace `daemonConnection.test.ts`'s spied sink with one that records events
  **and notifies a waiter**, so the test can await an event over the real async socket:

  ```ts
  // contract sketch — not the full body
  const events: DaemonEvent[] = []
  const waiter = makeWaiter()                       // copied from noiseSession.interop.test.ts
  const sink = { webContents: { send: (_ch, ev) => { events.push(ev); waiter.notify() } } }
  ```

- **`makeWaiter`** — copy the resolve-on-timeout waiter from `noiseSession.interop.test.ts:176-202`
  verbatim. Resolve-on-timeout (never reject) keeps a failed handshake surfacing as a **descriptive
  assertion** (`expected connected; observed [connecting, failed]`) rather than an opaque vitest timeout.
- **`cleanups: Array<() => void>` + `afterEach`** — copy the interop test's LIFO cleanup array so a
  mid-test throw still tears everything down (see §4 for teardown order).

### 2. Fake-target run (unconditional under `npm test`) — AC1, AC2, AC3

Ordering is load-bearing (each step depends on a value from the previous):

1. `const forwarder = await startFakeRelayForwarder()` — ephemeral loopback port.
2. `const daemon = await startFakeDaemon({ url: forwarder.url, buildReply: <see §3> })` — dials
   `/v1/server`; its leg is **OPEN before the client dials**, so the client's msg1 is never dropped.
3. Build the paired-server record from the two now-known values:

   ```ts
   // contract sketch
   const record: PairedServerRecord = {
     server: 'fake-srv',
     relay: `${forwarder.url}/v1/client`,                    // real driver dials this verbatim
     token: 'dummy-token-not-a-real-credential',             // synthetic — never a real credential
     server_static_pubkey: base64StdEncode(daemon.staticPublicKey)
   }
   ```
4. Mint a **real** device static keypair via `loadNoiseLib().CreateKeyPair(...)` and build the deps —
   the two stores return the record / keypair; `sink` is the recording sink; `now` is a fixed clock;
   **`createDriver` is omitted** (defaults to the real `createNoiseRelayDriver`):

   ```ts
   // contract sketch — deviceKeypair.ensure() returns { privateKey, publicKey } from CreateKeyPair
   const connection = createDaemonConnection({
     deviceKeypair: { ensure: async () => devicePair },
     pairedServer: { load: async () => record, save: async () => {} },
     sink, deviceName: 'roundtrip-desktop', clientVersion: '0', now: () => FIXED_TS
   })
   ```
5. `connection.start()` — emits `connecting`, then the real driver dials `/v1/client` and runs the
   genuine IK handshake through the forwarder splice to the fake daemon.
6. `await forwarder.whenReady(<generous>)` — explicit checkpoint that both legs spliced (clearer failure
   than waiting only on `connected`).
7. `await waiter.wait(() => events.some(e => e.type === 'connected'), <local timeout>)`.
8. `connection.send({ conversation_id, message_id, text })` — encrypts a `send_message` onto the live
   session.
9. `await waiter.wait(() => events.some(e => e.type === 'messageReceived'))` **and**
   `await daemon.whenSettled()` (expect `{ ok: true }`) — the two deterministic sync points.

**Assertions (AC1/AC2):**
- an `events` entry of type `connected` was emitted (handshake completed), carrying a parsed
  `HelloAckPayload`;
- an `events` entry of type `messageReceived` (or `messagesReceived` in the chunk twin, §3) carrying the
  expected `MessagePayload`;
- **no** `events` entry of type `failed` across the whole sequence (no binary-frame / handshake-deadline
  / decrypt failure);
- `daemon.whenSettled()` resolved `{ ok: true }` — the session stayed open after the single reply
  (the fake is a single-round-trip responder).

### 3. The reply builder (why the default echo fails AC2)

`connection.send(...)` puts a **`send_message`** envelope on the wire. The daemon's default `buildReply`
echoes that plaintext verbatim → the client receives a `send_message` envelope → `parseInboundMessage`
returns `null` (not a `message`/`message_chunk`) → the client **ignores it** → no `messageReceived`,
AC2 fails.

So the test supplies a `buildReply` that returns a well-formed **`message`** envelope built through the
real codec (correlation-free; it may ignore `inboundPlaintext`):

```ts
// contract sketch
buildReply: () => encodeEnvelope({
  id: 99, type: 'message', ts: FIXED_TS,
  payload: { conversation_id: 'c1', message_id: 'reply-1', role: 'assistant', text: 'pong' }
})
```

Optional twin (nice-to-have, not required — AC2's "`messageReceived` / `messagesReceived`" is satisfied
by either): a second fake-target case whose `buildReply` returns a `message_chunk` envelope and asserts a
single ordered `messagesReceived`. Keep it only if it stays within the size budget; the `message` case
is the primary.

### 4. State + concurrency model

- The test drives the **real** driver → real relay supervisor → real Noise session → real loopback
  socket. No fixed sleeps: synchronisation is `forwarder.whenReady()`, `daemon.whenSettled()`, and the
  bounded event waiter on the sink.
- **Teardown order (load-bearing):** register in `cleanups` so LIFO runs (a) `connection.stop()` **first**
  — it sets the module's `stopped` flag, tears down the driver, suppresses the clean terminal, **and
  quiesces the supervisor** so it does not auto-reconnect when the forwarder drops; then (b)
  `daemon.close()` (frees wasm + terminates the leg); then (c) `forwarder.close()`. Stopping the client
  before closing the forwarder is what prevents supervisor reconnect churn / a spurious `failed` at
  teardown.
- **Per-test timeout:** set the `it(...)` timeout generously (e.g. `15_000`) to absorb the one-time
  wasm compile on a cold CI runner; keep the internal waiter bounds smaller (a few seconds) so a genuine
  hang still fails fast with a descriptive message.

### 5. Live variant (opt-in, operator-gated) — AC4

`describe.skipIf(!live)(...)`, reusing the interop test's convention **verbatim** (same env-var names,
same skip pattern):

- `readLiveEnv()` reads `PYRY_LIVE_RELAY_URL`, `PYRY_LIVE_SERVER_ID`, `PYRY_LIVE_DEVICE_TOKEN`,
  `PYRY_LIVE_SERVER_STATIC_PUB`, `PYRY_LIVE_DEVICE_NAME` (optional) and returns `null` unless all
  required vars are present. `PYRY_LIVE_RELAY_URL` is used **verbatim** as `record.relay` (the operator
  supplies the full client-leg dial URL, exactly as the interop live path consumes `cfg.url`).
- Deps: `pairedServer.load()` returns a record assembled from the env (`server: serverId`, `relay: url`,
  `token`, `server_static_pubkey: serverStaticPub`); `deviceKeypair.ensure()` returns a **fresh
  in-process keypair** (mirrors the interop live path — the token in the encrypted `hello` authorizes;
  IK recovers whatever static the initiator presents, so a fresh static completes the handshake);
  `createDriver` omitted (real); `now` is the real wall clock (the live daemon may validate `ts`).
- Flow: `connection.start()` → `await waiter.wait(connected || failed, ~8-10s)` → assert `connected`
  present and **no** `failed` / no `transport-decrypt`-class failure (the session-open outcome is the
  deterministic assertion). Then `connection.send(<probe>)` and a **bounded, best-effort** wait for
  `messageReceived` — **do not hard-assert** the streamed reply, because a live daemon's reply to a
  synthetic probe is not guaranteed (this matches `noiseSession.interop.test.ts`'s live path, which
  asserts handshake + no decrypt error, not a returned message). Then `connection.stop()`.
- **Operator-visible skip reason (AC4):** encode the gate in the `describe` title
  (`'live round-trip — set PYRY_LIVE_RELAY_URL/SERVER_ID/DEVICE_TOKEN/SERVER_STATIC_PUB to enable'`) so
  the skipped entry names the vars in the reporter, plus one static `console.info` at module load when
  `!live` (mirrors the interop test's skip signalling — a static string, never a credential).

## Error handling

- The happy path asserts the **absence** of a `failed` event; a handshake-deadline, binary-frame, or
  decrypt failure would surface as `failed` (or a missing `connected`) and fail the assertion clearly.
- Bounded waiters **resolve** (not reject) on timeout → assertions read the observed `events`, producing
  a descriptive failure rather than an opaque timeout.
- Failure messages name event **types/counts**, never full serialized payloads (avoids dumping message
  plaintext; on the live path this also keeps the credential out of any failure output — the credential
  never reaches an event anyway, but this is defence in depth).

## Testing strategy

- `npm test` (vitest): the fake-target `describe` runs **unconditionally** — fully in-process over
  loopback `ws`, no Go toolchain, no external network.
- The live `describe` is `describe.skipIf(!live)` — skipped by default with the env-var reason visible in
  the reporter; runs only when the operator exports the `PYRY_LIVE_*` credential.
- `npm run typecheck` covers the type-level surface (no new exported types; the test consumes existing
  ones).
- Per-layer log-free / malformed-frame / oversized behaviour is **already** pinned by
  `daemonConnection.test.ts` and the transport unit tests; this file deliberately proves the **happy
  assembled round-trip**, not the adversarial branches (keeps scope S). A full-stack console-spy
  assertion is optional and only if it stays in budget.

## Open questions

- **`messagesReceived` twin:** include the `message_chunk` variant, or leave `messageReceived` as the
  sole path? Recommend: primary `message` case is mandatory; the chunk twin is a nice-to-have if it fits
  the size budget.
- **Live device static:** fresh synthetic keypair (spec's choice, matching the interop precedent) vs. a
  real paired device static from the keychain. If the live daemon is ever found to bind the initiator
  static to the token, revisit — but the interop live path proves fresh works today.

---

## Security review

**Verdict:** PASS

Walked adversarially against the spec's own design (test-only integration harness; one `.test.ts`; no
production code; a real handshake over loopback + an opt-in live path on a real credential).

**Findings:**

- **[Trust boundaries]** No findings — the test *exercises* the client's existing untrusted→trusted
  boundary end-to-end (`parseHelloAck`, `parseInboundMessage`) rather than introducing a new one. The
  fake daemon is a cooperative peer that speaks the real protocol; the reply bytes it seals cross the
  boundary through the real parsers, which is exactly the coverage being added.
- **[Tokens, secrets, credentials]** SHOULD FIX → **baked into the design, code-review must enforce.**
  Fake target uses a synthetic literal `'dummy-token-not-a-real-credential'`, never a real credential.
  The live variant sources a **real** `PYRY_LIVE_DEVICE_TOKEN` from the environment only — it MUST NEVER
  be committed as a fixture, logged (`console.*`), echoed into a failure message, or used inside an
  `expect(...)` assertion. The design routes the credential env-only and asserts on event **types**, not
  payloads — same convention as `noiseSession.interop.test.ts`. No MUST FIX because the design already
  keeps the credential off every observable path.
- **[File / storage operations]** N/A — the test writes no files and reads no disk secrets. Both stores
  are in-memory fakes; live credentials come from `process.env`, not disk. No path concatenation, no
  check-then-open.
- **[Inter-process / Electron attack surface]** No findings — no `BrowserWindow`, no `webPreferences`,
  no `ipcMain`/`contextBridge`, no renderer. The sink is a plain `{ webContents: { send } }` fake in
  Node (vitest). **Quarantine boundary (load-bearing):** the file is a **`.test.ts`**, so importing the
  permissive-`ws://` `fakeDaemon` / `fakeRelayForwarder` doubles keeps them out of the production graph
  (`src/main/index.ts`, `src/preload`, `src/renderer`) — exactly as those doubles are used today. A
  `.ts` (non-test) name would break this; the spec pins `.test.ts`.
- **[Cryptographic primitives]** No findings — the test drives the **real** vetted Noise stack
  (`noise-c.wasm`) via the real driver; no hand-rolled crypto. The device keypair is minted with
  `lib.CreateKeyPair` (noise-c CSPRNG), never `Math.random()`. Each run uses a fresh keypair + fresh
  session, so no `(key, nonce)` reuse is introduced.
- **[Network & I/O]** No findings — fake target is **loopback-only** `ws://127.0.0.1:<ephemeral>`; the
  daemon leg caps `maxPayload: MAX_FRAME_BYTES` and the real driver's relay connection keeps its own
  frame cap. The loopback `ws://` is **test infrastructure**, not a production scheme downgrade: the
  transport already has no `wss://` enforcement (that seam belongs to #93's pairing-through-UI path, per
  [[ticket-89-roundtrip-test-refined]]), and this test changes none of it. The live variant uses the
  operator's `wss://` URL verbatim. Timeout discipline is covered by bounded waiters +
  `whenReady`/`whenSettled` deadlines + `stop()`/`close()` teardown.
- **[Error messages, logs, telemetry]** SHOULD FIX → **baked into the design.** Failure messages name
  event types/counts, not serialized payloads; no `console` output of frames/keys/token; the module
  under test is log-free by construction. The synthetic fake-target reply text (`'pong'`) is
  non-sensitive; the live credential never reaches an event or a log.
- **[Concurrency]** No findings — every long-lived async task (supervisor reconnect timer, relay read
  loop, daemon leg) is owned and torn down: `connection.stop()` quiesces the driver+supervisor,
  `daemon.close()` frees wasm + terminates the leg, `forwarder.close()` closes the server. All register
  in an `afterEach` LIFO cleanup so a mid-test throw still tears down; the **stop-client-before-close-
  forwarder** order prevents reconnect churn / a spurious `failed`.
- **[Threat model alignment]** No findings for scope — this is a test that *adds* CI coverage of the
  happy assembled path (the ticket's motivation: connection-layer regressions caught in CI, not only
  under a manual demo). **OUT OF SCOPE (named):** adversarial fuzzing of the assembled path (malformed /
  oversized / hostile-daemon frames) — already covered at the unit layer by `daemonConnection.test.ts`
  (drops malformed/oversized/mistyped without emitting) and the transport unit tests; a future ticket
  owns any assembled-path adversarial suite if one is ever wanted.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
