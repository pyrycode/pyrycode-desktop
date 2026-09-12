# Saved-host restart authentication

## Context

The report is not yet a reproduced storage defect. Saved rows and successful relay
connections do not establish daemon authentication. First add a repeatable proof
using the production encryption backend, then select a reconnect fix only from an
observed failure category. Do not weaken token rejection or regenerate an existing
device identity. Authentication-aware pairing completion belongs to #1366.

## Files read

- `src/main/pairedServerStore.ts` → `createPairedServerStore`, `readForSave`: keyed collection, strict decrypt failures and serialized mutations.
- `src/main/deviceKeypair.ts` → `createDeviceKeypairStore`, `load`: present identity is reused; generation is persisted before use.
- `src/main/connectionRegistry.ts` → `viewFor`, `runReconcile`, `start`: each host reloads its own record after the initial collection read.
- `src/main/index.ts` → `openWindow`, `before-quit` handler: renderer readiness starts the registry; quit stops it without erasing credentials.
- `src/main/daemonConnection.ts` → `loadDialConfig`, `onDriverEvent`: saved token and device key drive authentication; only parsed `hello_ack` emits `connected`.
- `src/main/liveWindow.ts` → `createLiveWindow`, `replayStatus`: main-process status survives renderer reload, but cannot survive process exit.
- `src/main/electronSecretEncryption.ts` → `electronSecretEncryption`: OS encryption, with unavailable/basic-text backends rejected.
- `src/main/fileSecretPersistence.ts` → `fileSecretPersistence`: fixed encoded names, owner-only storage, atomic writes.
- `e2e/fixtures/realDaemon.ts` → `withIsolatedElectronApp`, daemon fixture: current app lifecycle discards data; real daemon can run without Claude.
- `e2e/fixture-teardown-leak.spec.ts` → setup-failure test: cleanup must preserve the causal error and remove owned resources.
- `e2e/fixtures/pairingArrival.ts` → pairing entry helpers: normal UI pairing without payload-bearing assertions.
- `docs/knowledge/features/paired-server-store.md` and `device-keypair.md`: unreadable is distinct from absent; device identity must not regenerate.
- `docs/knowledge/features/daemon-connection-registry.md`: per-host views prevent newest-pairing aliasing.
- `docs/knowledge/features/real-daemon-credential-light-e2e.md`, `live-e2e-runbook.md`, `development-verification.md`: real authentication, executed counts and static-test limits.

Codegraph reported an uninitialized index; repository reads supplied this map.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Read design context and screenshot: a 400px sidebar groups hosts and workspaces,
with separate host/relay dots, beside a flexible conversation pane. Host repair
and the pairing-error control use existing error/primary theme roles. This work
changes no renderer markup, layout, typography or assets.

## Design

Extend `withIsolatedElectronApp` with an opt-in OS encryption mode and a relaunch
handle. Its default remains test encryption. Relaunch awaits full Electron exit
and creates a new process using the same fixture-owned application directory;
daemon and relay lifetimes remain outside that operation. No arbitrary directory
parameter or credential reseeding is introduced.

Add `e2e/real-daemon-restart.spec.ts` with `spawnClaude: false`. Confirm the real
backend is available and selected, pair through the UI, then relaunch twice.
Observe host-specific status at the main-process send boundary. A renderer reload
may request replay after installing observation: replay is acceptable only in a
verified new process, whose status cache starts empty. It does not itself count
as a restart or a fresh authentication. Project diagnostics to static categories
and booleans, excluding acknowledgements, payloads and identifiers.

Save a second independent host through the UI using an explicitly synthetic fake
peer. Authenticate it before testing rejection/unavailability. Verify the real
host authenticates after both relaunches, and both identities/labels and encrypted
credential files remain unchanged. This peer proves isolation, not real token
redemption. Existing fake-tier recovery tests remain the manual-repair proof.

Add stop/start controls to the real-daemon fixture using the same daemon home,
arguments and relay. After verified authentication, stop the daemon, observe loss
of authentication, restart it and require automatic authentication without repair.

## State + concurrency model

No application state or API changes. The app fixture owns one live Electron child
at a time and one temporary directory. A stale relaunch handle is rejected.
Teardown closes the current child before removing its data. The daemon fixture
owns and reaps its current process group; restart does not rerun pairing or seed
the registry. Existing connection cancellation and per-host reconciliation stay
authoritative.

## Error handling

Encryption unavailable is an explicit environment failure, never a test-backend
fallback. Awaited exit must finish before another launch. Reports distinguish
initial authentication, first/second relaunch and outage recovery using fixed
stage names and content-free main-process status. If live evidence finds no
restart failure, return it for triage. If it isolates a daemon defect, propose that
blocker instead of changing desktop authentication speculatively.

## Testing strategy

- First add a fake-tier fixture lifecycle test that fails because relaunch is absent; then implement the lifecycle and run the touched fixture spec.
- The real regression requires OS encryption, initial authentication, two new process lifetimes, retained ciphertext and host isolation, plus daemon outage/recovery.
- Run `npm run build` and real-tier discovery. The dispatcher owns execution of the real spec and recording its result; this builder does not obtain Claude credentials or run the live tier.
- A production fix requires observed RED evidence first, an appended revision selecting its cause, a focused regression and touched-scope verification. Until that evidence exists, the deliverable is the reproduction harness, not a claimed reconnect fix.

## Open questions

- What content-free category fails after verified initial authentication? Pending dispatcher execution; source inspection alone does not answer it.
- Does the installed daemon reproduce the report? Pending dispatcher execution against the maintained test binary.

## Size and overlap

One deliverable: authenticated restart persistence. Estimate about 550 written
lines for the proof, fixture changes and plan, leaving room within the refiner's
650-line estimate for a small evidence-based fix. Current plan: zero production
files, no new exported types, zero required consumer updates, four acceptance
criteria, no new production rejection branches. Before any fix, recheck the
three-production-file estimate and 800-line ceiling. Refreshed remote feature
branches showed no overlaps with the investigated source and planned fixture/spec
paths. The #466 analogue is 114 inserted and 11 deleted lines.

## Documentation handoff

Pending documentation stage: record the confirmed cause and restart coverage in
`docs/knowledge/features/paired-server-store.md` under “Edge cases and limitations”,
and update the real-tier coverage/count in
`docs/knowledge/features/live-e2e-runbook.md` under “Current real-claude gate state”.
The PR must report the added real-tier test count and hand its executed evidence
and gate-floor update to the dispatcher.

## Security review

**Verdict:** PASS

- Trust boundaries: observe only `onDriverEvent`'s host-stamped status downstream of parsed `hello_ack`; never synthesize success or trust a saved row.
- Tokens: OS `safeStorage` is mandatory in the real proof. Credentials remain in the application/daemon's isolated storage and never enter assertion diffs or attachments.
- Storage: only fixture-minted directories are removed. Fixed persistence names are compared as ciphertext using boolean equality; no plaintext snapshot is written.
- Electron: no new IPC or production hooks, navigation permissions, or window settings. Test observation does not expose keys to the renderer.
- Cryptography: keep the existing vetted Noise implementation, fresh session handshakes and stored device identity; no token bypass or nonce reuse.
- Network: keep existing relay validation, frame limits and supervisor deadlines. Loopback is the existing unpackaged-only fixture affordance; no TLS policy change.
- Diagnostics: no raw daemon stderr added to failure artifacts, no secret-bearing screenshots/traces/video, no acknowledgements or tokens returned by observation.
- Concurrency: await process exit; one current process per fixture; cleanup removes owned resources on success and failure. Relaunch cannot reuse a live process.
- Threat model: malicious relay/daemon input remains checked by the existing Noise/parser boundaries. Authentication-aware pairing completion is out of scope in #1366; no new security exception is introduced here.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-12
