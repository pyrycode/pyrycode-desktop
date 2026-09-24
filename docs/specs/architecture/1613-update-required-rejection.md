# #1613 — stop re-dialling a host that rejects the app as too old

## Files read

- `src/main/daemonConnection.ts` → `createDaemonConnection`: `onDriverEvent` (the `daemon-error` arm's `pairingReject` branch, the `terminal` arm), `emitFailed` + the sticky `pairingRejected` flag, `messageFor`, `dial` (the `generation` fence and the `onEvent` wrapper in `bootstrap` that drops a superseded driver's events). This is where the new reason is recognised and where supervision is halted.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` (`daemon-error` member, its `pairingReject` field) and the `error` case of `parseInboundMessage`. The classifier gains an update-required narrowing beside `pairingReject`.
- `src/main/transport/relaySupervisor.ts` → `DEFAULT_FATAL_CLOSE_CODES`, `onConnEvent`'s `closed` arm. `4412` joins the fatal set so a bare close is terminal, not a backoff re-dial.
- `src/shared/wire/types.ts` → `ErrorPayload`. Gains the daemon's optional `min_client_version`.
- `src/shared/ipc/events.ts` → `DaemonEvent`'s `failed` member carries `error: ErrorPayload`, so the widened wire type is also the window's optional field. No edit here.
- `src/main/connectionRegistry.ts` → `reconnect(serverId)`: one connection per host; a manual retry is `connection.reconnect()` → `dial()`. No edit.
- `src/main/transport/fakeRelayForwarder.ts` → `closeClientLeg(code)`: drives a clean fatal close for the e2e spec.
- `e2e/host-conversation-list.spec.ts`: the two-host fixture shape (`secondServer`, `closeClientLeg`, host dot aria labels) the new spec mirrors.
- pyrycode `internal/relay/v2session_handshake.go` (the version-reject branch): the daemon sends the Noise response (a `hello_ack`), then `closeWith(4412, errFrame)`, so the client sees `handshake-complete` → sealed `error` → close `4412`, the same order as `auth.invalid_token`/`4401`. When sealing fails it sends the close alone.

## Design source

N/A — no new visual. The failure uses the existing generic failed treatment with a static line; the designed update-required host state is #1614.

## Context

A daemon whose release sets a desktop minimum answers an older build's hello with a sealed `client.update_required` error (optional `min_client_version`) and then WS close `4412` (pyrycode `docs/protocol-mobile.md` § Compatibility › The app-too-old rejection). Today `4412` is retryable in the supervisor and the error code is unrecognised, so the host loops through backoff re-dials and ends up as `offline`/`connection-closed`. The spec makes the rejection terminal for that host only, manual retry allowed.

No ADR needed; this extends the pairing-rejection path.

## Design

### Wire (`types.ts`)

`ErrorPayload` gains `min_client_version?: string` — daemon-authored, `omitempty`. Documented as untrusted: read only by the update-required narrowing below.

### Classifier (`inboundMessage.ts`)

The `daemon-error` member gains an optional field:

```ts
updateRequired?: { minClientVersion?: string }
```

Set only when `payload.code === 'client.update_required'` (comparand against a client-owned literal, like `pairingReject`). `minClientVersion` is present only when `payload.min_client_version` is a string matching `^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$` (digits-only `MAJOR.MINOR.PATCH`, at most 17 characters). Anything else — absent, non-string, pre-release suffix, whitespace, over-long — is dropped. The value is never logged; the existing `inbound-decoded` record is unchanged.

A separate field rather than a second member of `pairingReject`'s union: `pairingReject` carries no data, this one carries the version, and every other consumer keeps reading `pairingReject` unchanged.

### Supervisor (`relaySupervisor.ts`)

`DEFAULT_FATAL_CLOSE_CODES` becomes `{4401, 4412, 4421, 4426}`. A bare `4412` now ends supervision as `terminal` instead of scheduling a backoff re-dial.

### Connection (`daemonConnection.ts`)

- `messageFor('update-required')` → a static line naming no version: `This app is too old for this host. Update Pyrycode to reconnect.`
- `emitFailed` gains an optional `minClientVersion` it copies onto the failed event's `error.min_client_version` only when defined. The `daemon-failed` log keeps logging only the static `code`.
- **Sealed error arm.** When `inbound.updateRequired` is set (checked right after the existing `pairingReject` branch): run the four teardown nets (`failBundleStream`, `failAttachmentTransfers`, `failAttachmentRetrievals`, `abandonHistoryRequests`), then **halt this host's supervision**: bump `generation`, null `driver` and `stop()` it. Then `emitFailed('update-required', …, minClientVersion)`.
  - The generation bump is `dial()`'s own fence: the stopped driver's `terminal{1000}` and the relay's following `4412` close both carry the old generation and are dropped by the `onEvent` wrapper in `bootstrap`. That is the sticky treatment the ticket asks for, made structural: nothing after the rejection can reach `onDriverEvent`, so the close cannot overwrite `update-required` with `connection-closed`, and no `pairingRejected`-style flag is needed.
  - Halting on the error itself (rather than relying on the `4412` that follows) is what makes the sealed error alone stop re-dialling, as AC1 lists it as a sufficient trigger; a socket that drops with a retryable code after the error cannot resume a backoff loop.
- **Terminal arm.** `event.code === 4412` (a local `CLIENT_UPDATE_REQUIRED_CLOSE_CODE` constant beside `RELAY_NO_DAEMON_CLOSE_CODE`) → `emitFailed('update-required')` with no version; every other code keeps `connection-closed`. This is the close-without-sealed-error path. A sticky `pairingRejected` still wins inside `emitFailed`, unchanged.
- **Manual retry.** `reconnect()` → `dial()` builds a fresh driver under a new generation. Against a still-rejecting daemon it reaches the same sealed-error arm once and halts again — no loop. Against an updated app it connects normally.
- **Nothing persisted.** The rejection lives only in the connection's closure (the halted driver); no store is written, so a relaunch dials normally.

### Isolation

One `DaemonConnection` per host (`connectionRegistry`); `generation`, `driver` and the halt are per-closure. Other hosts' connections and their `hello_ack` capabilities are untouched.

## State + concurrency model

No new async work. The halt is synchronous inside `onDriverEvent`. The supervisor's pending backoff timer (if any) is cleared by the driver's `stop()` → supervisor `emitTerminal`. `stop()` of the connection afterwards is a no-op on a null driver; `reconnect()` works as today.

## Error handling

- Unparseable / malformed error frames are already dropped by `parseInboundMessage`'s catch.
- A malformed `min_client_version` degrades to a failure without a version, never a dropped rejection.
- `update-required` is `retryable: false` like every `failed` event.

## Testing strategy

Vitest (node):
- `inboundMessage.test.ts`: `client.update_required` with a valid version yields `updateRequired.minClientVersion`; absent / non-string / `1.2`, `1.2.3-beta`, ` 1.2.3`, `１.2.3` (full-width), over-long parts → `updateRequired: {}` with no version; another code → no `updateRequired`; the log record never contains the version string.
- `relaySupervisor.test.ts`: `4412` is in the default fatal set and a `closed{4412}` emits `terminal` with no re-dial.
- `daemonConnection.test.ts`:
  - sealed error then `terminal{4412}` → exactly one `failed` with code `update-required`, the static message, `min_client_version` when valid; driver stopped.
  - sealed error with malformed version → failed carries no `min_client_version`.
  - `terminal{4412}` alone → `update-required` without a version.
  - isolation: host B stays `connected`; manual `reconnect()` on A dials a new driver, and a repeat rejection yields one more failure and a stopped driver (no loop); a reconnect whose handshake completes emits `connected`.
  - `pairedServer.save` is never called (nothing persisted).

Playwright (`e2e/update-required-host.spec.ts`, fake transport): two hosts; `servers[1].forwarder.closeClientLeg(4412)` → host 2's dot goes Offline and stays so past the first backoff window (a 1006 would have re-connected within ~1 s), host 1 stays Connected; `window.pyry.reconnectServer(servers[1].serverId)` → host 2 Connected again.

## Open questions

- Does the fake-transport host dot read `Pyrycode Offline` for a `failed` host with this code? Expected yes (the generic failed treatment, as for `4401` in `host-conversation-list.spec.ts`); confirm when running the spec.

## Documentation handoff

Pending for the documentation stage: the ticket names no documentation acceptance criteria. Suggested: note the `update-required` failure code, the `4412` fatal close and the halt-on-sealed-error behaviour in the owning package overview for the daemon connection (search `docs/knowledge/CATALOG.md` for the connection/transport topic).

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the one new untrusted value, `ErrorPayload.min_client_version`, crosses at exactly one place: the update-required narrowing in `parseInboundMessage`'s `error` case. It is compared, never passed through: only a string matching an anchored ASCII-digit `MAJOR.MINOR.PATCH` pattern with a 5-digit cap per part (≤ 17 chars, no ReDoS — a linear pattern with no nested quantifiers) survives, and it reaches the window only as the failed event's optional `error.min_client_version`. The `code` string stays a comparand against the client-owned literal `client.update_required`, like `auth.invalid_token`.
- [Tokens] No findings — the ticket touches no token, key or credential; the pairing record is only read by the existing `loadDialConfig` on a manual retry.
- [File / storage] No findings — nothing is persisted (AC4); the rejection lives in the connection closure only, asserted by a unit test that `pairedServer.save` is never called.
- [Electron attack surface] No findings — no new IPC channel or bridge method; the manual retry is the existing `reconnectServer` → `connectionRegistry.reconnect(serverId)` path, whose request guard is unchanged.
- [Crypto] No findings — no change to the Noise session or framing; halting stops the driver, which tears its session down through the existing `stop()`.
- [Network & I/O] Noted, no new exposure — a content-blind hostile relay can now halt auto-reconnect for one host by closing with `4412`, but it already can with `4401`/`4421`/`4426` (all in `DEFAULT_FATAL_CLOSE_CODES`), and a bare `4412` carries no version, so the relay cannot inject one into the update-required state. A hostile daemon inside the session can send the sealed error, but it can already end the session with `auth.invalid_token`. Manual retry recovers in both cases. The halt removes the reconnect loop against a rejecting daemon rather than adding one.
- [Error messages / logs] No findings — `messageFor('update-required')` is static and names no version; the `daemon-failed` log keeps only the static code; the `inbound-decoded` record is unchanged and a unit test asserts the version string never appears in log records.
- [Concurrency] No findings — the halt is synchronous inside `onDriverEvent` and reuses `dial()`'s generation fence, so the stopped driver's terminal, the relay's following close and any in-flight bootstrap of an older generation are dropped. The supervisor's backoff timer is cleared by `emitTerminal` via the driver's `stop()`. A later `reconnect()` builds a fresh driver under a new generation, so no two sockets stack.
- [Threat model] OUT OF SCOPE — how the designed update-required state (#1614) renders the version and any "update" affordance; #1614 must keep the version as text only, never in a URL or attribute, per CLAUDE.md's daemon-text rule.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24

## Revisions

- 2026-09-24 (build): Open question resolved, no design change. A host failed with `update-required` shows the generic `Pyrycode Offline` dot, and `e2e/update-required-host.spec.ts` asserts it holds past the first backoff step. Probed once with a retryable code (`4413`) in place of `4412`: the spec reddens (`Pyrycode Connected` after the automatic re-dial), so it discriminates.
