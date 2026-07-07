# Spec — #128 Log the daemon-connection lifecycle

Wire the content-free diagnostic logger (#126, merged) into `daemonConnection.ts` — the
composition/wiring layer above transport — so the classifications the module *already computes* also
land in the log. Three log sites, all at pre-existing seams: the dial-start anchor, the
handshake-complete → connected transition, and every failure funnelled through `emitFailed`. No new
choke points, no new exported types, no root wiring (the composition root already constructs and
injects the singleton; #126). Adds log calls only.

**Size:** S (comfortably — arguably XS). One production file (`daemonConnection.ts`): 3 one-line log
calls + a header-comment update (~5 production LOC). ~50–70 test LOC in `daemonConnection.test.ts`.
**Zero** new exported types. **Zero** consumer call sites — `deps.diagnosticLog?` already exists
(added accepted-unused by #126) and `src/main/index.ts` already injects the singleton. No edit
fan-out.

## Design source

N/A — main-process transport/composition infrastructure; no UI surface, no Figma node. (Confirmed:
ticket body has no `## Figma` section and the work is not UI-visible — it emits JSON-line log records
in the background process, nothing the renderer reads.)

## Files to read first

- `src/main/daemonConnection.ts:14-17` — the "LOG-FREE by construction" header block. Update its
  language to "content-free-log by construction" (mirror `relayConnection.ts` post-#127 and
  `diagnosticLog.ts:1-13`): the module now emits diagnostics through the injected `DiagnosticLog`, and
  still never logs a caught error object, a banner string, ack/plaintext bytes, or the numeric close
  code.
- `src/main/daemonConnection.ts:165-167` — `emitFailed`, the single choke point every failure funnels
  through. **Log site 1** — one call here covers all classifications. Log its `code` argument, never
  its `message` argument.
- `src/main/daemonConnection.ts:170-217` — `onDriverEvent`. The `handshake-complete` success path
  (`:182`, the `connected` emit, after the ack parses) is **log site 2**. Confirm the `terminal`
  (`:205-210`) and `error` (`:212-215`) cases both route through `emitFailed`, so log site 1 already
  covers them — no separate call in either case.
- `src/main/daemonConnection.ts:351-369` — `dial()`. The `connecting` emit (`:366`) is **log site 3**
  (the dial-start anchor). Coordinate-free: do NOT reach into `loadDialConfig` for host/path (they are
  #127's, and not even loaded at this seam — the paired record hasn't been read yet).
- `src/main/daemonConnection.ts:59-65` — `DaemonConnectionDeps.diagnosticLog?` (already present,
  accepted-unused since #126). This is the DI seam the three sites consume as `deps.diagnosticLog?`.
- `src/main/diagnosticLog.ts:27-56` — the `DiagnosticEvent` allowlist (`event`, `code?`, `status?`,
  `bytes?`, `count?`, `host?`, `path?`) and `DiagnosticLog.event`. The fields this ticket needs
  (`event`, `code`) already exist — **no #126 change**. Note `DiagnosticEvent.code`'s own doc example
  cites `'not-paired'`/`'malformed-hello-ack'` — the #126 authors anticipated exactly these codes.
- `src/main/transport/noiseRelayDriver.ts:44-59` — `RelaySessionErrorReason` and `RelaySessionEvent`.
  **Load-bearing for the security review:** `RelaySessionErrorReason` is a *closed set of static
  strings* ("never carries key/token/frame/plaintext bytes", `:46`), so logging `event.reason` (via
  `emitFailed(event.reason)`) as `code` is safe. `terminal.reason` (`:58`, a peer-supplied string) is
  NOT this enum and is already dropped by the existing `terminal` case — never reaches the log.
- `src/main/transport/relayConnection.ts:178,211,243` — the **merged #127 relay-leg records**
  (`relay-open`, `relay-unexpected-response`, `relay-closed`). Read these to see exactly what the
  daemon leg must NOT duplicate: the connection coordinates (`host`/`path`) and the numeric WS close
  code (`status: terminal.code`) are #127's. This ticket logs classification codes only.
- `docs/specs/architecture/127-relay-lifecycle-logging.md` — the sibling spec (merged, PR #135). The
  leg division it establishes is the contract this ticket preserves.
- `src/main/daemonConnection.test.ts:104-162` — the `build()` deps builder (`:117`), `reachConnected()`
  (`:146`), and `tick()` (`:143`) helpers. This is where a `captureLog()` fake threads in, and how the
  fake driver's `.emit(...)` drives each lifecycle transition.
- `docs/knowledge/decisions/0007-content-free-diagnostics-by-construction.md` — the #126 ADR; the
  "content-free BY CONSTRUCTION" invariant this ticket extends to the daemon leg.

## Context

`src/main/daemonConnection.ts` is the composition/wiring layer above transport: it sources the device
key + paired record, drives the Noise relay driver, and maps its four lifecycle events onto the typed
`DaemonEvent` channel. It is "LOG-FREE by construction": every caught error is classified into a
static category code and the caught object DROPPED (a codec/keychain error could echo the token or
transcript bytes). Every failure surfaces to the UI as a non-connected `DaemonEvent`, but the *reason*
— the static code the module already computes — is recorded nowhere. An operator watching a
connection stall between "connecting" and "connected"/"failed" has no daemon-side anchor to diagnose
which classification a failure carried.

#126 (merged) built the content-free logger and threaded its process-singleton `DiagnosticLog` into
`createDaemonConnection` (`deps.diagnosticLog?`, accepted-unused). #127 (merged, PR #135) routed that
singleton into `relayConnection` for the relay-socket leg. This ticket adds the daemon-composition
leg: it consumes the same injected singleton at three pre-existing seams. It wires nothing at the root
and imports no Electron sink.

**Scope boundary vs #127 (the two legs are complementary, not overlapping):**

| | Relay leg (#127, `relayConnection.ts`) | Daemon leg (#128, this ticket) |
|---|---|---|
| Records | `relay-open`, `relay-unexpected-response`, `relay-closed` | `daemon-dial`, `daemon-connected`, `daemon-failed` |
| Carries | connection coordinates (`host`/`path`), numeric WS close code (`status`) | static classification `code` and event name only |
| Signal | the WS socket opening / HTTP upgrade status / socket closing | the daemon dial window + Noise handshake finishing + classified failure |

The same socket close flows through both layers. #128 logs the *classification*, #127 logs the
*socket code*. Do not re-log a relay-leg field from the daemon leg.

## Design

### Three log sites — all pre-existing seams, all consuming `deps.diagnosticLog?`

No new local is needed: `deps` is in scope in every closure of `createDaemonConnection`, so each site
references `deps.diagnosticLog?.event({ … })` directly — matching the optional-DI-seam idiom #127 used
(`config.diagnosticLog?`). The diff is exactly the three log lines plus the header comment.

Each record is a static-literal `event` name plus, for the failure record, the static `code`. Log
**after** the corresponding `emitDaemonEvent(...)` call at each site, so the `DaemonEvent` emission
stays the primary effect and the log is a faithful shadow of it (AC4).

**Site 1 — `emitFailed` (`:165`).** The single choke point for `not-paired`, `malformed-hello-ack`,
`connect-failed`, `connection-closed`, and the driver's `error` reason (`emitFailed(event.reason)`).
One call covers all classifications:

- Record: `{ event: 'daemon-failed', code }` — where `code` is `emitFailed`'s **first** parameter.
- **Never** log `emitFailed`'s `message` parameter. In the `terminal` case it interpolates the numeric
  close code (`…(code ${event.code}).`); that number is #127's `relay-closed { status }`, not the
  daemon leg's. Logging only `code` keeps the numeric close code out of the daemon record by
  construction.

**Site 2 — `onDriverEvent` `handshake-complete` success (`:182`).** After the ack parses and
`emitDaemonEvent(sink, { type: 'connected', ack })`:

- Record: `{ event: 'daemon-connected' }` — event name only. **Never** `ack` or `event.helloAck`
  bytes (AC2). This is the load-bearing "did the Noise handshake finish" signal, distinct from #127's
  `relay-open` (the WS socket opening, which precedes the handshake). No `bytes`/`code` field — the
  signal is binary (finished / didn't), so no byte length is logged.
- The malformed-ack path is already a failure covered by site 1 (`emitFailed('malformed-hello-ack')`);
  add nothing to it.

**Site 3 — `dial()` `connecting` transition (`:366`).** After
`emitDaemonEvent(sink, { type: 'connecting' })`:

- Record: `{ event: 'daemon-dial' }` — event name only, coordinate-free (AC1). No `host`/`path`: the
  paired record is not loaded at this seam, and coordinates are #127's `relay-open`/`relay-closed`.
- Because `dial()` logs this unconditionally before `bootstrap(gen)` runs, the record is present even
  in the **not-paired** case — where the relay socket never opens and #127 logs nothing. The
  not-paired log sequence is therefore `daemon-dial` → `daemon-failed { code: 'not-paired' }`, giving
  the operator a complete daemon-side window with zero relay-leg records. (`daemon-dial` for `dial`
  matches the codebase idiom: `dial()`, `loadDialConfig`, `DialConfig`, "per-dial".)

### Event names — the daemon triple

`daemon-dial` (window opens) → `daemon-connected` (Noise handshake finished) **or** `daemon-failed`
(classified failure). Symmetric with the `DaemonEvent` lifecycle (`connecting` → `connected` /
`failed`) and namespaced parallel to #127's `relay-*`, so log lines from the two legs interleave
readably and never collide.

### The log is a faithful shadow of the gen-fenced event stream (AC4)

All three sites sit where the existing generation fence already gates emission, so the log mirrors the
emitted `DaemonEvent`s exactly — no stray records from a superseded dial:

- `daemon-failed` fires only inside `emitFailed`, which every failure path calls **only** under a
  current-gen guard (`bootstrap`'s `if (gen === generation)` at `:311`; the not-paired branch after
  the `gen !== generation` early-return at `:278`; and `onDriverEvent`, reached only through the
  gen-fenced `onEvent` wrapper at `:300-303`). A superseded bootstrap's failure is silent — and so is
  its would-be log.
- `daemon-connected` sits inside that same gen-fenced `onEvent` wrapper — logged only for the
  current-gen driver.
- `daemon-dial` sits in `dial()`, which runs once per `start()`/`reconnect()`; each dial logs exactly
  one anchor.
- Clean-stop suppression is inherited for free: the `terminal` case returns on `if (stopped)` **before**
  reaching `emitFailed` (`:209`), so a quit-driven `terminal{1000,'stopped'}` emits neither a `failed`
  event nor a `daemon-failed` record.

## State + concurrency model

- **No new state, no new store surface, no new async task, no new listener.** Three synchronous log
  calls at existing seams. The renderer's `sessionStore` remains the single source of session state;
  this module only emits into it and now shadows those emits into the log.
- **Non-throwing.** `DiagnosticLog.event` swallows its own sink errors (`diagnosticLog.ts:89-95`), so a
  full-disk / EACCES sink can never crash the connection it observes. The three call sites add no
  try/catch and cannot re-enter the state machine.
- **Behaviour unchanged apart from observability (AC4).** The module still never throws, still drops
  every caught object (only the pre-computed static code crosses to the log), and still emits the same
  `DaemonEvent`s in the same order. The added calls are pure side-effect appends after each emit.

## Error handling

- **No logger injected (tests, or a root that didn't wire one):** `deps.diagnosticLog?.event` is a
  no-op; behaviour is exactly pre-#128. This keeps every existing `daemonConnection` test green
  unchanged.
- **Sink failure (full disk / EACCES):** swallowed inside `DiagnosticLog.event` (#126); no handling
  here.
- **The caught error object / banner text / ack bytes / numeric close code are never logged** — the
  module continues to classify-don't-forward. Only the static `code` (site 1) and the static event
  names (sites 2, 3) reach the sink.

## Testing strategy

`npm test` (vitest), extending `daemonConnection.test.ts`. Thread a `captureLog()` fake into the
existing `build()` deps builder (`:117`) — a `DiagnosticLog` whose `event(fields)` pushes `fields`
into an array the test asserts against (~6 lines); pass it via a new optional `build` override, or add
it to the constructed `deps`. Drive transitions with the existing fake driver's `.emit(...)` and the
`tick()` / `reachConnected()` helpers. Scenarios (bullet-level; developer writes the bodies in the
file's idiom):

- **AC1 — dial-start anchor.** `start()`; assert exactly one `daemon-dial` record, emitted
  synchronously with the `connecting` `DaemonEvent` (before any `await`), carrying **only** `event`
  (no `host`/`path`/`status`/`code`).
- **AC1 — not-paired still anchors.** `build({ load: () => Promise.resolve(null) })`, `start()`,
  `await tick()`; assert the record sequence is `daemon-dial` then `daemon-failed { code: 'not-paired' }`
  — the daemon-side window that exists even when #127 (relay leg) is silent.
- **AC2 — handshake-complete → connected.** `reachConnected()`; assert exactly one `daemon-connected`
  record with only `event`. Adversarially assert no captured record's flattened values contain the
  ack bytes.
- **AC3 — `emitFailed` logs the static code only, across every classification.** Drive each and assert
  `daemon-failed { code: <expected> }` with **no** `message`/`status`/`bytes` field:
  - `not-paired` (load resolves null)
  - `malformed-hello-ack` (emit `handshake-complete` with a wrong-type ack, as at `:306`)
  - `connect-failed` (load or ensure rejects)
  - `connection-closed` (emit `{ type: 'terminal', code: <n>, reason: <s> }`, not stopped) — and
    adversarially assert the numeric `event.code` and the peer `reason` string did **not** reach the
    log (no `status` field, no record value equal to the interpolated banner text `…(code n).`).
  - a driver error reason (emit `{ type: 'error', reason: 'session-load-failed' }`) → `code:
    'session-load-failed'`.
- **AC3 — banner text is never logged.** Reuse the `connection-closed` case: assert no captured record
  contains `messageFor`'s / the interpolated message string.
- **AC4 — behaviour unchanged.** The emitted `DaemonEvent` sequence is identical with and without a
  `captureLog` (the existing suite already pins the events; the log calls don't perturb them). Existing
  tests that build deps with no `diagnosticLog` stay green (the `?.` no-op path).
- **AC4 — clean stop() suppresses both event and log.** `stop()` then emit `terminal{1000,'stopped'}`;
  assert neither a `failed` event nor a `daemon-failed` record.
- **Faithful shadow across a re-dial.** `start()` then `reconnect()`; assert exactly two `daemon-dial`
  records and that a superseded in-flight dial produces no stray `daemon-failed` (leans on the existing
  gen-fence tests; one focused assertion is enough).

Typecheck (`npm run typecheck`) covers the three call sites against the existing
`DaemonConnectionDeps.diagnosticLog?` seam — no new types, no fixture cascade.

## Open questions

- None. The seams, the DI dependency, the sink, and the leg division are all pre-existing and merged;
  this ticket only adds three log calls that consume them.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The single value this design crosses into the log is
  `emitFailed`'s `code` parameter. It is only ever a static string literal (`not-paired`,
  `malformed-hello-ack`, `connect-failed`, `connection-closed`) or `event.reason`, typed
  `RelaySessionErrorReason` — a *closed set of six static strings* documented "never carries
  key/token/frame/plaintext bytes" (`noiseRelayDriver.ts:44-52`). The relay/daemon can select *which*
  classification fires but cannot inject bytes into it. The peer-supplied `terminal.reason` string
  (`noiseRelayDriver.ts:58`, attacker-controlled) is dropped by the existing `terminal` case and never
  reaches `emitFailed`'s `code`. Boundary is explicit and single (`emitFailed`).
- **[Tokens, secrets, credentials]** No findings. None of the three sites reads a header, a URL, or a
  token. `daemon-dial` and `daemon-connected` log only a static event name; `daemon-failed` logs only
  the static classification code. The token lives in the per-dial `connection` headers/URL, untouched
  by this ticket. No token lifecycle in scope.
- **[File / storage operations]** N/A — this ticket writes no files. The rotating 0o600 file under
  `userData` is #126's sink, unchanged; no path is constructed, opened, or checked here.
- **[Inter-process / Electron attack surface]** N/A — no IPC, `contextBridge`, `BrowserWindow`, or
  protocol handler touched. The logger and all three call sites stay in the main process; nothing
  reaches the renderer. Process placement (a MUST-FIX category) is preserved — no secret or socket
  moves toward the renderer.
- **[Cryptographic primitives]** N/A — no crypto handling. The Noise session is a layer below;
  `daemon-connected` records only that the handshake *finished* (the event name), never the ack bytes
  (`event.helloAck`), the transcript, keys, or nonces. No key/nonce reuse, no comparison.
- **[Network & I/O]** N/A — no socket, no URL parsing, no TLS config, no frame handling in scope.
  #127 owns the relay-socket leg (frame cap, connect/idle timeouts, ping-pong). This ticket adds no
  network surface and no new hang vector (the log calls are synchronous and non-blocking).
- **[Error messages, logs, telemetry]** No findings — this is the ticket's core risk, and it is
  excluded by construction. MUST-NOT-log — message plaintext (`event.plaintext`, no log site on that
  path), Noise transcript / ack bytes (`event.helloAck`, never logged; site 2 is event-name-only),
  keys/tokens/full headers (never read), URL query (never read), the numeric WS close code
  (`event.code`; only the static `code` arg is logged), the peer close `reason` string (dropped
  upstream), and the human-readable banner (`messageFor` / the interpolated `message` param, explicitly
  never logged) — are all absent from the three records. MUST-log — event name + static classification
  code — are exactly the allowlisted `event`/`code` fields (`diagnosticLog.ts:27-42`). Records are
  content-free JSON lines to #126's rotated file; nothing is piped to the renderer console. No new
  telemetry. **Residual (code-review line item, inherited from #126/#127, not a design hole):**
  `DiagnosticEvent.event`/`code` are `string`, so the type cannot *forbid* a secret; code-review MUST
  confirm each site passes only the static/enum values above — in particular that `emitFailed` logs its
  `code` parameter and never its `message`, and that no site passes `event.helloAck`,
  `event.plaintext`, or `event.code`.
- **[Concurrency]** No findings. No new async task, timer, listener, or `AbortController` surface —
  three synchronous, non-throwing log calls (the sink swallows its own errors, `diagnosticLog.ts:89-95`).
  The pre-existing generation fence already guards all three sites, so the log is a faithful shadow of
  the gen-fenced event stream: no stray `daemon-failed` from a superseded dial, no double-log, and a
  clean stop() suppresses the terminal's `daemon-failed` for free (the log sits inside `emitFailed`,
  reached only after the `terminal` case's `if (stopped) return`). No check-then-act race — the calls
  read no shared state.
- **[Threat model alignment]** **Malicious/compromised relay** (the primary actor) can select which
  driver `error.reason` fires (a closed enum, harmless in `code`), set the numeric close `code` (a
  number, and not logged by the daemon leg regardless), and set the peer close `reason` (never logged).
  It cannot inject a secret into the daemon log, change what is logged beyond selecting among static
  classifications, or hang anything (no new I/O). **Token theft from disk** — unchanged; the daemon log
  carries no token. **Hostile daemon response** — a malformed/mistyped ack drives
  `malformed-hello-ack` (static code, caught `WireDecodeError` dropped as before); the ack bytes never
  reach site 2, which fires only on the success path and logs the event name. **Renderer compromise
  reaching transport** — out of scope; this ticket adds no renderer surface and the log stays in the
  main process.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-08
