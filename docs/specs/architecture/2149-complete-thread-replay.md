# Explicit complete-thread replay compatibility

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process boundaries and verification map.
- `docs/knowledge/features/development-verification.md`: native ABI sequencing and replay proof limits.
- `docs/knowledge/features/thread-runtime-compact.md`: omitted opening options retain complete delivery through reconnect.
- `docs/knowledge/features/conversation-shell.md`: authoritative thread composition.
- `src/renderer/src/PairedShell.tsx` → `PairedShell`: creation and ordinary opening select automatic delivery.
- `src/renderer/src/store/threadRuntime.ts` → `createThreadRuntime`: complete is the existing default; only automatic selections upgrade.
- `electron.vite.config.ts`, `e2e/recordings/capture.config.ts`: separate test build configuration precedent; no recorder import is needed.
- `scripts/run-offline-replay.mjs`, `scripts/offline-replay-guard.test.ts`: guarded process tree and credential removal.
- `e2e/fixtures/clientScenario.ts`, `e2e/fixtures/launchRecordedApp.ts`: unchanged shared assertions and strict exchange completion.
- `e2e/fixtures/recordedExchange.ts` → `RecordedExchange`: full-envelope matching, identity binding, causal barriers and close boundaries.
- `e2e/compact-demand.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: production application and compact-capable handshake controls.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: provenance and documentation handoff.

## Context
Automatic compact selection correctly changes requests when the authenticated host supports compact delivery. Older complete-thread recordings need an explicit current-source complete-route profile. This is one useful behavior: its build seam, invocation and strict regression controls ship together. #2141 owns the independent close-ordering repair and final combined retained-scenario pass. No ADR is needed.

Sizing: approximately 600 written lines including plan, controls and evidence; one new exported policy value, two updated production consumers, four observable criteria, no new protocol state machine. The analogue #2072 initially added 277/deleted 10 lines; these extra build/isolation controls account for the larger forecast. Recount before implementation and handoff against the 800-line ceiling. Remote feature-branch audit found no overlapping planned existing files.

## Design
- A small renderer policy module exports the opening options used by both `PairedShell` calls. Normal source exports automatic selection.
- A separate `e2e/recordings/complete-thread.config.ts` aliases only that policy module to a test-owned module exporting omitted options. No negotiation, codec, transport, wire, matcher or recording changes.
- `node scripts/run-offline-replay.mjs --profile complete-thread ...` explicitly builds this configuration before launching the original guarded replay. No profile means the existing normal-build invocation. Unknown profiles fail before launch.
- Compatibility uses the ordinary output temporarily and restores a normal build in `finally`, including build/test failure. Restoration failure fails the command. A profile is never chosen from an application environment variable, IPC or renderer state.
- Runner evidence identifies executed revision/dirty status, profile and SHA-256 of every executable bundle separately from capture provenance. Replay attachments add the raw input SHA-256 alongside unchanged capture source and exchange counts.
- A focused application control uses compact-capable authentication and strict complete-thread matching, without captured closes. It proves initial opening, created-conversation activation and accepted reconnect. Normal selection and changed payload controls must reject strictly; existing compact-demand coverage uses the normal build.

## State + concurrency model
No new application state, stream or background task. Existing thread runtime owns selection and teardown. The runner performs build, replay and restoration sequentially; native Node/Electron preparation is also sequential. The guard still covers the entire replay process tree.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Initial open under compact-capable authentication | `complete-thread-profile.spec.ts`: strict complete query accepted in compatibility; normal query rejected |
| Created-conversation activation | Same application control: the second production opening site retains complete |
| Accepted reconnect with the same host/chat IDs | Same application control: no automatic upgrade in compatibility |
| Default automatic reconnect/demand | Existing `compact-demand.spec.ts`, normal build |
| Success or failure of a compatibility run | Runner controls: normal restoration always executes |
| Changed payload or wrong profile | Strict mismatch controls; matcher remains unchanged |

## Error handling
Unknown profile, build failure, replay failure and restoration failure yield nonzero exit. No mismatch fallback. The existing exchange remains sticky on mismatches and incomplete requests. Logs/attachments contain only provenance, checksums and counts, never payloads. Missing retained bytes remain an explicit acceptance blocker rather than substituted evidence.

## Testing strategy
- Test first: build-policy and runner controls fail before implementation; production app regression initially exposes the compact projection mismatch.
- Unit/configuration controls verify normal versus complete build selection, no capture imports, restoration after success/failure and strict changed payload rejection. Existing exchange/guard tests retain their original assertions.
- Focused Playwright application control exercises both real selection sites and reconnect using existing encrypted fake transport and the strict matcher, without #2141 scheduling.
- Run exact unchanged retained question input with retries zero under both profiles if available; compatibility must accept its complete query and reach close index 47. Any subsequent close failure stays a failed full scenario. Never infer #2141's required 1/1 complete exchange from prefix evidence.
- Final main merge, install, affected pre-verify checks, normal build, Electron ABI preparation, normal compact-demand and complete guarded committed-recording suite with retries zero. Preserve system-prompt-reset fixme. Record executed/passed/failed/skipped, exchange and forbidden-launch counts on Linux; macOS is outside scope. No fresh live/provider claim.

## Open Questions
- Required retained bytes are absent locally; supported provisioning is pending. SHA-256 must equal `24bbe5dff65241a77dda96cbd262c9185925d88f6168439a1679b576b984dac1` before the exact scenario runs. This does not prevent independent implementation/controls; it prevents claiming completed acceptance.

## Documentation handoff
- Pending documentation stage: `docs/recorded-tests.md`, “Replay contract”: explicit compatibility invocation, build isolation/restoration, executed revision/profile/bundle hashes/input checksum separately from capture provenance; current-source complete route versus default automatic projection, with no fresh provider or physical transport proof.
- Pending documentation stage: `docs/client-replay-migration.md`, replay evidence description: retain the same complete-route/default-policy distinction.
