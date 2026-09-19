# Named-host reconnect IPC

## Context

Ticket #1509 exposes an explicit retry after a terminal connection failure, without
restarting the app. It ends at the preload API; #1510 owns the composer control and
integrated fake-transport proof. No UI, wire format, or retry policy changes.

Sizing: one deliverable, five production files, approximately 400 written lines
including tests and this plan, two new exported types/interfaces, zero existing
consumer migrations, four acceptance criteria, and two handler failure branches.
The #173 analogue added 260 lines across five files; this adds registry coverage
and stricter validation. All six ticket boundaries hold. Source searches found one
production registry construction and two test constructions, with no independent
registry or preload API implementations requiring migration. The refreshed scan
of 22 other remote feature branches found no overlapping files.

## Files read

- `src/main/connectionRegistry.ts` — `createConnectionRegistry`, `Entry`, `viewOf`,
  `runReconcile`, `ActiveConnection`: held-entry ownership and lifecycle exclusion.
- `src/main/connectionRegistry.test.ts` — `harness`, `createFactoryFake`, `settle`:
  existing per-host lifecycle counters and reconciliation control.
- `src/main/daemonConnection.ts` — `dial`, `bootstrap`, `reconnect`, `stop`:
  fresh dials, generation fencing, and permanent shutdown already exist.
- `src/main/unpairHandler.ts` and its tests — `registerUnpairServerHandler`,
  `UnpairServerHandleTarget`, `fakeServerTarget`: injectable invoke registration.
- `src/shared/ipc/unpair.ts` — `isUnpairServerRequest`: naming precedent only;
  its permissive extra-field and length rules are not this request's contract.
- `src/preload/index.ts` and `index.d.ts` — `api`, `PyryApi`: a fixed-channel
  method automatically updates the window API type.
- `src/main/index.ts` — `createWindow`, `registry`, `unregisterUnpairServer`:
  registration after registry construction and removal on `will-quit`.
- `src/main/diagnosticLog.ts` — `DiagnosticLog`, `DiagnosticEvent`: shared
  non-throwing logger with content-free event envelopes.
- `docs/knowledge/features/daemon-connection-registry.md` — “The entry set and
  its one invariant”, “Reconcile”: null stand-in and exact string matching.
- `docs/knowledge/features/daemon-connection.md` — “What it does”: reconnect
  outcomes already travel through daemon events.
- `docs/knowledge/features/unpair-channel.md` — “How it works”: IPC layering.
- `docs/knowledge/features/diagnostic-log.md` — “Security posture”: static text
  must be enforced at call sites; the logger spreads its event input.
- `docs/knowledge/features/development-verification.md` — “Source and contract
  checks”, “What each test tier proves”: source fallback and unit-test boundaries.

Codegraph context was unavailable (index not initialized); file reads and text
search supplied the symbol and consumer map.

## Design

- Add `ConnectionRegistry.reconnect(serverId: string): void` in
  `src/main/connectionRegistry.ts`. Find the held entry with a linear `===` scan
  and invoke only its connection's `reconnect()`. Unknown strings and the null-id
  stand-in cannot match. Do not extend `ActiveConnection` or `viewOf`.
- Create `src/shared/ipc/reconnectServer.ts` exporting `RECONNECT_SERVER_CHANNEL`
  (`pyry:reconnect-server`), `ReconnectServerRequest`,
  `reconnectServerRequest(serverId)`, and `isReconnectServerRequest(value)`.
  The constructor returns a fresh `{ serverId }`. The guard accepts only a
  non-null, non-array object with exactly one own key, `serverId`, holding a
  string. Count all own keys, including symbols and non-enumerable fields.
  Empty, long, and prototype-shaped ids are ordinary strings; no normalization
  or length restriction is added.
- Create `src/main/reconnectServerHandler.ts` with
  `registerReconnectServerHandler(target, deps): () => void` and a minimal
  `ReconnectServerHandleTarget` (`handle`, `removeHandler`). Dependencies are
  `Pick<ConnectionRegistry, 'reconnect'>` and the shared `DiagnosticLog`.
  The async invoke listener strips the Electron event, validates the request,
  calls `registry.reconnect` once with the id, and resolves `undefined`.
- Expose `api.reconnectServer(serverId: string): Promise<void>` from
  `src/preload/index.ts`, constructing the request on the fixed channel and
  discarding invoke result data. Register once in `src/main/index.ts` beside
  unpair and remove that handler on `will-quit`.

## State + concurrency model

The handler is stateless and the registry lookup has no await. It uses the entries
held at invocation, including the stand-in during initial loading. It introduces
no queue, timer, subscription, store slice, or async transport owner. Repeated
requests each reach the existing reconnect lifecycle; `dial` replaces the driver
and generation-fences stale bootstrap work. `DaemonConnection.stop` keeps later
calls inert. Progress and outcomes remain on `DAEMON_EVENT_CHANNEL`.

## Error handling

Malformed IPC data is refused before registry access and acknowledged with no
data. Log only `{ event: 'reconnect-server-refused', code: 'malformed-request' }`.
Accepted dispatch logs `{ event: 'reconnect-server-requested' }`. If the trusted
dispatch throws, drop the error object and log
`{ event: 'reconnect-server-failed', code: 'dispatch-failed' }`, still acknowledging
without data. Never spread requests or forward ids, payloads, or exception text
to diagnostics. The logger's existing non-throwing contract applies.

## Testing strategy

Write and run failing unit tests before production changes, then rerun touched
specs and `npm run build`. No Electron or UI test is needed for this slice.

- Extend registry fakes: target alpha/beta independently, repeat a request,
  unknown-id and stand-in no-ops, and exact empty/prototype-shaped id matching.
  Existing lifecycle-exclusion assertions remain unchanged.
- Shared contract: fixed channel, fresh construction, accepted strings, rejection
  of non-objects, arrays, inherited/missing/non-string ids, and all extra own
  fields, including `undefined`, symbols, and non-enumerable fields.
- Handler fake: one registration and exact teardown, one accepted dispatch,
  empty acknowledgements, malformed refusal without dispatch, exact constant
  diagnostic records, and no exception details on dispatch failure.
- Preload test with mocked Electron: exposed API constructs the fixed-channel
  request and resolves without forwarding invoke result data.

## Open questions

None. The issue deliberately leaves visible recovery and integrated proof to #1510.

## Documentation handoff

Pending for the documentation stage: the refiner requires “folding the shipped
reconnect contract into the relevant knowledge topics.” Document
`ConnectionRegistry.reconnect`, exact-match/no-op semantics, and the preload IPC
contract in `docs/knowledge/features/daemon-connection-registry.md` under
“Wiring — the four lifecycle sites in `src/main/index.ts`” and the named reconnect
entry point in `docs/knowledge/features/daemon-connection-lifecycle.md` under
“Composition-root wiring (`src/main/index.ts`)”. No documentation-only acceptance criterion or exact path
was specified in the issue body; these are the proposed owning sections.

## Security review

**Verdict:** PASS

- [Trust boundaries] `isReconnectServerRequest` is the explicit renderer-to-main
  gate. It checks all own keys before dispatch; extra undefined data is refused.
  The id remains untrusted text even after its shape is validated.
- [Tokens] The handler holds only the reconnect method, never a record reader.
  Token generation, storage, revocation, and keychain fallback are unchanged.
- [File/storage operations] No new storage or path operation exists. An id only
  participates in the registry's exact-match scan; it cannot select a filename.
- [Electron attack surface] One fixed invoke channel exposes only reconnect.
  `createWindow` already sets sandbox/context isolation, leaves Node integration
  disabled, guards navigation, and denies internal window opening. No new window
  or remote content is introduced. Validation is for structured-cloned IPC data;
  proxies and executable accessors cannot cross this channel.
- [Cryptography] Existing `dial` builds a fresh driver/Noise session; no nonce,
  key, primitive, or wire constant changes. Id comparison is not secret comparison.
- [Network/I/O] An id cannot supply a new endpoint: only a held connection is
  callable. Existing configuration loading and transport limits remain in force.
  Explicit repeated requests each dial, as required; no automatic retry is added.
- [Logs/errors] Every new log is a fresh object containing client-owned literals.
  No server id, request, IPC event, caught error, or result data reaches logs or
  acknowledgements. The shared logger contains sink failures.
- [Concurrency] Lookup and dispatch have no await gap. Existing driver teardown,
  generation fencing, and permanent stop own cancellation. Shutdown removes the
  fixed handler. No lifecycle members escape through connection views.
- [Threat alignment] A compromised renderer can ask a held host to redial, the
  intended capability, but cannot read secrets or reach sockets. Relay hostility,
  daemon response parsing, and at-rest token protection stay in their existing
  transport/storage owners; this change introduces no new paths to those assets.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-19
