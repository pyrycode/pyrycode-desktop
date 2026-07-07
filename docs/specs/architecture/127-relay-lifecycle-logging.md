# Spec — #127 Log the relay-connection lifecycle (incl. the unexpected-response HTTP status)

Wire the content-free diagnostic logger (#126, merged) into `relayConnection`, and add the
`unexpected-response` handler that captures the relay's HTTP upgrade status (the 404 a client dialed
without `/v1/client`) — the single highest-value log line the Diagnostics motivation calls out by
name. No `RelayEvent` change: the status reaches the log, not the event stream.

**Size:** S. Two production files (`relayConnection.ts`, `daemonConnection.ts`), ~30 production LOC +
~100 test LOC, **zero** new exported types. No edit fan-out: the new field is optional, so it
threads through every `Omit<RelayConnectionConfig, 'onEvent'>` with a single construction-site edit.

## Design source

N/A — main-process transport infrastructure; no UI surface, no Figma node. (Confirmed: ticket body
has no `## Figma` section and the work is not UI-visible.)

## Files to read first

- `src/main/transport/relayConnection.ts:14-17` — the header block to update ("LOG-FREE by
  construction" → "content-free-log by construction"; mirror `diagnosticLog.ts`'s language).
- `src/main/transport/relayConnection.ts:34-49` — `RelayConnectionConfig`; the one **type** edit adds
  `diagnosticLog?: DiagnosticLog`.
- `src/main/transport/relayConnection.ts:112` — `new WebSocket(config.url, …)`; derive `host`/`path`
  right after (the URL is already validated by this call, so `new URL(config.url)` cannot throw).
- `src/main/transport/relayConnection.ts:118-122` — the connect-timeout self-terminate
  (`pending = { code: 1006, … }; ws.terminate()`). **This is the exact idiom the new
  `unexpected-response` handler copies** — the proof that `ws.terminate()` during CONNECTING drives a
  deterministic `close`.
- `src/main/transport/relayConnection.ts:147-155` — `teardownAndEmitClosed`; the single terminal
  choke point (once-only, `removeAllListeners`).
- `src/main/transport/relayConnection.ts:157-175` — the `open` handler; add the `relay-open` log.
- `src/main/transport/relayConnection.ts:186-205` — the `error` + `close` handlers; the terminal path
  the new handler must stay byte-identical to, and the site of the `relay-closed` log (in `close`,
  where `pending` provenance is known).
- `src/main/diagnosticLog.ts:27-56` — `DiagnosticEvent` allowlist (`event`, `status?`, `code?`,
  `host?`, `path?`) and `DiagnosticLog.event`. The fields needed already exist — **no #126 change**.
- `src/main/daemonConnection.ts:44-65` — `DaemonConnectionDeps.diagnosticLog` (already present,
  accepted-unused since #126).
- `src/main/daemonConnection.ts:227-263` — `loadDialConfig`; the **only** production site that builds
  the `connection` blob. The one-line wiring edit lands in its `connection: { … }` object.
- `src/main/transport/noiseRelayDriver.ts:70-104` — `DialConfig` / `NoiseRelayDriverConfig`; confirm
  `connection` is `Omit<RelayConnectionConfig, 'onEvent'>` and is spread verbatim (`:312`). **No edit.**
- `src/main/transport/relaySupervisor.ts:66-85, 238` — confirm `connection` is
  `Omit<RelayConnectionConfig, 'onEvent'>`, spread into `createConnection({ ...conn, onEvent })`.
  **No edit.**
- `src/main/index.ts:147-162` — composition root; `diagnosticLog` is already constructed and injected
  into `createDaemonConnection`. **No edit** — `deps.diagnosticLog` is populated at runtime.
- `src/main/transport/relayConnection.test.ts:35-101` — the `startRelay` / `startBlackHole` in-process
  helpers; model a status-rejecting helper on these. `:188-198` — the existing "refused upgrade" test,
  which after this change routes through the new handler and becomes the AC4b regression guard.
- `src/main/transport/relayConnection.teardown.test.ts` — the mock-`ws` teardown pins; the new
  `unexpected-response` listener is removed by `removeAllListeners`, so the post-teardown
  `listenerCount === 0` assertion still holds (verify, don't overstate).
- `docs/knowledge/decisions/0007-content-free-diagnostics-by-construction.md` — the #126 ADR; the
  "content-free BY CONSTRUCTION" invariant this ticket extends to the relay leg.

## Context

`relayConnection.ts` opens the one `wss://` connection at the base of the round-trip. It is
"LOG-FREE by construction": all diagnostics travel as `RelayEvent` data and today nothing logs, so a
failed dial surfaces only as a generic `connect-error`/1006. Worse, the relay's **HTTP upgrade status
is lost entirely** — the module has no `unexpected-response` handler, so a 404 (client dialed without
`/v1/client`) is classified by the `error` handler (`:195-197`) to a nondescript 1006 with no status.

#126 merged the content-free logger (`src/main/diagnosticLog.ts`) and already threaded its
process-singleton `DiagnosticLog` into `createDaemonConnection` (`deps.diagnosticLog`,
`daemonConnection.ts:64`, accepted-unused). This ticket routes that singleton the last leg into
`relayConnection` and logs at three boundaries. The daemon-leg call sites are #128's job, not this
ticket's.

## Design

### 1. Threading — ride inside the `connection` blob (single construction-site edit)

`relayConnection` gains an optional dependency; the logger reaches it by riding the `connection`
config that already spreads verbatim through every layer:

```
daemonConnection.loadDialConfig() → DialConfig.connection            (build site — the ONE edit)
  → createDriver({ connection, … })                                 (spread, no change)
    → createSupervisor({ connection, … })                           (spread, no change)
      → createConnection({ ...conn, onEvent })                      (spread, no change)
        → relayConnection reads config.diagnosticLog
```

**Edits:**

- **`relayConnection.ts`** — add to `RelayConnectionConfig`:
  `diagnosticLog?: DiagnosticLog` (import `type { DiagnosticLog } from '../diagnosticLog'` — relative
  path; `@shared`/bare aliases are not available under `src/main`). Doc it as: the injected
  content-free logger (#126); absent in tests → the module simply does not log.
- **`daemonConnection.ts`** — in `loadDialConfig`'s returned `connection` object (`:240-255`), add one
  property: `diagnosticLog: deps.diagnosticLog`. `deps.diagnosticLog` is `DiagnosticLog | undefined`;
  the target field is optional, so this assigns cleanly whether or not the root wired a logger.

**No change to `relaySupervisor.ts` / `noiseRelayDriver.ts`.** Their `connection` fields are
`Omit<RelayConnectionConfig, 'onEvent'>`, which now transitively includes `diagnosticLog?`. Every
existing config-construction site omits the optional field and still typechecks — no fixture cascade.

**Why ride-in-blob over a separate constant field (trap 3, resolved).** The ticket flags that #83's
reload rebuilds the per-dial `connection` blob on every reconnect (`daemonConnection.ts:227-263`), so
a logger riding inside it "must be re-attached each reload." That re-attach is **automatic and free**:
`loadDialConfig` is the *single* per-dial construction site (used for both the first dial and every
#83 reload), and it closes over the constant `deps.diagnosticLog` — so each rebuilt blob references
the same process-singleton (one `seq` counter, one file) with no extra logic. The alternative — a
constant field threaded explicitly through `NoiseRelayDriverConfig` + `RelaySupervisorConfig` — is a
4-file cascade for no benefit and is rejected.

### 2. Three log sites in `relayConnection.ts`

Derive the coordinates once, right after the `WebSocket` is constructed (`:112`), and reuse at all
three sites. **Coordinates are `hostname` + `pathname` only — never `href`, never `search`:**

```
const { hostname: host, pathname: path } = new URL(config.url)   // safe: WebSocket already parsed url
```

- **`open` handler (`:157`)** — after `config.onEvent({ type: 'connected' })`:
  `config.diagnosticLog?.event({ event: 'relay-open', host, path })`.
- **New `unexpected-response` handler** — see §3; logs
  `{ event: 'relay-unexpected-response', status: res.statusCode, host, path }`.
- **`close` handler (`:202-205`)** — log **before** `teardownAndEmitClosed`, where `pending`
  provenance is in scope, so the static classification is logged only when module-initiated:
  `config.diagnosticLog?.event({ event: 'relay-closed', status: terminal.code, code: pending?.reason, host, path })`.
  - `status: terminal.code` — the numeric WS close code (1000 / 1006 / 1009 / a peer 4xxx). Always safe.
  - `code: pending?.reason` — the module-static classification (`'connect-timeout'` / `'pong-timeout'`
    / `'max-frame-exceeded'` / `'connect-error'` / `'client closing'`) **only** when `pending !== null`.
    On a peer/library close `pending` is `null` → the field is `undefined` → omitted from the record.
    The wire `reason.toString()` (`:203`, attacker-controlled) is **never** passed to the log.

The `close` handler fires at most once (the first `close` runs `teardownAndEmitClosed`, which
`removeAllListeners`), so the `relay-closed` log is once-only without a new guard.

**Field mapping (no #126 change).** `DiagnosticEvent` already exposes exactly what's needed —
`status?` carries an HTTP *or* WS status number (per its own doc), `code?` a static classification,
`host?`/`path?` safe coordinates, `event` a static literal. Nothing carries a value.

### 3. The `unexpected-response` handler — capture status AND drive today's terminal (AC4b)

`ws` 8.21 behaviour trap: with an `unexpected-response` listener present, `ws` emits that event
*instead of* `error` for a non-101 response and **stops auto-destroying** the socket. A log-only
handler would let the dial hang until the owned 10 s connect-timeout fires, flipping the observable
terminal from `connect-error`/1006 to `connect-timeout`/1006. The handler must therefore both log the
status **and** self-terminate, exactly as the connect-timeout path does (`:118-122`):

Handler contract (signature `(request, response)` — read only `response.statusCode`, never headers/body):
1. `if (closed) return` (guard; the event only fires pre-open, so `opened` is false).
2. Log `{ event: 'relay-unexpected-response', status: res.statusCode, host, path }`.
3. `pending = { code: 1006, reason: 'connect-error' }` — the same terminal today's pre-open `error`
   branch sets (`:197`).
4. `ws.terminate()`.

`ws.terminate()` during CONNECTING → `abortHandshake` → (next tick) emits `error` then `close`. The
`error` handler early-returns on `pending !== null` (`:190`), so the error is swallowed; the `close`
handler reads `pending` and emits `closed{ 1006, 'connect-error' }` — **byte-identical to today**, and
promptly (no wait for the connect-timeout). No frame bytes, no header, no URL query are read.

### 4. Header comment

Update `relayConnection.ts:14-17`: the invariant is no longer strictly "LOG-FREE by construction" but
"content-free-log by construction" — the module now emits diagnostics through the injected
`DiagnosticLog`, and never logs a header value, a frame byte, or a URL query (`href`/`search`). Mirror
the language in `diagnosticLog.ts:1-13` and ADR 0007.

## State + concurrency model

- **No new state, no new store surface.** `RelayEvent` is unchanged; the status reaches the log, not
  the event stream. `pending` (the existing terminal-reason latch) is reused by the new handler.
- **Terminal-emitted-once (AC4c) holds.** All terminals still funnel through `teardownAndEmitClosed`
  (`closed` guard + `removeAllListeners`). The new handler drives that path via `pending` + `terminate`,
  not a second emit. Log calls are synchronous, non-throwing (the sink swallows its own errors,
  `diagnosticLog.ts:89-95`), and cannot re-enter the state machine.
- **Heartbeat / ping-pong unchanged (AC4c).** No edit to the `open`-handler ping loop or the
  pong-deadline beyond appending one log call after the existing `connected` emit.
- **Listener lifecycle.** The one added `ws` listener (`unexpected-response`) is removed by the
  existing `ws.removeAllListeners()` in teardown — no listener leak, no post-teardown re-fire.

## Error handling

- **Unexpected upgrade (404/401/…):** logged with `status`, then terminated to `closed{1006,'connect-error'}`
  (§3). Byte-identical to the pre-#127 refused-upgrade terminal.
- **Malformed `config.url`:** unreachable at the log sites — `new WebSocket(config.url)` (`:112`)
  throws first on a bad URL, before `new URL(config.url)` is ever reached. No new failure mode.
- **Sink failure (full disk / EACCES):** swallowed inside `DiagnosticLog.event` (`diagnosticLog.ts`);
  a diagnostics sink can never take down the connection it observes. No handling needed here.
- **No logger injected (tests, or a root that didn't wire one):** `config.diagnosticLog?.event` is a
  no-op; behaviour is exactly pre-#127. This is what keeps every existing `relayConnection` test green
  unchanged.

## Testing strategy

`npm test` (vitest), extending `relayConnection.test.ts` (real in-process `ws` server; no `ws` mock).
Add two tiny helpers:

- `captureLog()` → a fake `DiagnosticLog` whose `event(fields)` pushes into an array the test asserts
  against. ~6 lines.
- `startRejectingRelay(status)` → modeled on `startBlackHole` (`:82-101`): an `http` server that on
  `'upgrade'` writes a raw `HTTP/1.1 <status> …\r\nConnection: close\r\nContent-Length: 0\r\n\r\n` then
  `socket.end()`, so the client sees a real non-101 response and fires `unexpected-response`. ~10 lines.

Scenarios (bullet-level; developer writes the bodies in the file's idiom):

- **AC1 — unexpected-response 404 logs status + coordinates and terminates.** Dial
  `startRejectingRelay(404)` with a `captureLog()`. Assert: exactly one `relay-unexpected-response`
  record with `status: 404`, `host` = the server host, `path` = `/v1/client`, and **no** other field;
  and the terminal is `closed{ code: 1006, reason: 'connect-error' }`, arriving well under the
  connect-timeout (use a large `connectTimeoutMs` so a hang would be observable as a test timeout).
- **AC4b — refused upgrade stays byte-identical (regression).** The existing "refused upgrade" test
  (`:188-198`, `startRelay({ refuse: true })` → 401) must still assert
  `closed{ 1006, 'connect-error' }` and no `connected`. It now exercises the new handler; leave its
  assertion unchanged as the guard. (No `captureLog` needed — proves the terminal, not the log.)
- **AC2 (open) — `relay-open` logged.** Dial `startRelay()` with a `captureLog()`; on `connected`,
  assert one `relay-open` record with `host` + `path` and no `status`.
- **AC2 (close) — `relay-closed` carries the numeric code + static classification.** Two sub-cases:
  (a) module-initiated: drive a `pong-timeout` (`startRelay({ autoPong: false })`, small timings) and
  assert `relay-closed` with `status: 1006`, `code: 'pong-timeout'`; (b) peer close: have the server
  `terminate()` the socket and assert `relay-closed` with a numeric `status` and `code === undefined`
  (assert the *value*, not `'code' in record` — `code: pending?.reason` leaves the property present but
  `undefined`, which `JSON.stringify` drops from the serialized line).
- **AC3 — secret-safety across every log field.** Dial a URL carrying a query string
  (`ws://<host>/v1/client?token=SUPERSECRET`) and headers `{ 'x-pyrycode-token': 'SUPERSECRET' }` with
  a `captureLog()`; force a terminal. Assert, over the flattened values of every captured record: none
  equals `'SUPERSECRET'`; no `path` contains `'?'` or `'token'`; every `host` is the bare hostname and
  every `path` is `/v1/client`. This pins AC3(a)/(b)/(c) in one adversarial test.
- **Backward-compat.** The suite's existing tests construct configs with **no** `diagnosticLog` — they
  must stay green untouched (the `?.` no-op path).

Typecheck (`npm run typecheck`) covers the additive-optional `RelayConnectionConfig` field and the
one `daemonConnection` wiring line with no fixture changes.

## Open questions

- **`res.statusCode` undefined.** `http.IncomingMessage.statusCode` is `number | undefined`; passing
  `undefined` simply omits the field (`JSON.stringify` drops it) and typechecks against `status?: number`.
  Acceptable — a status-less unexpected response is vanishingly rare and still yields the `relay-closed`
  record. No special-casing prescribed; the developer may confirm the real relay always sets it.
- **Socket cleanup after `terminate()`.** Expected to be handled by `ws.terminate()` → `abortHandshake`
  → `req.abort()` (destroys the underlying socket). If the AC1 test reveals a lingering socket (leak or
  a hang), the fallback is an explicit `response.destroy()` in the handler before `terminate()`. The
  test is the oracle; the connect-timeout precedent (`:118-122`) says `terminate()` alone suffices.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The one untrusted input this ticket reads is
  `response.statusCode` (a number from a hostile-relay HTTP response) — coerced into `status?: number`,
  a field structurally incapable of carrying a string secret. The peer-supplied close `reason` string
  (`relayConnection.ts:203`, attacker-controlled) is explicitly **excluded** from every log field
  (§2 `close` site logs `pending?.reason`, never `reason.toString()`). The relay socket → main-process
  boundary is unchanged; no new data crosses to the renderer.
- **[Tokens, secrets, credentials]** No findings — and this is the ticket's core risk. The token lives
  in `config.headers['x-pyrycode-token']` and (in dev) potentially the URL query. **`config.headers` is
  never read into any log field**, and coordinates are `new URL(config.url).hostname`/`.pathname` —
  never `.href`/`.search`, so a `?token=…` query cannot reach the log. Enforced by the AC3 adversarial
  test and by `DiagnosticEvent`'s allowlist (no header/URL/token-shaped field). Residual (inherited
  from #126's security review): `host`/`path` are `string` and cannot be *type*-forbidden from holding
  a secret, so code-review MUST confirm each of the three call sites passes `hostname`/`pathname`
  literals, never `config.url` or a header value. This is a code-review line item, not a design hole.
- **[File / storage operations]** N/A — this ticket writes no files. The sink's rotating file
  (`userData/logs`, 0o600, size-capped) is #126's, unchanged.
- **[Inter-process / Electron attack surface]** N/A — no IPC, `contextBridge`, `BrowserWindow`, or
  protocol handler touched. The logger and every log site stay in the main process; nothing reaches the
  renderer. Process placement is preserved (a MUST-FIX category, here clean).
- **[Cryptographic primitives]** N/A — no crypto, no key/nonce handling. The Noise session is a layer
  above `relayConnection` and untouched.
- **[Network & I/O]** No findings. `maxPayload` frame cap, connect/idle timeouts, and ping-pong
  liveness are unchanged. The new handler *strengthens* slow/hostile-relay resistance: a rejected
  upgrade now terminates immediately (`1006`) instead of the pre-existing hang-until-connect-timeout
  the trap would otherwise introduce (AC4b). No `rejectUnauthorized: false`, no `ws://` for production
  (the loopback-`ws://` dev seam is #97's, gated on `app.isPackaged`).
- **[Error messages, logs, telemetry]** No findings — this is the whole ticket. MUST-NOT-log
  (message bodies, Noise transcripts, keys, tokens, full headers, URL query, wire close `reason`) are
  all excluded by construction; MUST-log (event name, status number, static classification, host, path)
  are exactly the allowlisted fields. Logs are content-free JSON lines to a 0o600 rotated file under
  `userData` (#126); nothing is piped to the renderer console. No new telemetry.
- **[Concurrency]** No findings. One added `ws` listener, removed by the existing `removeAllListeners`
  in `teardownAndEmitClosed`; no new timer, no new async task, no `AbortController` surface changed.
  Terminal-emitted-once holds (all paths funnel through the guarded choke point). The `relay-closed`
  log is once-only because the `close` handler fires once (listeners removed after the first teardown).
- **[Threat model alignment]** **Malicious/compromised relay** — the primary actor here — is addressed:
  a hostile relay controls `statusCode` (a number, harmless in `status?`) and the close `reason` (never
  logged) and the close `code` (a number, harmless). It cannot inject a secret into the log or hang the
  dial (the handler terminates). **Token theft from disk** — unchanged; the log file carries no token.
  **Hostile daemon response / renderer compromise** — out of scope (no daemon parsing, no renderer
  surface in this ticket); the daemon-leg logging is #128.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-08
